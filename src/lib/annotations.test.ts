import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor as TiptapEditor, type Content } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { UploadableImage } from './imageExtension'
import { BlockId, getBlocks } from './blockId'
import {
  Annotations, clearAnnotations, findQuote, getAnnotations, setAnnotations,
  type AnnotationsOptions, type ResolvedAnnotation,
} from './annotations'

// See imageExtension.test.ts: every headless editor must be destroyed.
const liveEditors: TiptapEditor[] = []

async function makeEditor(content: Content, options: AnnotationsOptions = {}) {
  let n = 0
  const editor = new TiptapEditor({
    extensions: [
      StarterKit,
      UploadableImage.configure({ inline: false }),
      Table, TableRow, TableCell, TableHeader,
      BlockId.configure({ generateId: () => `id${++n}` }),
      Annotations.configure(options),
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

const textOf = (editor: TiptapEditor, a: ResolvedAnnotation) =>
  editor.state.doc.textBetween(a.from!, a.to!, '\n', '\n')
const only = (editor: TiptapEditor, layer = 'test') => getAnnotations(editor, layer)[0]
const marked = (editor: TiptapEditor) =>
  [...editor.view.dom.querySelectorAll('.cw-annotation')].map((el) => el.textContent)

/** Calls the editor's click handlers as ProseMirror would for a click at `pos`. */
function clickAt(editor: TiptapEditor, pos: number) {
  const event = new MouseEvent('click', { bubbles: true })
  editor.view.someProp('handleClick', (handler) => handler(editor.view, pos, event))
}

const PARAGRAPHS = '<p data-block-id="a">The quick brown fox</p><p data-block-id="b">jumps over the dog</p>'

describe('findQuote', () => {
  it('returns -1 when the quote is absent', () => {
    expect(findQuote('hello world', 'bye')).toBe(-1)
  })

  it('returns the first occurrence without context', () => {
    expect(findQuote('a cat and a cat', 'cat')).toBe(2)
  })

  it('uses prefix and/or suffix to pick among repeated occurrences', () => {
    const text = 'red cat, blue cat, red dog'
    expect(findQuote(text, 'cat', 'blue ')).toBe(14)
    expect(findQuote(text, 'red', undefined, ' dog')).toBe(19)
    expect(findQuote(text, 'cat', 'red ', ',')).toBe(4)
  })

  it('falls back to the occurrence matching most of the context when none matches all of it', () => {
    const text = 'red cat, blue cat.'
    expect(findQuote(text, 'cat', 'blue ', '!')).toBe(14)
    expect(findQuote(text, 'cat', 'green ', '!')).toBe(4)
  })

  it('finds overlapping occurrences', () => {
    expect(findQuote('aaa', 'aa', 'a')).toBe(1)
  })
})

describe('setAnnotations — resolving', () => {
  it('marks the quote inside the given block', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    const [a] = setAnnotations(editor, 'test', [{ id: 'x', blockId: 'b', quote: 'over' }])
    expect(a).toMatchObject({ id: 'x', layer: 'test', status: 'active', blockId: 'b' })
    expect(textOf(editor, a)).toBe('over')
    expect(marked(editor)).toEqual(['over'])
  })

  it('only searches the given block, even if the quote appears elsewhere', async () => {
    const editor = await makeEditor('<p data-block-id="a">the end</p><p data-block-id="b">the start</p>')
    const [a] = setAnnotations(editor, 'test', [{ id: 'x', blockId: 'b', quote: 'the' }])
    expect(a.from).toBeGreaterThan(editor.state.doc.child(0).nodeSize)
  })

  it('resolves correctly across formatting, hard breaks, lists and table cells', async () => {
    const editor = await makeEditor(
      '<p data-block-id="fmt">plain <strong>bold</strong> <em>it</em>alic</p>'
      + '<p data-block-id="br">line one<br>line two</p>'
      + '<ul><li><p data-block-id="li">list item</p></li></ul>'
      + '<table><tr><td><p data-block-id="td">in a cell</p></td></tr></table>'
      + '<p>End</p>',
    )
    const results = setAnnotations(editor, 'test', [
      { id: '1', blockId: 'fmt', quote: 'bold italic' },
      { id: '2', blockId: 'br', quote: 'two' },
      { id: '3', blockId: 'br', quote: 'one\nline' },
      { id: '4', blockId: 'li', quote: 'item' },
      { id: '5', blockId: 'td', quote: 'cell' },
    ])
    expect(results.map((a) => a.status)).toEqual(['active', 'active', 'active', 'active', 'active'])
    expect(results.map((a) => textOf(editor, a))).toEqual(['bold italic', 'two', 'one\nline', 'item', 'cell'])
  })

  it('uses prefix/suffix to pick the right occurrence in the block', async () => {
    const editor = await makeEditor('<p data-block-id="a">one cat, two cat</p>')
    const [a] = setAnnotations(editor, 'test', [{ id: 'x', blockId: 'a', quote: 'cat', prefix: 'two ' }])
    expect(a.from).toBe(1 + 'one cat, two '.length)
  })

  it('annotates the whole block when there is no quote — text blocks and images alike', async () => {
    const editor = await makeEditor('<p data-block-id="p">Para</p><img data-block-id="img" src="a.png"><p>End</p>')
    const [p, img] = setAnnotations(editor, 'test', [
      { id: '1', blockId: 'p' },
      { id: '2', blockId: 'img', quote: '' },
    ])
    expect(p).toMatchObject({ status: 'active', from: 0, to: editor.state.doc.child(0).nodeSize })
    expect(editor.state.doc.nodeAt(img.from!)?.type.name).toBe('image')
    expect(editor.view.dom.querySelectorAll('.cw-annotation-block')).toHaveLength(2)
  })

  it('styles whole-block annotations with their own kind class', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    setAnnotations(editor, 'test', [{ id: '1', blockId: 'a', kind: 'comment' }])
    expect(editor.view.dom.querySelector('p')!.className).toBe('cw-annotation-block cw-annotation-block--comment')
  })

  it('reports annotations it cannot place as stale (missing block, missing quote, quote on an image)', async () => {
    const editor = await makeEditor('<p data-block-id="a">Text</p><img data-block-id="img" src="a.png"><p>End</p>')
    const results = setAnnotations(editor, 'test', [
      { id: '1', blockId: 'nope', quote: 'Text' },
      { id: '2', blockId: 'a', quote: 'absent' },
      { id: '3', blockId: 'img', quote: 'alt' },
    ])
    expect(results.map((a) => [a.status, a.from, a.to])).toEqual([
      ['stale', null, null], ['stale', null, null], ['stale', null, null],
    ])
    expect(marked(editor)).toEqual([])
  })

  it('is case-sensitive and exact', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    const [a] = setAnnotations(editor, 'test', [{ id: 'x', blockId: 'a', quote: 'quick  brown' }])
    expect(a.status).toBe('stale')
    const [b] = setAnnotations(editor, 'test', [{ id: 'x', blockId: 'a', quote: 'Quick' }])
    expect(b.status).toBe('stale')
  })

  it('keeps the host payload and styling fields', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    const data = { message: 'Weak verb', severity: 2 }
    setAnnotations(editor, 'test', [
      { id: 'x', blockId: 'b', quote: 'jumps', kind: 'style', className: 'extra one', title: 'Weak verb', data },
    ])
    expect(only(editor).data).toEqual(data)
    const el = editor.view.dom.querySelector('.cw-annotation')!
    expect(el.className).toBe('cw-annotation cw-annotation--style extra one')
    expect(el.getAttribute('title')).toBe('Weak verb')
  })

  it('is a pure overlay: not in HTML/JSON, no undo step, no update event', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    const onUpdate = vi.fn()
    editor.on('update', onUpdate)
    const html = editor.getHTML()
    setAnnotations(editor, 'test', [{ id: 'x', blockId: 'a', quote: 'quick' }])
    expect(editor.getHTML()).toBe(html)
    expect(JSON.stringify(editor.getJSON())).not.toContain('cw-annotation')
    expect(editor.can().undo()).toBe(false)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('returns copies: mutating results does not affect the editor', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    const [a] = setAnnotations(editor, 'test', [{ id: 'x', blockId: 'a', quote: 'quick' }])
    a.from = 999
    only(editor).to = 999
    expect(textOf(editor, only(editor))).toBe('quick')
  })
})

describe('layers', () => {
  it('keeps layers independent, and replaces only the layer being set', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    setAnnotations(editor, 'spelling', [{ id: '1', blockId: 'a', quote: 'quick' }])
    setAnnotations(editor, 'style', [{ id: '1', blockId: 'b', quote: 'jumps' }])
    setAnnotations(editor, 'spelling', [{ id: '2', blockId: 'a', quote: 'fox' }])
    expect(getAnnotations(editor).map((a) => [a.layer, a.id, a.quote])).toEqual([
      ['spelling', '2', 'fox'], ['style', '1', 'jumps'],
    ])
  })

  it('clears one layer or all of them', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    setAnnotations(editor, 'one', [{ id: '1', blockId: 'a', quote: 'quick' }])
    setAnnotations(editor, 'two', [{ id: '1', blockId: 'b', quote: 'jumps' }])
    clearAnnotations(editor, 'one')
    expect(getAnnotations(editor).map((a) => a.layer)).toEqual(['two'])
    clearAnnotations(editor)
    expect(getAnnotations(editor)).toEqual([])
    expect(marked(editor)).toEqual([])
  })

  it('setting an empty list empties the layer', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    setAnnotations(editor, 'test', [{ id: '1', blockId: 'a', quote: 'quick' }])
    setAnnotations(editor, 'test', [])
    expect(getAnnotations(editor, 'test')).toEqual([])
  })

  it('keeps the last annotation when ids repeat within a layer', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    setAnnotations(editor, 'test', [
      { id: 'x', blockId: 'a', quote: 'quick' },
      { id: 'x', blockId: 'a', quote: 'fox' },
    ])
    expect(getAnnotations(editor, 'test').map((a) => a.quote)).toEqual(['fox'])
  })

  it('lets overlapping annotations from different layers coexist', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    setAnnotations(editor, 'one', [{ id: '1', blockId: 'a', quote: 'quick brown' }])
    setAnnotations(editor, 'two', [{ id: '1', blockId: 'a', quote: 'brown fox' }])
    expect(getAnnotations(editor).map((a) => a.status)).toEqual(['active', 'active'])
    expect(editor.view.dom.querySelectorAll('.cw-annotation').length).toBeGreaterThanOrEqual(2)
  })

  it('does nothing (and does not throw) when the extension is not installed', async () => {
    const editor = new TiptapEditor({ extensions: [StarterKit], content: '<p>x</p>' })
    liveEditors.push(editor)
    expect(setAnnotations(editor, 'test', [{ id: '1', blockId: 'a', quote: 'x' }])).toEqual([])
    expect(getAnnotations(editor)).toEqual([])
    expect(() => clearAnnotations(editor)).not.toThrow()
  })
})

describe('annotations while editing', () => {
  it('follows its text when the user types before it', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    setAnnotations(editor, 'test', [{ id: 'x', blockId: 'a', quote: 'brown' }])
    editor.commands.insertContentAt(1, 'Look: ')
    expect(only(editor).status).toBe('active')
    expect(textOf(editor, only(editor))).toBe('brown')
  })

  it('is unaffected by edits in other blocks', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    const [before] = setAnnotations(editor, 'test', [{ id: 'x', blockId: 'a', quote: 'brown' }])
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' again')
    expect(only(editor)).toMatchObject({ status: 'active', from: before.from, to: before.to })
  })

  it('does not stretch when the user types right at its edges, nor jump to another occurrence', async () => {
    const editor = await makeEditor('<p data-block-id="a">brown cat, brown fox</p>')
    const [a] = setAnnotations(editor, 'test', [{ id: 'x', blockId: 'a', quote: 'brown', suffix: ' fox' }])
    expect(a.from).toBe(1 + 'brown cat, '.length)
    editor.commands.insertContentAt(a.to!, 'ish')
    editor.commands.insertContentAt(a.from!, 'dark-')
    expect(only(editor).from).toBe(1 + 'brown cat, dark-'.length)
    expect(textOf(editor, only(editor))).toBe('brown')
    expect(marked(editor)).toEqual(['brown'])
  })

  it('becomes stale (and unmarked) when its text is edited, and active again on undo', async () => {
    const onStatusChange = vi.fn()
    const editor = await makeEditor(PARAGRAPHS, { onStatusChange })
    const [a] = setAnnotations(editor, 'test', [{ id: 'x', blockId: 'a', quote: 'quick' }])

    editor.commands.insertContentAt(a.from! + 2, 'X')
    expect(only(editor)).toMatchObject({ status: 'stale', from: null, to: null })
    expect(marked(editor)).toEqual([])
    expect(onStatusChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'x', status: 'stale' })])

    editor.commands.undo()
    expect(only(editor).status).toBe('active')
    expect(textOf(editor, only(editor))).toBe('quick')
    expect(onStatusChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'x', status: 'active' })])
  })

  it('becomes stale when its block is deleted', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    setAnnotations(editor, 'test', [{ id: 'x', blockId: 'b', quote: 'over' }, { id: 'y', blockId: 'b' }])
    editor.commands.deleteRange({ from: editor.state.doc.child(0).nodeSize, to: editor.state.doc.content.size })
    expect(getAnnotations(editor, 'test').map((a) => a.status)).toEqual(['stale', 'stale'])
  })

  it('follows its text into the previous block when two blocks are joined', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    setAnnotations(editor, 'test', [{ id: 'x', blockId: 'b', quote: 'over' }])
    editor.chain().setTextSelection(editor.state.doc.child(0).nodeSize + 1).joinBackward().run()
    expect(only(editor)).toMatchObject({ status: 'active', blockId: 'a' })
    expect(textOf(editor, only(editor))).toBe('over')
  })

  it('follows its text into the new block when Enter splits the block before it', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    setAnnotations(editor, 'test', [{ id: 'x', blockId: 'a', quote: 'fox' }])
    editor.chain().setTextSelection(1 + 'The quick '.length).splitBlock().run()
    const holder = getBlocks(editor.state.doc).find((b) => b.text === 'brown fox')!
    expect(only(editor)).toMatchObject({ status: 'active', blockId: holder.id })
    expect(holder.id).not.toBe('a')
  })

  it('is re-found by block id and quote when its range cannot be mapped (content reloaded)', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    setAnnotations(editor, 'test', [{ id: 'x', blockId: 'b', quote: 'over' }])
    editor.commands.setContent(`<p data-block-id="new">Intro</p>${PARAGRAPHS}`)
    expect(only(editor).status).toBe('active')
    expect(textOf(editor, only(editor))).toBe('over')
  })

  it('is re-found when its text comes back after being stale, without undo', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    setAnnotations(editor, 'test', [{ id: 'x', blockId: 'a', quote: 'quick' }])
    editor.commands.deleteRange({ from: 5, to: 10 }) // "quick"
    expect(only(editor).status).toBe('stale')
    editor.commands.insertContentAt(5, 'quick')
    expect(only(editor).status).toBe('active')
  })

  it('keeps disambiguating with prefix when re-found', async () => {
    const editor = await makeEditor('<p data-block-id="a">one cat, two cat</p>')
    setAnnotations(editor, 'test', [{ id: 'x', blockId: 'a', quote: 'cat', prefix: 'two ' }])
    editor.commands.setContent('<p data-block-id="a">one cat, two cat</p>')
    expect(only(editor).from).toBe(1 + 'one cat, two '.length)
  })

  it('whole-block annotations follow the block and survive edits to its text', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    setAnnotations(editor, 'test', [{ id: 'x', blockId: 'b' }])
    editor.commands.insertContentAt(1, 'Intro. ')
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' and more')
    const a = only(editor)
    expect(a.status).toBe('active')
    expect(editor.state.doc.nodeAt(a.from!)?.attrs.blockId).toBe('b')
    expect(a.to! - a.from!).toBe(editor.state.doc.nodeAt(a.from!)!.nodeSize)
  })

  it('reports only the annotations whose status changed', async () => {
    const onStatusChange = vi.fn()
    const editor = await makeEditor(PARAGRAPHS, { onStatusChange })
    setAnnotations(editor, 'test', [{ id: 'x', blockId: 'a', quote: 'quick' }, { id: 'y', blockId: 'b', quote: 'dog' }])
    editor.commands.insertContentAt(1, 'Hey ')
    expect(onStatusChange).not.toHaveBeenCalled()
    editor.commands.deleteRange({ from: 9, to: 14 }) // "quick", now shifted by 4
    expect(onStatusChange).toHaveBeenCalledTimes(1)
    expect(onStatusChange.mock.calls[0][0].map((a: ResolvedAnnotation) => a.id)).toEqual(['x'])
  })

  it('does not report status changes caused by the host itself', async () => {
    const onStatusChange = vi.fn()
    const editor = await makeEditor(PARAGRAPHS, { onStatusChange })
    setAnnotations(editor, 'test', [{ id: 'x', blockId: 'a', quote: 'quick' }])
    setAnnotations(editor, 'test', [{ id: 'x', blockId: 'a', quote: 'absent' }])
    clearAnnotations(editor)
    expect(onStatusChange).not.toHaveBeenCalled()
  })

  it('stays consistent through undo/redo of a split', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    setAnnotations(editor, 'test', [{ id: 'x', blockId: 'a', quote: 'fox' }])
    editor.chain().setTextSelection(1 + 'The quick '.length).splitBlock().run()
    editor.commands.undo()
    expect(only(editor)).toMatchObject({ status: 'active', blockId: 'a' })
    editor.commands.redo()
    expect(only(editor).status).toBe('active')
    expect(textOf(editor, only(editor))).toBe('fox')
  })
})

describe('annotation events', () => {
  it('reports clicks on annotated text, with every overlapping annotation', async () => {
    const onClick = vi.fn()
    const editor = await makeEditor(PARAGRAPHS, { onClick })
    setAnnotations(editor, 'one', [{ id: '1', blockId: 'a', quote: 'quick brown' }])
    setAnnotations(editor, 'two', [{ id: '2', blockId: 'a', quote: 'brown fox' }])

    clickAt(editor, 1 + 'The quick b'.length) // inside "brown": both
    expect(onClick.mock.lastCall![0].map((a: ResolvedAnnotation) => a.id)).toEqual(['1', '2'])
    clickAt(editor, 1 + 'The q'.length) // inside "quick": only the first
    expect(onClick.mock.lastCall![0].map((a: ResolvedAnnotation) => a.id)).toEqual(['1'])
  })

  it('does not report clicks outside annotations, nor on stale ones', async () => {
    const onClick = vi.fn()
    const editor = await makeEditor(PARAGRAPHS, { onClick })
    setAnnotations(editor, 'test', [{ id: '1', blockId: 'a', quote: 'quick' }, { id: '2', blockId: 'a', quote: 'absent' }])
    clickAt(editor, editor.state.doc.content.size - 2)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('reports clicks on whole-block annotations', async () => {
    const onClick = vi.fn()
    const editor = await makeEditor(PARAGRAPHS, { onClick })
    setAnnotations(editor, 'test', [{ id: 'blk', blockId: 'b' }])
    clickAt(editor, editor.state.doc.child(0).nodeSize + 3)
    expect(onClick).toHaveBeenCalledWith([expect.objectContaining({ id: 'blk' })], expect.any(MouseEvent))
  })

  it('does not swallow the click (cursor placement still happens)', async () => {
    const editor = await makeEditor(PARAGRAPHS, { onClick: () => {} })
    setAnnotations(editor, 'test', [{ id: '1', blockId: 'a', quote: 'quick' }])
    const handled = editor.view.someProp('handleClick', (h) => h(editor.view, 6, new MouseEvent('click')))
    expect(handled).toBeFalsy()
  })

  it('reports hovering in and out of annotations, once per change', async () => {
    const onHover = vi.fn()
    const editor = await makeEditor(PARAGRAPHS, { onHover })
    setAnnotations(editor, 'test', [{ id: '1', blockId: 'a', quote: 'quick' }])
    const span = editor.view.dom.querySelector('.cw-annotation')!
    const paragraph = editor.view.dom.querySelectorAll('p')[1]

    span.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    span.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(onHover).toHaveBeenCalledTimes(1)
    expect(onHover.mock.lastCall![0].map((a: ResolvedAnnotation) => a.id)).toEqual(['1'])

    paragraph.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(onHover).toHaveBeenCalledTimes(2)
    expect(onHover.mock.lastCall![0]).toEqual([])
  })

  it('reports leaving the editor while hovering an annotation', async () => {
    const onHover = vi.fn()
    const editor = await makeEditor(PARAGRAPHS, { onHover })
    setAnnotations(editor, 'test', [{ id: '1', blockId: 'a', quote: 'quick' }])
    editor.view.dom.querySelector('.cw-annotation')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    editor.view.dom.dispatchEvent(new MouseEvent('mouseleave'))
    expect(onHover).toHaveBeenLastCalledWith([], expect.any(MouseEvent))
  })

  it('reports hovering a whole-block annotation without the inline ones at its start', async () => {
    const onHover = vi.fn()
    const editor = await makeEditor(PARAGRAPHS, { onHover })
    setAnnotations(editor, 'test', [{ id: 'blk', blockId: 'a' }, { id: 'in', blockId: 'a', quote: 'The' }])
    editor.view.dom.querySelector('.cw-annotation-block')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(onHover.mock.lastCall![0].map((a: ResolvedAnnotation) => a.id)).toEqual(['blk'])
  })
})
