/**
 * arXiv helpers shared by the server action (input validation) and the
 * digest job (metadata + full text). Pure string functions so they run in
 * the Worker and in Vitest alike.
 */

/** New-style ids (2401.01234, optional vN) and old-style ids (hep-th/9901001). */
const NEW_ID = /(\d{4}\.\d{4,5})(v\d+)?/
const OLD_ID = /([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/

/**
 * Accepts a bare id or any arxiv.org abs/pdf/html URL and returns the
 * version-less id, or null when the input is not an arXiv reference.
 */
export function parseArxivId(input: string): string | null {
  const raw = input.trim()
  if (!raw || raw.length > 300) return null

  let candidate = raw.replace(/^arxiv:/i, '')
  if (/^https?:\/\//i.test(candidate)) {
    let url: URL
    try {
      url = new URL(candidate)
    } catch {
      return null
    }
    if (!/(^|\.)arxiv\.org$/i.test(url.hostname)) return null
    candidate = url.pathname.replace(/^\/(abs|pdf|html)\//, '').replace(/\.pdf$/i, '')
  }

  const newMatch = candidate.match(new RegExp(`^${NEW_ID.source}$`))
  if (newMatch) return newMatch[1]
  const oldMatch = candidate.match(new RegExp(`^${OLD_ID.source}$`))
  if (oldMatch) return oldMatch[1]
  return null
}

export interface ArxivMetadata {
  arxivId: string
  title: string
  authors: string[]
  abstract: string
  publishedAt: string
}

const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')

const squash = (s: string) => decodeEntities(s).replace(/\s+/g, ' ').trim()

/** Parses the Atom feed returned by export.arxiv.org/api/query?id_list=… */
export function parseArxivAtom(xml: string, arxivId: string): ArxivMetadata | null {
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1]
  if (!entry) return null
  const title = squash(entry.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? '')
  // arXiv answers an unknown id with an entry titled "Error".
  if (!title || title === 'Error') return null

  const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) => squash(m[1]))
  return {
    arxivId,
    title,
    authors,
    abstract: squash(entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? ''),
    publishedAt: squash(entry.match(/<published>([\s\S]*?)<\/published>/)?.[1] ?? ''),
  }
}

/**
 * Turns an arXiv HTML render (arxiv.org/html/<id>) into plain text with
 * section headings kept on their own lines, capped at `maxChars`.
 * Drops math markup, bibliography, scripts, and navigation chrome.
 */
export function extractPaperText(html: string, maxChars = 60_000): string {
  let body = html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html
  body = body
    .replace(/<(script|style|nav|header|footer|figure|table|math|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<section[^>]*class="[^"]*ltx_bibliography[\s\S]*$/i, ' ')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, _l, inner: string) => `\n\n## ${stripTags(inner)}\n`)
    .replace(/<\/(p|div|li|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
  const text = decodeEntities(stripTags(body))
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter((line, i, all) => line !== '' || (i > 0 && all[i - 1] !== ''))
    .join('\n')
    .trim()
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[truncated]` : text
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim()
}
