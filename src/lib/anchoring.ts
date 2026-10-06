import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/**
 * Content-based anchoring shared by annotations and suggestions: "the phrase
 * `quote` in block `blockId`" (or the whole block when there's no quote),
 * turned into a document range and carried over edits.
 */
export interface Anchor {
  blockId: string
  quote?: string
  prefix?: string
  suffix?: string
}

export interface AnchorRange {
  /** May differ from the anchor's own blockId once its text has moved to another block (e.g. after a join). */
  blockId: string
  from: number
  to: number
}

export type BlockLookup = (id: string) => { pos: number, node: ProseMirrorNode } | undefined

/** Index of block id → node, built at most once per document and only if needed. */
export function lazyBlockIndex(doc: ProseMirrorNode): BlockLookup {
  let index: Map<string, { pos: number, node: ProseMirrorNode }> | undefined
  return (id) => {
    if (!index) {
      const built = new Map<string, { pos: number, node: ProseMirrorNode }>()
      doc.descendants((node, pos) => {
        const blockId = node.attrs.blockId as string | null | undefined
        if (blockId && !built.has(blockId)) built.set(blockId, { pos, node })
        return !node.isTextblock
      })
      index = built
    }
    return index.get(id)
  }
}

export const blockText = (node: ProseMirrorNode) => node.textBetween(0, node.content.size, '\n', '\n')

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u
const isWordChar = (char: string | undefined) => !!char && WORD_CHAR.test(char)

/** How many characters of `text` right before `index` match the end of `prefix`. */
function matchBefore(text: string, index: number, prefix: string): number {
  let n = 0
  while (n < index && n < prefix.length && text[index - 1 - n] === prefix[prefix.length - 1 - n]) n++
  return n
}

/** How many characters of `text` from `index` on match the start of `suffix`. */
function matchAfter(text: string, index: number, suffix: string): number {
  let n = 0
  while (index + n < text.length && n < suffix.length && text[index + n] === suffix[n]) n++
  return n
}

/**
 * Offset of the best occurrence of `quote` in `text`, or -1 (also for an
 * empty quote). Occurrences are ranked by, in order:
 * 1. Context: how many characters of `prefix` match the text right before
 *    the occurrence, plus how many of `suffix` match right after it —
 *    counted outwards from the quote, so a long prefix that differs only
 *    far from the quote still points at the right occurrence.
 * 2. Whole words: an occurrence that isn't part of a longer word ("casa" on
 *    its own rather than inside "casas") wins over one that is.
 * 3. Position: the first one.
 */
export function findQuote(text: string, quote: string, prefix?: string, suffix?: string): number {
  if (!quote) return -1
  let best = -1
  let bestContext = -1
  let bestWhole = false
  for (let i = text.indexOf(quote); i !== -1; i = text.indexOf(quote, i + 1)) {
    const end = i + quote.length
    const context = (prefix ? matchBefore(text, i, prefix) : 0) + (suffix ? matchAfter(text, end, suffix) : 0)
    // A quote edge that is itself punctuation/space can't be glued to a word.
    const whole = !(isWordChar(quote[0]) && isWordChar(text[i - 1]))
      && !(isWordChar(quote[quote.length - 1]) && isWordChar(text[end]))
    if (context > bestContext || (context === bestContext && whole && !bestWhole)) {
      best = i
      bestContext = context
      bestWhole = whole
    }
  }
  return best
}

/** Finds the anchor in the document, or null if its block (or quote) isn't there. */
export function resolveAnchor(anchor: Anchor, findBlock: BlockLookup): AnchorRange | null {
  const block = findBlock(anchor.blockId)
  if (!block) return null
  const { pos, node } = block
  if (!anchor.quote) return { blockId: anchor.blockId, from: pos, to: pos + node.nodeSize }
  if (!node.isTextblock) return null
  // Text offsets equal content offsets here: text is 1:1 and every inline
  // leaf (hard break) is both one position and one "\n" character.
  const offset = findQuote(blockText(node), anchor.quote, anchor.prefix, anchor.suffix)
  if (offset < 0) return null
  const from = pos + 1 + offset
  return { blockId: anchor.blockId, from, to: from + anchor.quote.length }
}

/**
 * Carries a resolved anchor over an edit: first by mapping its range (cheap,
 * and lets it follow its text even into another block, e.g. after joining two
 * paragraphs); if the mapped range no longer holds the quote, by searching
 * for the quote again in its block.
 */
export function mapAnchor(
  anchor: Anchor,
  range: AnchorRange | null,
  doc: ProseMirrorNode,
  map: (pos: number, assoc: number) => number,
  findBlock: BlockLookup,
): AnchorRange | null {
  if (range) {
    if (!anchor.quote) {
      const from = map(range.from, 1)
      const node = doc.nodeAt(from)
      if (node && node.attrs.blockId === range.blockId) return { blockId: range.blockId, from, to: from + node.nodeSize }
    } else {
      // Typing right at either edge of the quote shouldn't stretch it.
      const from = map(range.from, 1)
      const to = map(range.to, -1)
      if (from < to) {
        const $from = doc.resolve(from)
        const $to = doc.resolve(to)
        if ($from.sameParent($to) && $from.parent.isTextblock && doc.textBetween(from, to, '\n', '\n') === anchor.quote) {
          return { blockId: ($from.parent.attrs.blockId as string | null) || range.blockId, from, to }
        }
      }
    }
  }
  return resolveAnchor({ ...anchor, blockId: range?.blockId ?? anchor.blockId }, findBlock)
}
