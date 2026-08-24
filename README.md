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
| `isReady()` | Whether the underlying Tiptap editor has mounted |
| `getEditor()` | Escape hatch — the raw Tiptap `Editor` instance, `null` until mounted |

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

## Highlighting text ranges (e.g. AI style-check flags)

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
