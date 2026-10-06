const SCROLLABLE = new Set(['auto', 'scroll', 'overlay'])

/**
 * The nearest element, starting at `el` itself, that scrolls vertically and
 * currently has something to scroll — or null when it's the page that
 * scrolls. Lets behaviour like typewriter mode work when the editor sits in
 * a panel with its own scroll, or caps its own height and scrolls inside.
 */
export function scrollContainerOf(el: Element | null): HTMLElement | null {
  for (let node = el; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    if (!(node instanceof HTMLElement)) continue
    if (SCROLLABLE.has(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node
  }
  return null
}

/**
 * Scrolls whatever holds `from` — its nearest scroll container, or the page —
 * so that the viewport position `top` (e.g. the cursor's) ends up in the
 * middle of the visible area.
 */
export function centerVertically(top: number, from: Element): void {
  const container = scrollContainerOf(from)
  if (container) {
    const offset = top - container.getBoundingClientRect().top
    container.scrollTo({ top: Math.max(0, container.scrollTop + offset - container.clientHeight / 2), behavior: 'instant' })
  } else {
    window.scrollTo({ top: Math.max(0, window.scrollY + top - window.innerHeight / 2), behavior: 'instant' })
  }
}
