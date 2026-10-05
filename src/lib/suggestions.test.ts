import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor as TiptapEditor, type Content } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { BlockId, getBlocks, type BlocksChange } from './blockId'
import {
  Suggestions, acceptSuggestion, addSuggestions, getSuggestions, rejectSuggestion, removeSuggestions,
  type ResolvedSuggestion, type SuggestionsOptions,
} from './suggestions'

// See imageExtension.test.ts: every headless editor must be destroyed.
const liveEditors: TiptapEditor[] = []

async function makeEditor(
  content: Content,
  options: Partial<SuggestionsOptions> = {},
  onBlocksChange?: (change: BlocksChange) => void,
) {
  let n = 0
  const editor = new TiptapEditor({
    extensions: [
      StarterKit,
      BlockId.configure({ generateId: () => `id${++n}`, onBlocksChange }),
      Suggestions.configure(options),
    ],
    content,
  })
  liveEditors.push(editor)
  await new Promise<void>((resolve) => editor.on('create', () => resolve()))
  return editor
}

afterEach(() => {
  while (liveEditors.length) liveEditors.pop()!.destroy()
})

const PARAGRAPHS = '<p data-block-id="a">The quick brown fox</p><p data-block-id="b">jumps over the dog</p>'
const texts = (editor: TiptapEditor) => getBlocks(editor.state.doc).map((b) => b.text)
const only = (editor: TiptapEditor) => getSuggestions(editor)[0]
const dom = (editor: TiptapEditor) => editor.view.dom
const textOf = (editor: TiptapEditor, s: ResolvedSuggestion) => editor.state.doc.textBetween(s.from!, s.to!)

function pressKey(editor: TiptapEditor, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { key: 'Enter', ...init })
  return !!editor.view.someProp('handleKeyDown', (handler) => handler(editor.view, event))
}

describe('addSuggestions — resolving and display', () => {
  it('resolves a replace suggestion to its quote and shows it track-changes style', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    const [s] = addSuggestions(editor, [{ type: 'replace', id: 's1', blockId: 'a', quote: 'quick', replacement: 'slow' }])
    expect(s).toMatchObject({ id: 's1', status: 'active' })
    expect(textOf(editor, s)).toBe('quick')
    expect(dom(editor).querySelector('del.cw-suggestion-delete')).toHaveTextContent('quick')
    expect(dom(editor).querySelector('ins.cw-suggestion-insert')).toHaveTextContent('slow')
    expect(dom(editor).querySelector('[aria-label^="Aceptar sugerencia"]')).not.toBeNull()
    expect(dom(editor).querySelector('[aria-label^="Rechazar sugerencia"]')).not.toBeNull()
  })

  it('shows a deletion (empty replacement) as struck-through text only', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    addSuggestions(editor, [{ type: 'replace', id: 's1', blockId: 'a', quote: ' quick', replacement: '' }])
    expect(dom(editor).querySelector('del.cw-suggestion-delete')).toHaveTextContent('quick')
    expect(dom(editor).querySelector('ins')).toBeNull()
  })

  it('shows an insertAfter suggestion as one proposed paragraph per non-empty line, after its block', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    const [s] = addSuggestions(editor, [{ type: 'insertAfter', id: 's1', blockId: 'a', text: 'First new.\n\n  \nSecond new.' }])
    expect(s).toMatchObject({ status: 'active', from: 0, to: editor.state.doc.child(0).nodeSize })
    const widget = dom(editor).querySelector('.cw-suggestion-block')!
    expect([...widget.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['First new.', 'Second new.'])
    expect(widget.previousElementSibling).toHaveTextContent('The quick brown fox')
  })

  it('reports suggestions it cannot place as stale and does not show them', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    const results = addSuggestions(editor, [
      { type: 'replace', id: '1', blockId: 'nope', quote: 'quick', replacement: 'x' },
      { type: 'replace', id: '2', blockId: 'a', quote: 'absent', replacement: 'x' },
      { type: 'replace', id: '3', blockId: 'a', quote: '', replacement: 'x' },
      { type: 'insertAfter', id: '4', blockId: 'nope', text: 'New' },
      { type: 'insertAfter', id: '5', blockId: 'a', text: ' \n ' },
    ])
    expect(results.map((s) => [s.id, s.status, s.from])).toEqual([
      ['1', 'stale', null], ['2', 'stale', null], ['3', 'stale', null], ['4', 'stale', null], ['5', 'stale', null],
    ])
    expect(dom(editor).querySelector('.cw-suggestion, .cw-suggestion-block, .cw-suggestion-delete')).toBeNull()
  })

  it('uses prefix/suffix to pick the right occurrence', async () => {
    const editor = await makeEditor('<p data-block-id="a">one cat, two cat</p>')
    const [s] = addSuggestions(editor, [{ type: 'replace', id: '1', blockId: 'a', quote: 'cat', prefix: 'two ', replacement: 'dogs' }])
    expect(s.from).toBe(1 + 'one cat, two '.length)
  })

  it('replaces a suggestion added again with the same id, and returns only the ones just added', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    addSuggestions(editor, [
      { type: 'replace', id: '1', blockId: 'a', quote: 'quick', replacement: 'slow' },
      { type: 'replace', id: '2', blockId: 'b', quote: 'dog', replacement: 'cat' },
    ])
    const result = addSuggestions(editor, [{ type: 'replace', id: '1', blockId: 'a', quote: 'brown', replacement: 'red' }])
    expect(result.map((s) => s.id)).toEqual(['1'])
    expect(getSuggestions(editor).map((s) => [s.id, s.type === 'replace' && s.quote])).toEqual([['1', 'brown'], ['2', 'dog']])
  })

  it('is a pure overlay until accepted: no HTML change, no undo step, no update event', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    const onUpdate = vi.fn()
    editor.on('update', onUpdate)
    const html = editor.getHTML()
    addSuggestions(editor, [
      { type: 'replace', id: '1', blockId: 'a', quote: 'quick', replacement: 'slow' },
      { type: 'insertAfter', id: '2', blockId: 'b', text: 'More' },
    ])
    expect(editor.getHTML()).toBe(html)
    expect(editor.can().undo()).toBe(false)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('adds the title as a tooltip and keeps the host payload', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    addSuggestions(editor, [{ type: 'replace', id: '1', blockId: 'a', quote: 'quick', replacement: 'fast', title: 'Más claro', data: { by: 'llm' } }])
    expect(dom(editor).querySelector('.cw-suggestion-delete')!.getAttribute('title')).toBe('Más claro')
    expect(dom(editor).querySelector('.cw-suggestion')!.getAttribute('title')).toBe('Más claro')
    expect(only(editor).data).toEqual({ by: 'llm' })
  })

  it('omits the buttons when showControls is false', async () => {
    const editor = await makeEditor(PARAGRAPHS, { showControls: false })
    addSuggestions(editor, [
      { type: 'replace', id: '1', blockId: 'a', quote: 'quick', replacement: 'slow' },
      { type: 'insertAfter', id: '2', blockId: 'b', text: 'More' },
    ])
    expect(dom(editor).querySelector('.cw-suggestion-controls')).toBeNull()
    expect(dom(editor).querySelector('ins')).toHaveTextContent('slow')
  })

  it('returns copies: mutating results does not affect the editor', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    const [s] = addSuggestions(editor, [{ type: 'replace', id: '1', blockId: 'a', quote: 'quick', replacement: 'slow' }])
    s.from = 999
    expect(acceptSuggestion(editor, '1')).toBe(true)
    expect(texts(editor)[0]).toBe('The slow brown fox')
  })

  it('does nothing (and does not throw) when the extension is not installed', async () => {
    const editor = new TiptapEditor({ extensions: [StarterKit], content: '<p>x</p>' })
    liveEditors.push(editor)
    expect(addSuggestions(editor, [{ type: 'replace', id: '1', blockId: 'a', quote: 'x', replacement: 'y' }])).toEqual([])
    expect(getSuggestions(editor)).toEqual([])
    expect(acceptSuggestion(editor, '1')).toBe(false)
    expect(rejectSuggestion(editor, '1')).toBe(false)
    expect(() => removeSuggestions(editor)).not.toThrow()
  })
})

describe('acceptSuggestion', () => {
  it('applies a replacement, removes the suggestion and reports it', async () => {
    const onAccept = vi.fn()
    const editor = await makeEditor(PARAGRAPHS, { onAccept })
    addSuggestions(editor, [{ type: 'replace', id: '1', blockId: 'a', quote: 'quick', replacement: 'slow', data: 42 }])
    expect(acceptSuggestion(editor, '1')).toBe(true)
    expect(texts(editor)).toEqual(['The slow brown fox', 'jumps over the dog'])
    expect(getSuggestions(editor)).toEqual([])
    expect(dom(editor).querySelector('.cw-suggestion, .cw-suggestion-delete')).toBeNull()
    expect(onAccept).toHaveBeenCalledTimes(1)
    expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({ id: '1', data: 42 }))
  })

  it('is a single undo step that restores the original text', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    addSuggestions(editor, [{ type: 'replace', id: '1', blockId: 'a', quote: 'quick brown', replacement: 'red' }])
    acceptSuggestion(editor, '1')
    editor.commands.undo()
    expect(texts(editor)[0]).toBe('The quick brown fox')
    expect(editor.can().undo()).toBe(false)
  })

  it('keeps the formatting of the replaced text', async () => {
    const editor = await makeEditor('<p data-block-id="a">A <strong>bold claim</strong> here</p>')
    addSuggestions(editor, [{ type: 'replace', id: '1', blockId: 'a', quote: 'bold claim', replacement: 'strong claim' }])
    acceptSuggestion(editor, '1')
    expect(editor.getHTML()).toContain('<strong>strong claim</strong>')
  })

  it('applies a deletion', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    addSuggestions(editor, [{ type: 'replace', id: '1', blockId: 'a', quote: ' quick', replacement: '' }])
    acceptSuggestion(editor, '1')
    expect(texts(editor)[0]).toBe('The brown fox')
  })

  it('inserts proposed paragraphs after their block, with fresh block ids, and reports both', async () => {
    const onAccept = vi.fn()
    const onBlocksChange = vi.fn()
    const editor = await makeEditor(PARAGRAPHS, { onAccept }, onBlocksChange)
    addSuggestions(editor, [{ type: 'insertAfter', id: '1', blockId: 'a', text: 'New one.\nNew two.' }])
    expect(acceptSuggestion(editor, '1')).toBe(true)
    expect(texts(editor)).toEqual(['The quick brown fox', 'New one.', 'New two.', 'jumps over the dog'])
    const ids = getBlocks(editor.state.doc).map((b) => b.id)
    expect(new Set(ids).size).toBe(4)
    expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }))
    expect(onBlocksChange).toHaveBeenLastCalledWith(expect.objectContaining({ added: [ids[1], ids[2]] }))
  })

  it('inserts after a block nested in a list, inside the same list item', async () => {
    const editor = await makeEditor('<ul><li><p data-block-id="li">Item</p></li></ul><p data-block-id="end">End</p>')
    addSuggestions(editor, [{ type: 'insertAfter', id: '1', blockId: 'li', text: 'Detail' }])
    acceptSuggestion(editor, '1')
    expect(getBlocks(editor.state.doc).map((b) => [b.text, b.ancestors])).toEqual([
      ['Item', ['bulletList', 'listItem']], ['Detail', ['bulletList', 'listItem']], ['End', []],
    ])
  })

  it('refuses stale and unknown suggestions, leaving the document untouched and reporting nothing', async () => {
    const onAccept = vi.fn()
    const editor = await makeEditor(PARAGRAPHS, { onAccept })
    addSuggestions(editor, [{ type: 'replace', id: '1', blockId: 'a', quote: 'absent', replacement: 'x' }])
    const html = editor.getHTML()
    expect(acceptSuggestion(editor, '1')).toBe(false)
    expect(acceptSuggestion(editor, 'unknown')).toBe(false)
    expect(editor.getHTML()).toBe(html)
    expect(onAccept).not.toHaveBeenCalled()
    expect(getSuggestions(editor)).toHaveLength(1)
  })

  it('carries the other suggestions over the accepted change; overlapping ones become stale', async () => {
    const onStatusChange = vi.fn()
    const editor = await makeEditor(PARAGRAPHS, { onStatusChange })
    addSuggestions(editor, [
      { type: 'replace', id: 'first', blockId: 'a', quote: 'quick brown', replacement: 'red' },
      { type: 'replace', id: 'overlap', blockId: 'a', quote: 'brown fox', replacement: 'wolf' },
      { type: 'replace', id: 'later', blockId: 'a', quote: 'fox', replacement: 'hound' },
      { type: 'replace', id: 'other', blockId: 'b', quote: 'dog', replacement: 'cat' },
    ])
    acceptSuggestion(editor, 'first')
    const byId = Object.fromEntries(getSuggestions(editor).map((s) => [s.id, s]))
    expect(byId.overlap.status).toBe('stale')
    expect(textOf(editor, byId.later)).toBe('fox')
    expect(textOf(editor, byId.other)).toBe('dog')
    expect(onStatusChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'overlap', status: 'stale' })])
    expect(acceptSuggestion(editor, 'later')).toBe(true)
    expect(texts(editor)[0]).toBe('The red hound')
  })

  it('works on a read-only editor when called programmatically', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    editor.setEditable(false)
    addSuggestions(editor, [{ type: 'replace', id: '1', blockId: 'a', quote: 'quick', replacement: 'slow' }])
    expect(acceptSuggestion(editor, '1')).toBe(true)
    expect(texts(editor)[0]).toBe('The slow brown fox')
  })
})

describe('rejectSuggestion and removeSuggestions', () => {
  it('reject discards the suggestion without touching the document or the undo history, and reports it', async () => {
    const onReject = vi.fn()
    const onAccept = vi.fn()
    const editor = await makeEditor(PARAGRAPHS, { onReject, onAccept })
    addSuggestions(editor, [{ type: 'replace', id: '1', blockId: 'a', quote: 'quick', replacement: 'slow' }])
    const html = editor.getHTML()
    expect(rejectSuggestion(editor, '1')).toBe(true)
    expect(editor.getHTML()).toBe(html)
    expect(getSuggestions(editor)).toEqual([])
    expect(editor.can().undo()).toBe(false)
    expect(onReject).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }))
    expect(onAccept).not.toHaveBeenCalled()
  })

  it('reject works on stale suggestions too, and returns false for unknown ones', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    addSuggestions(editor, [{ type: 'replace', id: '1', blockId: 'a', quote: 'absent', replacement: 'x' }])
    expect(rejectSuggestion(editor, '1')).toBe(true)
    expect(rejectSuggestion(editor, '1')).toBe(false)
  })

  it('remove withdraws some or all suggestions silently', async () => {
    const onReject = vi.fn()
    const editor = await makeEditor(PARAGRAPHS, { onReject })
    addSuggestions(editor, [
      { type: 'replace', id: '1', blockId: 'a', quote: 'quick', replacement: 'slow' },
      { type: 'replace', id: '2', blockId: 'a', quote: 'fox', replacement: 'cat' },
      { type: 'insertAfter', id: '3', blockId: 'b', text: 'More' },
    ])
    removeSuggestions(editor, ['1', 'missing'])
    expect(getSuggestions(editor).map((s) => s.id)).toEqual(['2', '3'])
    removeSuggestions(editor)
    expect(getSuggestions(editor)).toEqual([])
    expect(onReject).not.toHaveBeenCalled()
  })

  it('reports exactly one event per settled suggestion, even across later transactions', async () => {
    const onAccept = vi.fn()
    const editor = await makeEditor(PARAGRAPHS, { onAccept })
    addSuggestions(editor, [{ type: 'replace', id: '1', blockId: 'a', quote: 'quick', replacement: 'slow' }])
    acceptSuggestion(editor, '1')
    editor.commands.insertContentAt(1, 'x')
    editor.commands.setTextSelection(3)
    expect(onAccept).toHaveBeenCalledTimes(1)
  })
})

describe('suggestions while editing', () => {
  it('follow their text when the user types before them', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    addSuggestions(editor, [{ type: 'replace', id: '1', blockId: 'a', quote: 'brown', replacement: 'red' }])
    editor.commands.insertContentAt(1, 'Look: ')
    expect(textOf(editor, only(editor))).toBe('brown')
    acceptSuggestion(editor, '1')
    expect(texts(editor)[0]).toBe('Look: The quick red fox')
  })

  it('become stale when the user edits their text, and are reported; active again on undo', async () => {
    const onStatusChange = vi.fn()
    const editor = await makeEditor(PARAGRAPHS, { onStatusChange })
    const [s] = addSuggestions(editor, [{ type: 'replace', id: '1', blockId: 'a', quote: 'quick', replacement: 'slow' }])
    editor.commands.insertContentAt(s.from! + 2, 'X')
    expect(only(editor).status).toBe('stale')
    expect(acceptSuggestion(editor, '1')).toBe(false)
    expect(onStatusChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: '1', status: 'stale' })])

    editor.commands.undo()
    expect(only(editor).status).toBe('active')
    expect(onStatusChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: '1', status: 'active' })])
    expect(acceptSuggestion(editor, '1')).toBe(true)
    expect(texts(editor)[0]).toBe('The slow brown fox')
  })

  it('follow their text into the previous block when blocks are joined', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    addSuggestions(editor, [{ type: 'replace', id: '1', blockId: 'b', quote: 'dog', replacement: 'cat' }])
    editor.chain().setTextSelection(editor.state.doc.child(0).nodeSize + 1).joinBackward().run()
    expect(only(editor)).toMatchObject({ status: 'active', blockId: 'a' })
    acceptSuggestion(editor, '1')
    expect(texts(editor)).toEqual(['The quick brown foxjumps over the cat'])
  })

  it('insertAfter stays after its block as the block grows, and when a new line is opened below it', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    addSuggestions(editor, [{ type: 'insertAfter', id: '1', blockId: 'a', text: 'Inserted' }])
    editor.commands.insertContentAt(editor.state.doc.child(0).nodeSize - 1, ' jumps')
    editor.chain().setTextSelection(editor.state.doc.child(0).nodeSize - 1).splitBlock().run()
    expect(only(editor).status).toBe('active')
    acceptSuggestion(editor, '1')
    expect(texts(editor)).toEqual(['The quick brown fox jumps', 'Inserted', '', 'jumps over the dog'])
  })

  it('insertAfter becomes stale when its block is deleted', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    addSuggestions(editor, [{ type: 'insertAfter', id: '1', blockId: 'b', text: 'More' }])
    editor.commands.deleteRange({ from: editor.state.doc.child(0).nodeSize, to: editor.state.doc.content.size })
    expect(only(editor).status).toBe('stale')
    expect(dom(editor).querySelector('.cw-suggestion-block')).toBeNull()
  })

  it('are re-found by block id and quote after the content is reloaded', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    addSuggestions(editor, [{ type: 'replace', id: '1', blockId: 'b', quote: 'dog', replacement: 'cat' }])
    editor.commands.setContent(`<p data-block-id="new">Intro</p>${PARAGRAPHS}`)
    expect(only(editor).status).toBe('active')
    expect(textOf(editor, only(editor))).toBe('dog')
  })

  it('does not report status changes caused by the host itself', async () => {
    const onStatusChange = vi.fn()
    const editor = await makeEditor(PARAGRAPHS, { onStatusChange })
    addSuggestions(editor, [{ type: 'replace', id: '1', blockId: 'a', quote: 'quick', replacement: 'slow' }])
    addSuggestions(editor, [{ type: 'replace', id: '1', blockId: 'a', quote: 'absent', replacement: 'slow' }])
    removeSuggestions(editor)
    expect(onStatusChange).not.toHaveBeenCalled()
  })
})

describe('accept/reject controls', () => {
  it('✓ accepts and ✕ rejects, without moving the selection on mousedown', async () => {
    const onAccept = vi.fn()
    const onReject = vi.fn()
    const editor = await makeEditor(PARAGRAPHS, { onAccept, onReject })
    addSuggestions(editor, [
      { type: 'replace', id: '1', blockId: 'a', quote: 'quick', replacement: 'slow' },
      { type: 'insertAfter', id: '2', blockId: 'b', text: 'More' },
    ])
    const accept = dom(editor).querySelector('[data-suggestion-id="1"] .cw-suggestion-accept') as HTMLButtonElement
    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    accept.dispatchEvent(mousedown)
    expect(mousedown.defaultPrevented).toBe(true)
    accept.click()
    expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }))
    expect(texts(editor)[0]).toBe('The slow brown fox')

    ;(dom(editor).querySelector('[data-suggestion-id="2"] .cw-suggestion-reject') as HTMLButtonElement).click()
    expect(onReject).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }))
    expect(getSuggestions(editor)).toEqual([])
  })

  it('Alt+Enter accepts and Alt+Shift+Enter rejects the suggestion under the cursor', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    addSuggestions(editor, [
      { type: 'replace', id: '1', blockId: 'a', quote: 'quick', replacement: 'slow' },
      { type: 'insertAfter', id: '2', blockId: 'b', text: 'More' },
    ])
    editor.commands.setTextSelection(1 + 'The qu'.length)
    expect(pressKey(editor, { altKey: true })).toBe(true)
    expect(texts(editor)[0]).toBe('The slow brown fox')

    editor.commands.setTextSelection(editor.state.doc.content.size - 3) // inside block b
    expect(pressKey(editor, { altKey: true, shiftKey: true })).toBe(true)
    expect(getSuggestions(editor)).toEqual([])
    expect(texts(editor)).toHaveLength(2)
  })

  it('Alt+Enter accepts an insertAfter suggestion from inside its block', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    addSuggestions(editor, [{ type: 'insertAfter', id: '1', blockId: 'a', text: 'More' }])
    editor.commands.setTextSelection(3)
    expect(pressKey(editor, { altKey: true })).toBe(true)
    expect(texts(editor)).toEqual(['The quick brown fox', 'More', 'jumps over the dog'])
  })

  it('the shortcuts do nothing outside suggestions, on stale ones, or in a read-only editor', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    addSuggestions(editor, [
      { type: 'replace', id: '1', blockId: 'a', quote: 'quick', replacement: 'slow' },
      { type: 'replace', id: '2', blockId: 'b', quote: 'absent', replacement: 'x' },
    ])
    editor.commands.setTextSelection(editor.state.doc.content.size - 3)
    expect(pressKey(editor, { altKey: true })).toBe(false)

    editor.commands.setTextSelection(1 + 'The qu'.length)
    editor.setEditable(false)
    expect(pressKey(editor, { altKey: true })).toBe(false)
    expect(texts(editor)[0]).toBe('The quick brown fox')
  })
})
