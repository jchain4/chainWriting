import type { Editor as TiptapEditor } from '@tiptap/react'

export interface ImageUploadDeps {
  /** Alt text for the inserted image. Falls back to the file name when omitted. */
  alt?: string
  uuid?: () => string
  createObjectUrl?: (file: File) => string
  revokeObjectUrl?: (url: string) => void
}

/**
 * Inserts an instant local preview of `file`, then swaps it for the real URL
 * (or removes it) once `onImageUpload` settles. Uses `UploadableImage`'s
 * `insertPendingImage`/`resolveImageUpload`/`rejectImageUpload` commands.
 */
export function insertImageWithUpload(
  editor: TiptapEditor,
  file: File,
  onImageUpload: (file: File) => Promise<string>,
  deps: ImageUploadDeps = {},
): void {
  const uuid = deps.uuid ?? (() => crypto.randomUUID())
  const createObjectUrl = deps.createObjectUrl ?? ((f: File) => URL.createObjectURL(f))
  const revokeObjectUrl = deps.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url))

  const uploadId = uuid()
  const objectUrl = createObjectUrl(file)
  // Preserves an explicitly empty string (decorative image) — only an
  // omitted `alt` (undefined) falls back to the file name.
  const alt = deps.alt ?? file.name

  editor.chain().focus().insertPendingImage({ src: objectUrl, alt, uploadId }).run()

  onImageUpload(file)
    .then((url) => {
      editor.commands.resolveImageUpload(uploadId, url)
      revokeObjectUrl(objectUrl)
    })
    .catch(() => {
      editor.commands.rejectImageUpload(uploadId)
      revokeObjectUrl(objectUrl)
    })
}
