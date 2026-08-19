import { useEffect, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import { useAutosave } from '../hooks/useAutosave'
import type { Editor as TiptapEditor } from '@tiptap/react'

interface EditorProps {
  docId: string
  initialContent: string
}

export function Editor({ docId, initialContent }: EditorProps) {
  return <EditorInner key={docId} docId={docId} initialContent={initialContent} />
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
      className={active ? 'is-active' : ''}
      onMouseDown={(e) => { e.preventDefault(); action() }}
      title={title}
    >
      {label}
    </button>
  )

  return (
    <div className="bubble-menu" style={{ position: 'fixed', top: coords.top, left: coords.left }}>
      {btn('B', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), 'Negrita (Ctrl+B)')}
      {btn('I', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), 'Cursiva (Ctrl+I)')}
      {btn('S', editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), 'Tachado')}
      <div className="bubble-menu__divider" />
      {btn('H2', editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), 'Encabezado 2')}
      {btn('H3', editor.isActive('heading', { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), 'Encabezado 3')}
      <div className="bubble-menu__divider" />
      {btn('"', editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), 'Cita')}
    </div>
  )
}

function EditorInner({ docId, initialContent }: EditorProps) {
  const [content, setContent] = useState(initialContent)
  const { saved } = useAutosave(docId, content)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Empieza a escribir…' }),
      Typography,
    ],
    content: initialContent,
    onUpdate: ({ editor }) => setContent(editor.getHTML()),
  })

  return (
    <div className="editor-wrapper">
      <span className={`save-status${saved ? ' save-status--visible' : ''}`}>
        Guardado
      </span>
      {editor && <BubbleToolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  )
}
