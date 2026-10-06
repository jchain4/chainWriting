import { afterEach, describe, expect, it, vi } from 'vitest'
import { centerVertically, scrollContainerOf } from './scrolling'

const created: HTMLElement[] = []
afterEach(() => {
  while (created.length) created.pop()!.remove()
  vi.restoreAllMocks()
})

/** A div with the given overflow and (jsdom doesn't lay out) scroll/visible heights. */
function box(overflowY: string, scrollHeight: number, clientHeight: number, parent: HTMLElement = document.body) {
  const el = document.createElement('div')
  el.style.overflowY = overflowY
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight })
  parent.append(el)
  if (parent === document.body) created.push(el)
  return el
}

describe('scrollContainerOf', () => {
  it('returns the element itself when it scrolls (e.g. the editor with --cw-max-height)', () => {
    const editor = box('auto', 800, 200)
    expect(scrollContainerOf(editor)).toBe(editor)
  })

  it('walks up to the nearest ancestor that scrolls', () => {
    const panel = box('scroll', 2000, 600)
    const wrapper = box('visible', 2000, 2000, panel)
    const editor = box('auto', 300, 300, wrapper) // overflow:auto but nothing to scroll
    expect(scrollContainerOf(editor)).toBe(panel)
  })

  it('skips elements that could scroll but have nothing to scroll, and ones that clip instead of scrolling', () => {
    const hidden = box('hidden', 2000, 600)
    const editor = box('auto', 100, 100, hidden)
    expect(scrollContainerOf(editor)).toBeNull()
  })

  it('returns null when it is the page that scrolls', () => {
    const editor = box('visible', 100, 100)
    expect(scrollContainerOf(editor)).toBeNull()
    expect(scrollContainerOf(null)).toBeNull()
  })
})

describe('centerVertically', () => {
  it('scrolls the nearest scroll container so the position lands in its middle', () => {
    const panel = box('auto', 2000, 400)
    const editor = box('visible', 1000, 1000, panel)
    panel.scrollTop = 100
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ top: 50 } as DOMRect)
    const scrollTo = vi.fn()
    panel.scrollTo = scrollTo as unknown as typeof panel.scrollTo
    const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

    centerVertically(450, editor) // 400px below the panel's top edge
    expect(scrollTo).toHaveBeenCalledWith({ top: 100 + 400 - 200, behavior: 'instant' })
    expect(windowScroll).not.toHaveBeenCalled()
  })

  it('never scrolls a container above its top', () => {
    const panel = box('auto', 2000, 400)
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect)
    const scrollTo = vi.fn()
    panel.scrollTo = scrollTo as unknown as typeof panel.scrollTo
    centerVertically(10, panel)
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
  })

  it('scrolls the page when nothing around the editor scrolls', () => {
    const editor = box('visible', 100, 100)
    const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    centerVertically(window.innerHeight / 2 + 300, editor)
    expect(windowScroll).toHaveBeenCalledWith({ top: window.scrollY + 300, behavior: 'instant' })
  })
})
