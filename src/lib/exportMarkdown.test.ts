import { describe, expect, it } from 'vitest'
import {
  getDocumentStats,
  getExcerpt,
  getFirstImage,
  getHeadingOutline,
  getText,
  getTitle,
  htmlToMarkdown,
} from './exportMarkdown'

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

describe('htmlToMarkdown — links', () => {
  it('converts a plain link', () => {
    expect(htmlToMarkdown('<p><a href="https://x.com">click</a></p>'))
      .toBe('[click](https://x.com)')
  })

  it('preserves bold formatting inside a link', () => {
    expect(htmlToMarkdown('<p><a href="https://x.com"><strong>click</strong></a></p>'))
      .toBe('[**click**](https://x.com)')
  })

  it('drops an empty link entirely', () => {
    expect(htmlToMarkdown('<p><a href="https://x.com"></a>Text</p>')).toBe('Text')
  })

  it('degrades a link with no href to plain text', () => {
    expect(htmlToMarkdown('<p><a>click</a></p>')).toBe('click')
  })
})

describe('htmlToMarkdown — ordered lists', () => {
  it('numbers a 3-item ordered list', () => {
    expect(htmlToMarkdown('<ol><li>One</li><li>Two</li><li>Three</li></ol>'))
      .toBe('1. One\n2. Two\n3. Three')
  })

  it('leaves an unordered list as bullets (regression guard)', () => {
    expect(htmlToMarkdown('<ul><li>A</li><li>B</li></ul>')).toBe('- A\n- B')
  })
})

describe('getText', () => {
  it('joins multiple paragraphs with newlines', () => {
    expect(getText('<p>Uno</p><p>Dos</p>')).toBe('Uno\nDos')
  })

  it('decodes entities', () => {
    expect(getText('<p>Tom &amp; Jerry</p>')).toBe('Tom & Jerry')
  })

  it('strips tags across a heading + list mix, one line per block', () => {
    expect(getText('<h2>Title</h2><ul><li>One</li><li>Two</li></ul>'))
      .toBe('Title\nOne\nTwo')
  })
})

describe('getDocumentStats', () => {
  it('counts words, characters, and characters without spaces (entity-decoded)', () => {
    const stats = getDocumentStats('<p>Tom &amp; Jerry</p>')
    expect(stats.words).toBe(3)
    expect(stats.characters).toBe('Tom & Jerry'.length)
    expect(stats.charactersNoSpaces).toBe('Tom&Jerry'.length)
  })

  it('floors reading time at 1 minute for a near-empty document', () => {
    const stats = getDocumentStats('<p></p>')
    expect(stats.words).toBe(0)
    expect(stats.readingTimeMinutes).toBe(1)
  })

  it('computes reading time from a custom wordsPerMinute', () => {
    const html = `<p>${Array(10).fill('word').join(' ')}</p>`
    expect(getDocumentStats(html, { wordsPerMinute: 5 }).readingTimeMinutes).toBe(2)
  })

  it('counts links (href only), images, and tables', () => {
    const html = '<p><a href="https://x.com">link</a> <a>nolink</a></p>'
      + '<img src="a.png"><table><tr><td>x</td></tr></table>'
    const stats = getDocumentStats(html)
    expect(stats.links).toBe(1)
    expect(stats.images).toBe(1)
    expect(stats.tables).toBe(1)
  })
})

describe('getHeadingOutline', () => {
  it('returns h1-h3 in document order', () => {
    expect(getHeadingOutline('<h1>Intro</h1><p>text</p><h2>Section</h2><h3>Sub</h3>')).toEqual([
      { level: 1, text: 'Intro' },
      { level: 2, text: 'Section' },
      { level: 3, text: 'Sub' },
    ])
  })

  it('surfaces an existing id attribute', () => {
    expect(getHeadingOutline('<h2 id="foo">Bar</h2>')).toEqual([{ level: 2, text: 'Bar', id: 'foo' }])
  })

  it('captures h5/h6 (broader than htmlToMarkdown\'s h1-h4 support)', () => {
    expect(getHeadingOutline('<h5>Five</h5><h6>Six</h6>')).toEqual([
      { level: 5, text: 'Five' },
      { level: 6, text: 'Six' },
    ])
  })
})

describe('getTitle', () => {
  it('prefers the first heading over a paragraph', () => {
    expect(getTitle('<h2>The Title</h2><p>Some intro text.</p>')).toBe('The Title')
  })

  it('falls back to the first paragraph when there is no heading', () => {
    expect(getTitle('<p>An article without a heading.</p>')).toBe('An article without a heading.')
  })

  it('truncates a long paragraph title at maxLength', () => {
    const html = `<p>${Array(20).fill('word').join(' ')}</p>`
    const title = getTitle(html, { maxLength: 10 })
    expect(title!.length).toBeLessThanOrEqual(11)
    expect(title!.endsWith('…')).toBe(true)
  })

  it('returns undefined for a document with no heading or paragraph text', () => {
    expect(getTitle('<p></p>')).toBeUndefined()
    expect(getTitle('')).toBeUndefined()
  })
})

describe('getExcerpt', () => {
  it('collapses multiple paragraphs into a single line', () => {
    expect(getExcerpt('<p>Uno</p><p>Dos</p>')).toBe('Uno Dos')
  })

  it('truncates at a word boundary and appends an ellipsis', () => {
    const html = `<p>${Array(50).fill('word').join(' ')}</p>`
    const excerpt = getExcerpt(html, { maxLength: 20 })
    expect(excerpt.length).toBeLessThanOrEqual(21)
    expect(excerpt.endsWith('…')).toBe(true)
    expect(excerpt.endsWith(' …')).toBe(false)
  })

  it('returns an empty string for an empty document', () => {
    expect(getExcerpt('<p></p>')).toBe('')
  })

  it('does not truncate text within maxLength', () => {
    expect(getExcerpt('<p>Short text.</p>', { maxLength: 200 })).toBe('Short text.')
  })
})

describe('getFirstImage', () => {
  it('returns the src of a single image', () => {
    expect(getFirstImage('<p>text</p><img src="https://x/a.png">')).toBe('https://x/a.png')
  })

  it('returns only the first image when there are several', () => {
    expect(getFirstImage('<img src="a.png"><img src="b.png">')).toBe('a.png')
  })

  it('returns undefined when there are no images', () => {
    expect(getFirstImage('<p>no images here</p>')).toBeUndefined()
  })
})
