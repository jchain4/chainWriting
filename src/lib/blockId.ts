import { Extension, combineTransactionSteps, getChangedRanges } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/** Node types that get a stable id by default — every text-bearing block plus standalone block atoms. */
export const DEFAULT_BLOCK_TYPES = ['paragraph', 'heading', 'codeBlock', 'image', 'horizontalRule']

/** One addressable block of the document, as seen by the host app (or an LLM it chooses to wire in). */
export interface Block {
  /** Stable id: survives edits elsewhere in the document, undo/redo, and HTML/JSON round-trips. */
  id: string
  /** Node type name, e.g. "paragraph", "heading", "image". */
  type: string
  /** Plain text of the block (hard breaks become "\n"). Empty for atoms like images. */
  text: string
  /** The node's own attributes (e.g. heading `level`, image `src`/`alt`), minus the block id itself. */
  attrs: Record<string, unknown>
  /** Enclosing node types from the outside in, e.g. ["bulletList", "listItem"] or ["table", "tableRow", "tableCell"]. */
  ancestors: string[]
}

export interface BlocksChange {
  /** Ids of blocks that did not exist before this change. */
  added: string[]
  /** Ids of blocks whose content or attributes changed. */
  updated: string[]
  /** Ids of blocks that no longer exist. */
  removed: string[]
  /**
   * The added and updated blocks themselves, in reading order — so the host
   * can re-analyze them without reading the whole document again.
   */
  blocks: Block[]
  /** Increments on every document change — lets async consumers detect that their results are stale. */
  version: number
}

/**
 * Every block id matches this: 1–64 ASCII letters, digits, `_` or `-`. Ids
 * that don't (in loaded or pasted content, or from a custom `generateId`)
 * are replaced with fresh ones. Default ids are 8 characters of `[0-9a-z]`.
 * A host sanitizer can safely allow `data-block-id` restricted to this.
 */
export const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export interface BlockIdOptions {
  types: string[]
  /** Must return ids matching BLOCK_ID_PATTERN; invalid or repeated ones are retried, then replaced by default ids. */
  generateId: () => string
  onBlocksChange?: (change: BlocksChange) => void
}

interface BlockIdStorage {
  version: number
  lastDoc: ProseMirrorNode | null
  warnedBadGenerator: boolean
}

declare module '@tiptap/core' {
  interface Storage {
    blockId: BlockIdStorage
  }
}

export const blockIdPluginKey = new PluginKey('blockId')

const ATTR = 'blockId'

function randomId(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0')
}

const isValidId = (id: unknown): id is string => typeof id === 'string' && BLOCK_ID_PATTERN.test(id)

const GENERATE_ATTEMPTS = 10

function isTracked(node: ProseMirrorNode, types: Set<string>): boolean {
  return types.has(node.type.name)
}

const isEmptyTextblock = (node: ProseMirrorNode) => node.isTextblock && node.content.size === 0

/**
 * Gives every node of a tracked type a unique id. Nodes that already have a
 * unique one keep it. When several nodes share an id, one keeps it and the
 * rest get fresh ones:
 * - a pasted copy of an existing block: the block outside the just-changed
 *   ranges (the original) keeps it;
 * - Enter at the very start of a block, which leaves the id on both halves:
 *   the half that holds the text keeps it, not the new empty line above.
 */
function assignIds(
  tr: Transaction,
  types: Set<string>,
  generateId: () => string,
  changedRanges: { from: number, to: number }[] = [],
  onBadGenerator: () => void = () => {},
) {
  const entries: { pos: number, node: ProseMirrorNode, id: string | null }[] = []
  const byId = new Map<string, typeof entries>()
  tr.doc.descendants((node, pos) => {
    if (!isTracked(node, types)) return !node.isTextblock
    const raw = node.attrs[ATTR] as unknown
    const entry = { pos, node, id: isValidId(raw) ? raw : null }
    entries.push(entry)
    if (entry.id) byId.set(entry.id, [...(byId.get(entry.id) ?? []), entry])
    return false
  })

  const used = new Set(byId.keys())
  const freshId = () => {
    // A host generator that keeps returning a used or malformed id must not
    // hang the editor: give it a few tries, then fall back to default ids.
    let id: string | undefined
    for (let i = 0; i < GENERATE_ATTEMPTS && id === undefined; i++) {
      const candidate = generateId()
      if (isValidId(candidate) && !used.has(candidate)) id = candidate
    }
    if (id === undefined) {
      onBadGenerator()
      do id = randomId()
      while (used.has(id))
    }
    used.add(id)
    return id
  }
  const touched = ({ pos, node }: { pos: number, node: ProseMirrorNode }) =>
    changedRanges.some((r) => pos < r.to && pos + node.nodeSize > r.from)

  for (const group of byId.values()) {
    if (group.length < 2) continue
    const untouched = group.filter((entry) => !touched(entry))
    const candidates = untouched.length ? untouched : group
    const keeper = candidates.find((entry) => !isEmptyTextblock(entry.node)) ?? candidates[0]
    for (const entry of group) if (entry !== keeper) entry.id = null
  }
  for (const entry of entries) {
    const id = entry.id ?? freshId()
    if (entry.node.attrs[ATTR] !== id) tr.setNodeAttribute(entry.pos, ATTR, id)
  }
}

/**
 * Lists the document's blocks in reading order. With `ids`, only those
 * blocks (still in reading order; unknown ids are ignored) — only their text
 * is extracted, and the walk stops as soon as all of them are found.
 */
export function getBlocks(
  doc: ProseMirrorNode,
  types: string[] = DEFAULT_BLOCK_TYPES,
  ids?: Iterable<string>,
): Block[] {
  const typeSet = new Set(types)
  const wanted = ids ? new Set(ids) : null
  let remaining = wanted ? wanted.size : Infinity
  const blocks: Block[] = []

  const walk = (node: ProseMirrorNode, ancestors: string[]) => {
    for (let i = 0; i < node.childCount && remaining > 0; i++) {
      const child = node.child(i)
      if (isTracked(child, typeSet)) {
        const { [ATTR]: id, ...attrs } = child.attrs
        if (!id || (wanted && !wanted.has(id as string))) continue
        remaining -= 1
        blocks.push({
          id: id as string,
          type: child.type.name,
          text: child.textBetween(0, child.content.size, '\n', '\n'),
          attrs,
          ancestors,
        })
      } else if (!child.isTextblock && !child.isLeaf) {
        walk(child, [...ancestors, child.type.name])
      }
    }
  }
  walk(doc, [])
  return blocks
}

function collectBlockNodes(doc: ProseMirrorNode, types: Set<string>): Map<string, ProseMirrorNode> {
  const map = new Map<string, ProseMirrorNode>()
  doc.descendants((node) => {
    if (!isTracked(node, types)) return !node.isTextblock
    const id = node.attrs[ATTR] as string | null
    if (id) map.set(id, node)
    return false
  })
  return map
}

/**
 * Compares two versions of a document block by block. Cheap on long
 * documents: ProseMirror reuses the very same node object for every block an
 * edit didn't touch, so most comparisons are a single `===`.
 */
export function diffBlocks(
  oldDoc: ProseMirrorNode,
  newDoc: ProseMirrorNode,
  types: string[] = DEFAULT_BLOCK_TYPES,
): Omit<BlocksChange, 'version' | 'blocks'> {
  const typeSet = new Set(types)
  const before = collectBlockNodes(oldDoc, typeSet)
  const after = collectBlockNodes(newDoc, typeSet)
  const added: string[] = []
  const updated: string[] = []
  const removed: string[] = []

  for (const [id, node] of after) {
    const old = before.get(id)
    if (!old) added.push(id)
    else if (old !== node && !old.eq(node)) updated.push(id)
  }
  for (const id of before.keys()) if (!after.has(id)) removed.push(id)
  return { added, updated, removed }
}

/**
 * Gives each block of the document (paragraph, heading, image…) a stable id,
 * rendered as `data-block-id` in the HTML so it survives saving and reloading.
 * Also reports, after every edit, which blocks were added, changed or removed.
 */
function warnBadGeneratorOnce(storage: BlockIdStorage) {
  if (storage.warnedBadGenerator) return
  storage.warnedBadGenerator = true
  console.warn('chain-writing: BlockId generateId() kept returning ids that are already in use or don\'t match BLOCK_ID_PATTERN; falling back to default ids.')
}

export const BlockId = Extension.create<BlockIdOptions, BlockIdStorage>({
  name: 'blockId',

  addOptions() {
    return {
      types: DEFAULT_BLOCK_TYPES,
      generateId: randomId,
      onBlocksChange: undefined,
    }
  },

  addStorage() {
    return { version: 0, lastDoc: null, warnedBadGenerator: false }
  },

  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        [ATTR]: {
          default: null,
          // Enter must not copy the id onto the new half of a split block.
          keepOnSplit: false,
          parseHTML: (element) => element.getAttribute('data-block-id'),
          renderHTML: (attributes) => attributes[ATTR] ? { 'data-block-id': attributes[ATTR] } : {},
        },
      },
    }]
  },

  addProseMirrorPlugins() {
    const types = new Set(this.options.types)
    const { generateId } = this.options
    const storage = this.storage

    return [new Plugin({
      key: blockIdPluginKey,
      appendTransaction: (transactions, oldState, newState) => {
        if (!transactions.some((tr) => tr.docChanged)) return null
        const transform = combineTransactionSteps(oldState.doc, [...transactions])
        const changedRanges = getChangedRanges(transform).map((r) => r.newRange)
        const tr = newState.tr
        assignIds(tr, types, generateId, changedRanges, () => warnBadGeneratorOnce(storage))
        return tr.docChanged ? tr : null
      },
    })]
  },

  // The initial content never goes through appendTransaction, so its ids are
  // assigned here. Kept out of undo history and out of onChange/onUpdate:
  // nothing the user did changed, so the host shouldn't see a phantom edit.
  onCreate() {
    const tr = this.editor.state.tr
    assignIds(tr, new Set(this.options.types), this.options.generateId, [], () => warnBadGeneratorOnce(this.storage))
    if (tr.docChanged) {
      tr.setMeta('addToHistory', false).setMeta('preventUpdate', true)
      this.editor.view.dispatch(tr)
    }
    this.storage.lastDoc = this.editor.state.doc
  },

  onUpdate() {
    const doc = this.editor.state.doc
    const lastDoc = this.storage.lastDoc
    this.storage.lastDoc = doc
    if (!lastDoc || lastDoc === doc) return
    this.storage.version += 1
    const change = diffBlocks(lastDoc, doc, this.options.types)
    if (!change.added.length && !change.updated.length && !change.removed.length) return
    if (!this.options.onBlocksChange) return
    const blocks = getBlocks(doc, this.options.types, [...change.added, ...change.updated])
    this.options.onBlocksChange({ ...change, blocks, version: this.storage.version })
  },
})
