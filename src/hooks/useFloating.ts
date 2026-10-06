import { useEffect, useLayoutEffect, useRef } from 'react'
import type { DependencyList, RefObject } from 'react'

/** Minimum distance kept between a floating element and the viewport edges. */
export const VIEWPORT_MARGIN = 8

/**
 * How far to move an element spanning `left`..`right` horizontally so it
 * stays within the viewport, `margin` away from its edges. An element wider
 * than the room available is pinned to the left margin.
 */
export function horizontalShift(left: number, right: number, viewportWidth: number, margin = VIEWPORT_MARGIN): number {
  if (right - left > viewportWidth - 2 * margin) return margin - left
  if (left < margin) return margin - left
  if (right > viewportWidth - margin) return viewportWidth - margin - right
  return 0
}

/**
 * Nudges a fixed-position floating element (bubble menu, popover…) back
 * inside the viewport after every placement — e.g. a bubble centred on a
 * word at the very edge of a phone screen. Uses the CSS `translate`
 * property, which composes with the element's own `transform` and entry
 * animation instead of overriding them.
 */
export function useKeepInViewport(ref: RefObject<HTMLElement | null>, deps: DependencyList) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.translate = ''
    const rect = el.getBoundingClientRect()
    // Measured mid entry-animation, the box is scaled down (around its
    // centre); use the untransformed width so the margin holds once it ends.
    const width = el.offsetWidth || rect.width
    const centre = rect.left + rect.width / 2
    const dx = horizontalShift(centre - width / 2, centre + width / 2, window.innerWidth)
    if (dx) el.style.translate = `${dx}px 0`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/**
 * Calls `onChange` (at most once per frame) whenever anything that moves
 * fixed-position elements relative to the text happens: scrolling the page
 * or *any* scroll container (capture phase, so inner panels count too), or
 * resizing the window. Only listens while `active`.
 */
export function useViewportChange(onChange: () => void, active: boolean) {
  const callbackRef = useRef(onChange)
  useLayoutEffect(() => { callbackRef.current = onChange })

  useEffect(() => {
    if (!active) return
    let frame: number | null = null
    const schedule = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        callbackRef.current()
      })
    }
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
    }
  }, [active])
}

/**
 * The CSS `--cw-u` unit in pixels for floating UI inside `el`: 1 at the
 * browser's default 16px font size and `--cw-ui-scale` 1 — based, like the
 * CSS, on the user's font-size preference (`medium`), not on the page's root
 * font size. For positioning code that needs the menus' scaled sizes before
 * they're rendered.
 */
export function uiUnit(el: Element | null): number {
  const host = el ?? document.body
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;visibility:hidden;font-size:medium'
  host.appendChild(probe)
  const userFont = parseFloat(getComputedStyle(probe).fontSize) || 16
  probe.remove()
  const scale = parseFloat(getComputedStyle(host).getPropertyValue('--cw-ui-scale')) || 1
  return (userFont / 16) * scale
}

/** Whether a rect is entirely outside the viewport vertically (its anchor scrolled away). */
export function isOffscreen(rect: { top: number, bottom: number }): boolean {
  return rect.bottom < 0 || rect.top > window.innerHeight
}
