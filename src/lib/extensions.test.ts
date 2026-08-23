import { describe, expect, it } from 'vitest'
import { Extension } from '@tiptap/react'
import { mergeExtensions } from './extensions'

const named = (name: string) => Extension.create({ name })

describe('mergeExtensions', () => {
  it('keeps defaults when no user extensions are given', () => {
    const defaults = [named('a'), named('b')]
    expect(mergeExtensions(defaults).map((e) => e.name)).toEqual(['a', 'b'])
    expect(mergeExtensions(defaults, []).map((e) => e.name)).toEqual(['a', 'b'])
  })

  it('replaces a default extension whose name matches a user extension', () => {
    const defaults = [named('a'), named('b')]
    const userA = named('a')
    const merged = mergeExtensions(defaults, [userA])
    expect(merged.map((e) => e.name)).toEqual(['b', 'a'])
    expect(merged.find((e) => e.name === 'a')).toBe(userA)
  })

  it('appends user extensions with names not present in the defaults', () => {
    const defaults = [named('a')]
    const userC = named('c')
    const merged = mergeExtensions(defaults, [userC])
    expect(merged.map((e) => e.name)).toEqual(['a', 'c'])
  })

  it('orders defaults before user extensions', () => {
    const defaults = [named('a'), named('b')]
    const merged = mergeExtensions(defaults, [named('c'), named('d')])
    expect(merged.map((e) => e.name)).toEqual(['a', 'b', 'c', 'd'])
  })
})
