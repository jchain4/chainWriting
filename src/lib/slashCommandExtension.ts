import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import type { Editor as TiptapEditor, Range } from '@tiptap/core'
import type { ReactNode } from 'react'

export interface SlashCommandItem {
  id: string
  label: string
  icon: ReactNode
  /** Leaf items run this when selected. Mutually exclusive with `children`. */
  execute?: (ctx: { editor: TiptapEditor; range: Range }) => void
  /** Group items open a submenu showing these instead of running anything. */
  children?: SlashCommandItem[]
}

export interface SlashCommandState {
  items: SlashCommandItem[]
  coords: { top: number; left: number } | null
  select: (item: SlashCommandItem) => void
}

export interface SlashKeyHandler {
  onKeyDown: (event: KeyboardEvent) => boolean
}

export interface SlashCommandOptions {
  items: SlashCommandItem[]
  onStateChange: (state: SlashCommandState | null) => void
  getKeyHandler: () => SlashKeyHandler | null
}

/**
 * Wraps @tiptap/suggestion to power a Notion-style "/" command menu.
 * Positioning/rendering is handled entirely in React (Editor.tsx), matching
 * this codebase's existing LinkPopover pattern — no tippy.js/ReactRenderer.
 */
export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',

  addOptions() {
    return {
      items: [],
      onStateChange: () => {},
      getKeyHandler: () => null,
    }
  },

  addProseMirrorPlugins() {
    const { items, onStateChange, getKeyHandler } = this.options

    const emit = (props: { items: SlashCommandItem[]; clientRect?: (() => DOMRect | null) | null; command: (item: SlashCommandItem) => void }) => {
      const rect = props.clientRect?.()
      onStateChange({
        items: props.items,
        coords: rect ? { top: rect.bottom + 8, left: rect.left } : null,
        select: props.command,
      })
    }

    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        pluginKey: new PluginKey('slashCommand'),
        // Only trigger at the start of an empty paragraph — not inside
        // headings, lists, or table cells.
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from)
          if ($from.parent.type.name !== 'paragraph') return false
          const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
          return textBefore.trim() === ''
        },
        items: ({ query }) =>
          items.filter((item) => item.label.toLowerCase().startsWith(query.toLowerCase())),
        command: ({ range, props: item }) => {
          item.execute?.({ editor: this.editor, range })
        },
        render: () => {
          // The menu is fixed-position: while it's open, re-place it when
          // the page or any scroll container scrolls, or the window resizes.
          let last: Parameters<typeof emit>[0] | null = null
          let frame: number | null = null
          const onViewportChange = () => {
            if (frame !== null || !last) return
            frame = requestAnimationFrame(() => { frame = null; if (last) emit(last) })
          }
          const stopFollowing = () => {
            if (frame !== null) cancelAnimationFrame(frame)
            frame = null
            last = null
            window.removeEventListener('scroll', onViewportChange, { capture: true })
            window.removeEventListener('resize', onViewportChange)
          }
          return {
          onStart: (props) => {
            last = props
            window.addEventListener('scroll', onViewportChange, { capture: true, passive: true })
            window.addEventListener('resize', onViewportChange)
            emit(props)
          },
          onUpdate: (props) => { last = props; emit(props) },
          // The key handler (SlashMenu) gets first refusal on every key,
          // including Escape — it needs to decide between "go back one
          // level" (inside a submenu) and "close entirely". Only falls back
          // to closing here if there's no handler mounted yet.
          onKeyDown: (props) => {
            if (getKeyHandler()?.onKeyDown(props.event)) return true
            if (props.event.key === 'Escape') { onStateChange(null); return true }
            return false
          },
          onExit: () => { stopFollowing(); onStateChange(null) },
          }
        },
      }),
    ]
  },
})
