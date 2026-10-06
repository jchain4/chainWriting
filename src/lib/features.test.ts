import { describe, expect, it } from 'vitest'
import { resolveFeatures, starterKitOptions } from './features'

describe('resolveFeatures', () => {
  it('turns everything on by default', () => {
    expect(Object.values(resolveFeatures()).every(Boolean)).toBe(true)
    expect(Object.values(resolveFeatures({})).every(Boolean)).toBe(true)
  })

  it('turns off only what is explicitly false', () => {
    const resolved = resolveFeatures({ headings: false, tables: false, images: true })
    expect(resolved.headings).toBe(false)
    expect(resolved.tables).toBe(false)
    expect(resolved.images).toBe(true)
    expect(resolved.lists).toBe(true)
  })

  it('ignores keys it does not know and non-boolean values', () => {
    const resolved = resolveFeatures({ comments: false, headings: 0 } as never)
    expect(resolved).not.toHaveProperty('comments')
    expect(resolved.headings).toBe(true)
  })
})

describe('starterKitOptions', () => {
  it('keeps StarterKit defaults when everything is on, with links configured', () => {
    const options = starterKitOptions(resolveFeatures())
    expect(options.link).toEqual({ openOnClick: false, autolink: true })
    for (const key of ['heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'listKeymap', 'codeBlock', 'horizontalRule'] as const) {
      expect(options[key]).toBeUndefined()
    }
  })

  it('drops the parts of StarterKit behind each disabled feature', () => {
    const options = starterKitOptions(resolveFeatures({
      headings: false, blockquote: false, lists: false, codeBlock: false, horizontalRule: false, links: false,
    }))
    expect(options).toEqual({
      link: false, heading: false, blockquote: false, bulletList: false, orderedList: false,
      listItem: false, listKeymap: false, codeBlock: false, horizontalRule: false,
    })
  })
})
