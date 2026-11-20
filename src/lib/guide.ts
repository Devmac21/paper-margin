/**
 * The reading guide the digest job asks the model to write, and the strict
 * parser that decides whether the model's answer is usable.
 *
 * Every guide section has a stable `anchor` so margin notes can attach to it.
 */

import { z } from 'zod/v4'

export const GUIDE_SECTIONS = [
  { anchor: 'tldr', label: 'TL;DR' },
  { anchor: 'problem', label: 'Problem' },
  { anchor: 'method', label: 'Method' },
  { anchor: 'results', label: 'Results' },
  { anchor: 'limitations', label: 'Limitations' },
] as const

export type SectionAnchor = (typeof GUIDE_SECTIONS)[number]['anchor']

const guideSchema = z.object({
  tldr: z.string().min(1).max(600),
  problem: z.string().min(1).max(1500),
  method: z.string().min(1).max(2500),
  results: z.string().min(1).max(2000),
  limitations: z.string().min(1).max(1500),
  questions: z.array(z.string().min(1).max(400)).min(3).max(6),
  glossary: z
    .array(z.object({ term: z.string().min(1).max(80), meaning: z.string().min(1).max(300) }))
    .max(8)
    .default([]),
})

export type ReadingGuide = z.infer<typeof guideSchema>

/** Anchor for discussion question i (0-based). */
export const questionAnchor = (i: number) => `q:${i}`

export function anchorLabel(anchor: string): string {
  const section = GUIDE_SECTIONS.find((s) => s.anchor === anchor)
  if (section) return section.label
  const q = anchor.match(/^q:(\d+)$/)
  if (q) return `Question ${Number(q[1]) + 1}`
  return anchor === 'general' ? 'General' : anchor
}

export function isValidAnchor(anchor: string, guide: ReadingGuide | null): boolean {
  if (anchor === 'general') return true
  if (GUIDE_SECTIONS.some((s) => s.anchor === anchor)) return true
  const q = anchor.match(/^q:(\d+)$/)
  return !!q && !!guide && Number(q[1]) < guide.questions.length
}

export const GUIDE_SYSTEM_PROMPT = [
  'You write reading guides for small research reading groups.',
  'Be concrete and faithful to the paper: name the actual datasets, numbers, and baselines it reports.',
  'Never invent results. If the provided text lacks something (e.g. only the abstract is available), say so briefly in that field.',
  'Discussion questions should provoke debate among readers (assumptions, failure modes, alternatives), not quiz facts.',
  'Answer with a single JSON object and nothing else.',
].join(' ')

export function buildGuidePrompt(input: {
  title: string
  authors: string[]
  abstract: string
  fullText: string | null
}): string {
  const source = input.fullText
    ? `Full text (may be truncated):\n${input.fullText}`
    : 'Only the abstract is available for this paper.'
  return [
    `Title: ${input.title}`,
    `Authors: ${input.authors.slice(0, 12).join(', ')}`,
    `Abstract: ${input.abstract}`,
    '',
    source,
    '',
    'Return JSON with exactly these keys:',
    '{"tldr": string (2 sentences), "problem": string, "method": string, "results": string,',
    ' "limitations": string, "questions": string[] (4 discussion questions),',
    ' "glossary": {"term": string, "meaning": string}[] (up to 6 terms a newcomer would need)}',
    'Use plain prose; short paragraphs are fine. No markdown headings.',
  ].join('\n')
}

/** Extracts and validates the JSON object from a model reply. */
export function parseGuide(reply: string): ReadingGuide | null {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = guideSchema.safeParse(JSON.parse(reply.slice(start, end + 1)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Pulls the text out of an anthropic/chat-completion integration response. */
export function replyText(response: unknown): string {
  const r = response as { data?: unknown; content?: unknown }
  const body = (r && typeof r === 'object' && 'data' in r ? r.data : r) as {
    content?: Array<{ type?: string; text?: string }>
  }
  if (!body || !Array.isArray(body.content)) return ''
  return body.content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
}
