import { Extension, combineTransactionSteps, getChangedRanges } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state'

export const insertionCursorPluginKey = new PluginKey('insertionCursor')

/**
 * After inserting a block node like an image or a horizontal rule — by
 * pasting, through the `/` menu, or by uploading a file — ProseMirror leaves
 * that node selected (a NodeSelection), so the next keystroke replaces it.
 * This moves the cursor to the first text position after the inserted node
 * instead — opening an empty paragraph there if there's none — so the user
 * simply keeps typing below it.
 *
 * Left alone on purpose: selecting a node by clicking it (no document
 * change), dropping a dragged node (it stays selected to show what moved),
 * and undo/redo (which restore their own selection). Hosts that want an
 * inserted node to stay selected can replace this with an extension of the
 * same name: `Extension.create({ name: 'insertionCursor' })`.
 */
export const InsertionCursor = Extension.create({
  name: 'insertionCursor',

  addProseMirrorPlugins() {
    return [new Plugin({
      key: insertionCursorPluginKey,
      appendTransaction: (transactions, oldState, newState) => {
        const { selection } = newState
        if (!(selection instanceof NodeSelection) || !selection.node.isBlock) return null
        if (!transactions.some((tr) => tr.docChanged)) return null
        if (transactions.some((tr) => tr.getMeta('uiEvent') === 'drop' || tr.getMeta('history$'))) return null

        // Only a node this change inserted — not one that was already selected.
        const inserted = getChangedRanges(combineTransactionSteps(oldState.doc, [...transactions]))
          .some(({ newRange }) => selection.from >= newRange.from && selection.to <= newRange.to)
        if (!inserted) return null

        const after = Selection.findFrom(newState.doc.resolve(selection.to), 1, true)
        if (after) return newState.tr.setSelection(after)

        // Nothing to type into after it (e.g. it's the last node): open an
        // empty paragraph below, where the user would expect to keep typing.
        const paragraph = newState.schema.nodes.paragraph
        const $end = newState.doc.resolve(selection.to)
        if (!paragraph || !$end.parent.canReplaceWith($end.index(), $end.index(), paragraph)) return null
        const tr = newState.tr.insert(selection.to, paragraph.create())
        return tr.setSelection(TextSelection.create(tr.doc, selection.to + 1))
      },
    })]
  },
})
