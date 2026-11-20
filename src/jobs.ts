/**
 * Background jobs, run by AppJobRoom (worker.ts).
 *
 * `digest-paper` turns an arXiv id into a reading guide:
 *   1. fetch metadata from the arXiv API,
 *   2. fetch the HTML render of the full text (falls back to the abstract),
 *   3. ask Claude for a structured guide and validate it,
 *   4. write the guide onto the paper record.
 *
 * Every stage writes `status`/`statusMessage` onto the paper record, so all
 * members of the circle watch progress live through their normal record
 * subscription. The job room itself stays owner-only (see worker.ts).
 */

import { buildCronContext } from 'deepspace/worker'
import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../worker'
import { extractPaperText, parseArxivAtom } from './lib/arxiv'
import { buildGuidePrompt, GUIDE_SYSTEM_PROMPT, parseGuide, replyText } from './lib/guide'
import { createStore } from './server/store'

const MODEL = 'claude-haiku-5-5'
const ARXIV_HEADERS = { 'User-Agent': 'paper-margin (reading-group app; https://paper-margin.app.space)' }
const MIN_FULLTEXT_CHARS = 2_000

export async function runJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  if (job.type === 'digest-paper') {
    const { paperId } = job.payload as { paperId: string }
    return digestPaper(paperId, ctx, env)
  }
  throw new Error(`Unknown job type: ${job.type}`)
}

async function digestPaper(paperId: string, ctx: JobContext, env: Env) {
  const store = createStore(env, env.OWNER_USER_ID)
  const paper = await store.get<{ arxivId: string }>('papers', paperId)
  if (!paper) return { skipped: 'paper was removed' }
  const { arxivId } = paper.data
  const stage = async (status: string, statusMessage: string, progress: number) => {
    ctx.progress(progress, statusMessage)
    await store.update('papers', paperId, { status, statusMessage })
  }

  try {
    await stage('fetching', 'Fetching the paper from arXiv', 0.1)
    const atom = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`, {
      headers: ARXIV_HEADERS,
      signal: ctx.signal,
    })
    if (!atom.ok) throw new Error(`arXiv answered ${atom.status}`)
    const meta = parseArxivAtom(await atom.text(), arxivId)
    if (!meta) throw new Error(`arXiv has no paper with id ${arxivId}`)
    await store.update('papers', paperId, {
      title: meta.title,
      authors: meta.authors,
      abstract: meta.abstract,
      publishedAt: meta.publishedAt,
    })

    await stage('fetching', 'Reading the full text', 0.3)
    const fullText = await fetchFullText(arxivId, ctx.signal)

    await stage('reading', fullText ? 'Writing the reading guide' : 'No HTML full text; writing a guide from the abstract', 0.5)
    const ai = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`).integrations
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: buildGuidePrompt({ ...meta, fullText }) },
    ]
    let reply = replyText(
      await ai.call('anthropic/chat-completion', { model: MODEL, max_tokens: 3000, system: GUIDE_SYSTEM_PROMPT, messages }),
    )
    let guide = parseGuide(reply)
    if (!guide) {
      // One repair turn: models occasionally wrap JSON in prose or miss a key.
      await stage('reading', 'Tidying up the guide', 0.8)
      messages.push(
        { role: 'assistant', content: reply || '(empty)' },
        { role: 'user', content: 'That was not valid JSON with every required key. Reply with only the JSON object.' },
      )
      reply = replyText(
        await ai.call('anthropic/chat-completion', { model: MODEL, max_tokens: 3000, system: GUIDE_SYSTEM_PROMPT, messages }),
      )
      guide = parseGuide(reply)
    }
    if (!guide) throw new Error('The model did not return a usable guide')

    ctx.progress(1, 'Ready')
    await store.update('papers', paperId, {
      guide,
      source: fullText ? 'fulltext' : 'abstract',
      status: 'ready',
      statusMessage: '',
    })
    return { arxivId, source: fullText ? 'fulltext' : 'abstract' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[digest-paper] ${paperId} (${arxivId}) failed: ${message}`)
    // The paper may have been removed mid-run; nothing to mark then.
    await store
      .update('papers', paperId, { status: 'failed', statusMessage: message.slice(0, 300) })
      .catch(() => undefined)
    throw err
  }
}

/** arXiv's HTML render exists for most papers since late 2023; older ones 404. */
async function fetchFullText(arxivId: string, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`https://arxiv.org/html/${arxivId}`, { headers: ARXIV_HEADERS, signal, redirect: 'follow' })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return null
    const text = extractPaperText(await res.text())
    return text.length >= MIN_FULLTEXT_CHARS ? text : null
  } catch (err) {
    if (signal.aborted) throw err
    return null
  }
}
