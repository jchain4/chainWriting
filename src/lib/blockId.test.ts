import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor as TiptapEditor, type AnyExtension, type Content } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { UploadableImage } from './imageExtension'
import { BLOCK_ID_PATTERN, BlockId, diffBlocks, getBlocks, type BlockIdOptions, type BlocksChange } from './blockId'

// See imageExtension.test.ts: every headless editor must be destroyed, or
// EditorView's pending timers fire after jsdom teardown.
const liveEditors: TiptapEditor[] = []

const richExtensions: AnyExtension[] = [
  UploadableImage.configure({ inline: false }),
  Table, TableRow, TableCell, TableHeader,
]

interface MakeOptions {
  onBlocksChange?: (change: BlocksChange) => void
  blockId?: Partial<BlockIdOptions>
  rich?: boolean
}

async function makeEditor(content: Content, { onBlocksChange, blockId, rich }: MakeOptions = {}) {
  let n = 0
  const editor = new TiptapEditor({
    extensions: [
      StarterKit,
      ...(rich ? richExtensions : []),
      BlockId.configure({ generateId: () => `id${++n}`, onBlocksChange, ...blockId }),
    ],
    content,
  })
  liveEditors.push(editor)
  // Tiptap emits 'create' (where initial ids are assigned) on a timeout.
  await new Promise<void>((resolve) => editor.on('create', () => resolve()))
  return editor
}

const blocks = (editor: TiptapEditor) => getBlocks(editor.state.doc)
const ids = (editor: TiptapEditor) => blocks(editor).map((b) => b.id)
const idOf = (editor: TiptapEditor, text: string) => blocks(editor).find((b) => b.text === text)?.id

function expectUniqueIds(editor: TiptapEditor) {
  const all = ids(editor)
  expect(all.every(Boolean)).toBe(true)
  expect(new Set(all).size).toBe(all.length)
}

// Positions in '<p data-block-id="a">One</p><p data-block-id="b">Two</p>':
// "One" spans 1–4 (block a ends at 5), "Two" spans 6–9.
const TWO_PARAGRAPHS = '<p data-block-id="a">One</p><p data-block-id="b">Two</p>'

afterEach(() => {
  while (liveEditors.length) liveEditors.pop()!.destroy()
})

describe('BlockId — initial content', () => {
  it('assigns a unique id to every kind of block, including nested ones', async () => {
    const editor = await makeEditor(
      '<h2>Title</h2>'
      + '<blockquote><p>Quote</p></blockquote>'
      + '<ul><li><p>Item</p><ul><li><p>Nested</p></li></ul></li></ul>'
      + '<pre><code>code</code></pre>'
      + '<hr>'
      + '<img src="pic.png" alt="Pic">'
      + '<table><tr><th><p>Head</p></th></tr><tr><td><p>Cell</p></td></tr></table>'
      + '<p>End</p>',
      { rich: true },
    )
    expect(blocks(editor).map((b) => b.type)).toEqual([
      'heading', 'paragraph', 'paragraph', 'paragraph', 'codeBlock',
      'horizontalRule', 'image', 'paragraph', 'paragraph', 'paragraph',
    ])
    expectUniqueIds(editor)
  })

  it('gives the single empty paragraph of an empty editor an id', async () => {
    const editor = await makeEditor('')
    expect(ids(editor)).toEqual(['id1'])
  })

  it('keeps ids already present in the HTML and only mints the missing ones', async () => {
    const editor = await makeEditor('<p data-block-id="keep-me">One</p><p>Two</p>')
    expect(ids(editor)).toEqual(['keep-me', 'id1'])
  })

  it('assigns ids to JSON content without them, and keeps the ones it has', async () => {
    const editor = await makeEditor({
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { blockId: 'from-json' }, content: [{ type: 'text', text: 'One' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Two' }] },
      ],
    })
    expect(ids(editor)).toEqual(['from-json', 'id1'])
  })

  it('resolves duplicate ids in the initial content, keeping the first one', async () => {
    const editor = await makeEditor('<p data-block-id="dup">One</p><p data-block-id="dup">Two</p>')
    expect(ids(editor)).toEqual(['dup', 'id1'])
  })

  it('does not count the initial id assignment as an edit, an update or an undo step', async () => {
    const onBlocksChange = vi.fn()
    const onUpdate = vi.fn()
    const editor = await makeEditor('<p>One</p>', { onBlocksChange })
    editor.on('update', onUpdate)
    expect(onBlocksChange).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
    expect(editor.can().undo()).toBe(false)
    expect(editor.storage.blockId.version).toBe(0)
  })

  it('renders ids as data-block-id in HTML and blockId in JSON, so they survive a round-trip', async () => {
    const editor = await makeEditor('<h2>Title</h2><p>Body</p>')
    const [titleId, bodyId] = ids(editor)
    expect(editor.getHTML()).toBe(`<h2 data-block-id="${titleId}">Title</h2><p data-block-id="${bodyId}">Body</p>`)
    expect(editor.getJSON().content![0].attrs).toMatchObject({ blockId: titleId })

    const fromHtml = await makeEditor(editor.getHTML())
    expect(ids(fromHtml)).toEqual([titleId, bodyId])
    const fromJson = await makeEditor(editor.getJSON())
    expect(ids(fromJson)).toEqual([titleId, bodyId])
  })

  it('does not put ids on container nodes (lists, list items, quotes)', async () => {
    const editor = await makeEditor('<blockquote><p>Q</p></blockquote><ul><li><p>Item</p></li></ul><p>End</p>')
    const html = editor.getHTML()
    expect(html).toMatch(/<blockquote><p data-block-id/)
    expect(html).toMatch(/<ul><li><p data-block-id/)
  })
})

describe('BlockId — while editing', () => {
  it('keeps the id while typing inside a block', async () => {
    const editor = await makeEditor(TWO_PARAGRAPHS)
    editor.commands.insertContentAt(4, ' more')
    expect(blocks(editor).map((b) => [b.id, b.text])).toEqual([['a', 'One more'], ['b', 'Two']])
  })

  it('Enter in the middle: the first half keeps the id, the second half gets a fresh one', async () => {
    const editor = await makeEditor('<p data-block-id="a">HelloWorld</p>')
    editor.chain().setTextSelection(6).splitBlock().run()
    expect(blocks(editor).map((b) => [b.id, b.text])).toEqual([['a', 'Hello'], ['id1', 'World']])
  })

  it('Enter at the end: the block keeps the id, the new empty line gets a fresh one', async () => {
    const editor = await makeEditor('<p data-block-id="a">Hello</p>')
    editor.chain().setTextSelection(6).splitBlock().run()
    expect(blocks(editor).map((b) => [b.id, b.text])).toEqual([['a', 'Hello'], ['id1', '']])
  })

  it('Enter at the start: the id follows the text, the new empty line above gets a fresh one', async () => {
    const editor = await makeEditor('<p data-block-id="a">Hello</p>')
    editor.chain().setTextSelection(1).splitBlock().run()
    expect(blocks(editor).map((b) => [b.id, b.text])).toEqual([['id1', ''], ['a', 'Hello']])
  })

  it('Enter at the start of a list item: the id follows the text', async () => {
    const editor = await makeEditor('<ul><li><p data-block-id="a">Item</p></li></ul><p data-block-id="end">End</p>')
    editor.chain().setTextSelection(3).splitListItem('listItem').run()
    expect(blocks(editor).map((b) => [b.id, b.text])).toEqual([['id1', ''], ['a', 'Item'], ['end', 'End']])
  })

  it('Enter in an empty block: the original empty block keeps its id', async () => {
    const editor = await makeEditor('<p data-block-id="a">One</p><p data-block-id="empty"></p>')
    editor.chain().setTextSelection(6).splitBlock().run()
    expect(ids(editor)).toEqual(['a', 'empty', 'id1'])
  })

  it('joining two blocks keeps the first id and drops the second', async () => {
    const editor = await makeEditor(TWO_PARAGRAPHS)
    editor.chain().setTextSelection(6).joinBackward().run()
    expect(blocks(editor).map((b) => [b.id, b.text])).toEqual([['a', 'OneTwo']])
  })

  it('a pasted copy gets a fresh id whether pasted after or before the original', async () => {
    const after = await makeEditor(TWO_PARAGRAPHS)
    after.commands.insertContentAt(after.state.doc.content.size, '<p data-block-id="a">Copy</p>')
    expect(idOf(after, 'One')).toBe('a')
    expect(idOf(after, 'Copy')).not.toBe('a')
    expectUniqueIds(after)

    const before = await makeEditor(TWO_PARAGRAPHS)
    before.commands.insertContentAt(0, '<p data-block-id="b">Copy</p>')
    expect(idOf(before, 'Two')).toBe('b')
    expect(idOf(before, 'Copy')).not.toBe('b')
    expectUniqueIds(before)
  })

  it('pasted blocks keep ids that are not already in the document', async () => {
    const editor = await makeEditor(TWO_PARAGRAPHS)
    editor.commands.insertContentAt(editor.state.doc.content.size, '<p data-block-id="from-elsewhere">New</p>')
    expect(idOf(editor, 'New')).toBe('from-elsewhere')
  })

  it('moving a block (cut + paste in one step) keeps its id', async () => {
    const editor = await makeEditor(TWO_PARAGRAPHS)
    const a = editor.state.doc.child(0)
    const tr = editor.state.tr.delete(0, a.nodeSize)
    tr.insert(tr.doc.content.size, a)
    editor.view.dispatch(tr)
    expect(blocks(editor).map((b) => [b.id, b.text])).toEqual([['b', 'Two'], ['a', 'One']])
  })

  it('changing the block type keeps the id (paragraph → heading → code block, heading level)', async () => {
    const editor = await makeEditor(TWO_PARAGRAPHS)
    editor.chain().setTextSelection(2).toggleHeading({ level: 2 }).run()
    expect(blocks(editor)[0]).toMatchObject({ id: 'a', type: 'heading', attrs: { level: 2 } })
    editor.chain().setTextSelection(2).toggleHeading({ level: 3 }).run()
    expect(blocks(editor)[0]).toMatchObject({ id: 'a', type: 'heading', attrs: { level: 3 } })
    editor.chain().setTextSelection(2).toggleCodeBlock().run()
    expect(blocks(editor)[0]).toMatchObject({ id: 'a', type: 'codeBlock' })
  })

  it('wrapping in a list or quote keeps the id and updates the ancestors', async () => {
    const editor = await makeEditor(TWO_PARAGRAPHS)
    editor.chain().setTextSelection(2).toggleBulletList().run()
    expect(blocks(editor)[0]).toMatchObject({ id: 'a', ancestors: ['bulletList', 'listItem'] })
    editor.chain().setTextSelection(editor.state.doc.content.size - 2).toggleBlockquote().run()
    expect(blocks(editor).find((b) => b.id === 'b')).toMatchObject({ ancestors: ['blockquote'] })
  })

  it('undo and redo restore the same ids', async () => {
    const editor = await makeEditor('<p data-block-id="a">HelloWorld</p>')
    editor.chain().setTextSelection(6).splitBlock().run()
    const afterSplit = ids(editor)

    editor.commands.undo()
    expect(blocks(editor).map((b) => [b.id, b.text])).toEqual([['a', 'HelloWorld']])
    editor.commands.redo()
    expect(ids(editor)).toEqual(afterSplit)
  })

  it('setContent without ids gets fresh ones', async () => {
    const editor = await makeEditor(TWO_PARAGRAPHS)
    editor.commands.setContent('<p>X</p><p>Y</p>')
    expect(ids(editor)).toEqual(['id1', 'id2'])
  })

  it('stays unique and complete through a long mixed sequence of edits', async () => {
    const editor = await makeEditor('<p>Alpha beta gamma</p><ul><li><p>Item one</p></li></ul><p>Omega</p>')
    for (let i = 0; i < 20; i++) {
      const size = editor.state.doc.content.size
      const pos = 1 + ((i * 7) % (size - 2))
      switch (i % 5) {
        case 0: editor.chain().setTextSelection(pos).splitBlock().run(); break
        case 1: editor.chain().setTextSelection(pos).joinBackward().run(); break
        case 2: editor.commands.insertContentAt(pos, `<p data-block-id="${ids(editor)[0]}">Paste ${i}</p>`); break
        case 3: editor.chain().setTextSelection(pos).insertContent('typed').run(); break
        case 4: editor.commands.undo(); break
      }
      expectUniqueIds(editor)
    }
  })
})

describe('BlockId — options', () => {
  it('`types` limits which nodes get ids', async () => {
    const editor = await makeEditor('<h2>Title</h2><p>Body</p>', { blockId: { types: ['heading'] } })
    expect(getBlocks(editor.state.doc, ['heading']).map((b) => b.type)).toEqual(['heading'])
    expect(editor.getHTML()).toMatch(/<h2 data-block-id="[^"]+">Title<\/h2><p>Body<\/p>/)
  })

  it('never hands out an id already in use, even if `generateId` repeats itself', async () => {
    const queue = ['taken', 'taken', 'free']
    const editor = await makeEditor('<p data-block-id="taken">A</p><p>B</p>', {
      blockId: { generateId: () => queue.shift() ?? 'fallback' },
    })
    expect(ids(editor)).toEqual(['taken', 'free'])
  })
})

describe('BlockId — id format', () => {
  async function withDefaultIds(content: Content) {
    const editor = new TiptapEditor({ extensions: [StarterKit, BlockId], content })
    liveEditors.push(editor)
    await new Promise<void>((resolve) => editor.on('create', () => resolve()))
    return editor
  }

  it('generates 8-character [0-9a-z] ids by default, which match BLOCK_ID_PATTERN', async () => {
    const editor = await withDefaultIds('<p>A</p><p>B</p><h2>C</h2>')
    for (const id of ids(editor)) {
      expect(id).toMatch(/^[0-9a-z]{8}$/)
      expect(id).toMatch(BLOCK_ID_PATTERN)
    }
  })

  it('BLOCK_ID_PATTERN allows 1–64 ASCII letters, digits, _ and -, and nothing else', () => {
    for (const ok of ['a', 'A-b_9', 'x'.repeat(64)]) expect(ok).toMatch(BLOCK_ID_PATTERN)
    for (const bad of ['', 'x'.repeat(65), 'has space', 'quo"te', '<script>', 'ñandú', 'a/b', 'a.b']) {
      expect(bad).not.toMatch(BLOCK_ID_PATTERN)
    }
  })

  it('replaces malformed ids in loaded HTML, keeping valid ones', async () => {
    const editor = await makeEditor(
      '<p data-block-id="A-b_9">ok</p><p data-block-id="has space">1</p><p data-block-id="&quot;&gt;&lt;x">2</p>'
      + `<p data-block-id="${'x'.repeat(65)}">3</p><p data-block-id="">4</p>`,
    )
    expect(ids(editor)).toEqual(['A-b_9', 'id1', 'id2', 'id3', 'id4'])
    expect(editor.getHTML()).not.toContain('has space')
  })

  it('replaces malformed ids in JSON content and in pasted HTML', async () => {
    const editor = await makeEditor({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { blockId: 'bad id' }, content: [{ type: 'text', text: 'One' }] }],
    })
    expect(ids(editor)).toEqual(['id1'])
    editor.commands.insertContentAt(editor.state.doc.content.size, '<p data-block-id="ñandú">Pasted</p>')
    expect(ids(editor)).toEqual(['id1', 'id2'])
  })

  it('falls back to default ids (and warns once) when generateId keeps repeating itself, instead of hanging', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const editor = await makeEditor('<p>A</p><p>B</p><p>C</p>', { blockId: { generateId: () => 'same' } })
      const all = ids(editor)
      expect(all[0]).toBe('same')
      expect(new Set(all).size).toBe(3)
      all.forEach((id) => expect(id).toMatch(BLOCK_ID_PATTERN))
      editor.chain().setTextSelection(2).splitBlock().run()
      expectUniqueIds(editor)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toContain('generateId() kept returning ids')
    } finally {
      warn.mockRestore()
    }
  })

  it('falls back to default ids when generateId returns malformed ids', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const editor = await makeEditor('<p>A</p>', { blockId: { generateId: () => 'not valid!' } })
      expect(ids(editor)[0]).toMatch(/^[0-9a-z]{8}$/)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('warns once per editor, not once per page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await makeEditor('<p>A</p><p>B</p>', { blockId: { generateId: () => 'same' } })
      await makeEditor('<p>A</p><p>B</p>', { blockId: { generateId: () => 'same' } })
      expect(warn).toHaveBeenCalledTimes(2)
    } finally {
      warn.mockRestore()
    }
  })

  it('accepts a generator that succeeds within a few retries without warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const queue = ['bad id', 'taken', 'fine']
      const editor = await makeEditor('<p data-block-id="taken">A</p><p>B</p>', { blockId: { generateId: () => queue.shift() ?? 'z' } })
      expect(ids(editor)).toEqual(['taken', 'fine'])
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('onBlocksChange', () => {
  async function tracked(content: Content, rich = false) {
    const onBlocksChange = vi.fn<(change: BlocksChange) => void>()
    const editor = await makeEditor(content, { onBlocksChange, rich })
    return { editor, onBlocksChange, last: () => onBlocksChange.mock.lastCall?.[0] }
  }

  it('reports a typed-in block as updated', async () => {
    const { editor, last } = await tracked(TWO_PARAGRAPHS)
    editor.commands.insertContentAt(4, '!')
    expect(last()).toEqual({
      added: [], updated: ['a'], removed: [], version: 1,
      blocks: [{ id: 'a', type: 'paragraph', text: 'One!', attrs: {}, ancestors: [] }],
    })
  })

  it('reports formatting and attribute changes as updates', async () => {
    const { editor, last } = await tracked(TWO_PARAGRAPHS)
    editor.chain().setTextSelection({ from: 1, to: 4 }).toggleBold().run()
    expect(last()).toMatchObject({ updated: ['a'] })
    editor.chain().setTextSelection(7).toggleHeading({ level: 2 }).run()
    expect(last()).toMatchObject({ updated: ['b'] })
  })

  it('reports image attribute changes as updates', async () => {
    const { editor, last } = await tracked('<img data-block-id="img" src="a.png" alt="Old"><p>End</p>', true)
    editor.commands.command(({ tr }) => { tr.setNodeAttribute(0, 'alt', 'New'); return true })
    expect(last()).toMatchObject({ updated: ['img'], added: [], removed: [] })
  })

  it('reports a split as the original updated plus one added block', async () => {
    const { editor, last } = await tracked('<p data-block-id="a">HelloWorld</p>')
    editor.chain().setTextSelection(6).splitBlock().run()
    expect(last()).toMatchObject({ updated: ['a'], added: ['id1'], removed: [] })
  })

  it('reports a join as the first block updated and the second removed', async () => {
    const { editor, last } = await tracked(TWO_PARAGRAPHS)
    editor.chain().setTextSelection(6).joinBackward().run()
    expect(last()).toMatchObject({ updated: ['a'], added: [], removed: ['b'] })
  })

  it('reports a deleted block as removed', async () => {
    const { editor, last } = await tracked(TWO_PARAGRAPHS)
    editor.commands.deleteRange({ from: 0, to: 5 })
    expect(last()).toMatchObject({ updated: [], added: [], removed: ['a'] })
  })

  it('reports undo as the reverse change', async () => {
    const { editor, last } = await tracked('<p data-block-id="a">HelloWorld</p>')
    editor.chain().setTextSelection(6).splitBlock().run()
    editor.commands.undo()
    expect(last()).toMatchObject({ updated: ['a'], added: [], removed: ['id1'] })
  })

  it('reports every block touched by a single change (setContent, clear)', async () => {
    const { editor, last } = await tracked(TWO_PARAGRAPHS)
    editor.commands.setContent('<p data-block-id="b">Two</p><p data-block-id="c">Three</p>')
    expect(last()).toMatchObject({ added: ['c'], updated: [], removed: ['a'] })
    editor.commands.clearContent(true)
    expect(last()).toMatchObject({ added: ['id1'], removed: ['b', 'c'] })
  })

  it('is not called for selection changes, and the version does not move', async () => {
    const { editor, onBlocksChange } = await tracked(TWO_PARAGRAPHS)
    editor.commands.setTextSelection(3)
    editor.commands.setTextSelection({ from: 1, to: 4 })
    expect(onBlocksChange).not.toHaveBeenCalled()
    expect(editor.storage.blockId.version).toBe(0)
  })

  it('is not called when no block content changed (e.g. wrapping in a list), but the version still moves', async () => {
    const { editor, onBlocksChange, last } = await tracked(TWO_PARAGRAPHS)
    editor.chain().setTextSelection(2).toggleBulletList().run()
    expect(onBlocksChange).not.toHaveBeenCalled()
    expect(editor.storage.blockId.version).toBe(1)

    editor.commands.insertContentAt(editor.state.doc.content.size - 1, '!')
    expect(last()).toMatchObject({ updated: ['b'], version: 2 })
  })

  it('includes the added and updated blocks themselves, in reading order, but not removed ones', async () => {
    const { editor, last } = await tracked('<p data-block-id="a">HelloWorld</p><p data-block-id="b">Two</p><p data-block-id="c">Three</p>')
    editor.commands.command(({ tr }) => {
      tr.delete(editor.state.doc.child(0).nodeSize, editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize)
      tr.split(6)
      return true
    })
    const change = last()!
    expect(change).toMatchObject({ updated: ['a'], added: ['id1'], removed: ['b'] })
    expect(change.blocks.map((b) => [b.id, b.text])).toEqual([['a', 'Hello'], ['id1', 'World']])
  })

  it('includes nested blocks with their ancestors', async () => {
    const { editor, last } = await tracked('<ul><li><p data-block-id="li">Item</p></li></ul><p data-block-id="end">End</p>')
    editor.commands.insertContentAt(3, 'My ')
    expect(last()!.blocks).toEqual([{ id: 'li', type: 'paragraph', text: 'My Item', attrs: {}, ancestors: ['bulletList', 'listItem'] }])
  })

  it('has no blocks when the change only removed blocks', async () => {
    const { editor, last } = await tracked(TWO_PARAGRAPHS)
    editor.commands.deleteRange({ from: 0, to: 5 })
    expect(last()).toMatchObject({ removed: ['a'], blocks: [] })
  })

  it('increments the version by one per change', async () => {
    const { editor, onBlocksChange } = await tracked(TWO_PARAGRAPHS)
    editor.commands.insertContentAt(4, '1')
    editor.commands.insertContentAt(4, '2')
    editor.commands.insertContentAt(4, '3')
    expect(onBlocksChange.mock.calls.map(([c]) => c.version)).toEqual([1, 2, 3])
  })

  it('after a silent setContent, the next change reports everything since the last notification', async () => {
    const { editor, onBlocksChange, last } = await tracked(TWO_PARAGRAPHS)
    editor.commands.setContent('<p data-block-id="c">New</p>', { emitUpdate: false })
    expect(onBlocksChange).not.toHaveBeenCalled()
    editor.commands.insertContentAt(4, '!')
    expect(last()).toMatchObject({ added: ['c'], removed: ['a', 'b'] })
  })
})

describe('getBlocks', () => {
  it('returns text, attrs (without the id) and enclosing node types, in reading order', async () => {
    const editor = await makeEditor('<h2>Title</h2><ul><li><p>Line<br>break</p></li></ul><p>End</p>')
    expect(blocks(editor)).toEqual([
      { id: 'id1', type: 'heading', text: 'Title', attrs: { level: 2 }, ancestors: [] },
      { id: 'id2', type: 'paragraph', text: 'Line\nbreak', attrs: {}, ancestors: ['bulletList', 'listItem'] },
      { id: 'id3', type: 'paragraph', text: 'End', attrs: {}, ancestors: [] },
    ])
  })

  it('handles code blocks, images, rules and table cells', async () => {
    const editor = await makeEditor(
      '<pre><code>a\nb</code></pre><hr><img src="pic.png" alt="Pic">'
      + '<table><tr><th><p>Head</p></th></tr><tr><td><p>Cell</p></td></tr></table><p>End</p>',
      { rich: true },
    )
    const [code, rule, image, head, cell] = blocks(editor)
    expect(code).toMatchObject({ type: 'codeBlock', text: 'a\nb' })
    expect(rule).toMatchObject({ type: 'horizontalRule', text: '' })
    expect(image).toMatchObject({ type: 'image', text: '', attrs: { src: 'pic.png', alt: 'Pic' } })
    expect(image.attrs).not.toHaveProperty('blockId')
    expect(head).toMatchObject({ text: 'Head', ancestors: ['table', 'tableRow', 'tableHeader'] })
    expect(cell).toMatchObject({ text: 'Cell', ancestors: ['table', 'tableRow', 'tableCell'] })
  })

  it('skips blocks that have no id yet', async () => {
    const editor = await makeEditor('')
    const { schema } = editor
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('No id'))])
    expect(getBlocks(doc)).toEqual([])
  })

  it('returns only the requested ids, in reading order whatever the order asked', async () => {
    const editor = await makeEditor('<p data-block-id="a">A</p><ul><li><p data-block-id="b">B</p></li></ul><p data-block-id="c">C</p>')
    expect(getBlocks(editor.state.doc, undefined, ['c', 'a']).map((b) => b.id)).toEqual(['a', 'c'])
    expect(getBlocks(editor.state.doc, undefined, ['b'])).toEqual([
      { id: 'b', type: 'paragraph', text: 'B', attrs: {}, ancestors: ['bulletList', 'listItem'] },
    ])
  })

  it('ignores unknown ids and returns nothing for an empty id list', async () => {
    const editor = await makeEditor(TWO_PARAGRAPHS)
    expect(getBlocks(editor.state.doc, undefined, ['ghost', 'b', 'b']).map((b) => b.id)).toEqual(['b'])
    expect(getBlocks(editor.state.doc, undefined, [])).toEqual([])
  })

  it('finds the last nested block when asked for it (the early stop does not skip it)', async () => {
    const editor = await makeEditor(
      '<p data-block-id="a">A</p><blockquote><ul><li><p data-block-id="deep">Deep</p></li></ul></blockquote><p data-block-id="z">Z</p>',
    )
    expect(getBlocks(editor.state.doc, undefined, ['a', 'deep']).map((b) => b.id)).toEqual(['a', 'deep'])
    expect(getBlocks(editor.state.doc, undefined, ['deep', 'z']).map((b) => b.id)).toEqual(['deep', 'z'])
  })

  it('only extracts the text of the requested blocks', async () => {
    const editor = await makeEditor(TWO_PARAGRAPHS)
    const spy = vi.spyOn(editor.state.doc.child(1), 'textBetween')
    getBlocks(editor.state.doc, undefined, ['a'])
    expect(spy).not.toHaveBeenCalled()
  })

  it('only lists the requested types', async () => {
    const editor = await makeEditor('<h2>Title</h2><p>Body</p>')
    expect(getBlocks(editor.state.doc, ['heading']).map((b) => b.text)).toEqual(['Title'])
  })
})

describe('diffBlocks', () => {
  // Both documents must share one schema (as they always do inside one
  // editor) — ProseMirror never considers nodes of two schemas equal.
  async function docs(before: string, after: string) {
    const editor = await makeEditor(before)
    const other = await makeEditor(after)
    return [editor.state.doc, editor.schema.nodeFromJSON(other.getJSON())] as const
  }

  it('reports nothing for identical documents', async () => {
    const editor = await makeEditor('<p>One</p>')
    expect(diffBlocks(editor.state.doc, editor.state.doc)).toEqual({ added: [], updated: [], removed: [] })
  })

  it('reports nothing for equal content built separately (no false positives from new node objects)', async () => {
    const [before, after] = await docs(TWO_PARAGRAPHS, TWO_PARAGRAPHS)
    expect(before.child(0)).not.toBe(after.child(0))
    expect(diffBlocks(before, after)).toEqual({ added: [], updated: [], removed: [] })
  })

  it('does not report reordered blocks', async () => {
    const [before, after] = await docs(TWO_PARAGRAPHS, '<p data-block-id="b">Two</p><p data-block-id="a">One</p>')
    expect(diffBlocks(before, after)).toEqual({ added: [], updated: [], removed: [] })
  })

  it('compares only the requested types', async () => {
    const [before, after] = await docs(
      '<h2 data-block-id="h">Title</h2><p data-block-id="p">Body</p>',
      '<h2 data-block-id="h">Title</h2><p data-block-id="p">Changed</p>',
    )
    expect(diffBlocks(before, after, ['heading'])).toEqual({ added: [], updated: [], removed: [] })
    expect(diffBlocks(before, after)).toEqual({ added: [], updated: ['p'], removed: [] })
  })
})
