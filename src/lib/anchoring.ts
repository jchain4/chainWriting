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

/** Offset of the best occurrence of `quote` in `text`, or -1. */
export function findQuote(text: string, quote: string, prefix?: string, suffix?: string): number {
  let best = -1
  let bestScore = -1
  for (let i = text.indexOf(quote); i !== -1; i = text.indexOf(quote, i + 1)) {
    const score = (prefix && text.slice(0, i).endsWith(prefix) ? 1 : 0)
      + (suffix && text.slice(i + quote.length).startsWith(suffix) ? 1 : 0)
    if (score > bestScore) {
      best = i
      bestScore = score
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
