'use client'

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { TextSelection } from '@tiptap/pm/state'
import type { AnyExtension, Content, Editor as TiptapEditor, JSONContent } from '@tiptap/react'
import { mergeExtensions } from '../lib/extensions'
import { UploadableImage } from '../lib/imageExtension'
import { insertImageWithUpload } from '../lib/imageUpload'
import { SlashCommand, type SlashCommandItem, type SlashCommandState, type SlashKeyHandler } from '../lib/slashCommandExtension'
import { useRovingToolbar, type RovingToolbarHandle } from '../hooks/useRovingToolbar'
import '../editor.css'

export interface EditorProps {
  initialContent?: string
  placeholder?: string
  typewriterMode?: boolean
  /** Extra class added to the root .cw-editor wrapper — use for scoped CSS variable overrides */
  className?: string
  /**
   * Extra Tiptap extensions merged into the built-in set (StarterKit + link/
   * underline config, Placeholder, Typography). To reconfigure or disable
   * parts of StarterKit (e.g. remove headings or code blocks), pass your own
   * `StarterKit.configure({...})` here — it will replace the built-in one.
   * Set once at construction time; changing this prop after mount has no
   * effect on the live editor.
   */
  extensions?: AnyExtension[]
  onChange?: (html: string) => void
  /**
   * Enables file-based image insertion (the upload button in the image
   * popover, plus dropping/pasting raw image files). Receives the file and
   * must resolve to the URL to embed. Without this prop, only URL-based
   * image insertion is available — dropped/pasted image files are ignored
   * rather than silently embedded as base64.
   */
  onImageUpload?: (file: File) => Promise<string>
  /**
   * Accessible name for the editing surface, exposed via aria-label on the
   * contenteditable element (role="textbox"). Falls back to `placeholder`
   * when omitted, so there is always a non-empty accessible name. Like
   * `placeholder`, read once at construction — changing it after mount has
   * no effect on the live editor.
   */
  ariaLabel?: string
}

export interface EditorHandle {
  /** Focus the editor. No-op if not yet mounted. */
  focus: () => void
  /** Current content as HTML. */
  getHTML: () => string
  /** Current content as Tiptap JSON — for round-tripping without going through HTML. */
  getJSON: () => JSONContent
  /**
   * Replace the whole document with new content. This is the correct way to
   * load new content into a live editor — there is no reactive `content`
   * prop, since Tiptap never re-parses content on prop changes.
   */
  setContent: (content: Content, options?: { emitUpdate?: boolean }) => boolean
  /** Clear the whole document. */
  clear: () => boolean
  /** True once the underlying Tiptap editor has mounted. */
  isReady: () => boolean
  /** Escape hatch: the raw Tiptap editor instance. `null` until mounted. */
  getEditor: () => TiptapEditor | null
}

interface LinkPopoverState {
  top: number
  left: number
  from: number
  to: number
  initialUrl: string
}

// ── Bubble position hook ────────────────────────────────────────────────────

function useBubblePos(editor: TiptapEditor | null, toolbarRef: RefObject<HTMLDivElement | null>) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!editor) return
    const update = () => {
      if (editor.state.selection.empty) { setCoords(null); return }
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) { setCoords(null); return }
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      if (!rect.width) { setCoords(null); return }
      const bubbleH = 36
      const gap = 8
      const top = rect.top - bubbleH - gap >= 0 ? rect.top - bubbleH - gap : rect.bottom + gap
      setCoords({ top, left: rect.left + rect.width / 2 })
    }
    // Delay blur-clear so onMouseDown/onPointerDown handlers on bubble buttons
    // can fire before the bubble unmounts (native pointerdown fires before mousedown).
    // Also don't hide it if focus moved INTO the toolbar itself (keyboard
    // users tabbing/arrow-navigating into it trigger the editor's own blur).
    let blurTimer: ReturnType<typeof setTimeout>
    const clear = () => {
      blurTimer = setTimeout(() => {
        if (toolbarRef.current?.contains(document.activeElement)) return
        setCoords(null)
      }, 150)
    }
    const cancelClear = () => clearTimeout(blurTimer)
    editor.on('selectionUpdate', update)
    editor.on('blur', clear)
    editor.on('focus', cancelClear)
    return () => {
      clearTimeout(blurTimer)
      editor.off('selectionUpdate', update)
      editor.off('blur', clear)
      editor.off('focus', cancelClear)
    }
  }, [editor, toolbarRef])

  return coords
}

// ── Bubble toolbar ──────────────────────────────────────────────────────────

const BubbleToolbar = forwardRef<RovingToolbarHandle, {
  editor: TiptapEditor
  onLinkClick: (editor: TiptapEditor) => void
}>(function BubbleToolbar({ editor, onLinkClick }, ref) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const coords = useBubblePos(editor, toolbarRef)
  const roving = useRovingToolbar({
    count: 8,
    active: coords !== null,
    onEscape: () => editor.chain().focus().run(),
  })
  useImperativeHandle(ref, () => ({ focusFirst: roving.focusFirst }), [roving.focusFirst])

  if (!coords) return null

  const btn = (
    index: number,
    label: string,
    format: string,
    active: boolean,
    action: () => void,
    title: string,
    ariaLabel: string,
  ) => (
    <button
      key={format}
      ref={roving.registerButton(index)}
      data-format={format}
      className={active ? 'is-active' : ''}
      tabIndex={roving.getTabIndex(index)}
      onKeyDown={roving.onButtonKeyDown(index)}
      onPointerDown={(e) => { e.preventDefault(); action() }}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={active}
    >
      {label}
    </button>
  )

  const sep = () => <div className="cw-bubble-menu__divider" />

  return (
    <div ref={toolbarRef} role="toolbar" aria-label="Formato de texto" className="cw-bubble-menu" style={{ position: 'fixed', top: coords.top, left: coords.left }}>
      {btn(0, 'B', 'bold',      editor.isActive('bold'),      () => editor.chain().focus().toggleBold().run(),      'Negrita (Ctrl+B)', 'Negrita')}
      {btn(1, 'I', 'italic',    editor.isActive('italic'),    () => editor.chain().focus().toggleItalic().run(),    'Cursiva (Ctrl+I)', 'Cursiva')}
      {btn(2, 'U', 'underline', editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(), 'Subrayado (Ctrl+U)', 'Subrayado')}
      {btn(3, 'S', 'strike',    editor.isActive('strike'),    () => editor.chain().focus().toggleStrike().run(),    'Tachado', 'Tachado')}
      {sep()}
      {btn(4, 'H2', 'h2', editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), 'Encabezado 2', 'Encabezado 2')}
      {btn(5, 'H3', 'h3', editor.isActive('heading', { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), 'Encabezado 3', 'Encabezado 3')}
      {sep()}
      {btn(6, '"', 'blockquote', editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), 'Cita', 'Cita')}
      {sep()}
      {btn(7, '↗', 'link', editor.isActive('link'), () => onLinkClick(editor), 'Enlace (Ctrl+K)', 'Enlace')}
    </div>
  )
})
BubbleToolbar.displayName = 'BubbleToolbar'

// ── Link popover ────────────────────────────────────────────────────────────

function LinkPopover({
  state,
  onApply,
  onClose,
}: {
  state: LinkPopoverState
  onApply: (url: string) => void
  onClose: () => void
}) {
  const [url, setUrl] = useState(state.initialUrl)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="cw-link-popover"
      style={{ top: state.top, left: state.left }}
    >
      <input
        ref={inputRef}
        type="url"
        value={url}
        className="cw-link-input"
        placeholder="https://"
        aria-label="URL del enlace"
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onApply(url) }
          if (e.key === 'Escape') { e.preventDefault(); onClose() }
        }}
      />
      <button
        className="cw-link-btn cw-link-apply"
        title="Aplicar (Enter)"
        aria-label="Aplicar enlace"
        onPointerDown={(e) => { e.preventDefault(); onApply(url) }}
      >
        ↵
      </button>
      {state.initialUrl && (
        <button
          className="cw-link-btn cw-link-remove"
          title="Eliminar enlace"
          aria-label="Eliminar enlace"
          onPointerDown={(e) => { e.preventDefault(); onApply('') }}
        >
          ✕
        </button>
      )}
    </div>
  )
}

// ── Slash command menu ──────────────────────────────────────────────────────

const SlashMenu = forwardRef<SlashKeyHandler, {
  items: SlashCommandItem[]
  coords: { top: number; left: number }
  listboxId: string
  onSelect: (item: SlashCommandItem) => void
  onClose: () => void
  onHighlightChange: (id: string | null) => void
}>(function SlashMenu({ items, coords, listboxId, onSelect, onClose, onHighlightChange }, ref) {
  const [selected, setSelected] = useState(0)

  // Reset the highlighted item whenever the filtered list changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setSelected(0) }, [items])

  // Focus never moves into this menu (it's driven by typed text while the
  // contenteditable stays focused, Notion-style), so the highlighted item
  // is exposed to assistive tech via aria-activedescendant on the editable
  // element itself — see the effect near the editor's useEditor() call.
  useEffect(() => {
    onHighlightChange(items[selected] ? `${listboxId}-option-${items[selected].id}` : null)
  }, [items, selected, listboxId, onHighlightChange])

  useEffect(() => () => onHighlightChange(null), [onHighlightChange])

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (event.key === 'Escape') { onClose(); return true }
      if (items.length === 0) return false
      if (event.key === 'ArrowDown') { setSelected((i) => (i + 1) % items.length); return true }
      if (event.key === 'ArrowUp') { setSelected((i) => (i - 1 + items.length) % items.length); return true }
      if (event.key === 'Enter') { onSelect(items[selected]); return true }
      return false
    },
  }), [items, selected, onSelect, onClose])

  return (
    <div id={listboxId} role="listbox" aria-label="Comandos" className="cw-slash-menu" style={{ position: 'fixed', top: coords.top, left: coords.left }}>
      {items.length === 0 ? (
        <div className="cw-slash-menu__empty">Sin resultados</div>
      ) : (
        items.map((item, i) => (
          <button
            key={item.id}
            id={`${listboxId}-option-${item.id}`}
            role="option"
            aria-selected={i === selected}
            className={i === selected ? 'is-active' : ''}
            tabIndex={-1}
            onPointerEnter={() => setSelected(i)}
            onPointerDown={(e) => { e.preventDefault(); onSelect(item) }}
          >
            {item.label}
          </button>
        ))
      )}
    </div>
  )
})

// ── Table toolbar ───────────────────────────────────────────────────────────

// Unlike useBubblePos (which bails on an empty/collapsed selection), the
// cursor inside a table cell is usually just a caret — so this tracks
// editor.isActive('table') instead of selection range, and also recomputes
// on every transaction since row/column changes move the table's position.
function useTableToolbarPos(editor: TiptapEditor | null) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!editor) return
    const update = () => {
      if (!editor.isActive('table')) { setCoords(null); return }
      try {
        const domAtPos = editor.view.domAtPos(editor.state.selection.from).node
        const el = domAtPos.nodeType === 1 ? (domAtPos as HTMLElement) : domAtPos.parentElement
        const tableEl = el?.closest('table')
        if (!tableEl) { setCoords(null); return }
        const rect = tableEl.getBoundingClientRect()
        setCoords({ top: rect.top - 40, left: rect.left })
      } catch {
        setCoords(null)
      }
    }
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
    }
  }, [editor])

  return coords
}

const TableToolbar = forwardRef<RovingToolbarHandle, { editor: TiptapEditor }>(function TableToolbar({ editor }, ref) {
  const coords = useTableToolbarPos(editor)
  const roving = useRovingToolbar({
    count: 5,
    active: coords !== null,
    onEscape: () => editor.chain().focus().run(),
  })
  useImperativeHandle(ref, () => ({ focusFirst: roving.focusFirst }), [roving.focusFirst])

  if (!coords) return null

  const btn = (index: number, label: string, title: string, ariaLabel: string, action: () => void) => (
    <button
      key={title}
      ref={roving.registerButton(index)}
      tabIndex={roving.getTabIndex(index)}
      onKeyDown={roving.onButtonKeyDown(index)}
      title={title}
      aria-label={ariaLabel}
      onPointerDown={(e) => { e.preventDefault(); action() }}
    >
      {label}
    </button>
  )

  return (
    <div role="toolbar" aria-label="Tabla" className="cw-bubble-menu cw-table-menu" style={{ position: 'fixed', top: coords.top, left: coords.left }}>
      {btn(0, '+Fila', 'Añadir fila', 'Añadir fila', () => editor.chain().focus().addRowAfter().run())}
      {btn(1, '+Col', 'Añadir columna', 'Añadir columna', () => editor.chain().focus().addColumnAfter().run())}
      <div className="cw-bubble-menu__divider" />
      {btn(2, '−Fila', 'Eliminar fila', 'Eliminar fila', () => editor.chain().focus().deleteRow().run())}
      {btn(3, '−Col', 'Eliminar columna', 'Eliminar columna', () => editor.chain().focus().deleteColumn().run())}
      <div className="cw-bubble-menu__divider" />
      {btn(4, '✕', 'Eliminar tabla', 'Eliminar tabla', () => editor.chain().focus().deleteTable().run())}
    </div>
  )
})
TableToolbar.displayName = 'TableToolbar'

// ── Image insert popover ────────────────────────────────────────────────────

interface ImageInsertState {
  top: number
  left: number
}

function ImageInsertPopover({
  state,
  canUpload,
  onInsertUrl,
  onUploadClick,
  onClose,
}: {
  state: ImageInsertState
  canUpload: boolean
  onInsertUrl: (url: string, alt: string) => void
  onUploadClick: (alt: string) => void
  onClose: () => void
}) {
  const [url, setUrl] = useState('')
  const [alt, setAlt] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const submit = () => {
    const trimmed = url.trim()
    if (trimmed) onInsertUrl(trimmed, alt)
  }

  const handleFieldKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); submit() }
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  return (
    <div
      ref={ref}
      className="cw-link-popover"
      style={{ top: state.top, left: state.left }}
    >
      <input
        ref={inputRef}
        type="url"
        value={url}
        className="cw-link-input"
        placeholder="https://…"
        aria-label="URL de la imagen"
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={handleFieldKeyDown}
      />
      <input
        type="text"
        value={alt}
        className="cw-link-input"
        placeholder="Texto alternativo (opcional)"
        aria-label="Texto alternativo"
        onChange={(e) => setAlt(e.target.value)}
        onKeyDown={handleFieldKeyDown}
      />
      <button
        className="cw-link-btn cw-link-apply"
        title="Insertar (Enter)"
        aria-label="Insertar imagen"
        onPointerDown={(e) => { e.preventDefault(); submit() }}
      >
        ↵
      </button>
      {canUpload && (
        <button
          className="cw-link-btn"
          title="Subir archivo"
          aria-label="Subir archivo"
          onPointerDown={(e) => { e.preventDefault(); onUploadClick(alt) }}
        >
          ⤒
        </button>
      )}
    </div>
  )
}

// ── Editor ──────────────────────────────────────────────────────────────────

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor({
  initialContent = '',
  placeholder = 'Start writing…',
  typewriterMode = false,
  className,
  extensions,
  onChange,
  onImageUpload,
  ariaLabel,
}, ref) {
  const accessibleName = ariaLabel || placeholder
  const rafRef = useRef<number | null>(null)
  const [linkState, setLinkState] = useState<LinkPopoverState | null>(null)
  const [imageInsertState, setImageInsertState] = useState<ImageInsertState | null>(null)
  const [pendingUploadAlt, setPendingUploadAlt] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [slashState, setSlashState] = useState<SlashCommandState | null>(null)
  const [slashHighlightId, setSlashHighlightId] = useState<string | null>(null)
  const slashMenuHandleRef = useRef<SlashKeyHandler>(null)
  const bubbleToolbarRef = useRef<RovingToolbarHandle>(null)
  const tableToolbarRef = useRef<RovingToolbarHandle>(null)
  const instanceId = useId()
  const slashListboxId = `cw-slash-${instanceId}`

  const slashItems = useMemo<SlashCommandItem[]>(() => [
    {
      id: 'image',
      label: 'Imagen',
      execute: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run()
        const coords = editor.view.coordsAtPos(editor.state.selection.from)
        setImageInsertState({ top: coords.bottom + 8, left: coords.left })
      },
    },
    {
      id: 'table',
      label: 'Tabla',
      execute: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      },
    },
  ], [])

  const slashExtension = useMemo(() => SlashCommand.configure({
    items: slashItems,
    onStateChange: setSlashState,
    getKeyHandler: () => slashMenuHandleRef.current,
  }), [slashItems])

  const scrollToCursor = useCallback((editor: TiptapEditor) => {
    if (!typewriterMode) return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      try {
        const { from } = editor.state.selection
        const coords = editor.view.coordsAtPos(from)
        const desired = window.scrollY + coords.top - window.innerHeight / 2
        window.scrollTo({ top: Math.max(0, desired), behavior: 'instant' })
      } catch {}
    })
  }, [typewriterMode])

  const mergedExtensions = useMemo(
    () => mergeExtensions(
      [
        StarterKit.configure({
          link: { openOnClick: false, autolink: true },
        }),
        Placeholder.configure({ placeholder }),
        Typography,
        UploadableImage.configure({ inline: false, allowBase64: true }),
        Table.configure({ resizable: true }),
        TableRow,
        TableCell,
        TableHeader,
        slashExtension,
      ],
      extensions,
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placeholder, slashExtension],
  )

  const editor = useEditor({
    immediatelyRender: false,
    extensions: mergedExtensions,
    content: initialContent,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': accessibleName,
        'aria-haspopup': 'listbox',
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Tab' && !event.shiftKey) {
          const isInList = view.state.selection.$head.parent.type.name === 'listItem'
          if (isInList) return false // StarterKit's list keymap sinks/lifts the item

          // If a floating toolbar (bubble menu / table toolbar) is visible,
          // Tab jumps focus into it instead of leaving the document — the
          // same convention used by Medium and similar contextual-toolbar
          // editors. Without a toolbar visible, don't intercept: falling
          // through lets the browser's native contenteditable tab-navigation
          // move focus off the editor (WCAG 2.1.2 — Tab must never be a
          // silent no-op here).
          if (bubbleToolbarRef.current?.focusFirst() || tableToolbarRef.current?.focusFirst()) {
            event.preventDefault()
            return true
          }
          return false
        }
        return false
      },
      // Raw image files (a real file drag, or an OS-level file copy) are only
      // ever embedded via the host-provided onImageUpload callback — never as
      // base64. Without it, dropped/pasted files are left alone. Clipboard
      // HTML containing <img src="data:..."> (e.g. Google Docs paste) is a
      // separate path handled by ProseMirror's default HTML-paste parsing
      // via UploadableImage's own parseHTML rule (allowBase64: true above).
      handlePaste: (_view, event) => {
        if (!onImageUpload) return false
        const files = Array.from(event.clipboardData?.files ?? [])
          .filter((f) => f.type.startsWith('image/'))
        if (files.length === 0) return false
        event.preventDefault()
        files.forEach((file) => handleImageFile(file))
        return true
      },
      handleDrop: (view, event) => {
        if (!onImageUpload) return false
        const files = Array.from(event.dataTransfer?.files ?? [])
          .filter((f) => f.type.startsWith('image/'))
        if (files.length === 0) return false
        event.preventDefault()
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
        if (coords) {
          const { tr } = view.state
          view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(coords.pos))))
        }
        files.forEach((file) => handleImageFile(file))
        return true
      },
    },
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML())
      scrollToCursor(editor)
    },
    onSelectionUpdate: ({ editor }) => {
      scrollToCursor(editor)
    },
  })

  const handleImageFile = useCallback((file: File, alt?: string) => {
    if (!editor || !onImageUpload) return
    insertImageWithUpload(editor, file, onImageUpload, { alt })
  }, [editor, onImageUpload])

  const insertImageUrl = useCallback((url: string, alt: string) => {
    editor?.chain().focus().setImage({ src: url, alt }).run()
    setImageInsertState(null)
  }, [editor])

  // Keep the editable element's dynamic ARIA state in sync with the slash
  // menu — editorProps.attributes is fixed at useEditor() construction time,
  // so this part can't be re-supplied reactively and is set imperatively.
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const isOpen = !!slashState?.coords
    dom.setAttribute('aria-expanded', String(isOpen))
    if (isOpen) {
      dom.setAttribute('aria-controls', slashListboxId)
      if (slashHighlightId) dom.setAttribute('aria-activedescendant', slashHighlightId)
      else dom.removeAttribute('aria-activedescendant')
    } else {
      dom.removeAttribute('aria-controls')
      dom.removeAttribute('aria-activedescendant')
    }
  }, [editor, slashState, slashHighlightId, slashListboxId])

  const openLink = useCallback((ed: TiptapEditor) => {
    const { from, to } = ed.state.selection
    if (from === to && !ed.isActive('link')) return
    try {
      const startCoords = ed.view.coordsAtPos(from)
      const endCoords = ed.view.coordsAtPos(to)
      const midX = (startCoords.left + endCoords.right) / 2
      const popoverH = 44
      const gap = 10
      const top = startCoords.bottom + popoverH + gap < window.innerHeight
        ? startCoords.bottom + gap
        : startCoords.top - popoverH - gap
      const initialUrl = (ed.getAttributes('link').href as string) ?? ''
      setLinkState({ top, left: midX, from, to, initialUrl })
    } catch {}
  }, [])

  const applyLink = useCallback((url: string) => {
    if (!editor || !linkState) return
    const { from, to } = linkState
    const trimmed = url.trim()
    const chain = editor.chain().setTextSelection({ from, to })
    if (trimmed) {
      chain.setLink({ href: trimmed })
    } else if (linkState.initialUrl) {
      chain.unsetLink()
    }
    chain.focus().run()
    setLinkState(null)
  }, [editor, linkState])

  // Ctrl+K: open link popover on selected text or when cursor is on a link
  useEffect(() => {
    if (!editor) return
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        if (!editor.state.selection.empty || editor.isActive('link')) {
          openLink(editor)
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [editor, openLink])

  // Fire onChange once on mount so the host has the initial HTML
  useEffect(() => {
    if (initialContent) onChange?.(initialContent)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    focus: () => { editor?.chain().focus().run() },
    getHTML: () => editor?.getHTML() ?? '',
    getJSON: () => editor?.getJSON() ?? { type: 'doc', content: [] },
    setContent: (content, options) => editor?.commands.setContent(content, options) ?? false,
    clear: () => editor?.commands.clearContent(true) ?? false,
    isReady: () => !!editor,
    getEditor: () => editor,
  }), [editor])

  return (
    <div className={`cw-editor${className ? ` ${className}` : ''}`}>
      {editor && (
        <BubbleToolbar
          ref={bubbleToolbarRef}
          editor={editor}
          onLinkClick={openLink}
        />
      )}
      {editor && <TableToolbar ref={tableToolbarRef} editor={editor} />}
      {linkState && (
        <LinkPopover
          state={linkState}
          onApply={applyLink}
          onClose={() => { setLinkState(null); editor?.chain().focus().run() }}
        />
      )}
      {slashState?.coords && (
        <SlashMenu
          ref={slashMenuHandleRef}
          items={slashState.items}
          coords={slashState.coords}
          listboxId={slashListboxId}
          onSelect={(item) => slashState.select(item)}
          onClose={() => setSlashState(null)}
          onHighlightChange={setSlashHighlightId}
        />
      )}
      {imageInsertState && (
        <ImageInsertPopover
          state={imageInsertState}
          canUpload={!!onImageUpload}
          onInsertUrl={insertImageUrl}
          onUploadClick={(alt) => { setPendingUploadAlt(alt); fileInputRef.current?.click() }}
          onClose={() => { setImageInsertState(null); editor?.chain().focus().run() }}
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleImageFile(file, pendingUploadAlt)
          e.target.value = ''
          setImageInsertState(null)
        }}
      />
      <EditorContent editor={editor} />
    </div>
  )
})

Editor.displayName = 'Editor'
