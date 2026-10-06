import { afterEach, describe, expect, it } from 'vitest'
import { Editor as TiptapEditor, type Content } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { UploadableImage } from './imageExtension'
import { BlockId, getBlocks } from './blockId'
import { Annotations, getAnnotations, setAnnotations } from './annotations'
import { Suggestions, acceptSuggestion, addSuggestions, getSuggestions } from './suggestions'
import { createEditorTools, type EditorToolResult, type EditorToolsOptions } from './agentTools'

// See imageExtension.test.ts: every headless editor must be destroyed.
const liveEditors: TiptapEditor[] = []

async function makeEditor(content: Content) {
  let n = 0
  const editor = new TiptapEditor({
    extensions: [
      StarterKit,
      UploadableImage.configure({ inline: false }),
      BlockId.configure({ generateId: () => `id${++n}` }),
      Annotations,
      Suggestions,
    ],
    content,
  })
  liveEditors.push(editor)
  await new Promise<void>((resolve) => editor.on('create', () => resolve()))
  return editor
}

afterEach(() => {
  while (liveEditors.length) liveEditors.pop()!.destroy()
})

const PARAGRAPHS = '<p data-block-id="a">The quick brown fox</p><p data-block-id="b">jumps over the dog</p>'

async function setup(content: Content = PARAGRAPHS, options?: EditorToolsOptions) {
  const editor = await makeEditor(content)
  const tools = createEditorTools(editor, options)
  return { editor, ...tools }
}

const textOf = (result: EditorToolResult) => result.content.map((c) => c.text).join('\n')
const structured = <T = Record<string, unknown>>(result: EditorToolResult) => result.structuredContent as T
type Results = { results: { id: string, blockId: string, status: string }[] }

describe('tool definitions', () => {
  it('offers the seven tools in MCP shape', () => {
    const { tools } = createEditorTools(() => null)
    expect(tools.map((t) => t.name)).toEqual([
      'read_document', 'get_selection', 'annotate', 'remove_annotations',
      'suggest_edits', 'suggest_insert', 'withdraw_suggestions',
    ])
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
      expect(tool.title).toBeTruthy()
      expect(tool.description.length).toBeGreaterThan(40)
      expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
      expect(Object.keys(tool.annotations).sort()).toEqual(['destructiveHint', 'idempotentHint', 'openWorldHint', 'readOnlyHint'])
      expect(tool.annotations.destructiveHint).toBe(false)
      expect(tool.annotations.openWorldHint).toBe(false)
    }
  })

  it('declares every required field, at every level, in the schema properties', () => {
    const check = (schema: { properties?: Record<string, unknown>, required?: string[] }, path: string) => {
      for (const key of schema.required ?? []) expect(schema.properties, `${path}.${key}`).toHaveProperty(key)
      for (const [key, prop] of Object.entries(schema.properties ?? {})) {
        const items = (prop as { items?: { type?: string } }).items
        if (items?.type === 'object') check(items as typeof schema, `${path}.${key}[]`)
      }
    }
    for (const tool of createEditorTools(() => null).tools) check(tool.inputSchema, tool.name)
  })

  it('marks only the reading tools as read-only', () => {
    const readOnly = createEditorTools(() => null).tools.filter((t) => t.annotations.readOnlyHint).map((t) => t.name)
    expect(readOnly).toEqual(['read_document', 'get_selection'])
  })

  it('has no tool that edits the document directly', () => {
    const names = createEditorTools(() => null).tools.map((t) => t.name)
    expect(names.some((n) => /^(edit|replace|insert|delete|write|set)_/.test(n))).toBe(false)
  })

  it('is plain JSON, ready to send to any LLM API', () => {
    const { tools } = createEditorTools(() => null)
    expect(JSON.parse(JSON.stringify(tools))).toEqual(tools)
  })

  it('`include` limits the offered tools, and the others cannot be executed', async () => {
    const { tools, execute } = await setup(PARAGRAPHS, { include: ['read_document', 'annotate'] })
    expect(tools.map((t) => t.name)).toEqual(['read_document', 'annotate'])
    const result = execute('suggest_edits', { edits: [{ blockId: 'a', quote: 'quick', replacement: 'slow' }] })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('Available tools: read_document, annotate')
  })

  it('hands out independent copies of the definitions', () => {
    const one = createEditorTools(() => null).tools
    one[0].description = 'changed'
    expect(createEditorTools(() => null).tools[0].description).not.toBe('changed')
  })
})

describe('execute', () => {
  it('reports unknown tools as errors', async () => {
    const { execute } = await setup()
    const result = execute('delete_everything', {})
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('Unknown tool "delete_everything"')
  })

  it('never throws on malformed input', async () => {
    const { execute } = await setup()
    for (const input of [null, undefined, 'text', 42, [], { edits: 'nope' }, { edits: [null] }, { edits: [{}] }]) {
      expect(() => execute('suggest_edits', input)).not.toThrow()
    }
    expect(execute('suggest_edits', 'text').isError).toBe(true)
    expect(execute('read_document', undefined).isError).toBeUndefined()
  })

  it('reaches the editor through an EditorHandle-like object or a getter, resolved at call time', async () => {
    const editor = await makeEditor(PARAGRAPHS)
    expect(createEditorTools({ getEditor: () => editor }).execute('read_document', {}).isError).toBeUndefined()

    let current: TiptapEditor | null = null
    const { execute } = createEditorTools(() => current)
    expect(execute('read_document', {})).toMatchObject({ isError: true })
    expect(textOf(execute('read_document', {}))).toContain('not available')
    current = editor
    expect(execute('read_document', {}).isError).toBeUndefined()
  })

  it('reports a destroyed editor as unavailable', async () => {
    const { editor, execute } = await setup()
    editor.destroy()
    expect(execute('read_document', {}).isError).toBe(true)
  })

  it('returns JSON-serializable results', async () => {
    const { execute } = await setup()
    for (const [name, input] of [
      ['read_document', {}],
      ['get_selection', {}],
      ['annotate', { annotations: [{ blockId: 'a', quote: 'quick', note: 'n' }] }],
      ['suggest_edits', { edits: [{ blockId: 'a', quote: 'fox', replacement: 'cat' }] }],
    ] as const) {
      const result = execute(name, input)
      expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    }
  })
})

describe('read_document', () => {
  it('lists every block with its id, type, context and exact text', async () => {
    const { execute } = await setup(
      '<h2 data-block-id="h">Title</h2>'
      + '<ul><li><p data-block-id="li">Item "quoted"</p></li></ul>'
      + '<pre data-block-id="code"><code>a\nb</code></pre>'
      + '<hr data-block-id="hr">'
      + '<img data-block-id="img" src="pic.png" alt="A pic">'
      + '<p data-block-id="end">End</p>',
    )
    const result = execute('read_document', {})
    expect(textOf(result).split('\n')).toEqual([
      'Document version 0, 6 block(s):',
      '[h] heading 2: "Title"',
      '[li] paragraph (in bulletList > listItem): "Item \\"quoted\\""',
      '[code] codeBlock: "a\\nb"',
      '[hr] horizontalRule',
      '[img] image: alt="A pic" src="pic.png"',
      '[end] paragraph: "End"',
    ])
    expect(structured<{ blocks: unknown[] }>(result).blocks).toHaveLength(6)
  })

  it('reports the document version, which moves as the user edits', async () => {
    const { editor, execute } = await setup()
    expect(structured(execute('read_document', {})).version).toBe(0)
    editor.commands.insertContentAt(1, 'X')
    expect(structured(execute('read_document', {})).version).toBe(1)
  })

  it('can return just some blocks, and says which ones do not exist', async () => {
    const { execute } = await setup()
    const result = execute('read_document', { blockIds: ['b', 'ghost'] })
    expect(textOf(result)).toContain('[b] paragraph: "jumps over the dog"')
    expect(textOf(result)).not.toContain('[a]')
    expect(textOf(result)).toContain('Not found (deleted or never existed): ghost')
    expect(structured(result).missing).toEqual(['ghost'])
  })

  it('rejects unknown fields and wrongly typed ones', async () => {
    const { execute } = await setup()
    expect(textOf(execute('read_document', { page: 2 }))).toContain('unknown field(s) "page"')
    expect(textOf(execute('read_document', { blockIds: 'a' }))).toContain('"blockIds" must be an array')
    expect(textOf(execute('read_document', { blockIds: [1] }))).toContain('array of strings')
  })
})

describe('get_selection', () => {
  it('reports the block under the cursor when nothing is selected', async () => {
    const { editor, execute } = await setup()
    editor.commands.setTextSelection(editor.state.doc.content.size - 2)
    const result = execute('get_selection', {})
    expect(structured(result)).toMatchObject({
      empty: true, selectedText: '', blocks: [{ blockId: 'b', selectedText: '', blockText: 'jumps over the dog' }],
    })
    expect(textOf(result)).toContain('cursor is in block [b]')
  })

  it('reports the selected text within one block', async () => {
    const { editor, execute } = await setup()
    editor.commands.setTextSelection({ from: 5, to: 16 })
    expect(structured(execute('get_selection', {}))).toMatchObject({
      empty: false, selectedText: 'quick brown', blocks: [{ blockId: 'a', selectedText: 'quick brown' }],
    })
  })

  it('reports each block of a selection spanning several', async () => {
    const { editor, execute } = await setup()
    editor.commands.setTextSelection({ from: 15, to: editor.state.doc.child(0).nodeSize + 6 })
    const result = structured<{ selectedText: string, blocks: { blockId: string, selectedText: string }[] }>(execute('get_selection', {}))
    expect(result.blocks.map((b) => [b.blockId, b.selectedText])).toEqual([['a', 'n fox'], ['b', 'jumps']])
    expect(result.selectedText).toBe('n fox\njumps')
  })

  it('finds the block of a cursor inside a nested list', async () => {
    const { editor, execute } = await setup('<ul><li><p data-block-id="li">Item</p></li></ul><p data-block-id="end">End</p>')
    editor.commands.setTextSelection(4)
    expect(structured(execute('get_selection', {}))).toMatchObject({ blocks: [{ blockId: 'li', blockText: 'Item' }] })
  })
})

describe('annotate and remove_annotations', () => {
  it('adds annotations to the assistant layer with the note as tooltip and payload', async () => {
    const { editor, execute } = await setup()
    const result = execute('annotate', { annotations: [
      { blockId: 'a', quote: 'quick', note: 'Overused word', kind: 'style' },
      { blockId: 'b', note: 'Whole paragraph' },
    ] })
    expect(structured<Results>(result).results.map((r) => [r.id, r.status])).toEqual([
      ['assistant-a1', 'added'], ['assistant-a2', 'added'],
    ])
    const [first, second] = getAnnotations(editor, 'assistant')
    expect(first).toMatchObject({ quote: 'quick', kind: 'style', title: 'Overused word', data: { note: 'Overused word', source: 'assistant' } })
    expect(second).toMatchObject({ blockId: 'b', status: 'active' })
  })

  it('accumulates across calls instead of replacing earlier annotations', async () => {
    const { editor, execute } = await setup()
    execute('annotate', { annotations: [{ blockId: 'a', quote: 'quick', note: '1' }] })
    execute('annotate', { annotations: [{ blockId: 'a', quote: 'fox', note: '2' }] })
    expect(getAnnotations(editor, 'assistant').map((a) => a.quote)).toEqual(['quick', 'fox'])
  })

  it('reports quotes it cannot find, with a hint on how to fix them', async () => {
    const { execute } = await setup()
    const result = execute('annotate', { annotations: [{ blockId: 'a', quote: 'Quick', note: 'n' }] })
    expect(result.isError).toBeUndefined()
    expect(structured<Results>(result).results[0].status).toBe('not_found')
    expect(textOf(result)).toContain('copied exactly')
  })

  it('never touches annotations in other layers', async () => {
    const { editor, execute } = await setup()
    setAnnotations(editor, 'spelling', [{ id: 'host', blockId: 'a', quote: 'brown' }])
    execute('annotate', { annotations: [{ blockId: 'a', quote: 'quick', note: 'n' }] })
    execute('remove_annotations', {})
    expect(getAnnotations(editor, 'spelling').map((a) => a.id)).toEqual(['host'])
    expect(getAnnotations(editor, 'assistant')).toEqual([])
  })

  it('removes some annotations by id, or all of them', async () => {
    const { editor, execute } = await setup()
    execute('annotate', { annotations: [
      { blockId: 'a', quote: 'quick', note: '1' }, { blockId: 'a', quote: 'fox', note: '2' }, { blockId: 'b', note: '3' },
    ] })
    expect(structured(execute('remove_annotations', { ids: ['assistant-a1', 'nope'] })).removed).toBe(1)
    expect(getAnnotations(editor, 'assistant').map((a) => a.id)).toEqual(['assistant-a2', 'assistant-a3'])
    expect(textOf(execute('remove_annotations', {}))).toBe('Removed 2 annotation(s).')
  })

  it('numbers annotations and suggestions independently', async () => {
    const { execute } = await setup()
    execute('annotate', { annotations: [{ blockId: 'a', quote: 'quick', note: 'n' }] })
    const result = execute('suggest_edits', { edits: [{ blockId: 'a', quote: 'fox', replacement: 'cat' }] })
    expect(structured<Results>(result).results[0].id).toBe('assistant-s1')
  })

  it("keeps the host's whileEditing mode for the assistant layer when adding annotations", async () => {
    const { editor, execute } = await setup()
    setAnnotations(editor, 'assistant', [], { whileEditing: 'track' })
    execute('annotate', { annotations: [{ blockId: 'a', quote: 'quick', note: 'n' }] })
    editor.commands.insertContentAt(1 + 'The qu'.length, 'XX')
    expect(getAnnotations(editor, 'assistant')[0]).toMatchObject({ status: 'active', quote: 'quXXick' })
  })

  it('honors the annotationLayer and idPrefix options', async () => {
    const { editor, execute } = await setup(PARAGRAPHS, { annotationLayer: 'copilot', idPrefix: 'cp-' })
    execute('annotate', { annotations: [{ blockId: 'a', quote: 'quick', note: 'n' }] })
    expect(getAnnotations(editor, 'copilot').map((a) => a.id)).toEqual(['cp-a1'])
    expect(getAnnotations(editor, 'assistant')).toEqual([])
  })

  it('validates its input', async () => {
    const { execute } = await setup()
    const message = (input: unknown) => textOf(execute('annotate', input))
    expect(message({})).toContain('"annotations" is required')
    expect(message({ annotations: [] })).toContain('must not be empty')
    expect(message({ annotations: ['x'] })).toContain('annotations[0] must be an object')
    expect(message({ annotations: [{ blockId: 'a' }] })).toContain('"note" is required')
    expect(message({ annotations: [{ note: 'n' }] })).toContain('"blockId" is required')
    expect(message({ annotations: [{ blockId: 'a', note: 'n', color: 'red' }] })).toContain('unknown field(s) "color"')
    expect(message({ annotations: [{ blockId: 'a', note: 5 }] })).toContain('"note" must be a string')
  })
})

describe('suggest_edits, suggest_insert and withdraw_suggestions', () => {
  it('proposes replacements the user then accepts — the full loop', async () => {
    const { editor, execute } = await setup()
    // What an LLM would do: read, copy a quote from the text, propose.
    const doc = structured<{ blocks: { id: string, text: string }[] }>(execute('read_document', {}))
    const target = doc.blocks[0]
    const result = execute('suggest_edits', { edits: [
      { blockId: target.id, quote: target.text.slice(4, 9), replacement: 'slow', reason: 'Tone' },
    ] })
    expect(structured<Results>(result).results).toEqual([{ id: 'assistant-s1', blockId: 'a', status: 'pending_user_review' }])
    expect(textOf(result)).toContain('The user will accept or reject')
    expect(editor.getHTML()).toContain('The quick brown fox') // nothing changed yet

    expect(getSuggestions(editor)[0]).toMatchObject({ title: 'Tone', data: { reason: 'Tone', source: 'assistant' } })
    acceptSuggestion(editor, 'assistant-s1')
    expect(getBlocks(editor.state.doc)[0].text).toBe('The slow brown fox')
  })

  it('handles several edits at once, including deletions and disambiguated quotes', async () => {
    const { editor, execute } = await setup('<p data-block-id="a">one cat, two cat, done</p>')
    const result = execute('suggest_edits', { edits: [
      { blockId: 'a', quote: 'cat', prefix: 'two ', replacement: 'cats' },
      { blockId: 'a', quote: ', done', replacement: '' },
    ] })
    expect(structured<Results>(result).results.map((r) => r.status)).toEqual(['pending_user_review', 'pending_user_review'])
    acceptSuggestion(editor, 'assistant-s1')
    acceptSuggestion(editor, 'assistant-s2')
    expect(getBlocks(editor.state.doc)[0].text).toBe('one cat, two cats')
  })

  it('drops suggestions whose quote is not found, and explains how to fix them', async () => {
    const { editor, execute } = await setup()
    const result = execute('suggest_edits', { edits: [
      { blockId: 'a', quote: 'quick', replacement: 'slow' },
      { blockId: 'a', quote: 'purple', replacement: 'red' },
      { blockId: 'ghost', quote: 'fox', replacement: 'cat' },
    ] })
    expect(structured<Results>(result).results.map((r) => r.status)).toEqual(['pending_user_review', 'not_found', 'not_found'])
    expect(textOf(result)).toContain('copied exactly')
    expect(getSuggestions(editor).map((s) => s.id)).toEqual(['assistant-s1'])
  })

  it('validates edits', async () => {
    const { execute } = await setup()
    const message = (input: unknown) => textOf(execute('suggest_edits', input))
    expect(message({ edits: [] })).toContain('must not be empty')
    expect(message({ edits: [{ blockId: 'a', quote: '', replacement: 'x' }] })).toContain('"quote" must not be empty')
    expect(message({ edits: [{ blockId: 'a', quote: 'quick' }] })).toContain('"replacement" is required')
    expect(message({ edits: [{ blockId: 'a', quote: 'quick', replacement: 'x', confidence: 1 }] })).toContain('unknown field(s) "confidence"')
  })

  it('proposes new paragraphs after a block', async () => {
    const { editor, execute } = await setup()
    const result = execute('suggest_insert', { afterBlockId: 'a', text: 'New one.\nNew two.', reason: 'Bridge' })
    expect(structured<Results>(result).results[0]).toMatchObject({ id: 'assistant-s1', status: 'pending_user_review' })
    acceptSuggestion(editor, 'assistant-s1')
    expect(getBlocks(editor.state.doc).map((b) => b.text)).toEqual(['The quick brown fox', 'New one.', 'New two.', 'jumps over the dog'])
  })

  it('validates insertions', async () => {
    const { execute } = await setup()
    const message = (input: unknown) => textOf(execute('suggest_insert', input))
    expect(message({ text: 'x' })).toContain('"afterBlockId" is required')
    expect(message({ afterBlockId: 'a', text: '' })).toContain('"text" must not be empty')
    expect(message({ afterBlockId: 'a', text: ' \n ' })).toContain('at least one non-empty line')
    expect(structured<Results>(execute('suggest_insert', { afterBlockId: 'ghost', text: 'x' })).results[0].status).toBe('not_found')
  })

  it('withdraws only its own pending suggestions', async () => {
    const { editor, execute } = await setup()
    addSuggestions(editor, [{ type: 'replace', id: 'host', blockId: 'b', quote: 'dog', replacement: 'cat' }])
    execute('suggest_edits', { edits: [{ blockId: 'a', quote: 'quick', replacement: 'slow' }, { blockId: 'a', quote: 'fox', replacement: 'cat' }] })
    execute('suggest_insert', { afterBlockId: 'b', text: 'More' })
    acceptSuggestion(editor, 'assistant-s2')

    expect(structured(execute('withdraw_suggestions', { ids: ['assistant-s1', 'host', 'assistant-s2'] })).withdrawn).toEqual(['assistant-s1'])
    expect(structured(execute('withdraw_suggestions', {})).withdrawn).toEqual(['assistant-s3'])
    expect(getSuggestions(editor).map((s) => s.id)).toEqual(['host'])
  })
})
