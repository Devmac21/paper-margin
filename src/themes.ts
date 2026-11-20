/**
 * Theme catalog. Color values live in themes.css; this file is metadata only.
 * Switch via `data-theme` on <html> in index.html.
 */

export const THEMES = [
  {
    id: 'margin',
    label: 'Margin',
    description: 'Warm paper, dark ink, and a rust accent.',
  },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

/** Read the currently active theme id from <html data-theme>. */
export function getActiveTheme(): ThemeId {
  if (typeof document === 'undefined') return 'margin'
  const id = document.documentElement.getAttribute('data-theme') as ThemeId | null
  return id ?? 'margin'
}

/** Look up a theme entry by id, or fall back to the first theme. */
export function getTheme(id: string) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
