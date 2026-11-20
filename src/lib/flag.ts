/**
 * Boolean record fields come back from storage as 0/1, so `=== false` and
 * `&&` rendering both misbehave on them. Read them through this.
 */
export function flag(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true'
  return Boolean(value)
}
