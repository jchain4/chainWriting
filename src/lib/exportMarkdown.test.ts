import { describe, expect, it } from 'vitest'
import { htmlToMarkdown } from './exportMarkdown'

describe('htmlToMarkdown — images', () => {
  it('converts an image with alt text', () => {
    expect(htmlToMarkdown('<img src="https://x/a.png" alt="cat">'))
      .toBe('![cat](https://x/a.png)')
  })

  it('converts an image without alt text', () => {
    expect(htmlToMarkdown('<img src="https://x/a.png">'))
      .toBe('![](https://x/a.png)')
  })
})

describe('htmlToMarkdown — tables', () => {
  const table = (rows: string) =>
    `<table><tbody>${rows}</tbody></table>`

  it('converts a 2x2 table with a header row to GFM pipe syntax', () => {
    const html = table(
      '<tr><th><p>Header 1</p></th><th><p>Header 2</p></th></tr>' +
      '<tr><td><p>Cell 1</p></td><td><p>Cell 2</p></td></tr>',
    )
    expect(htmlToMarkdown(html)).toBe(
      '| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |',
    )
  })

  it('preserves bold formatting inside a cell (inline formatting runs before table extraction)', () => {
    const html = table('<tr><td><p><strong>bold</strong> text</p></td></tr>')
    expect(htmlToMarkdown(html)).toContain('**bold** text')
  })

  it('escapes a literal pipe character inside a cell', () => {
    const html = table('<tr><td><p>a | b</p></td></tr>')
    expect(htmlToMarkdown(html)).toContain('a \\| b')
  })
})
