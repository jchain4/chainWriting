import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useRovingToolbar } from './useRovingToolbar'

function keyEvent(key: string) {
  return { key, preventDefault: vi.fn() } as unknown as ReactKeyboardEvent<HTMLButtonElement>
}

describe('useRovingToolbar', () => {
  it('only the active index has tabIndex 0, the rest are -1', () => {
    const { result } = renderHook(() => useRovingToolbar({ count: 3, active: true, onEscape: vi.fn() }))
    expect(result.current.getTabIndex(0)).toBe(0)
    expect(result.current.getTabIndex(1)).toBe(-1)
    expect(result.current.getTabIndex(2)).toBe(-1)
  })

  it('ArrowRight/ArrowLeft move the active index with wraparound', () => {
    const buttons = [0, 1, 2].map(() => document.createElement('button'))
    const { result } = renderHook(() => useRovingToolbar({ count: 3, active: true, onEscape: vi.fn() }))
    buttons.forEach((btn, i) => result.current.registerButton(i)(btn))

    act(() => result.current.onButtonKeyDown(2)(keyEvent('ArrowRight')))
    expect(result.current.getTabIndex(0)).toBe(0) // wrapped from 2 -> 0

    act(() => result.current.onButtonKeyDown(0)(keyEvent('ArrowLeft')))
    expect(result.current.getTabIndex(2)).toBe(0) // wrapped from 0 -> 2
  })

  it('Home/End jump to the first/last button', () => {
    const buttons = [0, 1, 2].map(() => document.createElement('button'))
    const { result } = renderHook(() => useRovingToolbar({ count: 3, active: true, onEscape: vi.fn() }))
    buttons.forEach((btn, i) => result.current.registerButton(i)(btn))

    act(() => result.current.onButtonKeyDown(0)(keyEvent('End')))
    expect(result.current.getTabIndex(2)).toBe(0)

    act(() => result.current.onButtonKeyDown(2)(keyEvent('Home')))
    expect(result.current.getTabIndex(0)).toBe(0)
  })

  it('Escape calls onEscape', () => {
    const onEscape = vi.fn()
    const { result } = renderHook(() => useRovingToolbar({ count: 3, active: true, onEscape }))
    result.current.onButtonKeyDown(0)(keyEvent('Escape'))
    expect(onEscape).toHaveBeenCalledOnce()
  })

  it('focusFirst returns false when no button is registered', () => {
    const { result } = renderHook(() => useRovingToolbar({ count: 3, active: true, onEscape: vi.fn() }))
    expect(result.current.focusFirst()).toBe(false)
  })

  it('focusFirst focuses the registered first button and returns true', () => {
    const button = document.createElement('button')
    document.body.appendChild(button)
    const { result } = renderHook(() => useRovingToolbar({ count: 1, active: true, onEscape: vi.fn() }))
    result.current.registerButton(0)(button)

    let focused = false
    act(() => { focused = result.current.focusFirst() })
    expect(focused).toBe(true)
    expect(document.activeElement).toBe(button)

    document.body.removeChild(button)
  })
})
