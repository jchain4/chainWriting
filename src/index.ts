// Plain (non-type-only) imports: these packages' own `declare module
// '@tiptap/core'` augmentations (setImage, insertTable, addRowAfter, etc.
// on `editor.commands`/`editor.chain()`) are otherwise invisible to a
// consumer's TypeScript program unless it imports one of these packages
// itself — but Editor bundles them by default (not opt-in), so their
// command types should be available out of the box via `getEditor()` too.
// A `import type {}`/triple-slash reference gets elided from the emitted
// .d.ts (nothing structurally depends on it), so this uses a real import —
// harmless here since Editor.tsx already imports and uses all three for
// real; this just adds one redundant (idempotent, externalized) import.
import '@tiptap/extension-image'
import '@tiptap/extension-table'
import '@tiptap/suggestion'

export { Editor } from './components/Editor'
export type { EditorProps, EditorHandle } from './components/Editor'
export {
  htmlToMarkdown,
  getText,
  getTitle,
  getExcerpt,
  getFirstImage,
  countWords,
  getDocumentStats,
  getHeadingOutline,
  downloadMarkdown,
} from './lib/exportMarkdown'
export type { DocumentStats, HeadingOutlineItem } from './lib/exportMarkdown'
export { createHighlightPlugin, setHighlightRanges } from './lib/highlightPlugin'
export type { HighlightRange } from './lib/highlightPlugin'
