import { Extension } from '@tiptap/core'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/**
 * A mark the host app (or an LLM it chose to wire in) puts on the text. It's
 * anchored by *content* — "the phrase X in block Y" — rather than by
 * document positions, so it can be produced without knowing anything about
 * the editor's internals, and re-found after edits.
 */
export interface Annotation {
  /** Unique within its layer. */
  id: string
  /** Id of the block (see getBlocks()) the annotation belongs to. */
  blockId: string
  /**
   * Exact text to mark inside the block. Omit (or pass "") to annotate the
   * whole block instead — e.g. a comment on a paragraph or an image.
   */
  quote?: string
  /**
   * Optional text right before/after the quote, to pick the right one when
   * the quote appears several times in the block. A partial match still
   * counts: the occurrence matching most of the given context wins, and with
   * no context the first occurrence wins.
   */
  prefix?: string
  suffix?: string
  /** Free category (e.g. "spelling", "style"), added as a `cw-annotation--{kind}` class. */
  kind?: string
  /** Extra class(es) on the marked element. */
  className?: string
  /** Native tooltip text. */
  title?: string
  /** Anything the host wants back in events (message, severity, suggestion…). Never read by the editor. */
  data?: unknown
}

/**
 * - `active`: the quote was found and is marked.
 * - `stale`: the quote (or block) no longer exists — e.g. the user rewrote
 *   the flagged phrase. Not shown, but kept: if the text comes back (undo),
 *   the annotation becomes active again.
 */
export type AnnotationStatus = 'active' | 'stale'

export interface ResolvedAnnotation extends Annotation {
  layer: string
  status: AnnotationStatus
  /** Current document range, or null while stale. */
  from: number | null
  to: number | null
}

export interface AnnotationsOptions {
  /** Click on marked text. Receives every active annotation under the click (they can overlap). */
  onClick?: (annotations: ResolvedAnnotation[], event: MouseEvent) => void
  /** Pointer entering/leaving marked text. Called with [] when it leaves all annotations. */
  onHover?: (annotations: ResolvedAnnotation[], event: MouseEvent) => void
  /** After an edit, the annotations that switched between active and stale. */
  onStatusChange?: (annotations: ResolvedAnnotation[]) => void
}

type Layers = Map<string, Map<string, ResolvedAnnotation>>

interface AnnotationsState {
  layers: Layers
  decorations: DecorationSet
}

type Action =
  | { type: 'set', layer: string, annotations: Annotation[] }
  | { type: 'clear', layer?: string }

export const annotationsPluginKey = new PluginKey<AnnotationsState>('cwAnnotations')

const isWholeBlock = (a: Annotation) => !a.quote

/** Index of block id → node, built at most once per transaction and only if needed. */
function lazyBlockIndex(doc: ProseMirrorNode) {
  let index: Map<string, { pos: number, node: ProseMirrorNode }> | undefined
  return (id: string) => {
    if (!index) {
      const built = new Map<string, { pos: number, node: ProseMirrorNode }>()
      doc.descendants((node, pos) => {
        const blockId = node.attrs.blockId as string | null | undefined
        if (blockId && !built.has(blockId)) built.set(blockId, { pos, node })
        return !node.isTextblock
      })
      index = built
    }
    return index.get(id)
  }
}

const blockText = (node: ProseMirrorNode) => node.textBetween(0, node.content.size, '\n', '\n')

/** Offset of the best occurrence of `quote` in `text`, or -1. */
export function findQuote(text: string, quote: string, prefix?: string, suffix?: string): number {
  let best = -1
  let bestScore = -1
  for (let i = text.indexOf(quote); i !== -1; i = text.indexOf(quote, i + 1)) {
    const score = (prefix && text.slice(0, i).endsWith(prefix) ? 1 : 0)
      + (suffix && text.slice(i + quote.length).startsWith(suffix) ? 1 : 0)
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  }
  return best
}

function resolve(
  a: Annotation,
  layer: string,
  findBlock: ReturnType<typeof lazyBlockIndex>,
): ResolvedAnnotation {
  const stale: ResolvedAnnotation = { ...a, layer, status: 'stale', from: null, to: null }
  const block = findBlock(a.blockId)
  if (!block) return stale
  const { pos, node } = block
  if (isWholeBlock(a)) return { ...a, layer, status: 'active', from: pos, to: pos + node.nodeSize }
  if (!node.isTextblock) return stale
  // Text offsets equal content offsets here: text is 1:1 and every inline
  // leaf (hard break) is both one position and one "\n" character.
  const offset = findQuote(blockText(node), a.quote!, a.prefix, a.suffix)
  if (offset < 0) return stale
  const from = pos + 1 + offset
  return { ...a, layer, status: 'active', from, to: from + a.quote!.length }
}

/**
 * Carries an annotation over an edit: first by mapping its range (cheap, and
 * lets it follow its text even into another block, e.g. after joining two
 * paragraphs); if the mapped range no longer holds the quote, by searching
 * for the quote again in its block.
 */
function carryOver(
  a: ResolvedAnnotation,
  doc: ProseMirrorNode,
  map: (pos: number, assoc: number) => number,
  findBlock: ReturnType<typeof lazyBlockIndex>,
): ResolvedAnnotation {
  if (a.status === 'active' && a.from !== null && a.to !== null) {
    if (isWholeBlock(a)) {
      const from = map(a.from, 1)
      const node = doc.nodeAt(from)
      if (node && node.attrs.blockId === a.blockId) return { ...a, from, to: from + node.nodeSize }
    } else {
      // Typing right at either edge of the quote shouldn't stretch it.
      const from = map(a.from, 1)
      const to = map(a.to, -1)
      if (from < to) {
        const $from = doc.resolve(from)
        const $to = doc.resolve(to)
        if ($from.sameParent($to) && $from.parent.isTextblock && doc.textBetween(from, to, '\n', '\n') === a.quote) {
          const blockId = ($from.parent.attrs.blockId as string | null) || a.blockId
          return { ...a, blockId, from, to }
        }
      }
    }
  }
  return resolve(a, a.layer, findBlock)
}

function buildDecorations(doc: ProseMirrorNode, layers: Layers): DecorationSet {
  const decorations: Decoration[] = []
  for (const annotations of layers.values()) {
    for (const a of annotations.values()) {
      if (a.status !== 'active' || a.from === null || a.to === null) continue
      const base = isWholeBlock(a) ? 'cw-annotation-block' : 'cw-annotation'
      const classes = [base, a.kind && `${base}--${a.kind}`, a.className].filter(Boolean).join(' ')
      const attrs = { class: classes, ...(a.title ? { title: a.title } : {}) }
      const spec = { layer: a.layer, id: a.id }
      decorations.push(isWholeBlock(a)
        ? Decoration.node(a.from, a.to, attrs, spec)
        : Decoration.inline(a.from, a.to, attrs, spec))
    }
  }
  return DecorationSet.create(doc, decorations)
}

const allAnnotations = (layers: Layers, layer?: string) =>
  [...layers.entries()]
    .filter(([name]) => layer === undefined || name === layer)
    .flatMap(([, annotations]) => [...annotations.values()])

/** Active annotations covering `pos`; `blockOnly` restricts to whole-block ones. */
function annotationsAt(state: EditorState, pos: number, blockOnly = false): ResolvedAnnotation[] {
  const pluginState = annotationsPluginKey.getState(state)
  if (!pluginState) return []
  return allAnnotations(pluginState.layers).filter((a) => {
    if (a.status !== 'active' || a.from === null || a.to === null) return false
    if (isWholeBlock(a)) return pos >= a.from && pos < a.to
    return !blockOnly && pos >= a.from && pos <= a.to
  })
}

const sameAnnotations = (x: ResolvedAnnotation[], y: ResolvedAnnotation[]) =>
  x.length === y.length && x.every((a, i) => a.layer === y[i].layer && a.id === y[i].id)

/**
 * Lets the host mark text by content ("the phrase X in block Y") in named
 * layers (e.g. "spelling", "style", "comments"), keeps the marks attached to
 * their text while the user edits, and reports clicks, hovers, and marks
 * whose text disappeared. A pure overlay: never part of getHTML()/getJSON(),
 * never an undo step.
 */
export const Annotations = Extension.create<AnnotationsOptions>({
  name: 'annotations',

  addOptions() {
    return { onClick: undefined, onHover: undefined, onStatusChange: undefined }
  },

  addProseMirrorPlugins() {
    const options = this.options
    let hovered: ResolvedAnnotation[] = []
    const setHovered = (next: ResolvedAnnotation[], event: MouseEvent) => {
      if (sameAnnotations(hovered, next)) return
      hovered = next
      options.onHover?.(next, event)
    }

    return [new Plugin<AnnotationsState>({
      key: annotationsPluginKey,

      state: {
        init: () => ({ layers: new Map(), decorations: DecorationSet.empty }),
        apply: (tr, value, _oldState, newState) => {
          const action = tr.getMeta(annotationsPluginKey) as Action | undefined
          if (!tr.docChanged && !action) return value

          let { layers } = value
          const findBlock = lazyBlockIndex(newState.doc)

          if (tr.docChanged) {
            const map = (pos: number, assoc: number) => tr.mapping.map(pos, assoc)
            layers = new Map([...layers].map(([name, annotations]) => [
              name,
              new Map([...annotations].map(([id, a]) => [id, carryOver(a, newState.doc, map, findBlock)])),
            ]))
          }

          if (action) {
            layers = new Map(layers)
            if (action.type === 'set') {
              layers.set(action.layer, new Map(action.annotations.map((a) => [a.id, resolve(a, action.layer, findBlock)])))
            } else if (action.layer === undefined) {
              layers.clear()
            } else {
              layers.delete(action.layer)
            }
          }

          return { layers, decorations: buildDecorations(newState.doc, layers) }
        },
      },

      view: () => ({
        update: (view, prevState) => {
          const prev = annotationsPluginKey.getState(prevState)
          const next = annotationsPluginKey.getState(view.state)
          // Host actions (set/clear) never change the document, so this
          // only reports status changes caused by edits.
          if (!prev || !next || prev === next || prevState.doc === view.state.doc) return
          const changed = allAnnotations(next.layers).filter((a) => {
            const before = prev.layers.get(a.layer)?.get(a.id)
            return before && before.status !== a.status
          })
          if (changed.length) options.onStatusChange?.(changed)
        },
      }),

      props: {
        decorations: (state) => annotationsPluginKey.getState(state)?.decorations,

        handleClick: (view, pos, event) => {
          const hits = annotationsAt(view.state, pos)
          if (hits.length) options.onClick?.(hits, event)
          return false
        },

        handleDOMEvents: {
          mouseover: (view, event) => {
            const target = event.target as Element | null
            const element = target?.closest?.('.cw-annotation, .cw-annotation-block')
            if (!element || !view.dom.contains(element)) {
              setHovered([], event)
              return false
            }
            try {
              const pos = view.posAtDOM(element, 0)
              setHovered(annotationsAt(view.state, pos, element.classList.contains('cw-annotation-block')), event)
            } catch {
              setHovered([], event)
            }
            return false
          },
          mouseleave: (_view, event) => {
            setHovered([], event)
            return false
          },
        },
      },
    })]
  },
})

/**
 * Replaces every annotation in `layer` with `annotations` and returns how
 * each one resolved (`stale` = its quote/block wasn't found). Other layers
 * are left untouched.
 */
export function setAnnotations(editor: TiptapEditor, layer: string, annotations: Annotation[]): ResolvedAnnotation[] {
  if (!annotationsPluginKey.getState(editor.state)) return []
  editor.view.dispatch(editor.state.tr
    .setMeta(annotationsPluginKey, { type: 'set', layer, annotations } satisfies Action)
    .setMeta('addToHistory', false))
  return getAnnotations(editor, layer)
}

/** Removes the annotations of `layer`, or of every layer when omitted. */
export function clearAnnotations(editor: TiptapEditor, layer?: string): void {
  if (!annotationsPluginKey.getState(editor.state)) return
  editor.view.dispatch(editor.state.tr
    .setMeta(annotationsPluginKey, { type: 'clear', layer } satisfies Action)
    .setMeta('addToHistory', false))
}

/** Current annotations (active and stale) of `layer`, or of every layer when omitted. */
export function getAnnotations(editor: TiptapEditor, layer?: string): ResolvedAnnotation[] {
  const state = annotationsPluginKey.getState(editor.state)
  return state ? allAnnotations(state.layers, layer).map((a) => ({ ...a })) : []
}
