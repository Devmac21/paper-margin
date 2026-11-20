/**
 * Builds and sends a circle's weekly digest. Used by the Monday cron task
 * (every opted-in member) and by the owner's preview action (one recipient).
 *
 * Emails go out one recipient at a time so members never see each other's
 * addresses. Sends are billed to the app owner through `email/send`.
 */

import { buildCronContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import { composeDigest, WEEK_MS, type DigestPaper } from '../lib/digest'
import { flag } from '../lib/flag'
import type { ReadingGuide } from '../lib/guide'
import { createStore, toMillis, type MemberRow } from './store'

interface PaperRow {
  title?: string
  guide?: ReadingGuide | null
}

export function appUrl(env: Pick<Env, 'APP_NAME'>): string {
  return `https://${env.APP_NAME}.app.space`
}

export async function sendCircleDigest(
  env: Env,
  circleId: string,
  options: { onlyUserId?: string } = {},
): Promise<{ sent: number; reason?: string }> {
  const store = createStore(env, env.OWNER_USER_ID)
  const circle = await store.get<{ name: string }>('circles', circleId)
  if (!circle) return { sent: 0, reason: 'Circle not found.' }

  const since = Date.now() - WEEK_MS
  const [papers, notes, members] = await Promise.all([
    store.query<PaperRow>('papers', { circleId }),
    store.query<{ paperId: string }>('notes', { circleId }, 2000),
    store.query<MemberRow>('team_members', { teamId: circleId, status: 'active' }),
  ])

  const weekNotes = notes.filter((n) => toMillis(n.createdAt) > since)
  const notesByPaper = new Map<string, number>()
  for (const n of weekNotes) notesByPaper.set(n.data.paperId, (notesByPaper.get(n.data.paperId) ?? 0) + 1)

  const asDigest = (p: (typeof papers)[number]): DigestPaper => ({
    paperId: p.recordId,
    title: p.data.title ?? 'Untitled paper',
    tldr: p.data.guide?.tldr ?? null,
    addedAt: new Date(toMillis(p.createdAt)).toISOString(),
    noteCount: notesByPaper.get(p.recordId) ?? 0,
  })
  const newPapers = papers.filter((p) => toMillis(p.createdAt) > since).map(asDigest)
  const activePapers = papers
    .map(asDigest)
    .filter((p) => p.noteCount > 0)
    .sort((a, b) => b.noteCount - a.noteCount)
    .slice(0, 3)

  const email = composeDigest({
    circleName: circle.data.name,
    circleUrl: `${appUrl(env)}/c/${circleId}`,
    newPapers,
    activePapers,
    noteCount: weekNotes.length,
  })
  if (!email) return { sent: 0, reason: 'Nothing new this week, so there is nothing to send.' }

  const recipients = members.filter((m) =>
    options.onlyUserId ? m.data.userId === options.onlyUserId : flag(m.data.digest, true),
  )
  const ctx = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)

  let sent = 0
  const failures: string[] = []
  for (const m of recipients) {
    const user = await store.get<{ email?: string }>('users', m.data.userId)
    const to = user?.data.email
    if (!to) continue
    try {
      await ctx.integrations.call('email/send', { to, subject: email.subject, text: email.text, html: email.html })
      sent++
    } catch (err) {
      // Log the membership id, never the address.
      console.error(`[digest] send failed for member ${m.recordId}: ${(err as Error).message}`)
      failures.push(m.recordId)
    }
  }
  if (failures.length && sent === 0) throw new Error(`All ${failures.length} digest sends failed`)
  return { sent }
}
