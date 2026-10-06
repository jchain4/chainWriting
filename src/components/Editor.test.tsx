import { createRef, StrictMode } from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Extension } from '@tiptap/react'
import { PluginKey } from '@tiptap/pm/state'
import { Editor, type EditorHandle } from './Editor'
import { createHighlightPlugin, setHighlightRanges } from '../lib/highlightPlugin'
import { BlockId } from '../lib/blockId'
import { createEditorTools } from '../lib/agentTools'

function mockSelectionRect() {
  // jsdom implements neither Range.prototype.getBoundingClientRect nor
  // getClientRects (the latter is hit internally by ProseMirror's
  // coordsAtPos, used by Tiptap's default scroll-into-view-on-focus
  // behavior) — assign both directly, and restore afterwards.
  const rect = {
    width: 100, height: 20, top: 100, bottom: 120, left: 0, right: 100, x: 0, y: 100,
    toJSON: () => {},
  } as DOMRect
  const originalRect = Range.prototype.getBoundingClientRect
  const originalRects = Range.prototype.getClientRects
  Range.prototype.getBoundingClientRect = vi.fn(() => rect) as typeof Range.prototype.getBoundingClientRect
  Range.prototype.getClientRects = vi.fn(() => [rect]) as unknown as typeof Range.prototype.getClientRects
  return () => {
    Range.prototype.getBoundingClientRect = originalRect
    Range.prototype.getClientRects = originalRects
  }
}

async function renderReadyEditor(props: Partial<React.ComponentProps<typeof Editor>> = {}) {
  const ref = createRef<EditorHandle>()
  const utils = render(<Editor ref={ref} {...props} />)
  await waitFor(() => expect(ref.current?.isReady()).toBe(true))
  return { ref, ...utils }
}

describe('Editor', () => {
  it('exposes stable block ids via getBlocks() and reports edited blocks via onBlocksChange', async () => {
    const onBlocksChange = vi.fn()
    const { ref } = await renderReadyEditor({ initialContent: '<p data-block-id="a">One</p><p>Two</p>', onBlocksChange })
    await waitFor(() => expect(ref.current!.getBlocks()).toHaveLength(2))
    const [first, second] = ref.current!.getBlocks()
    expect(first).toMatchObject({ id: 'a', type: 'paragraph', text: 'One' })
    expect(second.id).toBeTruthy()

    ref.current!.getEditor()!.commands.insertContentAt(4, '!')
    expect(onBlocksChange).toHaveBeenLastCalledWith(expect.objectContaining({ updated: ['a'], added: [], removed: [] }))
    expect(ref.current!.getHTML()).toContain('data-block-id="a"')
  })

  it('always calls the latest onBlocksChange, even after a re-render with a new callback', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const ref = createRef<EditorHandle>()
    const { rerender } = render(<Editor ref={ref} initialContent="<p data-block-id='a'>One</p>" onBlocksChange={first} />)
    await waitFor(() => expect(ref.current?.getBlocks()).toHaveLength(1))

    rerender(<Editor ref={ref} initialContent="<p data-block-id='a'>One</p>" onBlocksChange={second} />)
    ref.current!.getEditor()!.commands.insertContentAt(4, '!')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ updated: ['a'] }))
  })

  it('reports content loaded through setContent as block changes', async () => {
    const onBlocksChange = vi.fn()
    const { ref } = await renderReadyEditor({ initialContent: '<p data-block-id="a">One</p>', onBlocksChange })
    await waitFor(() => expect(ref.current!.getBlocks()).toHaveLength(1))
    ref.current!.setContent('<p data-block-id="b">Two</p>')
    expect(onBlocksChange).toHaveBeenLastCalledWith(expect.objectContaining({ added: ['b'], removed: ['a'] }))
  })

  it('getBlocks() honors a custom BlockId passed through the extensions prop', async () => {
    const { ref } = await renderReadyEditor({
      initialContent: '<h2>Title</h2><p>Body</p>',
      extensions: [BlockId.configure({ types: ['heading'] })],
    })
    await waitFor(() => expect(ref.current!.getBlocks()).toHaveLength(1))
    expect(ref.current!.getBlocks()[0]).toMatchObject({ type: 'heading', text: 'Title' })
    expect(ref.current!.getHTML()).toContain('<p>Body</p>')
  })

  it('getBlocks(ids) on the ref handle returns just those blocks', async () => {
    const { ref } = await renderReadyEditor({ initialContent: '<p data-block-id="a">A</p><p data-block-id="b">B</p><p data-block-id="c">C</p>' })
    expect(ref.current!.getBlocks(['c', 'a']).map((b) => b.text)).toEqual(['A', 'C'])
  })

  it("passes setAnnotations options through the ref handle (whileEditing: 'track')", async () => {
    const { ref } = await renderReadyEditor({ initialContent: '<p data-block-id="a">The quick fox</p>' })
    ref.current!.setAnnotations('live', [{ id: 'x', blockId: 'a', quote: 'quick' }], { whileEditing: 'track' })
    ref.current!.getEditor()!.commands.insertContentAt(1 + 'The qu'.length, 'XX')
    expect(ref.current!.getAnnotations('live')[0]).toMatchObject({ status: 'active', quote: 'quXXick' })
  })

  it('focusAnnotation on the ref handle focuses the editor and selects the annotated text', async () => {
    const restore = mockSelectionRect()
    try {
      const { ref, container } = await renderReadyEditor({ initialContent: '<p data-block-id="a">The quick fox</p>' })
      ref.current!.setAnnotations('test', [{ id: 'x', blockId: 'a', quote: 'quick' }])
      expect(ref.current!.focusAnnotation('test', 'x')).toBe(true)
      expect(container.querySelector('.ProseMirror')).toHaveFocus()
      const { from, to } = ref.current!.getEditor()!.state.selection
      expect(ref.current!.getEditor()!.state.doc.textBetween(from, to)).toBe('quick')
      expect(ref.current!.focusAnnotation('test', 'missing')).toBe(false)
    } finally {
      // jsdom keeps focus and the document selection across tests (same
      // document); don't leak them into the next test.
      ;(document.activeElement as HTMLElement | null)?.blur()
      window.getSelection()?.removeAllRanges()
      restore()
    }
  })

  it('sets, reads and clears annotations through the ref handle', async () => {
    const { ref, container } = await renderReadyEditor({ initialContent: '<p data-block-id="a">The quick fox</p>' })
    await waitFor(() => expect(ref.current!.getBlocks()).toHaveLength(1))

    const [result] = ref.current!.setAnnotations('style', [{ id: 'x', blockId: 'a', quote: 'quick', kind: 'style' }])
    expect(result).toMatchObject({ id: 'x', layer: 'style', status: 'active' })
    expect(container.querySelector('.cw-annotation--style')).toHaveTextContent('quick')
    expect(ref.current!.getAnnotations('style')).toHaveLength(1)
    expect(ref.current!.getHTML()).not.toContain('cw-annotation')

    ref.current!.clearAnnotations()
    expect(ref.current!.getAnnotations()).toEqual([])
    expect(container.querySelector('.cw-annotation')).toBeNull()
  })

  it('forwards annotation click, hover and status-change events to the latest props', async () => {
    const onAnnotationClick = vi.fn()
    const onAnnotationHover = vi.fn()
    const onAnnotationStatusChange = vi.fn()
    const ref = createRef<EditorHandle>()
    const initial = '<p data-block-id="a">The quick fox</p>'
    const { rerender, container } = render(<Editor ref={ref} initialContent={initial} />)
    await waitFor(() => expect(ref.current?.getBlocks()).toHaveLength(1))
    rerender(<Editor
      ref={ref}
      initialContent={initial}
      onAnnotationClick={onAnnotationClick}
      onAnnotationHover={onAnnotationHover}
      onAnnotationStatusChange={onAnnotationStatusChange}
    />)
    const [a] = ref.current!.setAnnotations('test', [{ id: 'x', blockId: 'a', quote: 'quick' }])
    const editor = ref.current!.getEditor()!

    editor.view.someProp('handleClick', (h) => h(editor.view, a.from! + 1, new MouseEvent('click')))
    expect(onAnnotationClick).toHaveBeenCalledWith([expect.objectContaining({ id: 'x' })], expect.any(MouseEvent))

    fireEvent.mouseOver(container.querySelector('.cw-annotation')!)
    expect(onAnnotationHover).toHaveBeenCalledWith([expect.objectContaining({ id: 'x' })], expect.any(MouseEvent))

    editor.commands.deleteRange({ from: a.from!, to: a.to! })
    expect(onAnnotationStatusChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'x', status: 'stale' })])
  })

  it('proposes, accepts and rejects suggestions through the ref handle, forwarding events to the latest props', async () => {
    const onSuggestionAccept = vi.fn()
    const onSuggestionReject = vi.fn()
    const onSuggestionStatusChange = vi.fn()
    const ref = createRef<EditorHandle>()
    const initial = '<p data-block-id="a">The quick fox</p><p data-block-id="b">Second</p>'
    const { rerender, container } = render(<Editor ref={ref} initialContent={initial} />)
    await waitFor(() => expect(ref.current?.getBlocks()).toHaveLength(2))
    rerender(<Editor
      ref={ref}
      initialContent={initial}
      onSuggestionAccept={onSuggestionAccept}
      onSuggestionReject={onSuggestionReject}
      onSuggestionStatusChange={onSuggestionStatusChange}
    />)

    const results = ref.current!.addSuggestions([
      { type: 'replace', id: 'r', blockId: 'a', quote: 'quick', replacement: 'slow' },
      { type: 'insertAfter', id: 'i', blockId: 'b', text: 'Third' },
      { type: 'replace', id: 'gone', blockId: 'b', quote: 'Second', replacement: '2nd' },
    ])
    expect(results.map((s) => s.status)).toEqual(['active', 'active', 'active'])
    expect(container.querySelector('ins.cw-suggestion-insert')).toHaveTextContent('slow')

    expect(ref.current!.acceptSuggestion('r')).toBe(true)
    expect(onSuggestionAccept).toHaveBeenCalledWith(expect.objectContaining({ id: 'r' }))
    expect(ref.current!.getBlocks()[0].text).toBe('The slow fox')

    expect(ref.current!.rejectSuggestion('i')).toBe(true)
    expect(onSuggestionReject).toHaveBeenCalledWith(expect.objectContaining({ id: 'i' }))

    ref.current!.getEditor()!.commands.insertContentAt(ref.current!.getEditor()!.state.doc.content.size - 2, 'X')
    expect(onSuggestionStatusChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'gone', status: 'stale' })])

    ref.current!.removeSuggestions()
    expect(ref.current!.getSuggestions()).toEqual([])
  })

  it('hides the suggestion buttons with showSuggestionControls={false}', async () => {
    const { ref, container } = await renderReadyEditor({
      initialContent: '<p data-block-id="a">The quick fox</p>',
      showSuggestionControls: false,
    })
    await waitFor(() => expect(ref.current!.getBlocks()).toHaveLength(1))
    ref.current!.addSuggestions([{ type: 'replace', id: 'r', blockId: 'a', quote: 'quick', replacement: 'slow' }])
    expect(container.querySelector('ins.cw-suggestion-insert')).toBeInTheDocument()
    expect(container.querySelector('.cw-suggestion-controls')).toBeNull()
  })

  it('works with createEditorTools through the ref handle: read, annotate and suggest on the live component', async () => {
    const { ref, container } = await renderReadyEditor({ initialContent: '<p data-block-id="a">The quick fox</p>' })
    await waitFor(() => expect(ref.current!.getBlocks()).toHaveLength(1))
    const { execute } = createEditorTools(() => ref.current)

    expect(execute('read_document', {}).content[0].text).toContain('[a] paragraph: "The quick fox"')
    execute('annotate', { annotations: [{ blockId: 'a', quote: 'fox', note: 'Animal' }] })
    execute('suggest_edits', { edits: [{ blockId: 'a', quote: 'quick', replacement: 'slow' }] })
    expect(container.querySelector('.cw-annotation')).toHaveTextContent('fox')
    expect(container.querySelector('ins.cw-suggestion-insert')).toHaveTextContent('slow')
    expect(ref.current!.getAnnotations('assistant')).toHaveLength(1)

    expect(ref.current!.acceptSuggestion('assistant-s1')).toBe(true)
    expect(ref.current!.getBlocks()[0].text).toBe('The slow fox')
  })

  describe('onReady / isReady', () => {
    it('calls onReady once, with the initial blocks already carrying ids', async () => {
      const onReady = vi.fn()
      const ref = createRef<EditorHandle>()
      render(<Editor ref={ref} initialContent="<h2>Title</h2><p>Body</p>" onReady={onReady} />)
      await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
      const [blocks] = onReady.mock.calls[0]
      expect(blocks.map((b: { type: string, text: string }) => [b.type, b.text])).toEqual([['heading', 'Title'], ['paragraph', 'Body']])
      expect(blocks.every((b: { id: string }) => b.id)).toBe(true)
      expect(blocks).toEqual(ref.current!.getBlocks())
    })

    it('lets the host use the ref handle inside onReady', async () => {
      const ref = createRef<EditorHandle>()
      let result: unknown
      render(<Editor
        ref={ref}
        initialContent="<p>The quick fox</p>"
        onReady={(blocks) => {
          result = ref.current!.setAnnotations('test', [{ id: 'x', blockId: blocks[0].id, quote: 'quick' }])
        }}
      />)
      await waitFor(() => expect(result).toEqual([expect.objectContaining({ id: 'x', status: 'active' })]))
    })

    it('does not call onReady again after edits, setContent or re-renders', async () => {
      const onReady = vi.fn()
      const ref = createRef<EditorHandle>()
      const { rerender } = render(<Editor ref={ref} initialContent="<p>One</p>" onReady={onReady} />)
      await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
      ref.current!.setContent('<p>Two</p>')
      ref.current!.getEditor()!.commands.insertContentAt(1, 'x')
      rerender(<Editor ref={ref} initialContent="<p>One</p>" onReady={onReady} placeholder="other" />)
      await new Promise((r) => setTimeout(r, 20))
      expect(onReady).toHaveBeenCalledTimes(1)
    })

    it('calls onReady only once under React StrictMode (effects run twice in development)', async () => {
      const onReady = vi.fn()
      render(<StrictMode><Editor initialContent="<p>One</p>" onReady={onReady} /></StrictMode>)
      await waitFor(() => expect(onReady).toHaveBeenCalled())
      await new Promise((r) => setTimeout(r, 20))
      expect(onReady).toHaveBeenCalledTimes(1)
    })

    it('uses the latest onReady passed before the editor became ready', async () => {
      const first = vi.fn()
      const second = vi.fn()
      const { rerender } = render(<Editor initialContent="<p>One</p>" onReady={first} />)
      rerender(<Editor initialContent="<p>One</p>" onReady={second} />)
      await waitFor(() => expect(second).toHaveBeenCalledTimes(1))
      expect(first).not.toHaveBeenCalled()
    })

    it('isReady() is false right after mount and true by the time onReady fires', async () => {
      const ref = createRef<EditorHandle>()
      let readyInsideCallback: boolean | undefined
      render(<Editor ref={ref} initialContent="<p>One</p>" onReady={() => { readyInsideCallback = ref.current!.isReady() }} />)
      expect(ref.current!.isReady()).toBe(false)
      await waitFor(() => expect(readyInsideCallback).toBe(true))
    })

    it('warns once when annotations or suggestions are set before the editor is ready', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const ref = createRef<EditorHandle>()
        render(<Editor ref={ref} initialContent="<p>One</p>" />)
        const early = ref.current!.setAnnotations('test', [{ id: 'x', blockId: 'a', quote: 'One' }])
        expect(early.every((a) => a.status !== 'active')).toBe(true)
        ref.current!.addSuggestions([{ type: 'replace', id: 's', blockId: 'a', quote: 'One', replacement: 'Two' }])
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0][0]).toContain('setAnnotations() was called before the editor was ready')

        await waitFor(() => expect(ref.current!.isReady()).toBe(true))
        warn.mockClear()
        const [block] = ref.current!.getBlocks()
        ref.current!.setAnnotations('test', [{ id: 'x', blockId: block.id, quote: 'One' }])
        expect(warn).not.toHaveBeenCalled()
      } finally {
        warn.mockRestore()
      }
    })
  })

  it('renders the .cw-editor root without throwing', async () => {
    const { container } = await renderReadyEditor()
    expect(container.querySelector('.cw-editor')).toBeInTheDocument()
  })

  it('applies the className prop on the .cw-editor root for scoped theming', async () => {
    const { container } = await renderReadyEditor({ className: 'my-theme' })
    expect(container.querySelector('.cw-editor')).toHaveClass('my-theme')
  })

  it('mounts without throwing and becomes ready (SSR-safety proxy for immediatelyRender: false)', async () => {
    const ref = createRef<EditorHandle>()
    render(<Editor ref={ref} />)
    await waitFor(() => expect(ref.current?.isReady()).toBe(true))
  })

  it('exposes setContent/getHTML/getJSON/clear via the ref handle', async () => {
    const { ref } = await renderReadyEditor()

    ref.current!.setContent('<p>hello</p>')
    expect(ref.current!.getHTML()).toContain('hello')
    expect(ref.current!.getJSON()).toMatchObject({ type: 'doc' })

    ref.current!.clear()
    expect(ref.current!.getHTML()).not.toContain('hello')
  })

  it('exposes the raw Tiptap editor instance via getEditor', async () => {
    const { ref } = await renderReadyEditor()
    expect(ref.current!.getEditor()?.commands).toBeTruthy()
  })

  it('fires onChange when setContent is called with the default emitUpdate', async () => {
    const onChange = vi.fn()
    const { ref } = await renderReadyEditor({ onChange })
    onChange.mockClear()

    ref.current!.setContent('<p>from ref</p>')
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('from ref'))
  })

  it('does not fire onChange when setContent is called with emitUpdate: false', async () => {
    const onChange = vi.fn()
    const { ref } = await renderReadyEditor({ onChange })
    onChange.mockClear()

    ref.current!.setContent('<p>silent</p>', { emitUpdate: false })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('merges a custom extension via the extensions prop without dropping built-in defaults', async () => {
    const testMark = Extension.create({ name: 'testMark' })
    const { ref } = await renderReadyEditor({ extensions: [testMark] })
    const names = ref.current!.getEditor()!.extensionManager.extensions.map((e) => e.name)
    expect(names).toContain('testMark')
    expect(names).toContain('bold')
  })

  it('registers image, table, and slash-command extensions by default', async () => {
    const { ref } = await renderReadyEditor()
    const names = ref.current!.getEditor()!.extensionManager.extensions.map((e) => e.name)
    expect(names).toEqual(expect.arrayContaining([
      'image', 'table', 'tableRow', 'tableCell', 'tableHeader', 'slashCommand',
    ]))
  })

  it('inserts an image by URL via the setImage command', async () => {
    const { ref } = await renderReadyEditor()
    ref.current!.getEditor()!.chain().focus().setImage({ src: 'https://x/a.png', alt: 'A' }).run()
    const html = ref.current!.getHTML()
    expect(html).toContain('<img')
    expect(html).toContain('src="https://x/a.png"')
  })

  it('inserts a table and supports adding/removing rows and columns', async () => {
    const { ref } = await renderReadyEditor()
    const editor = ref.current!.getEditor()!

    editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()
    let html = ref.current!.getHTML()
    expect(html).toContain('<table')
    expect((html.match(/<tr/g) ?? []).length).toBe(2)
    expect((html.match(/<td|<th/g) ?? []).length).toBe(4)

    editor.chain().focus().addRowAfter().run()
    editor.chain().focus().addColumnAfter().run()
    html = ref.current!.getHTML()
    expect((html.match(/<tr/g) ?? []).length).toBe(3)

    editor.chain().focus().deleteRow().run()
    html = ref.current!.getHTML()
    expect((html.match(/<tr/g) ?? []).length).toBe(2)

    editor.chain().focus().deleteTable().run()
    expect(ref.current!.getHTML()).not.toContain('<table')
  })

  describe('editable prop', () => {
    it('defaults to editable', async () => {
      const { ref } = await renderReadyEditor()
      expect(ref.current!.getEditor()!.isEditable).toBe(true)
    })

    it('honors editable={false} at mount', async () => {
      const { ref } = await renderReadyEditor({ editable: false })
      expect(ref.current!.getEditor()!.isEditable).toBe(false)
    })

    it('reactively syncs isEditable when the prop changes after mount', async () => {
      const { ref, rerender } = await renderReadyEditor({ editable: true })
      const editor = ref.current!.getEditor()!
      expect(editor.isEditable).toBe(true)

      rerender(<Editor ref={ref} editable={false} />)
      await waitFor(() => expect(editor.isEditable).toBe(false))

      rerender(<Editor ref={ref} editable={true} />)
      await waitFor(() => expect(editor.isEditable).toBe(true))
    })
  })

  describe('lifecycle callbacks', () => {
    it('fires onSelectionUpdate when the selection moves', async () => {
      const onSelectionUpdate = vi.fn()
      const { ref } = await renderReadyEditor({ initialContent: '<p>hello world</p>', onSelectionUpdate })
      const editor = ref.current!.getEditor()!
      onSelectionUpdate.mockClear()

      editor.chain().focus().setTextSelection({ from: 1, to: 6 }).run()
      expect(onSelectionUpdate).toHaveBeenCalledWith(editor)
    })

    it('fires onFocus and onBlur', async () => {
      const onFocus = vi.fn()
      const onBlur = vi.fn()
      const { ref } = await renderReadyEditor({ onFocus, onBlur })
      const editor = ref.current!.getEditor()!

      editor.commands.focus()
      await waitFor(() => expect(onFocus).toHaveBeenCalledWith(editor, expect.anything()))

      editor.commands.blur()
      await waitFor(() => expect(onBlur).toHaveBeenCalledWith(editor, expect.anything()))
    })
  })

  describe('AI-readiness: highlight decorations', () => {
    it('registers, renders, and unregisters a highlight plugin without touching document content', async () => {
      const { ref, container } = await renderReadyEditor({ initialContent: '<p>hello world</p>' })
      const editor = ref.current!.getEditor()!
      const key = new PluginKey('test-highlight')

      editor.registerPlugin(createHighlightPlugin(key))
      setHighlightRanges(editor, key, [{ id: 'a', from: 1, to: 6, title: 'flag' }])

      await waitFor(() => expect(container.querySelector('[data-highlight-id="a"]')).toBeInTheDocument())
      const span = container.querySelector('[data-highlight-id="a"]')!
      expect(span).toHaveClass('cw-highlight-range')
      expect(span.getAttribute('title')).toBe('flag')

      expect(ref.current!.getHTML()).not.toContain('cw-highlight-range')

      editor.unregisterPlugin(key)
      await waitFor(() => expect(container.querySelector('[data-highlight-id="a"]')).not.toBeInTheDocument())
    })
  })

  describe('accessibility', () => {
    it('does not preventDefault on Tab when no floating toolbar is visible (keyboard-trap regression guard)', async () => {
      const { ref } = await renderReadyEditor()
      const dom = ref.current!.getEditor()!.view.dom
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      dom.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    })

    // These two use the table toolbar rather than the bubble menu: its
    // visibility is driven purely by editor.isActive('table') (ProseMirror
    // state), with no dependency on window.getSelection()/Range sync — the
    // bubble menu's visibility check does depend on that, and jsdom's timing
    // for it proved unreliable in isolation even though the underlying
    // useRovingToolbar/handleKeyDown mechanism is identical either way.
    it('Tab moves DOM focus to the table toolbar when visible, and Escape returns it to the editor', async () => {
      const { ref, container } = await renderReadyEditor()
      const editor = ref.current!.getEditor()!

      editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()
      await waitFor(() => expect(container.querySelector('.cw-table-menu')).toBeInTheDocument())

      const dom = editor.view.dom
      const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      dom.dispatchEvent(tabEvent)

      expect(tabEvent.defaultPrevented).toBe(true)
      const firstButton = container.querySelector('.cw-table-menu button')
      await waitFor(() => expect(document.activeElement).toBe(firstButton))

      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
      await waitFor(() => expect(document.activeElement).toBe(dom))
    })

    it('arrow keys move roving focus between table toolbar buttons', async () => {
      const { ref, container } = await renderReadyEditor()
      const editor = ref.current!.getEditor()!

      editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()
      await waitFor(() => expect(container.querySelector('.cw-table-menu')).toBeInTheDocument())

      editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
      // Re-queried fresh on every assertion/retry rather than snapshotted
      // once: TableToolbar recomputes its position (and can briefly unmount
      // via coords becoming null) on every editor 'transaction' event, not
      // just 'selectionUpdate' — a stale NodeList could otherwise hold
      // references to buttons from a since-replaced toolbar instance.
      const queryButtons = () => container.querySelectorAll('.cw-table-menu button')
      await waitFor(() => expect(document.activeElement).toBe(queryButtons()[0]))

      fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
      await waitFor(() => expect(document.activeElement).toBe(queryButtons()[1]))
      expect(queryButtons()[1].getAttribute('tabindex')).toBe('0')
      expect(queryButtons()[0].getAttribute('tabindex')).toBe('-1')
    })

    it('aria-pressed on the bold button reflects the active formatting state', async () => {
      const restoreRect = mockSelectionRect()
      const { ref, container, rerender } = await renderReadyEditor({ initialContent: '<p>hello world</p>' })
      const editor = ref.current!.getEditor()!

      editor.chain().focus().setTextSelection({ from: 1, to: 6 }).run()
      await waitFor(() => expect(container.querySelector('.cw-bubble-menu')).toBeInTheDocument())

      const boldButton = container.querySelector('.cw-bubble-menu button[data-format="bold"]')!
      expect(boldButton.getAttribute('aria-pressed')).toBe('false')

      editor.chain().focus().toggleBold().run()
      // Toggling a mark without moving the selection doesn't fire Tiptap's
      // own selectionUpdate event (it only fires on an actual selection
      // change), so nothing re-renders BubbleToolbar on its own — in real
      // usage this is masked by the host re-rendering on `onChange`. Force
      // that same re-render here rather than relying on onChange plumbing.
      rerender(<Editor ref={ref} initialContent="<p>hello world</p>" />)
      await waitFor(() => expect(boldButton.getAttribute('aria-pressed')).toBe('true'))

      restoreRect()
    })
  })
})
