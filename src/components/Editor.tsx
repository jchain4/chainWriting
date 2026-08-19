import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

export function Editor() {
  const editor = useEditor({
    extensions: [StarterKit],
    content: '<p>Empieza a escribir aquí...</p>',
  })

  return <EditorContent editor={editor} />
}
