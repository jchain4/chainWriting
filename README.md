# chain-writing

Embeddable rich-text editor component for long-form writing. Built with Tiptap v3 + React 19, designed to integrate with any host app through CSS variables and a stateless `onChange` API.

## Features

- **Rich formatting** — bold, italic, underline, strikethrough, headings (H2/H3), blockquote, code blocks
- **Smart typography** — em dashes, curly quotes, ellipsis via Tiptap Typography extension
- **Link support** — inline popover (Ctrl+K or ↗ button), autolink, remove button
- **Bubble menu** — appears on text selection with animated frosted-glass design; self-formatting labels (B is bold, I is italic, etc.)
- **Keyboard shortcuts** — Ctrl+B/I/U, Ctrl+K for links, Tab trapped inside editor
- **Typewriter mode** — cursor stays vertically centered while typing
- **Stateless** — Editor holds no storage; the host app receives HTML via `onChange`
- **Themeable** — all visual tokens as CSS variables on `.cw-editor`; typography inherited from host via `font: inherit`

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
| `initialContent` | `string` | `''` | Initial HTML content |
| `placeholder` | `string` | `'Start writing…'` | Placeholder text when empty |
| `typewriterMode` | `boolean` | `false` | Keep cursor vertically centered |
| `className` | `string` | — | Extra class on `.cw-editor` for scoped CSS variable overrides |
| `onChange` | `(html: string) => void` | — | Called on every content change |

### Theming

Override any CSS variable on `.cw-editor` or a parent selector:

```css
.my-wrapper .cw-editor {
  --cw-bubble-bg:       rgba(255, 255, 255, 0.92);
  --cw-bubble-text:     rgba(0, 0, 0, 0.5);
  --cw-link-color:      #4f46e5;
  --cw-placeholder-color:   currentColor;
  --cw-placeholder-opacity: 0.3;
}
```

Full token list is in `src/editor.css`.

## Development

```bash
pnpm install
pnpm dev          # demo app at localhost:5173
pnpm build:lib    # builds library to dist/
```

The repo serves two purposes:

- **`src/components/Editor.tsx` + `src/editor.css`** — the library
- **`src/App.tsx` + `src/index.css`** — a demo app that uses the library (autosave to IndexedDB, sidebar, word count, focus mode, Markdown export)

## Stack

- Vite 8 + React 19 + TypeScript 6
- Tiptap v3 (StarterKit, Placeholder, Typography)
- idb-keyval (demo app only)
