import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import type { Editor as TiptapEditor, Range } from '@tiptap/core'

export interface SlashCommandItem {
  id: string
  label: string
  execute: (ctx: { editor: TiptapEditor; range: Range }) => void
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
          item.execute({ editor: this.editor, range })
        },
        render: () => ({
          onStart: emit,
          onUpdate: emit,
          onKeyDown: (props) => {
            if (props.event.key === 'Escape') { onStateChange(null); return true }
            return getKeyHandler()?.onKeyDown(props.event) ?? false
          },
          onExit: () => onStateChange(null),
        }),
      }),
    ]
  },
})
