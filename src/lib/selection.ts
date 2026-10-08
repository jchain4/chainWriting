import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/**
 * Brings the editor's selection up to date with the browser's, if the
 * browser has moved on. A selection the user has just made with the keyboard
 * (Shift+Home) or the mouse (a double click) exists in the DOM at once, but
 * ProseMirror only reads it when the browser's `selectionchange` event
 * arrives — which can come *after* the very next keydown. A shortcut that
 * acts on the selection (e.g. Ctrl+K) would otherwise see the old one.
 *
 * Only plain text selections are synced; node selections (an image), and
 * anything that doesn't resolve into text, are left as they are.
 */
export function syncSelectionFromDOM(view: EditorView): void {
  if (view.state.selection instanceof NodeSelection) return
  const dom = (view.root as Document).getSelection?.() ?? window.getSelection()
  if (!dom || !dom.anchorNode || !dom.focusNode) return
  if (!view.dom.contains(dom.anchorNode) || !view.dom.contains(dom.focusNode)) return

  let anchor: number
  let head: number
  try {
    anchor = view.posAtDOM(dom.anchorNode, dom.anchorOffset)
    head = view.posAtDOM(dom.focusNode, dom.focusOffset)
  } catch {
    return // a DOM point ProseMirror can't map (e.g. inside a widget)
  }

  const { doc, selection } = view.state
  if (selection.anchor === anchor && selection.head === head) return
  const $anchor = doc.resolve(anchor)
  const $head = doc.resolve(head)
  if (!$anchor.parent.inlineContent || !$head.parent.inlineContent) return
  view.dispatch(view.state.tr.setSelection(TextSelection.between($anchor, $head)))
}
