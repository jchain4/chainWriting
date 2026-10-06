/**
 * Relative luminance (0 = black, 1 = white) of a computed CSS colour such as
 * `rgb(55, 65, 81)`, `rgba(…)` or `color(srgb 0.2 0.25 0.3 / 0.9)`, or null
 * if it can't be read. Alpha is ignored: this is for telling light text from
 * dark text, not for exact contrast ratios.
 */
export function luminance(css: string): number | null {
  let channels: number[] | null = null
  const rgb = css.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i)
  if (rgb) channels = rgb.slice(1, 4).map((v) => Number(v) / 255)
  const srgb = css.match(/^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i)
  if (srgb) channels = srgb.slice(1, 4).map(Number)
  if (!channels || channels.some((c) => Number.isNaN(c))) return null
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * The menu theme that matches a page, judged by its text colour: dark text
 * means a light page (→ light menus), light text a dark page (→ dark menus).
 * Falls back to `dark` — the editor's original look — when unsure.
 */
export function menuThemeFor(textColor: string): 'light' | 'dark' {
  const l = luminance(textColor)
  return l !== null && l < 0.3 ? 'light' : 'dark'
}
