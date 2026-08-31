import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor as TiptapEditor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { UploadableImage } from './imageExtension'
import { insertImageWithUpload } from './imageUpload'

// vitest.config.ts sets environment: 'jsdom', so window/document already
// exist here — a headless (non-React) Tiptap editor still needs a real DOM
// to construct its EditorView against, even though nothing attaches to
// document.body.
//
// EditorView schedules its DOM-mutation flush via setTimeout; if the editor
// is never destroyed, that timer outlives the test and fires after jsdom is
// torn down, throwing "document is not defined" as an unhandled rejection.
// Track every instance created here and destroy it in afterEach.
const liveEditors: TiptapEditor[] = []

function makeEditor() {
  const editor = new TiptapEditor({
    extensions: [StarterKit, UploadableImage.configure({ inline: false, allowBase64: true })],
  })
  liveEditors.push(editor)
  return editor
}

afterEach(() => {
  while (liveEditors.length) liveEditors.pop()!.destroy()
})

describe('UploadableImage commands', () => {
  it('insertPendingImage inserts an image node carrying data-upload-id', () => {
    const editor = makeEditor()
    editor.commands.insertPendingImage({ src: 'blob:preview', alt: 'a.png', uploadId: 'up-1' })
    expect(editor.getHTML()).toContain('data-upload-id="up-1"')
    expect(editor.getHTML()).toContain('src="blob:preview"')
  })

  it('resolveImageUpload swaps the src and clears the upload marker', () => {
    const editor = makeEditor()
    editor.commands.insertPendingImage({ src: 'blob:preview', alt: 'a.png', uploadId: 'up-1' })
    const result = editor.commands.resolveImageUpload('up-1', 'https://cdn/a.png')
    expect(result).toBe(true)
    expect(editor.getHTML()).toContain('src="https://cdn/a.png"')
    expect(editor.getHTML()).not.toContain('data-upload-id')
  })

  it('rejectImageUpload removes the pending image node', () => {
    const editor = makeEditor()
    editor.commands.insertPendingImage({ src: 'blob:preview', alt: 'a.png', uploadId: 'up-1' })
    const result = editor.commands.rejectImageUpload('up-1')
    expect(result).toBe(true)
    expect(editor.getHTML()).not.toContain('<img')
  })

  it('resolveImageUpload/rejectImageUpload are no-ops when the uploadId is unknown', () => {
    const editor = makeEditor()
    expect(editor.commands.resolveImageUpload('missing', 'https://cdn/a.png')).toBe(false)
    expect(editor.commands.rejectImageUpload('missing')).toBe(false)
  })

  it('resolveImageUpload does not add its own undo step, so undo right after a resolve undoes the whole paste instead of reverting only the swap', () => {
    const editor = makeEditor()
    editor.commands.insertPendingImage({ src: 'blob:preview', alt: 'a.png', uploadId: 'up-1' })
    editor.commands.resolveImageUpload('up-1', 'https://cdn/a.png')

    editor.commands.undo()

    // insertPendingImage is the only real history entry, so undo removes the
    // image entirely — the correct behavior for "undo my paste". Before this
    // fix, resolveImageUpload's swap was itself a separate undo step, so undo
    // reverted *only* the swap and left the node behind with its stale
    // preview src and uploadId re-armed: a broken, half-uploaded image with
    // no upload in flight to ever resolve it again.
    expect(editor.getHTML()).not.toContain('<img')
    expect(editor.getHTML()).not.toContain('data-upload-id')
    expect(editor.getHTML()).not.toContain('blob:preview')
  })

  it('rejectImageUpload does not add its own undo step', () => {
    const editor = makeEditor()
    editor.commands.insertPendingImage({ src: 'blob:preview', alt: 'a.png', uploadId: 'up-1' })
    editor.commands.rejectImageUpload('up-1')

    // Should not throw when rebasing undo over the untracked removal.
    expect(() => editor.commands.undo()).not.toThrow()
  })
})

describe('insertImageWithUpload', () => {
  function makeDeps(objectUrl = 'blob:fake') {
    const revokeObjectUrl = vi.fn()
    return {
      uuid: () => 'up-1',
      createObjectUrl: vi.fn(() => objectUrl),
      revokeObjectUrl,
    }
  }

  it('inserts a pending preview synchronously, then resolves to the real URL', async () => {
    const editor = makeEditor()
    const deps = makeDeps()
    let resolveUpload!: (url: string) => void
    const onImageUpload = vi.fn(() => new Promise<string>((resolve) => { resolveUpload = resolve }))
    const file = new File(['x'], 'a.png', { type: 'image/png' })

    insertImageWithUpload(editor, file, onImageUpload, deps)

    expect(editor.getHTML()).toContain('src="blob:fake"')
    expect(editor.getHTML()).toContain('data-upload-id="up-1"')

    resolveUpload('https://cdn/a.png')
    await Promise.resolve()
    await Promise.resolve()

    expect(editor.getHTML()).toContain('src="https://cdn/a.png"')
    expect(editor.getHTML()).not.toContain('data-upload-id')
    expect(deps.revokeObjectUrl).toHaveBeenCalledTimes(1)
    expect(deps.revokeObjectUrl).toHaveBeenCalledWith('blob:fake')
  })

  it('uses the provided alt option instead of the file name when given', () => {
    const editor = makeEditor()
    const deps = makeDeps()
    const onImageUpload = vi.fn(() => new Promise<string>(() => {}))
    const file = new File(['x'], 'IMG_20260823.png', { type: 'image/png' })

    insertImageWithUpload(editor, file, onImageUpload, { ...deps, alt: 'A sunset over the bay' })

    expect(editor.getHTML()).toContain('alt="A sunset over the bay"')
    expect(editor.getHTML()).not.toContain('IMG_20260823.png')
  })

  it('falls back to the file name when alt is omitted', () => {
    const editor = makeEditor()
    const deps = makeDeps()
    const onImageUpload = vi.fn(() => new Promise<string>(() => {}))
    const file = new File(['x'], 'IMG_20260823.png', { type: 'image/png' })

    insertImageWithUpload(editor, file, onImageUpload, deps)

    expect(editor.getHTML()).toContain('alt="IMG_20260823.png"')
  })

  it('removes the pending image if the upload rejects', async () => {
    const editor = makeEditor()
    const deps = makeDeps()
    let rejectUpload!: () => void
    const onImageUpload = vi.fn(() => new Promise<string>((_, reject) => { rejectUpload = reject }))
    const file = new File(['x'], 'a.png', { type: 'image/png' })

    insertImageWithUpload(editor, file, onImageUpload, deps)
    expect(editor.getHTML()).toContain('<img')

    rejectUpload()
    await Promise.resolve()
    await Promise.resolve()

    expect(editor.getHTML()).not.toContain('<img')
    expect(deps.revokeObjectUrl).toHaveBeenCalledTimes(1)
  })
})
