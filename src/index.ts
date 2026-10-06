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
// Exported so its commands' types (insertPendingImage, resolveImageUpload,
// rejectImageUpload on `editor.commands`) reach consumers' TypeScript, for
// hosts that build their own image-insertion flows on top of it.
export { UploadableImage } from './lib/imageExtension'
export { InsertionCursor } from './lib/insertionCursor'
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
export { BlockId, getBlocks, diffBlocks, DEFAULT_BLOCK_TYPES, BLOCK_ID_PATTERN } from './lib/blockId'
export type { Block, BlocksChange, BlockIdOptions } from './lib/blockId'
export { Annotations, setAnnotations, clearAnnotations, getAnnotations, findQuote } from './lib/annotations'
export type {
  Annotation, AnnotationStatus, ResolvedAnnotation, AnnotationsOptions, SetAnnotationsOptions, WhileEditing,
} from './lib/annotations'
export {
  Suggestions, addSuggestions, removeSuggestions, getSuggestions, acceptSuggestion, rejectSuggestion,
} from './lib/suggestions'
export type {
  Suggestion, ReplaceSuggestion, InsertAfterSuggestion, ResolvedSuggestion, SuggestionStatus, SuggestionsOptions,
} from './lib/suggestions'
export { createEditorTools } from './lib/agentTools'
export type {
  EditorTool, EditorToolName, EditorToolResult, EditorTools, EditorToolsOptions, EditorToolsSource, JsonSchemaObject,
} from './lib/agentTools'
