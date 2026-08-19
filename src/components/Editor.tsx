import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
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
    const clear = () => setCoords(null)
    editor.on('selectionUpdate', update)
    editor.on('blur', clear)
    return () => { editor.off('selectionUpdate', update); editor.off('blur', clear) }
  }, [editor])

  return coords
}

function promptLink(editor: TiptapEditor) {
  if (editor.isActive('link')) {
    editor.chain().focus().unsetLink().run()
    return
  }
  const previous = editor.getAttributes('link').href as string | undefined
  const url = window.prompt('URL del enlace:', previous ?? 'https://')
  if (url === null) return
  if (url.trim() === '') {
    editor.chain().focus().unsetLink().run()
  } else {
    editor.chain().focus().setLink({ href: url.trim() }).run()
  }
}

function BubbleToolbar({ editor }: { editor: TiptapEditor }) {
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
      onMouseDown={(e) => { e.preventDefault(); action() }}
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
      {btn('↗', 'link', editor.isActive('link'), () => promptLink(editor), 'Enlace (Ctrl+K)')}
    </div>
  )
}

export function Editor({
  initialContent = '',
  placeholder = 'Start writing…',
  typewriterMode = false,
  className,
  onChange,
}: EditorProps) {
  const rafRef = useRef<number | null>(null)

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
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
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

  // Ctrl+K: set/unset link on selected text
  useEffect(() => {
    if (!editor) return
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        if (!editor.state.selection.empty || editor.isActive('link')) {
          promptLink(editor)
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [editor])

  // Fire onChange once on mount so the host has the initial HTML
  useEffect(() => {
    if (initialContent) onChange?.(initialContent)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`cw-editor${className ? ` ${className}` : ''}`}>
      {editor && <BubbleToolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  )
}
