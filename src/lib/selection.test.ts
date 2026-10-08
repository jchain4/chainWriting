import { afterEach, describe, expect, it } from 'vitest'
import { Editor as TiptapEditor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { NodeSelection } from '@tiptap/pm/state'
import { UploadableImage } from './imageExtension'
import { syncSelectionFromDOM } from './selection'

// See imageExtension.test.ts: every headless editor must be destroyed.
const liveEditors: TiptapEditor[] = []
afterEach(() => {
  while (liveEditors.length) liveEditors.pop()!.destroy()
  window.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
})

function makeEditor(content = '<p>Una palabra</p><p>Otra</p>') {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new TiptapEditor({ element, extensions: [StarterKit, UploadableImage.configure({ inline: false })], content })
  liveEditors.push(editor)
  return editor
}

/** Selects DOM text the way the browser does — without ProseMirror knowing yet. */
function selectInDOM(startNode: Node, startOffset: number, endNode: Node, endOffset: number) {
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

const firstText = (editor: TiptapEditor, i = 0) => editor.view.dom.querySelectorAll('p')[i].firstChild!

describe('syncSelectionFromDOM', () => {
  it("copies a text selection the browser has but the editor hasn't read yet", () => {
    const editor = makeEditor()
    expect(editor.state.selection.empty).toBe(true)
    selectInDOM(firstText(editor), 0, firstText(editor), 11)
    syncSelectionFromDOM(editor.view)
    const { from, to } = editor.state.selection
    expect(editor.state.doc.textBetween(from, to)).toBe('Una palabra')
  })

  it('keeps the direction of a backwards selection (Shift+Home)', () => {
    const editor = makeEditor()
    const range = document.createRange()
    range.setStart(firstText(editor), 11)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    selection.extend(firstText(editor), 0)
    syncSelectionFromDOM(editor.view)
    expect(editor.state.selection.anchor).toBe(12)
    expect(editor.state.selection.head).toBe(1)
  })

  it('handles selections across blocks', () => {
    const editor = makeEditor()
    selectInDOM(firstText(editor), 4, firstText(editor, 1), 4)
    syncSelectionFromDOM(editor.view)
    const { from, to } = editor.state.selection
    expect(editor.state.doc.textBetween(from, to, '\n')).toBe('palabra\nOtra')
  })

  it('does nothing when the editor is already in sync (no extra transaction)', () => {
    const editor = makeEditor()
    editor.commands.setTextSelection({ from: 1, to: 4 })
    selectInDOM(firstText(editor), 0, firstText(editor), 3)
    let transactions = 0
    editor.on('transaction', () => { transactions++ })
    syncSelectionFromDOM(editor.view)
    expect(transactions).toBe(0)
  })

  it('ignores a browser selection outside the editor', () => {
    const editor = makeEditor()
    const outside = document.createElement('p')
    outside.textContent = 'Fuera del editor'
    document.body.append(outside)
    selectInDOM(outside.firstChild!, 0, outside.firstChild!, 5)
    const before = editor.state.selection
    syncSelectionFromDOM(editor.view)
    expect(editor.state.selection.eq(before)).toBe(true)
  })

  it('leaves a selected node (e.g. an image) alone', () => {
    const editor = makeEditor('<p>Antes</p><img src="a.png"><p>Después</p>')
    const imagePos = editor.state.doc.child(0).nodeSize
    editor.commands.setNodeSelection(imagePos)
    selectInDOM(firstText(editor), 0, firstText(editor), 3)
    syncSelectionFromDOM(editor.view)
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)
  })

  it('does nothing without any browser selection', () => {
    const editor = makeEditor()
    window.getSelection()!.removeAllRanges()
    expect(() => syncSelectionFromDOM(editor.view)).not.toThrow()
    expect(editor.state.selection.empty).toBe(true)
  })
})
