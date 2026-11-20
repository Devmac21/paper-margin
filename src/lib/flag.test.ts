import { describe, expect, it } from 'vitest'
import { flag } from './flag'

describe('flag', () => {
  it('reads stored 0/1 and booleans', () => {
    expect(flag(1)).toBe(true)
    expect(flag(0)).toBe(false)
    expect(flag(true)).toBe(true)
    expect(flag(false)).toBe(false)
    expect(flag('0')).toBe(false)
    expect(flag('true')).toBe(true)
  })

  it('uses the fallback only when the field is missing', () => {
    expect(flag(undefined, true)).toBe(true)
    expect(flag(null, true)).toBe(true)
    expect(flag(0, true)).toBe(false)
  })
})
