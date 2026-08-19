import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import type { Editor as TiptapEditor } from '@tiptap/react'
import '../editor.css'

export interface EditorProps {
  initialContent?: string
  placeholder?: string
  typewriterMode?: boolean
  /** Extra class added to the root .cw-editor wrapper — use for scoped CSS variable overrides */
  className?: string
  onChange?: (html: string) => void
}

interface LinkPopoverState {
  top: number
  left: number
  from: number
  to: number
  initialUrl: string
}

// ── Bubble position hook ────────────────────────────────────────────────────

function useBubblePos(editor: TiptapEditor | null) {
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
    let blurTimer: ReturnType<typeof setTimeout>
    const clear = () => { blurTimer = setTimeout(() => setCoords(null), 150) }
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
  }, [editor])

  return coords
}

// ── Bubble toolbar ──────────────────────────────────────────────────────────

function BubbleToolbar({
  editor,
  onLinkClick,
}: {
  editor: TiptapEditor
  onLinkClick: (editor: TiptapEditor) => void
}) {
  const coords = useBubblePos(editor)
  if (!coords) return null

  const btn = (
    label: string,
    format: string,
    active: boolean,
    action: () => void,
    title: string,
  ) => (
    <button
      key={format}
      data-format={format}
      className={active ? 'is-active' : ''}
      tabIndex={-1}
      onPointerDown={(e) => { e.preventDefault(); action() }}
      title={title}
    >
      {label}
    </button>
  )

  const sep = () => <div className="cw-bubble-menu__divider" />

  return (
    <div className="cw-bubble-menu" style={{ position: 'fixed', top: coords.top, left: coords.left }}>
      {btn('B', 'bold',      editor.isActive('bold'),      () => editor.chain().focus().toggleBold().run(),      'Negrita (Ctrl+B)')}
      {btn('I', 'italic',    editor.isActive('italic'),    () => editor.chain().focus().toggleItalic().run(),    'Cursiva (Ctrl+I)')}
      {btn('U', 'underline', editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(), 'Subrayado (Ctrl+U)')}
      {btn('S', 'strike',    editor.isActive('strike'),    () => editor.chain().focus().toggleStrike().run(),    'Tachado')}
      {sep()}
      {btn('H2', 'h2', editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), 'Encabezado 2')}
      {btn('H3', 'h3', editor.isActive('heading', { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), 'Encabezado 3')}
      {sep()}
      {btn('"', 'blockquote', editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), 'Cita')}
      {sep()}
      {btn('↗', 'link', editor.isActive('link'), () => onLinkClick(editor), 'Enlace (Ctrl+K)')}
    </div>
  )
}

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
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onApply(url) }
          if (e.key === 'Escape') { e.preventDefault(); onClose() }
        }}
      />
      <button
        className="cw-link-btn cw-link-apply"
        title="Aplicar (Enter)"
        tabIndex={-1}
        onPointerDown={(e) => { e.preventDefault(); onApply(url) }}
      >
        ↵
      </button>
      {state.initialUrl && (
        <button
          className="cw-link-btn cw-link-remove"
          title="Eliminar enlace"
          tabIndex={-1}
          onPointerDown={(e) => { e.preventDefault(); onApply('') }}
        >
          ✕
        </button>
      )}
    </div>
  )
}

// ── Editor ──────────────────────────────────────────────────────────────────

export function Editor({
  initialContent = '',
  placeholder = 'Start writing…',
  typewriterMode = false,
  className,
  onChange,
}: EditorProps) {
  const rafRef = useRef<number | null>(null)
  const [linkState, setLinkState] = useState<LinkPopoverState | null>(null)

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

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true },
      }),
      Placeholder.configure({ placeholder }),
      Typography,
    ],
    content: initialContent,
    editorProps: {
      handleKeyDown: (view, event) => {
        if (event.key === 'Tab') {
          const isInList = view.state.selection.$head.parent.type.name === 'listItem'
          if (!isInList) {
            event.preventDefault()
            return true
          }
        }
        return false
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
    if (trimmed) {
      editor.chain().setTextSelection({ from, to }).setLink({ href: trimmed }).run()
    } else if (linkState.initialUrl) {
      editor.chain().setTextSelection({ from, to }).unsetLink().run()
    }
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

  return (
    <div className={`cw-editor${className ? ` ${className}` : ''}`}>
      {editor && (
        <BubbleToolbar
          editor={editor}
          onLinkClick={openLink}
        />
      )}
      {linkState && (
        <LinkPopover
          state={linkState}
          onApply={applyLink}
          onClose={() => setLinkState(null)}
        />
      )}
      <EditorContent editor={editor} />
    </div>
  )
}
