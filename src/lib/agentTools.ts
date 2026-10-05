import type { Editor as TiptapEditor } from '@tiptap/core'
import { getBlocks, type Block } from './blockId'
import { getAnnotations, setAnnotations, type Annotation } from './annotations'
import { addSuggestions, getSuggestions, removeSuggestions, type Suggestion } from './suggestions'

/**
 * A tool an LLM can call, in the shape of an MCP (Model Context Protocol)
 * tool definition. The host passes these to *its own* LLM — chain-writing
 * never talks to any model or service. Other formats are a rename away:
 * Anthropic's Messages API calls `inputSchema` `input_schema`; OpenAI-style
 * function calling calls it `parameters`.
 */
export interface EditorTool {
  name: EditorToolName
  title: string
  description: string
  inputSchema: JsonSchemaObject
  /** MCP tool annotations: hints for the host's permission/confirmation UI. */
  annotations: { readOnlyHint: boolean, destructiveHint: boolean, idempotentHint: boolean, openWorldHint: boolean }
}

/** The result of a tool call, in the shape of an MCP `CallToolResult`. */
export interface EditorToolResult {
  content: { type: 'text', text: string }[]
  /** The same information as `content`, machine-readable. */
  structuredContent?: Record<string, unknown>
  /** True when the call failed; `content` then explains why, in words an LLM can act on. */
  isError?: boolean
}

export type EditorToolName =
  | 'read_document'
  | 'get_selection'
  | 'annotate'
  | 'remove_annotations'
  | 'suggest_edits'
  | 'suggest_insert'
  | 'withdraw_suggestions'

export interface JsonSchemaObject {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties: false
}

/** Anything the tools can reach the editor through: the raw Tiptap editor, an EditorHandle, or a getter for either. */
export type EditorToolsSource =
  | TiptapEditor
  | { getEditor: () => TiptapEditor | null }
  | (() => TiptapEditor | { getEditor: () => TiptapEditor | null } | null | undefined)

export interface EditorToolsOptions {
  /** Annotation layer the tools write to (and only ever touch). Default "assistant". */
  annotationLayer?: string
  /** Only offer these tools — e.g. `['read_document', 'annotate']` for a read-and-comment assistant. Default: all. */
  include?: EditorToolName[]
  /** Prefix for ids of annotations and suggestions created by the tools. Default "assistant-". */
  idPrefix?: string
}

export interface EditorTools {
  /** The tool definitions to hand to the LLM. */
  tools: EditorTool[]
  /** Runs a tool call the LLM made. Never throws: problems come back as `isError` results. */
  execute: (name: string, input: unknown) => EditorToolResult
}

// ── Schemas ─────────────────────────────────────────────────────────────────

const blockIdProp = { type: 'string', description: 'Id of the block, exactly as shown in brackets by read_document.' }
const quoteProp = {
  type: 'string',
  minLength: 1,
  description: 'Text copied exactly (same case, spacing and punctuation) from that block\'s text as returned by read_document.',
}
const contextProps = {
  prefix: { type: 'string', description: 'Optional: the text right before the quote, only needed if the quote appears more than once in the block.' },
  suffix: { type: 'string', description: 'Optional: the text right after the quote, only needed if the quote appears more than once in the block.' },
}
const idsProp = (what: string) => ({
  type: 'array',
  items: { type: 'string' },
  description: `Ids of the ${what} to remove, as returned when they were created. Omit to remove all of them.`,
})

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const overlay = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }

const DEFINITIONS: EditorTool[] = [
  {
    name: 'read_document',
    title: 'Read document',
    description:
      'Returns the document the user is writing, one block (paragraph, heading, list item, image…) per line, as '
      + '`[blockId] type: "text"`. Use the block ids and the exact text to refer to parts of the document in the '
      + 'other tools. Call it again after the user has edited, since text and blocks change.',
    inputSchema: {
      type: 'object',
      properties: {
        blockIds: { type: 'array', items: { type: 'string' }, description: 'Optional: only return these blocks.' },
      },
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: 'get_selection',
    title: 'Get selection',
    description:
      'Returns the text the user currently has selected and the block(s) it is in, or the block where the cursor is '
      + 'if nothing is selected. Use it when the user refers to "this", "the selected text" or "here".',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: 'annotate',
    title: 'Annotate text',
    description:
      'Highlights phrases in the document with a note for the user (e.g. a style remark, a fact to check, an '
      + 'explanation). Does not change the text. Omit `quote` to annotate a whole block. Returns an id per annotation.',
    inputSchema: {
      type: 'object',
      properties: {
        annotations: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              blockId: blockIdProp,
              quote: { type: 'string', description: `${quoteProp.description} Omit to annotate the whole block.` },
              ...contextProps,
              note: { type: 'string', description: 'Short message shown to the user for this annotation.' },
              kind: { type: 'string', description: 'Optional category, e.g. "style", "grammar", "fact-check".' },
            },
            required: ['blockId', 'note'],
            additionalProperties: false,
          },
        },
      },
      required: ['annotations'],
      additionalProperties: false,
    },
    annotations: overlay,
  },
  {
    name: 'remove_annotations',
    title: 'Remove annotations',
    description: 'Removes annotations previously created with annotate.',
    inputSchema: { type: 'object', properties: { ids: idsProp('annotations') }, additionalProperties: false },
    annotations: overlay,
  },
  {
    name: 'suggest_edits',
    title: 'Suggest edits',
    description:
      'Proposes replacing (or deleting, with an empty replacement) phrases in the document. Nothing changes until '
      + 'the user accepts each suggestion; they see it as tracked changes. Keep each quote as short as possible '
      + 'while still unambiguous. Returns an id and status per suggestion: "not_found" means the quote did not match '
      + 'the block text exactly — re-read the document and try again.',
    inputSchema: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              blockId: blockIdProp,
              quote: quoteProp,
              ...contextProps,
              replacement: { type: 'string', description: 'The new text for the quote. Empty string to delete it.' },
              reason: { type: 'string', description: 'Optional short explanation shown to the user.' },
            },
            required: ['blockId', 'quote', 'replacement'],
            additionalProperties: false,
          },
        },
      },
      required: ['edits'],
      additionalProperties: false,
    },
    annotations: overlay,
  },
  {
    name: 'suggest_insert',
    title: 'Suggest new paragraphs',
    description:
      'Proposes adding new paragraphs right after a block. Nothing changes until the user accepts. Each non-empty '
      + 'line of `text` becomes one paragraph (plain text, no Markdown).',
    inputSchema: {
      type: 'object',
      properties: {
        afterBlockId: { ...blockIdProp, description: 'Id of the block after which the paragraphs would be added.' },
        text: { type: 'string', minLength: 1, description: 'The paragraphs to add, one per line.' },
        reason: { type: 'string', description: 'Optional short explanation shown to the user.' },
      },
      required: ['afterBlockId', 'text'],
      additionalProperties: false,
    },
    annotations: overlay,
  },
  {
    name: 'withdraw_suggestions',
    title: 'Withdraw suggestions',
    description: 'Withdraws suggestions previously made with suggest_edits or suggest_insert that the user has not accepted or rejected yet.',
    inputSchema: { type: 'object', properties: { ids: idsProp('suggestions') }, additionalProperties: false },
    annotations: overlay,
  },
]

// ── Input checking ──────────────────────────────────────────────────────────

class InputError extends Error {}

type Obj = Record<string, unknown>

function asObject(value: unknown, where: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InputError(`${where} must be an object.`)
  return value as Obj
}

function str(obj: Obj, key: string, where: string, { required = false, nonEmpty = false } = {}): string | undefined {
  const value = obj[key]
  if (value === undefined || value === null) {
    if (required) throw new InputError(`${where}: "${key}" is required.`)
    return undefined
  }
  if (typeof value !== 'string') throw new InputError(`${where}: "${key}" must be a string.`)
  if (nonEmpty && !value) throw new InputError(`${where}: "${key}" must not be empty.`)
  return value
}

function list(obj: Obj, key: string, where: string, { required = false } = {}): unknown[] | undefined {
  const value = obj[key]
  if (value === undefined || value === null) {
    if (required) throw new InputError(`${where}: "${key}" is required.`)
    return undefined
  }
  if (!Array.isArray(value)) throw new InputError(`${where}: "${key}" must be an array.`)
  if (required && !value.length) throw new InputError(`${where}: "${key}" must not be empty.`)
  return value
}

function stringList(obj: Obj, key: string, where: string): string[] | undefined {
  const value = list(obj, key, where)
  if (value && value.some((v) => typeof v !== 'string')) throw new InputError(`${where}: "${key}" must be an array of strings.`)
  return value as string[] | undefined
}

function rejectUnknownKeys(obj: Obj, allowed: string[], where: string) {
  const unknown = Object.keys(obj).filter((key) => !allowed.includes(key))
  if (unknown.length) throw new InputError(`${where}: unknown field(s) ${unknown.map((k) => `"${k}"`).join(', ')}.`)
}

// ── Formatting ──────────────────────────────────────────────────────────────

function describeBlock(block: Block): string {
  const parts: string[] = [block.type === 'heading' ? `heading ${block.attrs.level}` : block.type]
  if (block.ancestors.length) parts.push(`(in ${block.ancestors.join(' > ')})`)
  let line = `[${block.id}] ${parts.join(' ')}`
  if (block.type === 'image') {
    const alt = block.attrs.alt ? ` alt=${JSON.stringify(block.attrs.alt)}` : ''
    line += `:${alt} src=${JSON.stringify(block.attrs.src ?? '')}`
  } else if (block.type !== 'horizontalRule') {
    line += `: ${JSON.stringify(block.text)}`
  }
  return line
}

const text = (value: string, structuredContent?: Obj): EditorToolResult =>
  ({ content: [{ type: 'text', text: value }], ...(structuredContent ? { structuredContent } : {}) })
const error = (message: string): EditorToolResult => ({ content: [{ type: 'text', text: message }], isError: true })

const NOT_FOUND_HINT = 'Quotes must be copied exactly from the block text returned by read_document; call read_document again if the user may have edited it.'

// ── Tools ───────────────────────────────────────────────────────────────────

function resolveEditor(source: EditorToolsSource): TiptapEditor | null {
  const target = typeof source === 'function' ? source() : source
  if (!target) return null
  if ('getEditor' in target && typeof target.getEditor === 'function') return target.getEditor()
  return target as TiptapEditor
}

/**
 * Builds the "instruction manual" for an LLM: tool definitions (MCP shape)
 * describing what it can do with the document — read it, read the user's
 * selection, annotate text, and *propose* edits the user accepts or rejects —
 * plus an `execute` function to run the calls the LLM makes.
 *
 * There is deliberately no tool that edits the document directly: the LLM
 * only ever proposes, and the user decides.
 *
 * ```ts
 * const { tools, execute } = createEditorTools(editorRef.current!)
 * // Send `tools` to your LLM; for each tool call it makes:
 * const result = execute(call.name, call.input)
 * ```
 */
export function createEditorTools(source: EditorToolsSource, options: EditorToolsOptions = {}): EditorTools {
  const layer = options.annotationLayer ?? 'assistant'
  const idPrefix = options.idPrefix ?? 'assistant-'
  const include = options.include ? new Set(options.include) : null
  const tools = DEFINITIONS
    .filter((tool) => !include || include.has(tool.name))
    .map((tool) => structuredClone(tool))
  const offered = new Set(tools.map((tool) => tool.name))
  const counters = { a: 0, s: 0 }
  const nextId = (kind: 'a' | 's') => `${idPrefix}${kind}${++counters[kind]}`
  const ownSuggestionIds = new Set<string>()

  const handlers: Record<EditorToolName, (editor: TiptapEditor, input: Obj) => EditorToolResult> = {
    read_document: (editor, input) => {
      rejectUnknownKeys(input, ['blockIds'], 'read_document')
      const only = stringList(input, 'blockIds', 'read_document')
      const all = getBlocks(editor.state.doc)
      const blocks = only ? all.filter((b) => only.includes(b.id)) : all
      const missing = only ? only.filter((id) => !all.some((b) => b.id === id)) : []
      const version = editor.storage.blockId?.version ?? 0
      const lines = [
        `Document version ${version}, ${blocks.length} block(s):`,
        ...blocks.map(describeBlock),
        ...(missing.length ? [`Not found (deleted or never existed): ${missing.join(', ')}`] : []),
      ]
      return text(lines.join('\n'), { version, blocks, ...(missing.length ? { missing } : {}) })
    },

    get_selection: (editor, input) => {
      rejectUnknownKeys(input, [], 'get_selection')
      const { from, to, empty } = editor.state.selection
      const touched: { blockId: string, selectedText: string, blockText: string }[] = []
      const visit = (node: typeof editor.state.doc, pos: number) => {
        if (!node.attrs.blockId) return true
        const start = Math.max(from, pos + 1)
        const end = Math.min(to, pos + node.nodeSize - 1)
        touched.push({
          blockId: node.attrs.blockId as string,
          selectedText: node.isTextblock && end > start ? editor.state.doc.textBetween(start, end, '\n', '\n') : '',
          blockText: node.textBetween(0, node.content.size, '\n', '\n'),
        })
        return false
      }
      if (empty) {
        const $pos = editor.state.selection.$from
        for (let depth = $pos.depth; depth >= 0; depth--) {
          if ($pos.node(depth).attrs.blockId) {
            visit($pos.node(depth), depth === 0 ? 0 : $pos.before(depth))
            break
          }
        }
      } else {
        editor.state.doc.nodesBetween(from, to, visit)
      }
      const selectedText = touched.map((t) => t.selectedText).filter(Boolean).join('\n')
      const summary = empty
        ? touched.length ? `Nothing selected. The cursor is in block [${touched[0].blockId}]: ${JSON.stringify(touched[0].blockText)}` : 'Nothing selected.'
        : `Selected text: ${JSON.stringify(selectedText)}\nIn block(s): ${touched.map((t) => `[${t.blockId}]`).join(', ')}`
      return text(summary, { empty, selectedText, blocks: touched })
    },

    annotate: (editor, input) => {
      rejectUnknownKeys(input, ['annotations'], 'annotate')
      const items = list(input, 'annotations', 'annotate', { required: true })!
      const created: Annotation[] = items.map((item, i) => {
        const where = `annotate: annotations[${i}]`
        const obj = asObject(item, where)
        rejectUnknownKeys(obj, ['blockId', 'quote', 'prefix', 'suffix', 'note', 'kind'], where)
        const note = str(obj, 'note', where, { required: true })!
        return {
          id: nextId('a'),
          blockId: str(obj, 'blockId', where, { required: true, nonEmpty: true })!,
          quote: str(obj, 'quote', where),
          prefix: str(obj, 'prefix', where),
          suffix: str(obj, 'suffix', where),
          kind: str(obj, 'kind', where),
          title: note,
          data: { note, source: 'assistant' },
        }
      })
      const ids = new Set(created.map((a) => a.id))
      const results = setAnnotations(editor, layer, [...getAnnotations(editor, layer), ...created])
        .filter((a) => ids.has(a.id))
        .map((a) => ({ id: a.id, blockId: a.blockId, status: a.status === 'active' ? 'added' : 'not_found' }))
      const notFound = results.filter((r) => r.status === 'not_found')
      return text([
        ...results.map((r) => `${r.id}: ${r.status} (block [${r.blockId}])`),
        ...(notFound.length ? [NOT_FOUND_HINT] : []),
      ].join('\n'), { results })
    },

    remove_annotations: (editor, input) => {
      rejectUnknownKeys(input, ['ids'], 'remove_annotations')
      const ids = stringList(input, 'ids', 'remove_annotations')
      const current = getAnnotations(editor, layer)
      const kept = ids ? current.filter((a) => !ids.includes(a.id)) : []
      setAnnotations(editor, layer, kept)
      const removed = current.length - kept.length
      return text(`Removed ${removed} annotation(s).`, { removed })
    },

    suggest_edits: (editor, input) => {
      rejectUnknownKeys(input, ['edits'], 'suggest_edits')
      const items = list(input, 'edits', 'suggest_edits', { required: true })!
      const suggestions: Suggestion[] = items.map((item, i) => {
        const where = `suggest_edits: edits[${i}]`
        const obj = asObject(item, where)
        rejectUnknownKeys(obj, ['blockId', 'quote', 'prefix', 'suffix', 'replacement', 'reason'], where)
        const reason = str(obj, 'reason', where)
        return {
          type: 'replace',
          id: nextId('s'),
          blockId: str(obj, 'blockId', where, { required: true, nonEmpty: true })!,
          quote: str(obj, 'quote', where, { required: true, nonEmpty: true })!,
          prefix: str(obj, 'prefix', where),
          suffix: str(obj, 'suffix', where),
          replacement: str(obj, 'replacement', where, { required: true })!,
          ...(reason ? { title: reason } : {}),
          data: { reason, source: 'assistant' },
        }
      })
      return proposed(editor, suggestions)
    },

    suggest_insert: (editor, input) => {
      rejectUnknownKeys(input, ['afterBlockId', 'text', 'reason'], 'suggest_insert')
      const reason = str(input, 'reason', 'suggest_insert')
      const body = str(input, 'text', 'suggest_insert', { required: true, nonEmpty: true })!
      if (!body.trim()) throw new InputError('suggest_insert: "text" must contain at least one non-empty line.')
      return proposed(editor, [{
        type: 'insertAfter',
        id: nextId('s'),
        blockId: str(input, 'afterBlockId', 'suggest_insert', { required: true, nonEmpty: true })!,
        text: body,
        ...(reason ? { title: reason } : {}),
        data: { reason, source: 'assistant' },
      }])
    },

    withdraw_suggestions: (editor, input) => {
      rejectUnknownKeys(input, ['ids'], 'withdraw_suggestions')
      const ids = stringList(input, 'ids', 'withdraw_suggestions')
      // Only ever the tools' own suggestions — never ones the host or another source added.
      const pending = new Set(getSuggestions(editor).map((s) => s.id))
      const targets = (ids ?? [...ownSuggestionIds]).filter((id) => ownSuggestionIds.has(id) && pending.has(id))
      removeSuggestions(editor, targets)
      for (const id of targets) ownSuggestionIds.delete(id)
      return text(`Withdrew ${targets.length} suggestion(s).`, { withdrawn: targets })
    },
  }

  function proposed(editor: TiptapEditor, suggestions: Suggestion[]): EditorToolResult {
    const results = addSuggestions(editor, suggestions).map((s) => ({
      id: s.id,
      blockId: s.blockId,
      status: s.status === 'active' ? 'pending_user_review' : 'not_found',
    }))
    // Not-found suggestions are useless to keep around: drop them right away.
    const notFound = results.filter((r) => r.status === 'not_found').map((r) => r.id)
    if (notFound.length) removeSuggestions(editor, notFound)
    for (const r of results) if (r.status !== 'not_found') ownSuggestionIds.add(r.id)
    return text([
      ...results.map((r) => `${r.id}: ${r.status} (block [${r.blockId}])`),
      ...(notFound.length ? [NOT_FOUND_HINT] : ['The user will accept or reject each suggestion.']),
    ].join('\n'), { results })
  }

  return {
    tools,
    execute: (name, input) => {
      if (!offered.has(name as EditorToolName)) {
        return error(`Unknown tool "${name}". Available tools: ${[...offered].join(', ')}.`)
      }
      const editor = resolveEditor(source)
      if (!editor || editor.isDestroyed) return error('The editor is not available right now. Try again later.')
      try {
        return handlers[name as EditorToolName](editor, asObject(input ?? {}, `${name} input`))
      } catch (e) {
        if (e instanceof InputError) return error(`Invalid input — ${e.message}`)
        return error(`The tool failed unexpectedly: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
  }
}
