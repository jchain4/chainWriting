import { useRef } from 'react'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { horizontalShift, isOffscreen, uiUnit, useKeepInViewport, useViewportChange, VIEWPORT_MARGIN } from './useFloating'

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

describe('horizontalShift', () => {
  const vw = 390

  it('leaves an element that fits alone', () => {
    expect(horizontalShift(50, 300, vw)).toBe(0)
    expect(horizontalShift(VIEWPORT_MARGIN, vw - VIEWPORT_MARGIN, vw)).toBe(0)
  })

  it('pushes an element overflowing on the left back in, keeping the margin', () => {
    expect(horizontalShift(-80, 214, vw)).toBe(88)
  })

  it('pulls an element overflowing on the right back in, keeping the margin', () => {
    expect(horizontalShift(200, 450, vw)).toBe(-68)
  })

  it('pins an element wider than the viewport to the left margin', () => {
    expect(horizontalShift(-50, 500, vw)).toBe(58)
    expect(horizontalShift(30, 600, vw)).toBe(-22)
  })

  it('honours a custom margin', () => {
    expect(horizontalShift(0, 100, vw, 16)).toBe(16)
  })
})

describe('isOffscreen', () => {
  it('is true only when the rect is entirely above or below the viewport', () => {
    expect(isOffscreen({ top: -50, bottom: -1 })).toBe(true)
    expect(isOffscreen({ top: window.innerHeight + 1, bottom: window.innerHeight + 30 })).toBe(true)
    expect(isOffscreen({ top: -50, bottom: 10 })).toBe(false)
    expect(isOffscreen({ top: window.innerHeight - 5, bottom: window.innerHeight + 30 })).toBe(false)
  })
})

describe('uiUnit', () => {
  afterEach(() => {
    document.documentElement.style.fontSize = ''
    document.body.replaceChildren()
  })

  function inside(scale?: string) {
    const outer = document.createElement('div')
    if (scale) outer.style.setProperty('--cw-ui-scale', scale)
    const inner = document.createElement('div')
    outer.append(inner)
    document.body.append(outer)
    return inner
  }

  it('is 1 at the default font size and scale', () => {
    expect(uiUnit(inside())).toBe(1)
    expect(uiUnit(null)).toBe(1)
  })

  it('ignores the page’s root font size (sites often change it, e.g. 62.5%)', () => {
    document.documentElement.style.fontSize = '10px'
    expect(uiUnit(inside())).toBe(1)
  })

  it('follows the user’s default font size (CSS `medium`)', () => {
    const original = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const style = original(el, pseudo)
      if ((el as HTMLElement).style?.fontSize === 'medium') return { ...style, fontSize: '20px', getPropertyValue: style.getPropertyValue.bind(style) } as CSSStyleDeclaration
      return style
    })
    expect(uiUnit(inside())).toBe(1.25)
    vi.restoreAllMocks()
  })

  it('follows --cw-ui-scale set on any ancestor', () => {
    expect(uiUnit(inside('1.5'))).toBe(1.5)
  })

  it('leaves no probe element behind', () => {
    const el = inside()
    uiUnit(el)
    expect(el.childElementCount).toBe(0)
  })

  it('falls back to 1 for an invalid scale', () => {
    expect(uiUnit(inside('big'))).toBe(1)
  })
})

describe('useKeepInViewport', () => {
  let restore: (() => void) | null = null
  afterEach(() => { restore?.(); restore = null })

  function mockRects(byClass: Record<string, { left: number, right: number }>) {
    const original = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const box = byClass[this.className]
      if (!box) return original.call(this)
      // The applied `translate` moves the element, as in a real browser.
      const dx = parseFloat(this.style.translate) || 0
      return { top: 0, bottom: 30, height: 30, width: box.right - box.left, x: box.left + dx, y: 0,
        left: box.left + dx, right: box.right + dx, toJSON: () => {} } as DOMRect
    }
    restore = () => { HTMLElement.prototype.getBoundingClientRect = original }
  }

  function Floating({ left }: { left: number }) {
    const ref = useRef<HTMLDivElement>(null)
    useKeepInViewport(ref, [left])
    return <div ref={ref} className="floating" style={{ position: 'fixed', left }} />
  }

  it('shifts an element that overflows the viewport, using the translate property', () => {
    mockRects({ floating: { left: -80, right: 214 } })
    const { container } = render(<Floating left={-80} />)
    expect((container.firstChild as HTMLElement).style.translate).toBe('88px 0')
  })

  it('leaves no translate on an element that fits', () => {
    mockRects({ floating: { left: 40, right: 200 } })
    const { container } = render(<Floating left={40} />)
    expect((container.firstChild as HTMLElement).style.translate).toBe('')
  })

  it('re-measures from scratch when the position changes, dropping a stale shift', () => {
    const boxes = { floating: { left: -80, right: 214 } }
    mockRects(boxes)
    const { container, rerender } = render(<Floating left={-80} />)
    boxes.floating = { left: 60, right: 354 }
    rerender(<Floating left={60} />)
    expect((container.firstChild as HTMLElement).style.translate).toBe('')
  })

  it('uses the untransformed width, so a box measured mid scale-in animation still keeps the margin', () => {
    // Rendered at 97% scale around its centre (151): 285px wide on screen, 294px once the animation ends.
    mockRects({ floating: { left: 8.5, right: 293.5 } })
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.className === 'floating' ? 294 : 0 } })
    try {
      const { container } = render(<Floating left={151} />)
      expect((container.firstChild as HTMLElement).style.translate).toBe('4px 0') // 151 - 147 = 4 → pushed to 8
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', descriptor)
    }
  })

  it('does not touch the element’s own transform (so centring and entry animations survive)', () => {
    mockRects({ floating: { left: -80, right: 214 } })
    const { container } = render(<Floating left={-80} />)
    const el = container.firstChild as HTMLElement
    el.style.transform = 'translateX(-50%)'
    expect(el.style.transform).toBe('translateX(-50%)')
  })
})

describe('useViewportChange', () => {
  function Listener({ onChange, active }: { onChange: () => void, active: boolean }) {
    useViewportChange(onChange, active)
    return null
  }

  it('calls back on page scroll and on window resize', async () => {
    const onChange = vi.fn()
    render(<Listener onChange={onChange} active />)
    window.dispatchEvent(new Event('scroll'))
    await nextFrame()
    window.dispatchEvent(new Event('resize'))
    await nextFrame()
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('catches scrolling inside any scroll container, not just the page', async () => {
    const onChange = vi.fn()
    render(<Listener onChange={onChange} active />)
    const panel = document.createElement('div')
    document.body.append(panel)
    panel.dispatchEvent(new Event('scroll')) // scroll events don't bubble
    await nextFrame()
    expect(onChange).toHaveBeenCalledTimes(1)
    panel.remove()
  })

  it('calls back at most once per frame, however many scroll events arrive', async () => {
    const onChange = vi.fn()
    render(<Listener onChange={onChange} active />)
    for (let i = 0; i < 10; i++) window.dispatchEvent(new Event('scroll'))
    await nextFrame()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('does not listen while inactive, and stops after unmount', async () => {
    const onChange = vi.fn()
    const { rerender, unmount } = render(<Listener onChange={onChange} active={false} />)
    window.dispatchEvent(new Event('scroll'))
    await nextFrame()
    expect(onChange).not.toHaveBeenCalled()

    rerender(<Listener onChange={onChange} active />)
    unmount()
    window.dispatchEvent(new Event('scroll'))
    await nextFrame()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('uses the latest callback', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Listener onChange={first} active />)
    rerender(<Listener onChange={second} active />)
    window.dispatchEvent(new Event('scroll'))
    await nextFrame()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
