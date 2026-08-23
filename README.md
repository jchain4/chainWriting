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
- **Keyboard shortcuts** — Ctrl+B/I/U, Ctrl+K for links, Tab trapped inside editor
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
| `onChange` | `(html: string) => void` | — | Called on every content change |
| `onImageUpload` | `(file: File) => Promise<string>` | — | Enables file-based image insertion — see "Rich content" |
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

There is no reactive `content` prop: Tiptap never re-parses content on prop changes, so pushing new content into a live editor always goes through `ref.current.setContent(...)`.

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

Type `/` at the start of an empty line to open a command menu with two entries: **Imagen** and **Tabla**.

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
