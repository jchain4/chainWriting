import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Editor as TiptapEditor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export interface HighlightRange {
  id: string
  from: number
  to: number
  className?: string
  title?: string
}

/**
 * A raw ProseMirror plugin (not a Tiptap Extension) for highlighting
 * arbitrary text ranges — e.g. AI style-check flags — as an overlay that
 * never touches the document itself: it never appears in getHTML()/getJSON()
 * output and never adds undo-history entries.
 *
 * Register it post-mount via `editor.registerPlugin(...)` (obtained from
 * EditorHandle.getEditor()) rather than through the `extensions` prop, since
 * that prop is construction-only. Each caller supplies its own PluginKey, so
 * independent highlight layers (spelling, style, etc.) can coexist.
 */
export function createHighlightPlugin(key: PluginKey, initialRanges: HighlightRange[] = []): Plugin {
  const buildDecorations = (doc: ProseMirrorNode, ranges: HighlightRange[]) =>
    DecorationSet.create(doc, ranges.map((r) =>
      Decoration.inline(r.from, r.to, {
        class: r.className ? `cw-highlight-range ${r.className}` : 'cw-highlight-range',
        'data-highlight-id': r.id,
        ...(r.title ? { title: r.title } : {}),
      }),
    ))

  return new Plugin({
    key,
    state: {
      init: (_, state) => buildDecorations(state.doc, initialRanges),
      apply: (tr, old) => {
        const ranges = tr.getMeta(key) as HighlightRange[] | undefined
        if (ranges) return buildDecorations(tr.doc, ranges)
        return old.map(tr.mapping, tr.doc)
      },
    },
    props: {
      decorations: (state) => key.getState(state),
    },
  })
}

/** Replaces the highlighted ranges for a plugin created by createHighlightPlugin. Pass [] to clear. */
export function setHighlightRanges(editor: TiptapEditor, key: PluginKey, ranges: HighlightRange[]): void {
  editor.view.dispatch(editor.state.tr.setMeta(key, ranges))
}
