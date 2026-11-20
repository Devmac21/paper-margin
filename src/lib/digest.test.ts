import { describe, expect, it } from 'vitest'
import { composeDigest, type DigestPaper } from './digest'

const paper = (over: Partial<DigestPaper> = {}): DigestPaper => ({
  paperId: 'p1',
  title: 'Attention <Is> All You Need',
  tldr: 'Attention replaces recurrence.',
  addedAt: '2026-11-18T00:00:00.000Z',
  noteCount: 0,
  ...over,
})

const base = { circleName: 'ML Reading', circleUrl: 'https://paper-margin.app.space/c/c1' }

describe('composeDigest', () => {
  it('sends nothing for a quiet week', () => {
    expect(composeDigest({ ...base, newPapers: [], activePapers: [], noteCount: 0 })).toBeNull()
  })

  it('summarizes new papers and the most discussed ones with links', () => {
    const email = composeDigest({
      ...base,
      newPapers: [paper()],
      activePapers: [paper({ paperId: 'p2', title: 'Scaling Laws', noteCount: 5 })],
      noteCount: 6,
    })!
    expect(email.subject).toBe('ML Reading: 1 new paper, 6 margin notes this week')
    expect(email.text).toContain('https://paper-margin.app.space/c/c1/p/p1')
    expect(email.text).toContain('Scaling Laws (5 notes)')
    expect(email.html).toContain('Attention &lt;Is&gt; All You Need')
    expect(email.html).not.toContain('<Is>')
  })

  it('still sends when there is discussion but no new paper', () => {
    const email = composeDigest({ ...base, newPapers: [], activePapers: [paper({ noteCount: 1 })], noteCount: 1 })
    expect(email?.subject).toBe('ML Reading: 0 new papers, 1 margin note this week')
  })
})
