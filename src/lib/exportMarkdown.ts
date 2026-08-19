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
