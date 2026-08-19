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
      setCoords({ top: rect.top - 48, left: rect.left + rect.width / 2 })
    }
    const clear = () => setCoords(null)
    editor.on('selectionUpdate', update)
    editor.on('blur', clear)
    return () => { editor.off('selectionUpdate', update); editor.off('blur', clear) }
  }, [editor])

  return coords
}

function BubbleToolbar({ editor }: { editor: TiptapEditor }) {
  const coords = useBubblePos(editor)
  if (!coords) return null

  const btn = (label: string, active: boolean, action: () => void, title: string) => (
    <button
      key={label}
      className={active ? 'is-active' : ''}
      onMouseDown={(e) => { e.preventDefault(); action() }}
      title={title}
    >
      {label}
    </button>
  )

  return (
    <div className="cw-bubble-menu" style={{ position: 'fixed', top: coords.top, left: coords.left }}>
      {btn('B', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), 'Negrita')}
      {btn('I', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), 'Cursiva')}
      {btn('S', editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), 'Tachado')}
      <div className="cw-bubble-menu__divider" />
      {btn('H2', editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), 'Encabezado 2')}
      {btn('H3', editor.isActive('heading', { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), 'Encabezado 3')}
      <div className="cw-bubble-menu__divider" />
      {btn('"', editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), 'Cita')}
    </div>
  )
}

export function Editor({
  initialContent = '',
  placeholder = 'Start writing…',
  typewriterMode = false,
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
      Placeholder.configure({ placeholder }),
      Typography,
    ],
    content: initialContent,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML())
      scrollToCursor(editor)
    },
    onSelectionUpdate: ({ editor }) => {
      scrollToCursor(editor)
    },
  })

  // Fire onChange once on mount so the host has the initial HTML
  useEffect(() => {
    if (initialContent) onChange?.(initialContent)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {editor && <BubbleToolbar editor={editor} />}
      <EditorContent editor={editor} />
    </>
  )
}
