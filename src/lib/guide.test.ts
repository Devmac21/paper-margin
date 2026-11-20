import { describe, expect, it } from 'vitest'
import { anchorLabel, isValidAnchor, parseGuide, replyText } from './guide'

const guide = {
  tldr: 'Attention replaces recurrence.',
  problem: 'RNNs are slow to train.',
  method: 'Stack self-attention layers.',
  results: '28.4 BLEU on WMT14 En-De.',
  limitations: 'Quadratic in sequence length.',
  questions: ['Why does it work?', 'What breaks at long context?', 'Is position encoding enough?', 'What about data?'],
  glossary: [{ term: 'BLEU', meaning: 'A translation overlap metric.' }],
}

describe('parseGuide', () => {
  it('accepts a bare JSON object', () => {
    expect(parseGuide(JSON.stringify(guide))).toEqual(guide)
  })

  it('accepts JSON wrapped in prose or a code fence', () => {
    expect(parseGuide(`Here you go:\n\`\`\`json\n${JSON.stringify(guide)}\n\`\`\``)).toEqual(guide)
  })

  it('defaults a missing glossary to empty', () => {
    const { glossary: _omit, ...rest } = guide
    expect(parseGuide(JSON.stringify(rest))?.glossary).toEqual([])
  })

  it('rejects missing keys, too few questions, and non-JSON', () => {
    const { method: _omit, ...noMethod } = guide
    expect(parseGuide(JSON.stringify(noMethod))).toBeNull()
    expect(parseGuide(JSON.stringify({ ...guide, questions: ['only one'] }))).toBeNull()
    expect(parseGuide('I cannot do that.')).toBeNull()
    expect(parseGuide('{not json}')).toBeNull()
  })
})

describe('anchors', () => {
  const parsed = parseGuide(JSON.stringify(guide))

  it('accepts sections, general, and existing questions only', () => {
    expect(isValidAnchor('method', parsed)).toBe(true)
    expect(isValidAnchor('general', parsed)).toBe(true)
    expect(isValidAnchor('q:3', parsed)).toBe(true)
    expect(isValidAnchor('q:4', parsed)).toBe(false)
    expect(isValidAnchor('q:0', null)).toBe(false)
    expect(isValidAnchor('intro', parsed)).toBe(false)
  })

  it('labels anchors for display', () => {
    expect(anchorLabel('tldr')).toBe('TL;DR')
    expect(anchorLabel('q:0')).toBe('Question 1')
    expect(anchorLabel('general')).toBe('General')
  })
})

describe('replyText', () => {
  it('joins text blocks from a Messages API body, with or without an envelope', () => {
    const body = { content: [{ type: 'text', text: '{"a":' }, { type: 'tool_use' }, { type: 'text', text: '1}' }] }
    expect(replyText(body)).toBe('{"a":1}')
    expect(replyText({ success: true, data: body })).toBe('{"a":1}')
    expect(replyText(null)).toBe('')
  })
})
