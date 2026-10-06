import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Editor as TiptapEditor, type AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { UploadableImage } from './imageExtension'
import { insertImageWithUpload } from './imageUpload'
import { BlockId, getBlocks } from './blockId'
import { InsertionCursor } from './insertionCursor'

// See imageExtension.test.ts: every headless editor must be destroyed.
const liveEditors: TiptapEditor[] = []

beforeAll(() => {
  // jsdom has no ClipboardEvent, which EditorView.pasteHTML constructs.
  ;(globalThis as { ClipboardEvent?: unknown }).ClipboardEvent ??= class extends Event {
    clipboardData = null
  }
})

async function makeEditor(content = '<p>Hola</p>', { withCursor = true, extensions = [] as AnyExtension[] } = {}) {
  const editor = new TiptapEditor({
    extensions: [
      StarterKit,
      UploadableImage.configure({ inline: false, allowBase64: true }),
      BlockId,
      ...(withCursor ? [InsertionCursor] : []),
      ...extensions,
    ],
    content,
  })
  liveEditors.push(editor)
  await new Promise<void>((resolve) => editor.on('create', () => resolve()))
  editor.commands.setTextSelection(5) // end of "Hola"
  return editor
}

afterEach(() => {
  while (liveEditors.length) liveEditors.pop()!.destroy()
})

const types = (editor: TiptapEditor) => editor.getJSON().content!.map((n) => n.type)
const selected = (editor: TiptapEditor) => editor.state.selection

/** The cursor is a caret in the text block right after the node at `nodePos`. */
function expectCaretAfter(editor: TiptapEditor, nodePos: number) {
  const sel = selected(editor)
  expect(sel).toBeInstanceOf(TextSelection)
  expect(sel.empty).toBe(true)
  const node = editor.state.doc.nodeAt(nodePos)!
  expect(sel.from).toBe(nodePos + node.nodeSize + 1)
}

describe('InsertionCursor', () => {
  it('puts the cursor after an image at the end of pasted HTML, so typing does not replace it', async () => {
    const editor = await makeEditor()
    editor.view.pasteHTML('<p>pegado</p><img src="https://x/a.png">')
    expect(types(editor)).toEqual(['paragraph', 'image', 'paragraph'])
    const imagePos = editor.state.doc.child(0).nodeSize
    expectCaretAfter(editor, imagePos)

    editor.commands.insertContent('sigo')
    expect(types(editor)).toEqual(['paragraph', 'image', 'paragraph'])
    expect(getBlocks(editor.state.doc).map((b) => b.text)).toEqual(['Holapegado', '', 'sigo'])
  })

  it('does the same for a pasted image alone and a pasted horizontal rule', async () => {
    const image = await makeEditor()
    image.view.pasteHTML('<img src="https://x/a.png">')
    expectCaretAfter(image, image.state.doc.child(0).nodeSize)

    const rule = await makeEditor()
    rule.view.pasteHTML('<p>a</p><hr>')
    expect(types(rule)).toEqual(['paragraph', 'horizontalRule', 'paragraph'])
    expectCaretAfter(rule, rule.state.doc.child(0).nodeSize)
  })

  it('puts the cursor after an image inserted by URL (the "/" menu) or by file upload', async () => {
    const byUrl = await makeEditor()
    byUrl.chain().focus().setImage({ src: 'https://x/a.png' }).run()
    expectCaretAfter(byUrl, byUrl.state.doc.child(0).nodeSize)

    const byUpload = await makeEditor()
    insertImageWithUpload(byUpload, new File(['x'], 'a.png', { type: 'image/png' }), () => new Promise(() => {}))
    expectCaretAfter(byUpload, byUpload.state.doc.child(0).nodeSize)
  })

  it('puts the cursor at the start of the following text when the node lands between paragraphs', async () => {
    const editor = await makeEditor('<p>Hola</p><p>Adiós</p>')
    editor.chain().setImage({ src: 'https://x/a.png' }).run()
    expect(types(editor)).toEqual(['paragraph', 'image', 'paragraph'])
    expectCaretAfter(editor, editor.state.doc.child(0).nodeSize)
    expect(getBlocks(editor.state.doc).map((b) => b.text)).toEqual(['Hola', '', 'Adiós'])
  })

  it('leaves the cursor alone when the paste already ends in text', async () => {
    const editor = await makeEditor()
    editor.view.pasteHTML('<p>Ho</p><img src="https://x/a.png"><p>la</p>')
    const sel = selected(editor)
    expect(sel).toBeInstanceOf(TextSelection)
    expect(editor.state.doc.textBetween(sel.from - 2, sel.from)).toBe('la')
  })

  it('keeps a node selected by clicking it (no document change)', async () => {
    const editor = await makeEditor('<p>A</p><img src="https://x/a.png"><p>B</p>')
    const imagePos = editor.state.doc.child(0).nodeSize
    editor.commands.setNodeSelection(imagePos)
    expect(selected(editor)).toBeInstanceOf(NodeSelection)
  })

  it('keeps an already-selected node selected through unrelated edits elsewhere', async () => {
    const editor = await makeEditor('<p>A</p><img src="https://x/a.png"><p>B</p>')
    const imagePos = editor.state.doc.child(0).nodeSize
    editor.commands.setNodeSelection(imagePos)
    editor.view.dispatch(editor.state.tr.insertText('zz', 1))
    expect(selected(editor)).toBeInstanceOf(NodeSelection)
    expect((selected(editor) as NodeSelection).node.type.name).toBe('image')
  })

  it('keeps a dropped node selected, to show what moved', async () => {
    const editor = await makeEditor()
    const image = editor.schema.nodes.image.create({ src: 'https://x/a.png' })
    const tr = editor.state.tr.insert(editor.state.doc.content.size, image)
    const pos = tr.doc.content.size - image.nodeSize
    tr.setSelection(NodeSelection.create(tr.doc, pos)).setMeta('uiEvent', 'drop')
    editor.view.dispatch(tr)
    expect(selected(editor)).toBeInstanceOf(NodeSelection)
  })

  it('does not change what undo restores', async () => {
    const restoredSelection = async (withCursor: boolean) => {
      const editor = await makeEditor('<p>A</p><img src="https://x/a.png"><p>B</p>', { withCursor })
      editor.commands.setNodeSelection(editor.state.doc.child(0).nodeSize)
      editor.commands.deleteSelection()
      editor.commands.undo()
      return [selected(editor).constructor.name, selected(editor).from, selected(editor).to]
    }
    expect(await restoredSelection(true)).toEqual(await restoredSelection(false))
  })

  it('opens an empty paragraph after the node when there is nothing to type into below it', async () => {
    // Without StarterKit's trailing paragraph, the image ends the document.
    const bare = new TiptapEditor({
      extensions: [StarterKit.configure({ trailingNode: false }), UploadableImage.configure({ inline: false }), InsertionCursor],
      content: '<p>Hola</p>',
    })
    liveEditors.push(bare)
    bare.commands.setTextSelection(5)
    bare.chain().setImage({ src: 'https://x/a.png' }).run()
    expect(types(bare)).toEqual(['paragraph', 'image', 'paragraph'])
    expectCaretAfter(bare, bare.state.doc.child(0).nodeSize)
  })

  it('makes the paste and the cursor move a single undo step', async () => {
    const editor = await makeEditor()
    editor.view.pasteHTML('<img src="https://x/a.png">')
    editor.commands.undo()
    expect(types(editor)).toEqual(['paragraph'])
    expect(getBlocks(editor.state.doc).map((b) => b.text)).toEqual(['Hola'])
  })

  it('is what makes the difference (without it, the inserted image stays selected)', async () => {
    const editor = await makeEditor('<p>Hola</p>', { withCursor: false })
    editor.view.pasteHTML('<img src="https://x/a.png">')
    expect(selected(editor)).toBeInstanceOf(NodeSelection)
  })
})
