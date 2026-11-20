/**
 * Weekly circle digest: what was added and discussed in the last 7 days.
 * Pure composition so the cron task, the "send now" action, and tests share it.
 */

export interface DigestPaper {
  paperId: string
  title: string
  tldr: string | null
  addedAt: string
  noteCount: number
}

export interface DigestInput {
  circleName: string
  circleUrl: string
  newPapers: DigestPaper[]
  activePapers: DigestPaper[]
  noteCount: number
}

export interface DigestEmail {
  subject: string
  text: string
  html: string
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Returns null when nothing happened, so quiet circles get no email. */
export function composeDigest(input: DigestInput): DigestEmail | null {
  const { circleName, circleUrl, newPapers, activePapers, noteCount } = input
  if (newPapers.length === 0 && noteCount === 0) return null

  const subject = `${circleName}: ${plural(newPapers.length, 'new paper')}, ${plural(noteCount, 'margin note')} this week`
  const paperUrl = (p: DigestPaper) => `${circleUrl}/p/${p.paperId}`

  const textLines = [`This week in ${circleName}`, '']
  if (newPapers.length) {
    textLines.push('New papers:')
    for (const p of newPapers) textLines.push(`- ${p.title}${p.tldr ? `\n  ${p.tldr}` : ''}\n  ${paperUrl(p)}`)
    textLines.push('')
  }
  if (activePapers.length) {
    textLines.push('Most discussed:')
    for (const p of activePapers) textLines.push(`- ${p.title} (${plural(p.noteCount, 'note')})\n  ${paperUrl(p)}`)
    textLines.push('')
  }
  textLines.push(`Open the circle: ${circleUrl}`, '', 'You can turn off this digest from the circle page.')

  const li = (p: DigestPaper, extra: string) =>
    `<li style="margin:0 0 12px"><a href="${escapeHtml(paperUrl(p))}">${escapeHtml(p.title)}</a>${extra}</li>`
  const html = [
    `<div style="font-family:Georgia,serif;max-width:560px;color:#2b2620">`,
    `<h2 style="font-weight:normal">This week in ${escapeHtml(circleName)}</h2>`,
    newPapers.length
      ? `<h3>New papers</h3><ul>${newPapers
          .map((p) => li(p, p.tldr ? `<br><span style="color:#6b6257">${escapeHtml(p.tldr)}</span>` : ''))
          .join('')}</ul>`
      : '',
    activePapers.length
      ? `<h3>Most discussed</h3><ul>${activePapers.map((p) => li(p, ` · ${plural(p.noteCount, 'note')}`)).join('')}</ul>`
      : '',
    `<p><a href="${escapeHtml(circleUrl)}">Open the circle</a></p>`,
    `<p style="color:#8a8073;font-size:12px">You can turn off this digest from the circle page.</p>`,
    `</div>`,
  ].join('')

  return { subject, text: textLines.join('\n'), html }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000
