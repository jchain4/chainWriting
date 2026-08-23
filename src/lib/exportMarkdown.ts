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

  // Lists
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `- ${stripTags(c).trim()}\n`)
  md = md.replace(/<[uo]l[^>]*>([\s\S]*?)<\/[uo]l>/gi, (_, c) => c + '\n')

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
