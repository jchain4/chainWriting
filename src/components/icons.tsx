import type { SVGProps } from 'react'

// Small inline icons for the "/" command menu. No icon library dependency —
// the text-glyph icons (headings/quote) reuse the exact self-formatting-label
// language already established by the bubble menu's own buttons (see
// .cw-bubble-menu button[data-format="..."] in editor.css); the rest
// (link/image/table/lists) get genuine pictorial line icons, since those
// don't have a natural single-character representation.
//
// Inline text-formatting toggles (bold/italic/underline/strike) live only in
// the bubble menu, not here — the "/" menu is reserved for inserting
// structural/content elements, not applying marks to text.

function GlyphIcon({ children, fontSize = 11, ...textProps }: {
  children: string
  fontSize?: number
} & Omit<SVGProps<SVGTextElement>, 'children'>) {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
      <text x="9" y="13" textAnchor="middle" fontSize={fontSize} fill="currentColor" {...textProps}>
        {children}
      </text>
    </svg>
  )
}

export function IconHeading1() {
  return <GlyphIcon fontSize={9} fontWeight={600}>H1</GlyphIcon>
}

export function IconHeading2() {
  return <GlyphIcon fontSize={9} fontWeight={600}>H2</GlyphIcon>
}

export function IconHeading3() {
  return <GlyphIcon fontSize={9} fontWeight={600}>H3</GlyphIcon>
}

export function IconHeadings() {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="3" y1="5" x2="15" y2="5" />
      <line x1="3" y1="9" x2="12" y2="9" />
      <line x1="3" y1="13" x2="9" y2="13" />
    </svg>
  )
}

export function IconBulletList() {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="3" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="3" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="3" cy="13" r="1" fill="currentColor" stroke="none" />
      <line x1="7" y1="5" x2="15" y2="5" />
      <line x1="7" y1="9" x2="15" y2="9" />
      <line x1="7" y1="13" x2="15" y2="13" />
    </svg>
  )
}

export function IconOrderedList() {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
      <text x="3" y="6.5" textAnchor="middle" fontSize="5.5" fill="currentColor">1</text>
      <text x="3" y="10.5" textAnchor="middle" fontSize="5.5" fill="currentColor">2</text>
      <text x="3" y="14.5" textAnchor="middle" fontSize="5.5" fill="currentColor">3</text>
      <line x1="7" y1="5" x2="15" y2="5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="7" y1="9" x2="15" y2="9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="7" y1="13" x2="15" y2="13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function IconQuote() {
  return <GlyphIcon fontSize={15}>&quot;</GlyphIcon>
}

export function IconLink() {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 11L11 7" />
      <path d="M8.5 5.5 10 4a2.5 2.5 0 0 1 3.5 3.5L12 9" />
      <path d="M9.5 12.5 8 14a2.5 2.5 0 0 1-3.5-3.5L6 9" />
    </svg>
  )
}

export function IconImage() {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="13" height="13" rx="2" />
      <circle cx="6.5" cy="6.5" r="1.3" fill="currentColor" stroke="none" />
      <path d="M3 12.5l3.5-3.5 2.5 2.5 3-4 3.5 4.5" />
    </svg>
  )
}

export function IconTable() {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="13" height="13" rx="2" />
      <line x1="2.5" y1="9" x2="15.5" y2="9" />
      <line x1="9" y1="2.5" x2="9" y2="15.5" />
    </svg>
  )
}
