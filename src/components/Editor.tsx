import { useEffect, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useAutosave, loadDocument } from '../hooks/useAutosave'

const EMPTY = '<p></p>'

export function Editor() {
  const [initialContent, setInitialContent] = useState<string | null>(null)

  useEffect(() => {
    loadDocument().then((saved) => setInitialContent(saved ?? EMPTY))
  }, [])

  if (initialContent === null) return null

  return <EditorInner initialContent={initialContent} />
}

function EditorInner({ initialContent }: { initialContent: string }) {
  const [content, setContent] = useState(initialContent)
  const { saved } = useAutosave(content)

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialContent,
    onUpdate: ({ editor }) => setContent(editor.getHTML()),
  })

  return (
    <div className="editor-wrapper">
      <span className={`save-status${saved ? ' save-status--visible' : ''}`}>
        Guardado
      </span>
      <EditorContent editor={editor} />
    </div>
  )
}
