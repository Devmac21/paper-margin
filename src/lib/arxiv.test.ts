import { describe, expect, it } from 'vitest'
import { extractPaperText, parseArxivAtom, parseArxivId } from './arxiv'

describe('parseArxivId', () => {
  it.each([
    ['1706.03762', '1706.03762'],
    ['1706.03762v7', '1706.03762'],
    ['arXiv:2401.01234', '2401.01234'],
    ['https://arxiv.org/abs/2401.01234v2', '2401.01234'],
    ['https://arxiv.org/pdf/2401.01234.pdf', '2401.01234'],
    ['https://arxiv.org/pdf/2401.01234v3', '2401.01234'],
    ['https://www.arxiv.org/html/2401.01234v1', '2401.01234'],
    ['  2310.12345  ', '2310.12345'],
    // 2007-2014 ids have a four-digit sequence number.
    ['0704.0001', '0704.0001'],
    ['hep-th/9901001', 'hep-th/9901001'],
    ['https://arxiv.org/abs/math.GT/0309136', 'math.GT/0309136'],
  ])('accepts %s', (input, expected) => {
    expect(parseArxivId(input)).toBe(expected)
  })

  it.each([
    '',
    'attention is all you need',
    'https://example.com/abs/1706.03762',
    'https://arxiv.org.evil.com/abs/1706.03762',
    '17.03762',
    '1706.123',
    '1706.03762; drop table',
  ])('rejects %s', (input) => {
    expect(parseArxivId(input)).toBeNull()
  })
})

const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="html">ArXiv Query: id_list=1706.03762</title>
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All
      You Need</title>
    <summary>  The dominant sequence transduction models are based on complex
 recurrent &amp; convolutional networks.</summary>
    <author><name>Ashish Vaswani</name></author>
    <author>
      <name>Noam Shazeer</name>
    </author>
  </entry>
</feed>`

describe('parseArxivAtom', () => {
  it('reads title, authors, abstract, and date from the entry', () => {
    expect(parseArxivAtom(atom, '1706.03762')).toEqual({
      arxivId: '1706.03762',
      title: 'Attention Is All You Need',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      abstract: 'The dominant sequence transduction models are based on complex recurrent & convolutional networks.',
      publishedAt: '2017-06-12T17:57:34Z',
    })
  })

  it('treats a missing entry or the arXiv error entry as not found', () => {
    expect(parseArxivAtom('<feed></feed>', 'x')).toBeNull()
    expect(parseArxivAtom('<feed><entry><title>Error</title></entry></feed>', 'x')).toBeNull()
  })
})

describe('extractPaperText', () => {
  const html = `<html><head><style>.x{}</style><script>alert(1)</script></head><body>
    <nav>Back to arXiv</nav>
    <article class="ltx_document">
      <h1 class="ltx_title">A Paper</h1>
      <section><h2>1 Introduction</h2><p>Transformers use <math><mi>x</mi></math> attention &amp; more.</p></section>
      <section><h2>2 Method</h2><p>We stack layers.</p><table><tr><td>noise</td></tr></table></section>
      <section class="ltx_bibliography"><h2>References</h2><p>[1] Someone.</p></section>
    </article>
    <footer>footer</footer></body></html>`

  it('keeps headings and paragraphs and drops chrome, math, tables, and references', () => {
    const text = extractPaperText(html)
    expect(text).toContain('## 1 Introduction')
    expect(text).toContain('Transformers use attention & more.')
    expect(text).toContain('## 2 Method\nWe stack layers.')
    for (const gone of ['alert', 'Back to arXiv', 'noise', 'References', 'footer']) {
      expect(text).not.toContain(gone)
    }
  })

  it('caps long text and marks the truncation', () => {
    const long = `<article><p>${'word '.repeat(5000)}</p></article>`
    const text = extractPaperText(long, 100)
    expect(text.length).toBeLessThan(120)
    expect(text.endsWith('[truncated]')).toBe(true)
  })
})
