# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Rich content: images (by URL or file upload via a new `onImageUpload` prop) and tables, inserted via a `/` slash-command menu.
- Contextual table toolbar (add/remove row or column, delete table) shown whenever the cursor is inside a table.
- `--cw-table-border`, `--cw-table-header-bg`, `--cw-table-cell-selected-bg` theming tokens.
- Pasting HTML containing images or tables (e.g. from Google Docs) is now preserved instead of being flattened to plain text.
- `htmlToMarkdown` now converts images and tables to their Markdown equivalents.
- Accessibility: keyboard access to the bubble menu and table toolbar (Tab to enter, arrow keys to navigate, Escape to return), `aria-label`/`aria-pressed` on every toolbar/popover button, `role="textbox"` and a new `ariaLabel` prop on the editing surface, `role="listbox"`/`role="option"` with dynamic `aria-activedescendant` on the `/` command menu, a visible focus ring on the editor and all keyboard-focusable buttons, and an alt-text field in the image-insert popover.
- `jsx-a11y` oxlint rules enabled to catch accessibility regressions going forward.
- `getText()` — plain-text content extraction (no HTML/Markdown), preserving block boundaries as newlines.
- `getDocumentStats()` — word/character count, estimated reading time, and link/image/table counts from an HTML string.
- `getHeadingOutline()` — h1-h6 outline extraction (`{ level, text, id? }[]`) for building a table of contents.
- `editable` prop — reactive read-only/editable toggle, unlike the construction-only `extensions`/`initialContent` props.
- `onSelectionUpdate`, `onFocus`, `onBlur` props for reacting to editor lifecycle events from the host app.
- `createHighlightPlugin`/`setHighlightRanges` — a ProseMirror decoration plugin for highlighting arbitrary text ranges (e.g. AI style-check flags) as a pure visual overlay, registered post-mount via `getEditor()`. New `--cw-highlight-decoration` theming token.
- Bulleted and numbered lists added to the `/` command menu.
- `getTitle()`, `getExcerpt()`, `getFirstImage()` — article-metadata extraction (title, subtitle/excerpt, cover-image candidate) for handing content off to a publishing target.

### Fixed
- Tab could not move focus out of the editor outside of a list (a real WCAG 2.1.2 keyboard trap) — Tab now either enters a visible floating toolbar or leaves the editor normally.
- Toolbar/popover text contrast (`--cw-bubble-text`) raised to meet WCAG AA (4.5:1) against the default background.
- `htmlToMarkdown` no longer drops link URLs — `<a href>` now converts to `[text](href)` instead of losing the link entirely.
- `htmlToMarkdown` now numbers ordered lists (`1.`/`2.`/`3.`) instead of flattening them to unordered bullets.
- The bubble menu no longer appears when a non-text node (e.g. a horizontal rule) is selected — its formatting buttons don't apply to it.

### Documentation
- Noted that chain-writing does not sanitize HTML anywhere (`getHTML()`/`getJSON()`/`setContent()` are raw passthroughs) — sanitizing untrusted content before `setContent()` is the host's responsibility.

## [0.2.0] - 2026-08-23

### Added
- Imperative ref API (`EditorHandle`) — `focus()`, `getHTML()`, `getJSON()`, `setContent()`, `clear()`, `isReady()`, `getEditor()`, giving consumers a way to load new documents into a live editor without remounting.
- `extensions` prop — an escape hatch to pass extra Tiptap extensions (or reconfigure/replace built-in ones, e.g. `StarterKit.configure(...)`).
- SSR safety: `'use client'` directive and `immediatelyRender: false`, so the component can be imported into Next.js App Router / Astro without hydration warnings.
- Test suite (Vitest + Testing Library + jsdom) covering the `Editor` component and extension merging.
- CI pipeline (GitHub Actions) running lint, tests, and both builds on push/PR.
- OIDC Trusted Publisher-based release pipeline, publishing to npm with provenance on GitHub Release creation.

### Fixed
- npm package metadata: added `license`, `repository`, `homepage`, `bugs`, `author`, `keywords`, and `sideEffects` fields — fixes the package page incorrectly showing "Proprietary" instead of MIT.
- Library build no longer bundles demo-app-only assets (`favicon.svg`, `icons.svg`) into the published package.

## [0.1.0] - 2026-08-23

### Added
- Initial release: embeddable rich-text `Editor` React component built on Tiptap v3.
- Rich formatting: bold, italic, underline, strikethrough, headings (H2/H3), blockquote, code blocks.
- Smart typography (em dashes, curly quotes, ellipsis) via Tiptap Typography extension.
- Link support: inline popover (Ctrl+K or button), autolink, remove button.
- Bubble menu with frosted-glass design, appearing on text selection.
- Keyboard shortcuts: Ctrl+B/I/U, Ctrl+K, trapped Tab inside the editor.
- Typewriter mode (cursor stays vertically centered while typing).
- Theming via CSS variables on `.cw-editor`; typography inherited from host via `font: inherit`.
- Stateless design — no internal storage, `onChange` callback delivers HTML to the host app.
- `htmlToMarkdown`, `countWords`, `downloadMarkdown` utility exports.
