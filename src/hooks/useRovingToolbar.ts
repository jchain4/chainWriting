import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

export interface RovingToolbarHandle {
  /** Moves DOM focus to the first button. Returns false if there is nothing to focus (toolbar not mounted). */
  focusFirst: () => boolean
}

export interface UseRovingToolbarOptions {
  /** Fixed number of focusable buttons in the toolbar (dividers excluded). */
  count: number
  /** Whether the toolbar is currently visible/mounted — resets the roving index to 0 whenever it becomes visible. */
  active: boolean
  /** Called on Escape — typically `() => editor.chain().focus().run()`. */
  onEscape: () => void
}

export interface UseRovingToolbarResult {
  getTabIndex: (index: number) => 0 | -1
  registerButton: (index: number) => (el: HTMLButtonElement | null) => void
  onButtonKeyDown: (index: number) => (e: KeyboardEvent<HTMLButtonElement>) => void
  focusFirst: () => boolean
}

/**
 * WAI-ARIA APG "Toolbar" roving-tabindex pattern: only one button is ever a
 * Tab stop (tabIndex 0); arrow keys move both the roving index and DOM
 * focus. Tab itself is intentionally NOT intercepted here — pressing it
 * should let focus continue naturally to the next focusable element on the
 * page rather than being trapped inside the toolbar.
 */
export function useRovingToolbar({ count, active, onEscape }: UseRovingToolbarOptions): UseRovingToolbarResult {
  const [activeIndex, setActiveIndex] = useState(0)
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([])

  // Reset the roving index whenever the toolbar (re)appears.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (active) setActiveIndex(0) }, [active])

  const focusIndex = useCallback((index: number) => {
    if (count === 0) return
    const clamped = Math.max(0, Math.min(count - 1, index))
    setActiveIndex(clamped)
    buttonsRef.current[clamped]?.focus()
  }, [count])

  const registerButton = useCallback((index: number) => (el: HTMLButtonElement | null) => {
    buttonsRef.current[index] = el
  }, [])

  const getTabIndex = useCallback((index: number): 0 | -1 => (index === activeIndex ? 0 : -1), [activeIndex])

  const onButtonKeyDown = useCallback((index: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); focusIndex((index + 1) % count); break
      case 'ArrowLeft':  e.preventDefault(); focusIndex((index - 1 + count) % count); break
      case 'Home':       e.preventDefault(); focusIndex(0); break
      case 'End':        e.preventDefault(); focusIndex(count - 1); break
      case 'Escape':     e.preventDefault(); onEscape(); break
    }
  }, [count, focusIndex, onEscape])

  const focusFirst = useCallback((): boolean => {
    const first = buttonsRef.current[0]
    if (!first) return false
    setActiveIndex(0)
    first.focus()
    return true
  }, [])

  return { getTabIndex, registerButton, onButtonKeyDown, focusFirst }
}
