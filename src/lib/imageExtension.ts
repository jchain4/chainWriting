import TiptapImage from '@tiptap/extension-image'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    uploadableImage: {
      /** Insert an image node carrying a temporary `uploadId` marker. */
      insertPendingImage: (attrs: { src: string; alt?: string; uploadId: string }) => ReturnType
      /** Swap the pending image's `src` for the final URL and clear its `uploadId`. */
      resolveImageUpload: (uploadId: string, src: string) => ReturnType
      /** Remove a pending image node (e.g. because its upload failed). */
      rejectImageUpload: (uploadId: string) => ReturnType
    }
  }
}

/**
 * Extends the base Image node with an `uploadId` attribute so an
 * instantly-inserted local preview can be swapped for the real URL (or
 * removed on failure) once an async upload settles.
 */
export const UploadableImage = TiptapImage.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      uploadId: {
        default: null,
        renderHTML: (attrs: { uploadId: string | null }) =>
          attrs.uploadId ? { 'data-upload-id': attrs.uploadId } : {},
        parseHTML: (element: HTMLElement) => element.getAttribute('data-upload-id'),
      },
    }
  },

  addCommands() {
    return {
      ...this.parent?.(),

      insertPendingImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),

      // Re-scans the document for the node on every call rather than caching
      // a position: the user may edit before an async upload settles, and a
      // cached position would then point at the wrong node.
      resolveImageUpload:
        (uploadId, src) =>
        ({ tr, state, dispatch }) => {
          let pos: number | null = null
          state.doc.descendants((node, nodePos) => {
            if (pos !== null) return false
            if (node.type.name === this.name && node.attrs.uploadId === uploadId) {
              pos = nodePos
              return false
            }
            return true
          })
          if (pos === null) return false
          if (dispatch) {
            // Not a user edit — an undo landing right after the swap resolves
            // must not revert the node back to its local-preview/data: src and
            // re-arm its uploadId, which would look exactly like the upload
            // never happened (and re-persist that broken state on next save).
            tr.setNodeAttribute(pos, 'src', src).setNodeAttribute(pos, 'uploadId', null)
            tr.setMeta('addToHistory', false)
          }
          return true
        },

      rejectImageUpload:
        (uploadId) =>
        ({ tr, state, dispatch }) => {
          let pos: number | null = null
          let size = 0
          state.doc.descendants((node, nodePos) => {
            if (pos !== null) return false
            if (node.type.name === this.name && node.attrs.uploadId === uploadId) {
              pos = nodePos
              size = node.nodeSize
              return false
            }
            return true
          })
          if (pos === null) return false
          if (dispatch) {
            // Same reasoning as resolveImageUpload: an automatic removal
            // triggered by a failed upload isn't a user edit either.
            tr.delete(pos, pos + size)
            tr.setMeta('addToHistory', false)
          }
          return true
        },
    }
  },
})
