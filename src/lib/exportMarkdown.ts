function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '')
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

export function htmlToMarkdown(html: string): string {
  let md = html

  // Code blocks before inline code
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
    (_, c) => '```\n' + decodeEntities(c) + '\n```\n\n')

  // Headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `# ${stripTags(c).trim()}\n\n`)
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `## ${stripTags(c).trim()}\n\n`)
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `### ${stripTags(c).trim()}\n\n`)
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `#### ${stripTags(c).trim()}\n\n`)

  // Blockquote
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
    (_, c) => stripTags(c).trim().split('\n').map(l => `> ${l}`).join('\n') + '\n\n')

  // Inline formatting
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, (_, c) => `**${c}**`)
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, (_, c) => `**${c}**`)
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, (_, c) => `*${c}*`)
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, (_, c) => `*${c}*`)
  md = md.replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, (_, c) => `~~${c}~~`)
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => `\`${decodeEntities(c)}\``)

  // Links — runs after inline formatting above, so a link wrapping <strong>/
  // <em> already reads as **text**/*text* by the time it's captured here.
  md = md.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs, inner) => {
    const href = /\bhref="([^"]*)"/i.exec(attrs)?.[1] ?? ''
    const label = stripTags(inner).trim()
    if (!label) return ''
    return href ? `[${label}](${href})` : label
  })

  // Images — block-level (Image is configured with inline: false), never
  // nested inside a <p>. alt/title are omitted from the HTML entirely when
  // unset, so both attributes are looked up independently rather than
  // assuming a fixed attribute order.
  md = md.replace(/<img\b([^>]*)>/gi, (_, attrs) => {
    const src = /\bsrc="([^"]*)"/i.exec(attrs)?.[1] ?? ''
    const alt = /\balt="([^"]*)"/i.exec(attrs)?.[1] ?? ''
    return src ? `![${decodeEntities(alt)}](${src})\n\n` : ''
  })

  // Tables → GFM pipe tables. Runs after inline formatting above, so cell
  // text already has **bold**/*italic* as literal characters by the time
  // it's extracted here (unlike blockquote, extracted before inline
  // formatting — a pre-existing quirk, not touched here). Multi-block
  // cells aren't supported by pipe tables, so internal newlines collapse
  // to spaces — an accepted limitation of the format.
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, inner) => {
    const rows = [...(inner as string).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, rowHtml]) =>
      [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, cellHtml]) =>
        stripTags(cellHtml).trim().replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')
      )
    )
    if (rows.length === 0) return ''
    const colCount = rows[0].length
    const header = `| ${rows[0].join(' | ')} |`
    const divider = `| ${Array(colCount).fill('---').join(' | ')} |`
    const body = rows.slice(1).map((r) => `| ${r.join(' | ')} |`).join('\n')
    return `${header}\n${divider}\n${body ? body + '\n' : ''}\n`
  })

  // Lists — ordered lists first (numbered), so their <li>s are consumed
  // before the generic bullet rule below would flatten them to "-".
  // Nested lists aren't supported (a nested <li> confuses the non-greedy
  // match) — a pre-existing limitation, unchanged here.
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
    let n = 0
    return (inner as string).replace(/<li[^>]*>([\s\S]*?)<\/li>/gi,
      (_m, c) => `${++n}. ${stripTags(c).trim()}\n`) + '\n'
  })
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `- ${stripTags(c).trim()}\n`)
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, c) => c + '\n')

  // Paragraphs and breaks
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => `${c}\n\n`)
  md = md.replace(/<br[^>]*\/?>/gi, '\n')
  md = md.replace(/<hr[^>]*\/?>/gi, '\n---\n\n')

  // Strip remaining tags and decode entities
  md = md.replace(/<[^>]+>/g, '')
  md = decodeEntities(md)

  return md.replace(/\n{3,}/g, '\n\n').trim()
}

export function countWords(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.split(' ').filter(Boolean).length : 0
}

/** Plain-text extraction (no HTML, no Markdown) — preserves block boundaries as newlines. */
export function getText(html: string): string {
  let text = html.replace(/<\/(p|h[1-6]|li|blockquote|tr)>/gi, '\n')
  text = text.replace(/<br[^>]*\/?>/gi, '\n')
  text = text.replace(/<hr[^>]*\/?>/gi, '\n')
  text = stripTags(text)
  text = decodeEntities(text)
  text = text.replace(/[ \t]+/g, ' ')
  return text.replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export interface DocumentStats {
  words: number
  characters: number
  charactersNoSpaces: number
  readingTimeMinutes: number
  links: number
  images: number
  tables: number
}

export function getDocumentStats(html: string, options?: { wordsPerMinute?: number }): DocumentStats {
  const wordsPerMinute = options?.wordsPerMinute ?? 200
  const flat = decodeEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
  const words = flat ? flat.split(' ').filter(Boolean).length : 0
  return {
    words,
    characters: flat.length,
    charactersNoSpaces: flat.replace(/\s/g, '').length,
    readingTimeMinutes: Math.max(1, Math.round(words / wordsPerMinute)),
    links: (html.match(/<a\b[^>]*\bhref="[^"]*"/gi) ?? []).length,
    images: (html.match(/<img\b/gi) ?? []).length,
    tables: (html.match(/<table\b/gi) ?? []).length,
  }
}

export interface HeadingOutlineItem {
  level: number
  text: string
  id?: string
}

/** Walks h1-h6 in document order. `id` is only set if already present in the HTML — no slug generation. */
export function getHeadingOutline(html: string): HeadingOutlineItem[] {
  const items: HeadingOutlineItem[] = []
  const re = /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    const [, levelStr, attrs, inner] = match
    const id = /\bid="([^"]*)"/i.exec(attrs)?.[1]
    items.push({ level: Number(levelStr), text: decodeEntities(stripTags(inner)).trim(), id })
  }
  return items
}

/**
 * Extracts a short title candidate: the first heading's text, or failing
 * that the first non-empty paragraph truncated to `maxLength`. Returns
 * `undefined` when neither is found — unlike a UI layer, this has no
 * locale-specific fallback string to fall back to; that's the host's call.
 */
export function getTitle(html: string, options?: { maxLength?: number }): string | undefined {
  const maxLength = options?.maxLength ?? 50

  const heading = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(html)
  if (heading) {
    const text = decodeEntities(stripTags(heading[1])).trim()
    if (text) return text
  }

  const para = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(html)
  if (para) {
    const text = decodeEntities(stripTags(para[1])).trim()
    if (text) return text.length > maxLength ? text.slice(0, maxLength).trim() + '…' : text
  }

  return undefined
}

/**
 * Plain-text excerpt (e.g. an article subtitle/meta description) collapsed
 * to a single line and truncated at a word boundary. Always returns a
 * string — an empty document yields `''`, unlike `getTitle`.
 */
export function getExcerpt(html: string, options?: { maxLength?: number }): string {
  const maxLength = options?.maxLength ?? 200
  const text = getText(html).replace(/\s+/g, ' ').trim()
  if (text.length <= maxLength) return text
  const truncated = text.slice(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated).trim() + '…'
}

/** Returns the `src` of the first `<img>` in the document (a cover-image candidate), or `undefined`. */
export function getFirstImage(html: string): string | undefined {
  const match = /<img\b([^>]*)>/i.exec(html)
  if (!match) return undefined
  return /\bsrc="([^"]*)"/i.exec(match[1])?.[1] ?? undefined
}

export function downloadMarkdown(title: string, html: string): void {
  const md = htmlToMarkdown(html)
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title.replace(/[<>:"/\\|?*]/g, '').trim() || 'documento'}.md`
  a.click()
  URL.revokeObjectURL(url)
}
