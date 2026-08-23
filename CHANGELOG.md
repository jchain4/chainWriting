# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]


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
