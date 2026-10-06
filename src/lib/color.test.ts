import { describe, expect, it } from 'vitest'
import { luminance, menuThemeFor } from './color'

describe('luminance', () => {
  it('reads rgb(), rgba() and color(srgb …) values', () => {
    expect(luminance('rgb(0, 0, 0)')).toBe(0)
    expect(luminance('rgb(255, 255, 255)')).toBeCloseTo(1)
    expect(luminance('rgba(255, 255, 255, 0.5)')).toBeCloseTo(1)
    expect(luminance('rgb(255 255 255 / 50%)')).toBeCloseTo(1)
    expect(luminance('color(srgb 1 1 1 / 0.9)')).toBeCloseTo(1)
    expect(luminance('color(srgb 0.2157 0.2549 0.3176)')).toBeCloseTo(luminance('rgb(55, 65, 81)')!, 3)
  })

  it('weights green the most, as the eye does', () => {
    expect(luminance('rgb(0, 255, 0)')!).toBeGreaterThan(luminance('rgb(255, 0, 0)')!)
    expect(luminance('rgb(255, 0, 0)')!).toBeGreaterThan(luminance('rgb(0, 0, 255)')!)
  })

  it('returns null for values it cannot read', () => {
    expect(luminance('')).toBeNull()
    expect(luminance('canvastext')).toBeNull()
    expect(luminance('hsl(0 0% 0%)')).toBeNull()
  })
})

describe('menuThemeFor', () => {
  it('picks light menus for dark text (a light page) and dark menus for light text (a dark page)', () => {
    expect(menuThemeFor('rgb(55, 65, 81)')).toBe('light')
    expect(menuThemeFor('rgb(17, 24, 39)')).toBe('light')
    expect(menuThemeFor('rgb(232, 230, 227)')).toBe('dark')
    expect(menuThemeFor('rgb(255, 255, 255)')).toBe('dark')
  })

  it('falls back to dark menus (the original look) when unsure', () => {
    expect(menuThemeFor('canvastext')).toBe('dark')
    expect(menuThemeFor('')).toBe('dark')
  })
})

describe('menu text contrast (WCAG AA, ≥ 4.5:1), read from editor.css', () => {
  /** A `rgba(r, g, b, a)` token's value in the given block of the stylesheet. */
  async function token(blockSelector: string, name: string): Promise<number[]> {
    const css = (await import('../editor.css?raw')).default
    const block = css.slice(css.indexOf(blockSelector), css.indexOf('}', css.indexOf(blockSelector)))
    const match = block.match(new RegExp(`${name}:\\s*rgba\\(([^)]*)\\)`))
    expect(match, `${name} in ${blockSelector}`).not.toBeNull()
    return match![1].split(',').map(Number)
  }
  /** Composites rgba(r, g, b, a) over an opaque [r, g, b] background. */
  const over = ([r, g, b, a]: number[], bg: number[]) => [r, g, b].map((c, i) => Math.round(c * a + bg[i] * (1 - a)))
  const lum = (rgb: number[]) => luminance(`rgb(${rgb.join(', ')})`)!
  const contrast = (x: number[], y: number[]) => {
    const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p)
    return (hi + 0.05) / (lo + 0.05)
  }

  it('light menus, over the light pages they are used on', async () => {
    const block = ':where(.cw-editor[data-menu-theme="light"])'
    const menu = over(await token(block, '--cw-bubble-bg'), [255, 255, 255])
    expect(contrast(over(await token(block, '--cw-bubble-text'), menu), menu)).toBeGreaterThanOrEqual(4.5)
  })

  it('dark menus, over the dark pages they are used on', async () => {
    const block = ':where(.cw-editor) {'
    const menu = over(await token(block, '--cw-bubble-bg'), [24, 24, 28])
    expect(contrast(over(await token(block, '--cw-bubble-text'), menu), menu)).toBeGreaterThanOrEqual(4.5)
  })
})
