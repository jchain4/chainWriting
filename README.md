# chain-writing

[![npm version](https://img.shields.io/npm/v/chain-writing)](https://www.npmjs.com/package/chain-writing)
[![CI](https://img.shields.io/github/actions/workflow/status/jchain4/chainWriting/ci.yml?branch=main)](https://github.com/jchain4/chainWriting/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/chain-writing)](https://github.com/jchain4/chainWriting/blob/main/LICENSE)

Embeddable rich-text editor component for long-form writing. Built with Tiptap v3 + React 19, designed to integrate with any host app through CSS variables and a stateless `onChange` API.

## Features

- **Rich formatting** — bold, italic, underline, strikethrough, headings (H2/H3), blockquote, code blocks
- **Smart typography** — em dashes, curly quotes, ellipsis via Tiptap Typography extension
- **Link support** — inline popover (Ctrl+K or ↗ button), autolink, remove button
- **Bubble menu** — appears on text selection with animated frosted-glass design; self-formatting labels (B is bold, I is italic, etc.)
- **Keyboard shortcuts** — Ctrl+B/I/U, Ctrl+K for links, Tab jumps into the floating toolbar when one is visible (arrow keys to navigate, Escape to return)
- **Typewriter mode** — cursor stays vertically centered while typing
- **Rich content** — images (by URL or file upload) and tables, inserted via a `/` slash-command menu
- **Stateless** — Editor holds no storage; the host app receives HTML via `onChange`
- **Analyzable** — every block has a stable id; `getBlocks()` and `onBlocksChange` tell the host exactly what changed, for incremental analysis
- **Annotations** — mark text by content ("this phrase in this block"), in independent layers, with click/hover events; marks follow their text while the user edits
- **Suggestions** — propose changes shown track-changes style, which the user accepts or rejects
- **LLM-ready, LLM-agnostic** — `createEditorTools()` gives your own model MCP-shaped tools to read, annotate and propose edits; the editor itself never calls any model or service
- **Themeable** — all visual tokens as CSS variables on `.cw-editor`; typography inherited from host via `font: inherit`

## Install

```bash
npm install chain-writing
# or
pnpm add chain-writing
```

`chain-writing` builds on Tiptap v3 and React — install the required peers alongside it (versions per the `peerDependencies` in `package.json`):

```bash
npm install @tiptap/react @tiptap/core @tiptap/pm @tiptap/starter-kit \
  @tiptap/extension-link @tiptap/extension-underline \
  @tiptap/extension-placeholder @tiptap/extension-typography \
  @tiptap/extension-image @tiptap/extension-table \
  @tiptap/extension-table-row @tiptap/extension-table-cell \
  @tiptap/extension-table-header @tiptap/suggestion
```

## Usage

```tsx
import { Editor } from 'chain-writing'
import 'chain-writing/style.css'

function App() {
  return (
    <Editor
      initialContent="<p>Hello</p>"
      placeholder="Start writing…"
      onChange={(html) => console.log(html)}
    />
  )
}
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `initialContent` | `string` | `''` | Initial HTML content. Read once at construction — see "Imperative API" to load new content later |
| `placeholder` | `string` | `'Start writing…'` | Placeholder text when empty |
| `typewriterMode` | `boolean` | `false` | Keep cursor vertically centered |
| `className` | `string` | — | Extra class on `.cw-editor` for scoped CSS variable overrides |
| `extensions` | `AnyExtension[]` | — | Extra Tiptap extensions merged into the built-in set — see "Customizing extensions" |
| `editable` | `boolean` | `true` | Whether the editor accepts input. Reactive — unlike `extensions`/`initialContent`, toggling this after mount live-updates the editor |
| `onChange` | `(html: string) => void` | — | Called on every content change |
| `onSelectionUpdate` | `(editor: Editor) => void` | — | Called whenever the selection changes |
| `onFocus` | `(editor: Editor, event: FocusEvent) => void` | — | Called when the editor gains focus |
| `onBlur` | `(editor: Editor, event: FocusEvent) => void` | — | Called when the editor loses focus |
| `onImageUpload` | `(file: File) => Promise<string>` | — | Enables file-based image insertion — see "Rich content" |
| `onReady` | `(blocks: Block[]) => void` | — | Called once, when the editor has mounted and every block has its id — see "When is the editor ready?" |
| `onBlocksChange` | `(change: BlocksChange) => void` | — | Called after each edit with the ids of added/changed/removed blocks — see "Blocks" |
| `onAnnotationClick` | `(annotations: ResolvedAnnotation[], event: MouseEvent) => void` | — | Click on annotated text — see "Annotations" |
| `onAnnotationHover` | `(annotations: ResolvedAnnotation[], event: MouseEvent) => void` | — | Pointer entering/leaving annotated text (`[]` on leave) — see "Annotations" |
| `onAnnotationStatusChange` | `(annotations: ResolvedAnnotation[]) => void` | — | Annotations that became `stale` or `active` again after an edit — see "Annotations" |
| `showSuggestionControls` | `boolean` | `true` | Show ✓/✕ buttons next to suggestions. Read once at construction — see "Suggestions" |
| `onSuggestionAccept` | `(suggestion: ResolvedSuggestion) => void` | — | A suggestion was accepted — see "Suggestions" |
| `onSuggestionReject` | `(suggestion: ResolvedSuggestion) => void` | — | A suggestion was rejected — see "Suggestions" |
| `onSuggestionStatusChange` | `(suggestions: ResolvedSuggestion[]) => void` | — | Suggestions that became `stale` or `active` again after an edit — see "Suggestions" |
| `ariaLabel` | `string` | falls back to `placeholder` | Accessible name for the editing surface — see "Accessibility" |
| `ref` | `Ref<EditorHandle>` | — | Imperative handle — see "Imperative API" |

## Imperative API

`Editor` forwards a ref exposing an `EditorHandle`:

```tsx
import { useRef } from 'react'
import { Editor, type EditorHandle } from 'chain-writing'

function App() {
  const editorRef = useRef<EditorHandle>(null)

  function loadDocument(html: string) {
    // Replaces the whole document without remounting the editor —
    // this is the correct replacement for remounting via key={doc.id}.
    editorRef.current?.setContent(html, { emitUpdate: false })
  }

  return <Editor ref={editorRef} onChange={(html) => {/* ... */}} />
}
```

| Method | Description |
|--------|-------------|
| `focus()` | Focus the editor |
| `getHTML()` | Current content as HTML |
| `getJSON()` | Current content as Tiptap JSON |
| `setContent(content, options?)` | Replace the whole document — the correct way to load new content into a live editor |
| `clear()` | Clear the whole document |
| `isReady()` | Whether the editor has mounted and every block has its id (the moment `onReady` fires) |
| `getEditor()` | Escape hatch — the raw Tiptap `Editor` instance, `null` until mounted |
| `getBlocks(ids?)` | The document as a list of blocks with stable ids — or just the given ones — see "Blocks" |
| `setAnnotations(layer, annotations, options?)` | Mark text by content in a named layer, replacing that layer — see "Annotations" |
| `clearAnnotations(layer?)` | Remove one layer's annotations, or all of them |
| `getAnnotations(layer?)` | Current annotations (active and stale) |
| `addSuggestions(suggestions)` | Propose changes, shown track-changes style — see "Suggestions" |
| `acceptSuggestion(id)` / `rejectSuggestion(id)` | Apply or discard a suggestion |
| `removeSuggestions(ids?)` | Withdraw suggestions silently (all when omitted) |
| `getSuggestions()` | Current suggestions (active and stale) |

There is no reactive `content` prop: Tiptap never re-parses content on prop changes, so pushing new content into a live editor always goes through `ref.current.setContent(...)`. The `editable` prop is the one exception to this construction-only rule — it's designed to be toggled live (e.g. a read-only "review" mode), so it's synced reactively on every render rather than only read once.

**chain-writing does not sanitize HTML anywhere** — `getHTML()`/`getJSON()` return exactly what's in the document, and `setContent()` is a raw passthrough with no XSS filtering. If you load HTML from an untrusted source (another user's document, a third-party API) and feed it back in via `setContent()`, sanitize it yourself first (e.g. with [DOMPurify](https://github.com/cure53/DOMPurify)).

## Customizing extensions

Pass extra Tiptap extensions via the `extensions` prop — they're merged into the built-in set (StarterKit + link/underline config, Placeholder, Typography). An extension whose name matches a built-in one (e.g. a reconfigured `StarterKit`) replaces it entirely:

```tsx
import StarterKit from '@tiptap/starter-kit'
import { Editor } from 'chain-writing'
import { MyMention } from './my-mention'

// Add a custom mark/node
<Editor extensions={[MyMention]} />

// Reconfigure or disable parts of StarterKit
<Editor extensions={[StarterKit.configure({ heading: false, codeBlock: false })]} />
```

`extensions` (like `initialContent`) is read once at construction — changing it after the first render has no effect on the live editor.

## Rich content

Type `/` at the start of an empty line to open a command menu: **Encabezado** (H1/H2/H3, in a submenu), **Lista**, **Lista numerada**, **Cita**, **Enlace**, **Imagen**, and **Tabla**.

**Images** can always be inserted by URL. To also enable inserting from a local file (via the upload button in the image popover, or by dragging/pasting an image file directly into the editor), pass `onImageUpload`:

```tsx
<Editor
  onImageUpload={async (file) => {
    const url = await myUploadToS3(file) // upload however you like
    return url
  }}
/>
```

The image is inserted immediately with a local preview and swapped for the real URL once the promise resolves (or removed if it rejects). Without `onImageUpload`, dropped/pasted image files are ignored rather than silently embedded as base64 — only URL-based insertion works.

Pasted HTML containing images (e.g. from Google Docs) is parsed independently of `onImageUpload`, since it arrives as `<img>` markup rather than a raw file. Word's clipboard often references images by local file path, which won't resolve in the browser — the rest of a Word paste (text, tables) is unaffected.

`UploadableImage` (the image node behind this) is exported, together with its commands' types — `editor.commands.insertPendingImage({ src, alt?, uploadId })`, `resolveImageUpload(uploadId, src)` and `rejectImageUpload(uploadId)` — for hosts building their own insertion flow (e.g. a custom paste handler) on top of the same preview-then-swap mechanism.

After an image or horizontal rule is inserted — pasted, picked from the `/` menu, or uploaded — the cursor lands on the first text position after it (opening an empty paragraph there if there's none), so the next keystroke continues the text instead of replacing the node. Clicking a node, dropping a dragged one, and undo/redo still select it as before. To keep inserted nodes selected instead, override the `InsertionCursor` extension by name: `extensions={[Extension.create({ name: 'insertionCursor' })]}`.

**Tables** come with a small contextual toolbar (add/remove row or column, delete table) that appears whenever the cursor is inside one.

## Content export & document stats

These all operate on plain HTML strings — the same string `onChange`/`getHTML()` produce — so they work without a live `Editor` instance (e.g. server-side, on content loaded from storage):

| Function | Description |
|----------|-------------|
| `htmlToMarkdown(html)` | Converts to Markdown (GFM-flavored: fenced code, pipe tables, strikethrough, numbered lists, links) |
| `getText(html)` | Plain text, no HTML/Markdown — one line per block (paragraph, heading, list item, etc.) |
| `countWords(html)` | Word count. Kept for backward compatibility — `getDocumentStats` is the richer superset below |
| `getDocumentStats(html, options?)` | `{ words, characters, charactersNoSpaces, readingTimeMinutes, links, images, tables }`. `options.wordsPerMinute` defaults to `200` |
| `getHeadingOutline(html)` | `{ level, text, id? }[]` for every h1-h6, in document order — useful for a table of contents. `id` is only set if already present in the HTML; no slugs are generated |
| `getTitle(html, options?)` | First heading's text, or the first paragraph truncated to `options.maxLength` (default `50`). `undefined` if neither is found — no locale-specific fallback string |
| `getExcerpt(html, options?)` | Plain-text excerpt collapsed to one line, truncated at a word boundary to `options.maxLength` (default `200`). Always a string (`''` for an empty document) |
| `getFirstImage(html)` | `src` of the first `<img>` in the document — a cover-image candidate — or `undefined` |
| `downloadMarkdown(title, html)` | Browser-only: triggers a `.md` file download. Call it from an event handler, not during SSR render |

```tsx
import { getDocumentStats, getHeadingOutline } from 'chain-writing'

const stats = getDocumentStats(html)
// { words: 128, characters: 612, ..., readingTimeMinutes: 1, links: 2, images: 1, tables: 0 }

const outline = getHeadingOutline(html)
// [{ level: 1, text: 'Introduction' }, { level: 2, text: 'Details' }, ...]
```

## Preparing content for publishing

`getHTML()` is already portable, publish-ready HTML: no `cw-*` classes or wrapper markup ever land inside the document content (those only exist on toolbar/menu/popover UI elements, never on ProseMirror nodes), and images inserted via `onImageUpload` carry the real uploaded URL rather than an embedded blob/base64 string. That means the raw output of `getHTML()` can go straight into a blogging platform's API (WordPress, Ghost, Medium, …) without any cleanup step.

`getTitle`, `getExcerpt`, and `getFirstImage` (above) fill in the metadata those APIs typically ask for alongside the body: a title, an excerpt/subtitle, and a featured/cover image.

```tsx
const html = editorRef.current!.getHTML()
const post = {
  title: getTitle(html) ?? 'Untitled',
  excerpt: getExcerpt(html),
  coverImage: getFirstImage(html),
  html,
}
```

chain-writing's job stops at producing this clean content — authenticating with a platform and calling its API is the host application's responsibility, not this library's.

## Blocks: stable ids and change tracking

Every block of the document — paragraphs, headings, code blocks, images, horizontal rules — carries a stable id. It survives edits anywhere else in the document, undo/redo, and saving/reloading (it's rendered as `data-block-id` in `getHTML()` and kept in `getJSON()`, so persisting either one keeps ids stable across sessions). This gives the host app — or an LLM it chooses to wire in — a reliable way to say "this paragraph" that doesn't break as the user keeps typing. The editor itself never calls any external service.

```tsx
<Editor
  ref={editorRef}
  onBlocksChange={({ blocks, removed, version }) => {
    // `blocks` = the added and updated blocks, already extracted: re-analyze
    // only these (e.g. send them to your own backend), drop results for `removed`.
  }}
/>
```

`onBlocksChange` receives `{ added, updated, removed, blocks, version }`: the ids of each kind of change, plus `blocks` — the added and updated blocks themselves, in reading order — so incremental analysis never has to read the whole document. To read specific blocks at any other time, pass their ids: `getBlocks(['k3f9a1x2', 'p0d81mzq'])` returns just those, in reading order, extracting only their text.

`getBlocks()` returns blocks in reading order:

```ts
{ id: 'k3f9a1x2', type: 'heading', text: 'Title', attrs: { level: 2 }, ancestors: [] }
{ id: 'p0d81mzq', type: 'paragraph', text: 'An item', attrs: {}, ancestors: ['bulletList', 'listItem'] }
```

- **`updated`** means the block's own text, formatting or attributes changed — moving a block or wrapping it in a list doesn't count.
- **Enter** keeps the id with the text: splitting in the middle or at the end leaves it on the first half, while Enter at the very start (opening a line above) leaves it on the text, not the new empty line. A **pasted copy** of an existing block gets a fresh id; changing a block's type (paragraph → heading, code block…) or wrapping it in a list keeps it.
- **`version`** increases on every document change. If you send blocks off for slow (async) analysis, compare versions when the result comes back to tell whether the document has moved on meanwhile.
- Ids are assigned right after mount without counting as an edit: no `onChange`/`onBlocksChange` call and no undo step. Content loaded without ids (or via `setContent`) gets fresh random ones.

**Id format.** Default ids are 8 characters of `[0-9a-z]` (e.g. `k3f9a1x2`). Every id — default, custom, loaded or pasted — matches `BLOCK_ID_PATTERN` (exported): 1–64 ASCII letters, digits, `_` or `-`. Ids that don't (malformed values in loaded HTML/JSON or pasted from elsewhere) are replaced with fresh ones, and a custom `generateId` that keeps returning malformed or repeated ids falls back to default ids with a one-time warning.

**If you sanitize HTML** before saving it, allow `data-block-id` on block elements (`p`, `h1`–`h6`, `pre`, `img`, `hr`), restricted to that same pattern — e.g. with OWASP Java HTML Sanitizer: `.allowAttributes("data-block-id").matching(Pattern.compile("[A-Za-z0-9_-]{1,64}")).onElements("p", "h1", "h2", "h3", "pre", "img", "hr")`. If the attribute is stripped, documents still work, but every load gets new random ids — so anything you stored by block id (annotations, comments, analysis results) stops matching after a reload.

The tracked node types and the id generator are configurable by passing your own `BlockId.configure({ types, generateId, onBlocksChange })` via the `extensions` prop (it replaces the built-in one, so wire `onBlocksChange` there instead of on the prop). `getBlocks(doc, types?, ids?)` and `diffBlocks(oldDoc, newDoc)` are also exported as standalone functions over a ProseMirror document.

### When is the editor ready?

The editor mounts asynchronously (it's SSR-safe, so it isn't created during render), and block ids are assigned right after that. Anything that refers to blocks — `setAnnotations()`, `addSuggestions()` — must wait until then, or it finds nothing. Use `onReady`, which fires once with the initial blocks, instead of polling:

```tsx
<Editor
  ref={editorRef}
  initialContent={html}
  onReady={(blocks) => {
    // The ref handle is already usable here.
    editorRef.current!.setAnnotations('readability', analyze(blocks))
  }}
/>
```

Calling `setAnnotations()`/`addSuggestions()` before that logs a one-time `console.warn`, since otherwise they'd silently have no effect.

## Annotations: marking text by content

Annotations let the host app — or an LLM it chooses to wire in — mark text by *what it says* rather than by position: "the phrase `quote` in block `blockId`" (block ids come from `getBlocks()`). That's exactly the kind of reference an LLM can produce reliably. Like highlights, annotations are a pure overlay: never in `getHTML()`/`getJSON()`, never an undo step.

```tsx
const results = editorRef.current!.setAnnotations('style', [
  { id: 'r1', blockId: 'k3f9a1x2', quote: 'muy muy', kind: 'repetition', title: 'Repetición', data: { fix: 'muy' } },
  { id: 'c1', blockId: 'p0d81mzq' }, // no quote: annotates the whole block
])
// results[i].status is 'active' (found and marked) or 'stale' (block/quote not found)

<Editor
  ref={editorRef}
  onAnnotationClick={(annotations, event) => openPanel(annotations[0].data)}
  onAnnotationHover={(annotations) => setHovered(annotations)}
  onAnnotationStatusChange={(changed) => { /* e.g. drop issues the user already fixed */ }}
/>
```

- **Layers** (`'spelling'`, `'style'`, `'comments'`…) are independent: `setAnnotations(layer, list)` replaces only that layer; `clearAnnotations(layer?)` removes one or all.
- **Repeated phrases**: pass `prefix`/`suffix` (the text right before/after) to pick the right occurrence. Context needn't match exactly: it's scored by how many characters match, counted outwards from the quote, and the best-scoring occurrence wins. On a tie — or with no context at all — a whole-word occurrence wins (`"casa"` matches the word *casa*, not the start of *casas*, unless no whole-word *casa* exists), then the first one. The same matcher is exported as `findQuote(text, quote, prefix?, suffix?)`.
- **While the user edits**, annotations follow their text — through typing elsewhere, Enter, and joining paragraphs (their `blockId` is updated if the text moves to another block). Typing right at the edge of a marked phrase doesn't stretch the mark.
- **Stale**: when the marked text itself changes or disappears (e.g. the user rewrote the flagged phrase), the annotation becomes `stale` — unmarked, but kept. If the text comes back (undo, or retyped), it becomes `active` again. Both transitions are reported through `onAnnotationStatusChange`; changes caused by the host's own `setAnnotations`/`clearAnnotations` calls aren't.
- **Layers you recompute anyway**: pass `{ whileEditing: 'track' }` — `setAnnotations('readability', list, { whileEditing: 'track' })` — and that layer's marks stretch or shrink as the user edits *inside* them, staying active with their `quote` updated to the new text, instead of turning stale and flickering until your next recompute. They still turn stale if all their text is deleted or Enter splits it across blocks. The mode sticks to the layer (later `setAnnotations` calls without options keep it) until you pass `'stale'` or clear the layer.
- **Events**: `onAnnotationClick` receives every active annotation under the click (they can overlap) and never prevents normal cursor placement. `onAnnotationHover` fires once per change, with `[]` when the pointer leaves.
- **Styling**: inline marks get `.cw-annotation` and `.cw-annotation--{kind}`; whole-block ones `.cw-annotation-block` and `.cw-annotation-block--{kind}`; plus your own `className`. Default tokens: `--cw-annotation-bg`, `--cw-annotation-decoration`, `--cw-annotation-block-border`.

Outside React, the same operations are exported as `setAnnotations(editor, layer, list)`, `clearAnnotations(editor, layer?)` and `getAnnotations(editor, layer?)` over the raw Tiptap editor, plus the `Annotations` extension and the `findQuote` matcher.

## Suggestions: proposed changes the user accepts or rejects

Suggestions let the host app — or an LLM it chooses to wire in — *propose* changes without making them. They're shown track-changes style (removed text struck through, new text highlighted), and nothing in the document changes until the user accepts one. Like annotations, they're anchored by content, using block ids from `getBlocks()`.

```tsx
editorRef.current!.addSuggestions([
  // Replace a phrase (an empty replacement deletes it)
  { type: 'replace', id: 's1', blockId: 'k3f9a1x2', quote: 'muy muy importante', replacement: 'crucial', title: 'Más conciso' },
  // Add paragraphs after a block — one paragraph per non-empty line
  { type: 'insertAfter', id: 's2', blockId: 'p0d81mzq', text: 'Una conclusión propuesta.' },
])

<Editor
  ref={editorRef}
  onSuggestionAccept={(s) => log('accepted', s.id)}
  onSuggestionReject={(s) => log('rejected', s.id)}
  onSuggestionStatusChange={(changed) => { /* e.g. ask the LLM again for the stale ones */ }}
/>
```

- **Accepting**: the ✓ button, **Alt+Enter** with the cursor inside the suggestion (or inside the block of an `insertAfter`), or `acceptSuggestion(id)`. It's a single undo step and keeps the formatting of the replaced text. Accepted paragraphs get fresh block ids (and show up in `onBlocksChange`). Undoing an accepted change restores the text, but not the suggestion.
- **Rejecting**: the ✕ button, **Alt+Shift+Enter**, or `rejectSuggestion(id)`. The document isn't touched. `removeSuggestions(ids?)` withdraws suggestions silently, without firing accept/reject events.
- **While the user edits**, suggestions follow their text like annotations do. If the user changes the text a suggestion would replace, it becomes `stale`: it's hidden and can't be accepted, so a proposal is never applied to text it wasn't written for. It becomes `active` again if the text comes back (e.g. undo). Accepting one suggestion can make overlapping ones stale.
- **Your own UI**: set `showSuggestionControls={false}` to hide the buttons and drive everything through `getSuggestions()`/`acceptSuggestion()`/`rejectSuggestion()` — e.g. from a side panel. Buttons are hidden automatically while the editor is read-only (`editable={false}`); `acceptSuggestion()` still works programmatically.
- **Styling**: `.cw-suggestion-delete` (a `<del>`), `.cw-suggestion-insert` (an `<ins>`), `.cw-suggestion-block`, `.cw-suggestion-controls`, and the tokens `--cw-suggestion-delete-color`, `--cw-suggestion-delete-bg`, `--cw-suggestion-insert-color`, `--cw-suggestion-insert-bg`.

Outside React, the same operations are exported as `addSuggestions(editor, list)`, `acceptSuggestion(editor, id)`, `rejectSuggestion(editor, id)`, `removeSuggestions(editor, ids?)` and `getSuggestions(editor)`, plus the `Suggestions` extension.

## Connecting an LLM: tools for the model

chain-writing never talks to any model or service — but it ships the "instruction manual" an LLM needs to work with the document. `createEditorTools()` returns tool definitions in the shape of [MCP](https://modelcontextprotocol.io) tools (`name`, `title`, `description`, `inputSchema`, `annotations`) plus an `execute` function that runs the calls the model makes and returns MCP-shaped results (`content`, `structuredContent`, `isError`). Which model to use, where it runs, and whether to offer it at all is entirely the host app's decision.

| Tool | What the model can do | Changes the text? |
|------|-----------------------|-------------------|
| `read_document` | Read the document, one `[blockId] type: "text"` line per block (optionally only some blocks) | No |
| `get_selection` | Read what the user has selected, or where the cursor is | No |
| `annotate` | Highlight phrases (or whole blocks) with a note for the user | No |
| `remove_annotations` | Remove its own annotations | No |
| `suggest_edits` | Propose replacing or deleting phrases | Only if the user accepts |
| `suggest_insert` | Propose new paragraphs after a block | Only if the user accepts |
| `withdraw_suggestions` | Withdraw its own pending suggestions | No |

There is deliberately no tool to edit the document directly: the model only ever *proposes*, and the user decides. A suggestion whose text the user changed meanwhile can't be accepted (see "Suggestions"), so the model never overwrites text it didn't read.

```ts
import { createEditorTools } from 'chain-writing'

const { tools, execute } = createEditorTools(() => editorRef.current, {
  include: ['read_document', 'get_selection', 'suggest_edits'], // optional subset
})

// 1. Send `tools` to your LLM, in its API's format — e.g. through your own backend:
//    Anthropic Messages API: tools.map(({ name, description, inputSchema }) => ({ name, description, input_schema: inputSchema }))
//    OpenAI-style function calling: tools.map(({ name, description, inputSchema }) => ({ type: 'function', function: { name, description, parameters: inputSchema } }))
// 2. For each tool call the model makes, run it and send the result back:
const result = execute(call.name, call.input)
```

- `execute` never throws: unknown tools, malformed input and an unmounted editor all come back as `isError` results whose text tells the model what to fix. When a quote isn't found, the result says so (`not_found`) and tells the model to re-read the document.
- Everything the tools create is tagged as the model's: annotations go to their own layer (`annotationLayer`, default `"assistant"`), ids get a prefix (`idPrefix`, default `"assistant-"`), and `data.source` is `"assistant"`. `remove_annotations` and `withdraw_suggestions` only ever touch the model's own items, never the host's.
- `read_document` reports the document `version` (see "Blocks"), so the host can tell whether the user kept typing while the model was thinking.
- **MCP**: since the definitions and results already follow MCP's shapes, exposing them through an MCP server (e.g. in your own backend, relaying calls to the open editor) — or a browser-side protocol such as WebMCP — is a matter of forwarding `tools` and `execute`. chain-writing itself never opens a server or a connection.

## Highlighting text ranges (e.g. AI style-check flags)

> For new code, prefer **Annotations** (above): they're anchored by content, so they can be produced without knowing document positions and survive edits that change the marked text's position.

`createHighlightPlugin`/`setHighlightRanges` give an AI integration (or any external analysis) a way to highlight arbitrary text ranges — flagged phrases, suggestions, comments — as a pure overlay: highlights never appear in `getHTML()`/`getJSON()` output and never add undo-history entries, since they're ProseMirror decorations, not document content.

```tsx
import { useEffect, useRef } from 'react'
import { PluginKey } from '@tiptap/pm/state'
import { Editor, createHighlightPlugin, setHighlightRanges, type EditorHandle } from 'chain-writing'

const styleCheckKey = new PluginKey('style-check')

function MyEditor() {
  const editorRef = useRef<EditorHandle>(null)

  useEffect(() => {
    const editor = editorRef.current?.getEditor()
    if (!editor) return

    editor.registerPlugin(createHighlightPlugin(styleCheckKey))
    return () => { editor.unregisterPlugin(styleCheckKey) }
  }, [editorRef.current?.isReady()])

  function applyFlags(flags: { id: string; from: number; to: number; message: string }[]) {
    const editor = editorRef.current?.getEditor()
    if (!editor) return
    setHighlightRanges(editor, styleCheckKey, flags.map((f) => ({
      id: f.id, from: f.from, to: f.to, title: f.message,
    })))
  }

  return <Editor ref={editorRef} />
}
```

Ranges remap automatically as the document is edited elsewhere, so a highlight stays attached to the right text even after unrelated typing. Pass `[]` to `setHighlightRanges` to clear. Default styling is one CSS variable, `--cw-highlight-decoration` (a wavy underline) — override it, or target `.cw-highlight-range` / `[data-highlight-id]` directly for a different treatment.

## Server-side rendering / Next.js

The component already includes a `'use client'` directive and sets `immediatelyRender: false` internally, so it's safe to import into an SSR framework (Next.js App Router, Astro, etc.) without hydration warnings — just make sure it's rendered from within a client boundary, and import `chain-writing/style.css` once (e.g. in the root layout).

## Theming

Override any CSS variable on `.cw-editor` or a parent selector:

```css
.my-wrapper .cw-editor {
  --cw-bubble-bg:       rgba(255, 255, 255, 0.92);
  --cw-bubble-text:     rgba(0, 0, 0, 0.5);
  --cw-link-color:      #4f46e5;
  --cw-placeholder-color:   currentColor;
  --cw-placeholder-opacity: 0.3;
  --cw-table-border:           rgba(0, 0, 0, 0.12);
  --cw-table-header-bg:        rgba(0, 0, 0, 0.04);
  --cw-table-cell-selected-bg: rgba(99, 102, 241, 0.15);
}
```

Full token list is in `src/editor.css`.

## Accessibility

This section documents specific, fixed gaps — it isn't a formal WCAG conformance statement.

**Keyboard**: Tab/Shift-Tab move focus into and out of the editor normally — the editor never traps keyboard focus. When the bubble menu or the table toolbar is visible, Tab moves focus into it instead (the same convention used by Medium and similar contextual-toolbar editors); arrow keys (plus Home/End) navigate between its buttons (WAI-ARIA APG "Toolbar" pattern), and Escape returns focus to the editor at the same cursor position. A further Tab from inside the toolbar continues to the next focusable element on the page rather than being trapped. Ctrl+B/I/U and Ctrl+K work regardless of whether a toolbar is focused.

**Screen readers**: the editing surface exposes `role="textbox"` and `aria-multiline="true"`, with its accessible name coming from the `ariaLabel` prop (falling back to `placeholder`). Every icon/glyph-only button (bold, italic, headings, table actions, link/image popovers, etc.) has a real `aria-label` rather than relying on its visible glyph or `title`; the 8 text-formatting toggle buttons also expose `aria-pressed`. The floating toolbars are `role="toolbar"`. The `/` command menu exposes `role="listbox"`/`role="option"` with a dynamic `aria-activedescendant` on the editing surface itself, since focus stays there while you type — this is a pragmatic pattern (the same one used by several `@`-mention-style autocompletes over `contenteditable`), not a strict ARIA 1.2 `combobox`, so a strict validator may flag the `role="textbox"` + `aria-expanded` pairing even though it works well with NVDA/JAWS/VoiceOver in practice.

**Color contrast & focus**: default toolbar text meets WCAG AA (≥4.5:1) against the default dark bubble background; the editing surface and every keyboard-focusable button show a visible focus ring (`--cw-focus-ring`, themeable like the rest of the tokens).

**Images**: the image-insert popover has an alt-text field (optional — an empty value correctly marks the image as decorative rather than being forced non-empty).

## Development

```bash
pnpm install
pnpm dev          # demo app at localhost:5173
pnpm test         # run the test suite
pnpm build:lib    # builds library to dist/
```

The repo serves two purposes:

- **`src/components/Editor.tsx` + `src/editor.css`** — the library
- **`src/App.tsx` + `src/index.css`** — a demo app that uses the library (autosave to IndexedDB, sidebar, word count, focus mode, Markdown export)

## Stack

- Vite 8 + React 19 + TypeScript 6
- Tiptap v3 (StarterKit, Placeholder, Typography, Image, Table, Suggestion)
- idb-keyval (demo app only)

## Roadmap

- **Framework-agnostic embed** — a Web Component wrapper so non-React sites (plain HTML, PHP, WordPress, etc.) can embed the editor via a `<script>` tag. Not built yet; the library is React-only today.
