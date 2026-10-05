import { Extension } from '@tiptap/core'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'
import { lazyBlockIndex, mapAnchor, resolveAnchor, type Anchor, type AnchorRange } from './anchoring'

interface SuggestionBase {
  /** Unique among all suggestions. */
  id: string
  /** Native tooltip text, e.g. the reason for the change. */
  title?: string
  /** Anything the host wants back in events. Never read by the editor. */
  data?: unknown
}

/** "In block `blockId`, change `quote` to `replacement`" (an empty replacement deletes the quote). */
export interface ReplaceSuggestion extends SuggestionBase {
  type: 'replace'
  blockId: string
  quote: string
  /** Text right before/after the quote, to pick the right one when it repeats in the block. */
  prefix?: string
  suffix?: string
  replacement: string
}

/** "After block `blockId`, add these paragraphs" — one paragraph per non-empty line of `text`. */
export interface InsertAfterSuggestion extends SuggestionBase {
  type: 'insertAfter'
  blockId: string
  text: string
}

export type Suggestion = ReplaceSuggestion | InsertAfterSuggestion

/**
 * - `active`: shown, can be accepted.
 * - `stale`: its text or block is gone (the user changed it meanwhile), so it
 *   can't be applied safely. Not shown; becomes active again if the text
 *   comes back (e.g. undo).
 */
export type SuggestionStatus = 'active' | 'stale'

export type ResolvedSuggestion = Suggestion & {
  status: SuggestionStatus
  /** Replace: the range of the quote. InsertAfter: the range of the block. Null while stale. */
  from: number | null
  to: number | null
}

export interface SuggestionsOptions {
  /** Show ✓/✕ buttons next to each suggestion. Default true; turn off to drive accept/reject from your own UI. */
  showControls: boolean
  /** A suggestion was accepted (from its button, Alt-Enter, or acceptSuggestion()). */
  onAccept?: (suggestion: ResolvedSuggestion) => void
  /** A suggestion was rejected (from its button, Alt-Shift-Enter, or rejectSuggestion()). */
  onReject?: (suggestion: ResolvedSuggestion) => void
  /** After an edit, the suggestions that switched between active and stale. */
  onStatusChange?: (suggestions: ResolvedSuggestion[]) => void
}

type Outcome = 'accepted' | 'rejected'

interface SuggestionsState {
  suggestions: Map<string, ResolvedSuggestion>
  decorations: DecorationSet
  /** Suggestions settled by the last transaction, for the view to report. */
  settled: { suggestion: ResolvedSuggestion, outcome: Outcome }[]
}

type Action =
  | { type: 'add', suggestions: Suggestion[] }
  | { type: 'remove', ids?: string[] }
  | { type: 'settle', id: string, outcome: Outcome }

export const suggestionsPluginKey = new PluginKey<SuggestionsState>('cwSuggestions')

/** Replace suggestions anchor on their quote; insertAfter ones on their whole block. */
function anchorOf(s: Suggestion): Anchor | null {
  if (s.type === 'replace') return s.quote ? s : null
  return { blockId: s.blockId }
}

const withRange = (s: Suggestion, range: AnchorRange | null): ResolvedSuggestion => range
  ? { ...s, blockId: range.blockId, status: 'active', from: range.from, to: range.to }
  : { ...s, status: 'stale', from: null, to: null }

const rangeOf = (s: ResolvedSuggestion): AnchorRange | null =>
  s.status === 'active' && s.from !== null && s.to !== null ? { blockId: s.blockId, from: s.from, to: s.to } : null

const paragraphLines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean)

function paragraphsFor(schema: Schema, text: string): ProseMirrorNode[] {
  return paragraphLines(text).map((line) => schema.nodes.paragraph.create(null, schema.text(line)))
}

function button(label: string, symbol: string, className: string, onPress: () => void): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = className
  el.textContent = symbol
  el.setAttribute('aria-label', label)
  el.title = label
  // Keep the editor's selection and focus where they were.
  el.addEventListener('mousedown', (event) => event.preventDefault())
  el.addEventListener('click', (event) => {
    event.preventDefault()
    onPress()
  })
  return el
}

function controls(view: EditorView, id: string): HTMLElement {
  const el = document.createElement('span')
  el.className = 'cw-suggestion-controls'
  el.append(
    button('Aceptar sugerencia (Alt+Enter)', '✓', 'cw-suggestion-accept', () => settleInView(view, id, 'accepted')),
    button('Rechazar sugerencia (Alt+Mayús+Enter)', '✕', 'cw-suggestion-reject', () => settleInView(view, id, 'rejected')),
  )
  return el
}

function buildDecorations(doc: ProseMirrorNode, suggestions: Map<string, ResolvedSuggestion>, showControls: boolean): DecorationSet {
  const decorations: Decoration[] = []
  for (const s of suggestions.values()) {
    if (s.status !== 'active' || s.from === null || s.to === null) continue
    const titleAttrs = s.title ? { title: s.title } : {}

    if (s.type === 'replace') {
      decorations.push(Decoration.inline(s.from, s.to, {
        nodeName: 'del', class: 'cw-suggestion-delete', 'data-suggestion-id': s.id, ...titleAttrs,
      }))
      decorations.push(Decoration.widget(s.to, (view) => {
        const el = document.createElement('span')
        el.className = 'cw-suggestion'
        el.dataset.suggestionId = s.id
        el.contentEditable = 'false'
        if (s.title) el.title = s.title
        if (s.replacement) {
          const ins = document.createElement('ins')
          ins.className = 'cw-suggestion-insert'
          ins.textContent = s.replacement
          el.append(ins)
        }
        if (showControls) el.append(controls(view, s.id))
        return el
      }, { side: 1, key: `replace:${s.id}:${s.replacement}:${showControls}`, ignoreSelection: true, stopEvent: () => true }))
    } else {
      decorations.push(Decoration.widget(s.to, (view) => {
        const el = document.createElement('div')
        el.className = 'cw-suggestion-block'
        el.dataset.suggestionId = s.id
        el.contentEditable = 'false'
        if (s.title) el.title = s.title
        for (const line of paragraphLines(s.text)) {
          const p = document.createElement('p')
          const ins = document.createElement('ins')
          ins.className = 'cw-suggestion-insert'
          ins.textContent = line
          p.append(ins)
          el.append(p)
        }
        if (showControls) el.append(controls(view, s.id))
        return el
      }, { side: -1, key: `insertAfter:${s.id}:${s.text}:${showControls}`, ignoreSelection: true, stopEvent: () => true }))
    }
  }
  return DecorationSet.create(doc, decorations)
}

/** Applies (accepted) or drops (rejected) a suggestion. Accepting a stale or unknown one does nothing. */
function settleInView(view: EditorView, id: string, outcome: Outcome): boolean {
  const s = suggestionsPluginKey.getState(view.state)?.suggestions.get(id)
  if (!s) return false
  const tr = view.state.tr
  if (outcome === 'accepted') {
    if (s.status !== 'active' || s.from === null || s.to === null) return false
    if (s.type === 'replace') {
      if (s.replacement) tr.insertText(s.replacement, s.from, s.to)
      else tr.delete(s.from, s.to)
    } else {
      const paragraphs = paragraphsFor(view.state.schema, s.text)
      if (!paragraphs.length) return false
      tr.insert(s.to, paragraphs)
    }
  } else {
    tr.setMeta('addToHistory', false)
  }
  view.dispatch(tr.setMeta(suggestionsPluginKey, { type: 'settle', id, outcome } satisfies Action))
  return true
}

/** The active suggestion the cursor is in: inside a replace's quote, or inside an insertAfter's block. */
function suggestionAt(state: EditorState, pos: number): ResolvedSuggestion | undefined {
  const all = [...(suggestionsPluginKey.getState(state)?.suggestions.values() ?? [])]
    .filter((s) => s.status === 'active' && s.from !== null && s.to !== null)
  return all.find((s) => s.type === 'replace' && pos >= s.from! && pos <= s.to!)
    ?? all.find((s) => s.type === 'insertAfter' && pos > s.from! && pos < s.to!)
}

/**
 * Lets the host propose changes — replacing a phrase, or adding paragraphs
 * after a block — shown track-changes style for the user to accept (✓,
 * Alt-Enter) or reject (✕, Alt-Shift-Enter). Nothing changes in the
 * document until a suggestion is accepted; accepting is one undo step.
 */
export const Suggestions = Extension.create<SuggestionsOptions>({
  name: 'suggestions',

  addOptions() {
    return { showControls: true, onAccept: undefined, onReject: undefined, onStatusChange: undefined }
  },

  addKeyboardShortcuts() {
    const settleAtCursor = (outcome: Outcome) => {
      if (!this.editor.isEditable) return false
      const s = suggestionAt(this.editor.state, this.editor.state.selection.head)
      return s ? settleInView(this.editor.view, s.id, outcome) : false
    }
    return {
      'Alt-Enter': () => settleAtCursor('accepted'),
      'Alt-Shift-Enter': () => settleAtCursor('rejected'),
    }
  },

  addProseMirrorPlugins() {
    const options = this.options

    return [new Plugin<SuggestionsState>({
      key: suggestionsPluginKey,

      state: {
        init: () => ({ suggestions: new Map(), decorations: DecorationSet.empty, settled: [] }),
        apply: (tr, value, _oldState, newState) => {
          const action = tr.getMeta(suggestionsPluginKey) as Action | undefined
          // Transactions appended by other plugins (e.g. BlockId giving ids to
          // accepted paragraphs) belong to the same dispatch: keep what the
          // root transaction settled so the view still reports it.
          if (!tr.docChanged && !action) return value
          const appended = !!tr.getMeta('appendedTransaction')

          let suggestions = value.suggestions
          let settled: SuggestionsState['settled'] = appended ? value.settled : []
          const findBlock = lazyBlockIndex(newState.doc)

          // Settled suggestions leave before the document change is mapped,
          // so an accepted one isn't first reported as stale by its own edit.
          if (action?.type === 'settle') {
            const s = suggestions.get(action.id)
            if (s) {
              suggestions = new Map(suggestions)
              suggestions.delete(action.id)
              settled = [...settled, { suggestion: s, outcome: action.outcome }]
            }
          }

          if (tr.docChanged) {
            const map = (pos: number, assoc: number) => tr.mapping.map(pos, assoc)
            suggestions = new Map([...suggestions].map(([id, s]) => {
              const anchor = anchorOf(s)
              return [id, withRange(s, anchor && mapAnchor(anchor, rangeOf(s), newState.doc, map, findBlock))]
            }))
          }

          if (action?.type === 'add') {
            suggestions = new Map(suggestions)
            for (const s of action.suggestions) {
              const anchor = anchorOf(s)
              const valid = s.type === 'replace' || paragraphLines(s.text).length > 0
              suggestions.set(s.id, withRange(s, anchor && valid ? resolveAnchor(anchor, findBlock) : null))
            }
          } else if (action?.type === 'remove') {
            suggestions = new Map(suggestions)
            if (action.ids === undefined) suggestions.clear()
            else for (const id of action.ids) suggestions.delete(id)
          }

          return { suggestions, decorations: buildDecorations(newState.doc, suggestions, options.showControls), settled }
        },
      },

      view: () => ({
        update: (view, prevState) => {
          const prev = suggestionsPluginKey.getState(prevState)
          const next = suggestionsPluginKey.getState(view.state)
          if (!prev || !next || prev === next) return

          for (const { suggestion, outcome } of next.settled) {
            if (outcome === 'accepted') options.onAccept?.(suggestion)
            else options.onReject?.(suggestion)
          }
          // Host actions never change the document, so this only reports
          // status changes caused by edits.
          if (prevState.doc === view.state.doc) return
          const changed = [...next.suggestions.values()].filter((s) => {
            const before = prev.suggestions.get(s.id)
            return before && before.status !== s.status
          })
          if (changed.length) options.onStatusChange?.(changed)
        },
      }),

      props: {
        decorations: (state) => suggestionsPluginKey.getState(state)?.decorations,
      },
    })]
  },
})

const hasPlugin = (editor: TiptapEditor) => !!suggestionsPluginKey.getState(editor.state)

/**
 * Adds suggestions (one with an existing id replaces it) and returns how each
 * one resolved: `stale` means its block or quote wasn't found.
 */
export function addSuggestions(editor: TiptapEditor, suggestions: Suggestion[]): ResolvedSuggestion[] {
  if (!hasPlugin(editor)) return []
  editor.view.dispatch(editor.state.tr
    .setMeta(suggestionsPluginKey, { type: 'add', suggestions } satisfies Action)
    .setMeta('addToHistory', false))
  const ids = new Set(suggestions.map((s) => s.id))
  return getSuggestions(editor).filter((s) => ids.has(s.id))
}

/** Withdraws suggestions without accepting or rejecting them (no events). All of them when `ids` is omitted. */
export function removeSuggestions(editor: TiptapEditor, ids?: string[]): void {
  if (!hasPlugin(editor)) return
  editor.view.dispatch(editor.state.tr
    .setMeta(suggestionsPluginKey, { type: 'remove', ids } satisfies Action)
    .setMeta('addToHistory', false))
}

/** Current suggestions, active and stale, in the order they were added. */
export function getSuggestions(editor: TiptapEditor): ResolvedSuggestion[] {
  const state = suggestionsPluginKey.getState(editor.state)
  return state ? [...state.suggestions.values()].map((s) => ({ ...s })) : []
}

/** Applies a suggestion to the document (one undo step). False if it's unknown or stale. */
export function acceptSuggestion(editor: TiptapEditor, id: string): boolean {
  return hasPlugin(editor) && settleInView(editor.view, id, 'accepted')
}

/** Discards a suggestion, leaving the document as it is. False if it's unknown. */
export function rejectSuggestion(editor: TiptapEditor, id: string): boolean {
  return hasPlugin(editor) && settleInView(editor.view, id, 'rejected')
}
