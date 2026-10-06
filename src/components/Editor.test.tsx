import { createRef, StrictMode } from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Extension } from '@tiptap/react'
import { PluginKey } from '@tiptap/pm/state'
import { Editor, type EditorHandle, type EditorSurface } from './Editor'
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

/**
 * jsdom does no layout, so every element measures 0×0 at the top of the
 * page — which the table toolbar (rightly) treats as "the table scrolled out
 * of view". Give tables a realistic on-screen box instead.
 */
function mockTableRect(rect: Partial<DOMRect> = {}) {
  const box = { width: 300, height: 100, top: 200, bottom: 300, left: 20, right: 320, x: 20, y: 200, toJSON: () => {}, ...rect } as DOMRect
  const original = HTMLTableElement.prototype.getBoundingClientRect
  HTMLTableElement.prototype.getBoundingClientRect = () => box
  return () => { HTMLTableElement.prototype.getBoundingClientRect = original }
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

  describe('features', () => {
    const extensionNames = (ref: React.RefObject<EditorHandle | null>) =>
      ref.current!.getEditor()!.extensionManager.extensions.map((e) => e.name)
    const nodes = (ref: React.RefObject<EditorHandle | null>) => Object.keys(ref.current!.getEditor()!.schema.nodes)
    const marks = (ref: React.RefObject<EditorHandle | null>) => Object.keys(ref.current!.getEditor()!.schema.marks)

    function cleanupFocus() {
      ;(document.activeElement as HTMLElement | null)?.blur()
      window.getSelection()?.removeAllRanges()
    }

    /** Selects some text so the bubble menu shows, and returns its button formats and divider count. */
    async function bubbleButtons(props: Partial<React.ComponentProps<typeof Editor>>) {
      const restore = mockSelectionRect()
      try {
        const { ref, container } = await renderReadyEditor({ initialContent: '<p>hello world</p>', ...props })
        const editor = ref.current!.getEditor()!
        editor.commands.focus()
        await waitFor(() => expect(document.activeElement).toBe(editor.view.dom))
        editor.commands.setTextSelection({ from: 1, to: 6 })
        await waitFor(() => expect(container.querySelector('.cw-bubble-menu')).toBeInTheDocument())
        const menu = container.querySelector('.cw-bubble-menu')!
        return {
          formats: [...menu.querySelectorAll('button')].map((b) => b.getAttribute('data-format')),
          dividers: menu.querySelectorAll('.cw-bubble-menu__divider').length,
          menu,
        }
      } finally {
        cleanupFocus()
        restore()
      }
    }

    it('offers everything by default', async () => {
      const { ref } = await renderReadyEditor()
      expect(nodes(ref)).toEqual(expect.arrayContaining(['heading', 'blockquote', 'bulletList', 'orderedList', 'codeBlock', 'horizontalRule', 'image', 'table']))
      expect(marks(ref)).toContain('link')
      expect(extensionNames(ref)).toContain('slashCommand')
      const { formats, dividers } = await bubbleButtons({})
      expect(formats).toEqual(['bold', 'italic', 'underline', 'strike', 'h1', 'h2', 'h3', 'blockquote', 'link'])
      expect(dividers).toBe(3)
    })

    it('removes each disabled feature from the editor itself', async () => {
      const { ref } = await renderReadyEditor({
        features: { headings: false, blockquote: false, lists: false, codeBlock: false, horizontalRule: false, links: false, images: false, tables: false },
      })
      for (const node of ['heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'codeBlock', 'horizontalRule', 'image', 'table']) {
        expect(nodes(ref)).not.toContain(node)
      }
      expect(marks(ref)).not.toContain('link')
      expect(marks(ref)).toEqual(expect.arrayContaining(['bold', 'italic', 'underline', 'strike']))
    })

    it('converts content of a disabled kind instead of keeping it (e.g. pasted or loaded)', async () => {
      const { ref } = await renderReadyEditor({
        features: { headings: false, lists: false, links: false, images: false, tables: false },
        initialContent: '<h2>Title</h2><ul><li><p>Item</p></li></ul><p><a href="https://x.y">link</a></p>'
          + '<img src="a.png"><table><tr><td><p>Cell</p></td></tr></table>',
      })
      const blocks = ref.current!.getBlocks()
      expect(blocks.map((b) => [b.type, b.text])).toEqual([['paragraph', 'Title'], ['paragraph', 'Item'], ['paragraph', 'link'], ['paragraph', 'Cell']])
      expect(ref.current!.getHTML()).not.toMatch(/<(h2|ul|a|img|table)\b/)
    })

    it('hides the bubble menu buttons of disabled features, keeping dividers only between groups', async () => {
      const noHeadings = await bubbleButtons({ features: { headings: false } })
      expect(noHeadings.formats).toEqual(['bold', 'italic', 'underline', 'strike', 'blockquote', 'link'])
      expect(noHeadings.dividers).toBe(2)

      const marksOnly = await bubbleButtons({ features: { headings: false, blockquote: false, links: false } })
      expect(marksOnly.formats).toEqual(['bold', 'italic', 'underline', 'strike'])
      expect(marksOnly.dividers).toBe(0)
    })

    it('keeps the bubble menu keyboard navigation in step with the visible buttons', async () => {
      const restore = mockSelectionRect()
      try {
        const { ref, container } = await renderReadyEditor({ initialContent: '<p>hello world</p>', features: { headings: false, links: false } })
        const editor = ref.current!.getEditor()!
        editor.commands.focus()
        await waitFor(() => expect(document.activeElement).toBe(editor.view.dom))
        editor.commands.setTextSelection({ from: 1, to: 6 })
        await waitFor(() => expect(container.querySelector('.cw-bubble-menu')).toBeInTheDocument())
        const buttons = () => [...container.querySelectorAll('.cw-bubble-menu button')] as HTMLElement[]
        expect(buttons().filter((b) => b.getAttribute('tabindex') === '0')).toHaveLength(1)
        editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
        await waitFor(() => expect(document.activeElement).toBe(buttons()[0]))
        fireEvent.keyDown(buttons()[0], { key: 'End' })
        await waitFor(() => expect(document.activeElement).toBe(buttons()[buttons().length - 1]))
        expect(buttons()[buttons().length - 1].getAttribute('data-format')).toBe('blockquote')
      } finally {
        cleanupFocus()
        restore()
      }
    })

    it('can turn off the bubble menu and the "/" menu entirely', async () => {
      const { ref } = await renderReadyEditor({ features: { slashMenu: false } })
      expect(extensionNames(ref)).not.toContain('slashCommand')

      const restore = mockSelectionRect()
      try {
        const { ref: ref2, container } = await renderReadyEditor({ initialContent: '<p>hello world</p>', features: { bubbleMenu: false } })
        const editor = ref2.current!.getEditor()!
        editor.commands.focus()
        await waitFor(() => expect(document.activeElement).toBe(editor.view.dom))
        editor.commands.setTextSelection({ from: 1, to: 6 })
        await new Promise((r) => setTimeout(r, 50))
        expect(container.querySelector('.cw-bubble-menu')).toBeNull()
      } finally {
        cleanupFocus()
        restore()
      }
    })

    it('drops the "/" menu when every item in it is disabled', async () => {
      const { ref } = await renderReadyEditor({
        features: { headings: false, lists: false, blockquote: false, links: false, images: false, tables: false },
      })
      expect(extensionNames(ref)).not.toContain('slashCommand')
    })

    it('lists only the enabled items in the "/" menu', async () => {
      const { ref, container } = await renderReadyEditor({ features: { tables: false, images: false, headings: false } })
      const editor = ref.current!.getEditor()!
      editor.commands.focus()
      await waitFor(() => expect(document.activeElement).toBe(editor.view.dom))
      editor.commands.insertContent('/')
      await waitFor(() => expect(container.querySelector('.cw-slash-menu')).toBeInTheDocument())
      // The label is the button's own text, next to its icon (whose SVG may contain text too).
      const labels = [...container.querySelectorAll('.cw-slash-menu button')]
        .map((b) => [...b.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(''))
      expect(labels).toEqual(['Lista', 'Lista numerada', 'Cita', 'Enlace'])
      cleanupFocus()
    })

    it('never shows the table toolbar with tables off', async () => {
      const { container } = await renderReadyEditor({ features: { tables: false } })
      expect(container.querySelector('.cw-table-menu')).toBeNull()
    })

    it('ignores pasted and dropped image files with images off, even with onImageUpload', async () => {
      const onImageUpload = vi.fn(() => Promise.resolve('https://x/a.png'))
      const { ref } = await renderReadyEditor({ onImageUpload, features: { images: false } })
      const view = ref.current!.getEditor()!.view
      const file = new File(['x'], 'a.png', { type: 'image/png' })
      const paste = Object.assign(new Event('paste'), { clipboardData: { files: [file], getData: () => '' } }) as unknown as ClipboardEvent
      const drop = Object.assign(new Event('drop'), { dataTransfer: { files: [file] }, clientX: 0, clientY: 0 }) as unknown as DragEvent
      expect(view.someProp('handlePaste', (f) => f(view, paste, view.state.doc.slice(0, 0)))).toBeFalsy()
      expect(view.someProp('handleDrop', (f) => f(view, drop, view.state.doc.slice(0, 0), false))).toBeFalsy()
      expect(onImageUpload).not.toHaveBeenCalled()
    })

    it('reads features once, at construction, so the menus never offer what the editor cannot hold', async () => {
      const restore = mockSelectionRect()
      try {
        const ref = createRef<EditorHandle>()
        const { rerender, container } = render(<Editor ref={ref} initialContent="<p>hello world</p>" features={{ headings: false }} />)
        await waitFor(() => expect(ref.current?.isReady()).toBe(true))
        rerender(<Editor ref={ref} initialContent="<p>hello world</p>" features={{ headings: true }} />)
        expect(nodes(ref)).not.toContain('heading')

        const editor = ref.current!.getEditor()!
        editor.commands.focus()
        await waitFor(() => expect(document.activeElement).toBe(editor.view.dom))
        editor.commands.setTextSelection({ from: 1, to: 6 })
        await waitFor(() => expect(container.querySelector('.cw-bubble-menu')).toBeInTheDocument())
        expect(container.querySelector('.cw-bubble-menu button[data-format="h1"]')).toBeNull()
      } finally {
        cleanupFocus()
        restore()
      }
    })

    it('still supports blocks, annotations and suggestions in a stripped-down comment box', async () => {
      const { ref } = await renderReadyEditor({
        initialContent: '<p data-block-id="c">A nice comment</p>',
        features: { headings: false, lists: false, blockquote: false, codeBlock: false, horizontalRule: false, images: false, tables: false, slashMenu: false },
      })
      expect(ref.current!.getBlocks()).toEqual([expect.objectContaining({ id: 'c', text: 'A nice comment' })])
      expect(ref.current!.setAnnotations('t', [{ id: 'a', blockId: 'c', quote: 'nice' }])[0].status).toBe('active')
      ref.current!.addSuggestions([{ type: 'replace', id: 's', blockId: 'c', quote: 'nice', replacement: 'great' }])
      expect(ref.current!.acceptSuggestion('s')).toBe(true)
      expect(ref.current!.getBlocks()[0].text).toBe('A great comment')
    })
  })

  describe('opt-in options', () => {
    const root = (container: HTMLElement) => container.querySelector('.cw-editor') as HTMLElement

    it('turns none of them on by default', async () => {
      const { container } = await renderReadyEditor()
      expect(root(container)).not.toHaveAttribute('data-content-style')
      expect(root(container)).not.toHaveAttribute('data-content-width')
      expect(root(container)).not.toHaveAttribute('data-fill')
      expect(root(container).style.getPropertyValue('--cw-content-width')).toBe('')
    })

    it('contentStyle applies prose or compact styles, and updates live', async () => {
      const ref = createRef<EditorHandle>()
      const { container, rerender } = render(<Editor ref={ref} contentStyle="prose" />)
      expect(root(container)).toHaveAttribute('data-content-style', 'prose')
      rerender(<Editor ref={ref} contentStyle="compact" />)
      expect(root(container)).toHaveAttribute('data-content-style', 'compact')
      rerender(<Editor ref={ref} contentStyle="none" />)
      expect(root(container)).not.toHaveAttribute('data-content-style')
    })

    it('contentWidth sets a centred column of that width, and can be removed', async () => {
      const ref = createRef<EditorHandle>()
      const { container, rerender } = render(<Editor ref={ref} contentWidth="70ch" />)
      expect(root(container)).toHaveAttribute('data-content-width')
      expect(root(container).style.getPropertyValue('--cw-content-width')).toBe('70ch')
      rerender(<Editor ref={ref} />)
      expect(root(container)).not.toHaveAttribute('data-content-width')
      expect(root(container).style.getPropertyValue('--cw-content-width')).toBe('')
    })

    it('fill stretches the editor to its container', async () => {
      const { container } = await renderReadyEditor({ fill: true })
      expect(root(container)).toHaveAttribute('data-fill')
    })

    describe('menuTheme', () => {
      /** Renders the editor inside a "page" with the given text colour. */
      async function onPage(color: string, props: Partial<React.ComponentProps<typeof Editor>> = {}) {
        const page = document.createElement('div')
        page.style.color = color
        document.body.append(page)
        const ref = createRef<EditorHandle>()
        const utils = render(<Editor ref={ref} {...props} />, { container: page })
        await waitFor(() => expect(ref.current?.isReady()).toBe(true))
        return { ...utils, ref, page, theme: () => root(page).dataset.menuTheme }
      }

      it('auto (default) picks light menus on a page with dark text, dark menus with light text', async () => {
        const light = await onPage('rgb(55, 65, 81)')
        expect(light.theme()).toBe('light')
        const dark = await onPage('rgb(232, 230, 227)')
        expect(dark.theme()).toBe('dark')
        light.page.remove(); dark.page.remove()
      })

      it('can be forced to light or dark whatever the page', async () => {
        const forcedDark = await onPage('rgb(55, 65, 81)', { menuTheme: 'dark' })
        expect(forcedDark.theme()).toBe('dark')
        const forcedLight = await onPage('rgb(232, 230, 227)', { menuTheme: 'light' })
        expect(forcedLight.theme()).toBe('light')
        forcedDark.page.remove(); forcedLight.page.remove()
      })

      it('follows a change of the prop', async () => {
        const { rerender, ref, page, theme } = await onPage('rgb(55, 65, 81)', { menuTheme: 'dark' })
        rerender(<Editor ref={ref} menuTheme="auto" />)
        expect(theme()).toBe('light')
        page.remove()
      })

      it('re-checks the page on focus, in case the host switched themes', async () => {
        const { ref, page, theme } = await onPage('rgb(55, 65, 81)')
        expect(theme()).toBe('light')
        page.style.color = 'rgb(240, 240, 240)'
        const editor = ref.current!.getEditor()!
        editor.commands.focus()
        await waitFor(() => expect(theme()).toBe('dark'))
        ;(document.activeElement as HTMLElement | null)?.blur()
        page.remove()
      })
    })

    describe('onSubmit (Ctrl/Cmd+Enter)', () => {
      const press = (dom: Element, init: KeyboardEventInit) => {
        const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init })
        dom.dispatchEvent(event)
        return event
      }

      it('submits the current HTML on Ctrl+Enter and Cmd+Enter, without adding a line', async () => {
        const onSubmit = vi.fn()
        const { ref } = await renderReadyEditor({ initialContent: '<p>Nice post</p>', onSubmit })
        const editor = ref.current!.getEditor()!
        editor.commands.setTextSelection(10)
        const before = editor.getHTML()
        expect(press(editor.view.dom, { ctrlKey: true }).defaultPrevented).toBe(true)
        expect(press(editor.view.dom, { metaKey: true }).defaultPrevented).toBe(true)
        expect(onSubmit).toHaveBeenCalledTimes(2)
        expect(onSubmit).toHaveBeenLastCalledWith(before)
        expect(editor.getHTML()).toBe(before)
      })

      it('submits what is in the editor now, not what it started with', async () => {
        const onSubmit = vi.fn()
        const { ref } = await renderReadyEditor({ initialContent: '<p>Draft</p>', onSubmit })
        const editor = ref.current!.getEditor()!
        editor.commands.insertContentAt(6, ' v2')
        press(editor.view.dom, { ctrlKey: true })
        expect(onSubmit.mock.lastCall![0]).toContain('Draft v2')
      })

      it('leaves Shift+Enter, Alt+Enter and plain Enter alone', async () => {
        const onSubmit = vi.fn()
        const { ref } = await renderReadyEditor({ initialContent: '<p>Hi</p>', onSubmit })
        const dom = ref.current!.getEditor()!.view.dom
        press(dom, { ctrlKey: true, shiftKey: true })
        press(dom, { ctrlKey: true, altKey: true })
        press(dom, {})
        press(dom, { shiftKey: true })
        expect(onSubmit).not.toHaveBeenCalled()
      })

      it('keeps the default Ctrl+Enter behaviour (a line break) without onSubmit', async () => {
        const { ref } = await renderReadyEditor({ initialContent: '<p>Hi</p>' })
        const editor = ref.current!.getEditor()!
        editor.commands.setTextSelection(3)
        press(editor.view.dom, { ctrlKey: true })
        expect(editor.getHTML()).toContain('<br>')
      })

      it('uses the latest callback', async () => {
        const first = vi.fn()
        const second = vi.fn()
        const ref = createRef<EditorHandle>()
        const { rerender } = render(<Editor ref={ref} onSubmit={first} />)
        await waitFor(() => expect(ref.current?.isReady()).toBe(true))
        rerender(<Editor ref={ref} onSubmit={second} />)
        press(ref.current!.getEditor()!.view.dom, { ctrlKey: true })
        expect(first).not.toHaveBeenCalled()
        expect(second).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('Ctrl+K', () => {
    const ctrlK = () => {
      const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      return event
    }

    it('is left alone for the rest of the page when no editor has focus', async () => {
      await renderReadyEditor({ initialContent: '<p>hello</p>' })
      expect(ctrlK().defaultPrevented).toBe(false)
    })

    it('only opens the link popover in the editor being written in', async () => {
      const restore = mockSelectionRect()
      try {
        const first = await renderReadyEditor({ initialContent: '<p>first</p>' })
        const second = await renderReadyEditor({ initialContent: '<p>second</p>' })
        const editor = second.ref.current!.getEditor()!
        editor.commands.focus()
        await waitFor(() => expect(document.activeElement).toBe(editor.view.dom))
        editor.commands.setTextSelection({ from: 1, to: 4 })
        expect(ctrlK().defaultPrevented).toBe(true)
        await waitFor(() => expect(second.container.querySelector('.cw-link-popover')).toBeInTheDocument())
        expect(first.container.querySelector('.cw-link-popover')).toBeNull()
      } finally {
        ;(document.activeElement as HTMLElement | null)?.blur()
        window.getSelection()?.removeAllRanges()
        restore()
      }
    })

    it('does nothing with links turned off', async () => {
      const restore = mockSelectionRect()
      try {
        const { ref, container } = await renderReadyEditor({ initialContent: '<p>hello</p>', features: { links: false } })
        const editor = ref.current!.getEditor()!
        editor.commands.focus()
        await waitFor(() => expect(document.activeElement).toBe(editor.view.dom))
        editor.commands.setTextSelection({ from: 1, to: 4 })
        expect(ctrlK().defaultPrevented).toBe(false)
        expect(container.querySelector('.cw-link-popover')).toBeNull()
      } finally {
        ;(document.activeElement as HTMLElement | null)?.blur()
        window.getSelection()?.removeAllRanges()
        restore()
      }
    })
  })

  describe('floating UI follows the text', () => {
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    /** Like mockSelectionRect, but the rect can be moved — as scrolling would. */
    function movableSelectionRect() {
      const rect = { width: 100, height: 20, top: 300, bottom: 320, left: 50, right: 150, x: 50, y: 300, toJSON: () => {} }
      const originalRect = Range.prototype.getBoundingClientRect
      const originalRects = Range.prototype.getClientRects
      Range.prototype.getBoundingClientRect = function () { return { ...rect } as DOMRect }
      Range.prototype.getClientRects = function () { return [{ ...rect }] as unknown as DOMRectList }
      const moveTo = (top: number) => Object.assign(rect, { top, bottom: top + 20, y: top })
      return {
        moveTo,
        restore: () => {
          Range.prototype.getBoundingClientRect = originalRect
          Range.prototype.getClientRects = originalRects
        },
      }
    }

    function cleanupFocus() {
      ;(document.activeElement as HTMLElement | null)?.blur()
      window.getSelection()?.removeAllRanges()
    }

    async function withSelectedText() {
      const rect = movableSelectionRect()
      const utils = await renderReadyEditor({ initialContent: '<p>hello world</p>' })
      // Focus first and wait for it (Tiptap focuses on the next frame), so the
      // DOM selection exists by the time the bubble measures it.
      const editor = utils.ref.current!.getEditor()!
      editor.commands.focus()
      await waitFor(() => expect(document.activeElement).toBe(editor.view.dom))
      editor.commands.setTextSelection({ from: 1, to: 6 })
      await waitFor(() => expect(utils.container.querySelector('.cw-bubble-menu')).toBeInTheDocument())
      const bubbleTop = () => (utils.container.querySelector('.cw-bubble-menu') as HTMLElement | null)?.style.top
      return { ...utils, ...rect, bubbleTop }
    }

    it('re-places the bubble menu when the page scrolls', async () => {
      const { moveTo, restore, bubbleTop } = await withSelectedText()
      try {
        expect(bubbleTop()).toBe('256px') // 300 - 36 - 8
        moveTo(200)
        window.dispatchEvent(new Event('scroll'))
        await waitFor(() => expect(bubbleTop()).toBe('156px'))
      } finally { cleanupFocus(); restore() }
    })

    it('leaves room for the bubble menu at its scaled size (--cw-ui-scale)', async () => {
      document.documentElement.style.setProperty('--cw-ui-scale', '2')
      const { restore, bubbleTop } = await withSelectedText()
      try {
        expect(bubbleTop()).toBe('212px') // 300 - 36×2 - 8×2
      } finally {
        document.documentElement.style.removeProperty('--cw-ui-scale')
        cleanupFocus(); restore()
      }
    })

    it('centres the cursor in the editor’s scroll container in typewriter mode, not the page', async () => {
      const restore = mockSelectionRect()
      const panel = document.createElement('div')
      panel.style.overflowY = 'auto'
      Object.defineProperty(panel, 'scrollHeight', { configurable: true, value: 3000 })
      Object.defineProperty(panel, 'clientHeight', { configurable: true, value: 400 })
      const panelScroll = vi.fn()
      panel.scrollTo = panelScroll as unknown as typeof panel.scrollTo
      document.body.append(panel)
      const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
      try {
        const ref = createRef<EditorHandle>()
        render(<Editor ref={ref} typewriterMode initialContent="<p>hello</p>" />, { container: panel })
        await waitFor(() => expect(ref.current?.isReady()).toBe(true))
        ref.current!.getEditor()!.commands.insertContentAt(2, 'x')
        await waitFor(() => expect(panelScroll).toHaveBeenCalled())
        expect(windowScroll).not.toHaveBeenCalled()
      } finally {
        windowScroll.mockRestore()
        panel.remove()
        cleanupFocus(); restore()
      }
    })

    it('re-places it when a scroll container (not the page) scrolls', async () => {
      const { moveTo, restore, bubbleTop } = await withSelectedText()
      const panel = document.createElement('div')
      document.body.append(panel)
      try {
        moveTo(150)
        panel.dispatchEvent(new Event('scroll'))
        await waitFor(() => expect(bubbleTop()).toBe('106px'))
      } finally { panel.remove(); cleanupFocus(); restore() }
    })

    it('hides the bubble while the selection is scrolled out of view, and brings it back', async () => {
      const { moveTo, restore, container } = await withSelectedText()
      try {
        moveTo(-200)
        window.dispatchEvent(new Event('scroll'))
        await waitFor(() => expect(container.querySelector('.cw-bubble-menu')).toBeNull())
        moveTo(300)
        window.dispatchEvent(new Event('scroll'))
        await waitFor(() => expect(container.querySelector('.cw-bubble-menu')).toBeInTheDocument())
      } finally { cleanupFocus(); restore() }
    })

    it('does not bring the bubble back on scroll once the editor lost focus', async () => {
      const { restore, container, ref } = await withSelectedText()
      try {
        const editor = ref.current!.getEditor()!
        editor.commands.blur()
        await waitFor(() => expect(container.querySelector('.cw-bubble-menu')).toBeNull())
        // In a real browser the text can stay selected after the editor loses
        // focus (e.g. switching tabs); reproduce that before scrolling.
        const range = document.createRange()
        range.selectNodeContents(editor.view.dom.querySelector('p')!)
        window.getSelection()!.addRange(range)
        window.dispatchEvent(new Event('scroll'))
        await nextFrame()
        await new Promise((r) => setTimeout(r, 200))
        expect(container.querySelector('.cw-bubble-menu')).toBeNull()
      } finally { cleanupFocus(); restore() }
    })

    it('re-places the link popover when the page scrolls', async () => {
      const { moveTo, restore, container } = await withSelectedText()
      try {
        fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
        await waitFor(() => expect(container.querySelector('.cw-link-popover')).toBeInTheDocument())
        const popoverTop = () => (container.querySelector('.cw-link-popover') as HTMLElement).style.top
        expect(popoverTop()).toBe('330px') // bottom 320 + 10
        moveTo(100)
        window.dispatchEvent(new Event('scroll'))
        await waitFor(() => expect(popoverTop()).toBe('130px'))
      } finally { cleanupFocus(); restore() }
    })

    describe('table toolbar', () => {
      async function inTable(rect: Partial<DOMRect>) {
        const restoreTable = mockTableRect(rect)
        const utils = await renderReadyEditor()
        utils.ref.current!.getEditor()!.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()
        const toolbar = () => utils.container.querySelector('.cw-table-menu') as HTMLElement | null
        return { ...utils, restoreTable, toolbar }
      }

      it('sits just above the table', async () => {
        const { toolbar, restoreTable } = await inTable({ top: 200, bottom: 300 })
        try {
          await waitFor(() => expect(toolbar()?.style.top).toBe('160px'))
        } finally { cleanupFocus(); restoreTable() }
      })

      it('sticks to the top edge while a long table is scrolled partly out of view', async () => {
        const { toolbar, restoreTable } = await inTable({ top: -400, bottom: 300 })
        try {
          await waitFor(() => expect(toolbar()?.style.top).toBe('8px'))
        } finally { cleanupFocus(); restoreTable() }
      })

      it('hides once the table has scrolled away', async () => {
        const { toolbar, restoreTable } = await inTable({ top: -400, bottom: 30 })
        try {
          await new Promise((r) => setTimeout(r, 50))
          expect(toolbar()).toBeNull()
        } finally { cleanupFocus(); restoreTable() }
      })

      it('follows the table when the page scrolls', async () => {
        const box = { top: 200, bottom: 300 }
        const { toolbar, restoreTable } = await inTable(box)
        restoreTable()
        const restoreMoved = mockTableRect({ top: 120, bottom: 220 })
        try {
          await waitFor(() => expect(toolbar()).not.toBeNull())
          window.dispatchEvent(new Event('scroll'))
          await waitFor(() => expect(toolbar()?.style.top).toBe('80px'))
        } finally { cleanupFocus(); restoreMoved() }
      })
    })
  })

  describe('surface and keyboard focus ring', () => {
    const root = (container: HTMLElement) => container.querySelector('.cw-editor')!

    /** Focuses the editor the way the browser would after Tab or a click. */
    async function focusWith(input: 'keyboard' | 'pointer', props: Partial<React.ComponentProps<typeof Editor>> = {}) {
      const restore = mockSelectionRect()
      const utils = await renderReadyEditor({ initialContent: '<p>Hello</p>', ...props })
      if (input === 'keyboard') fireEvent.keyDown(document, { key: 'Tab' })
      else fireEvent.pointerDown(document.body)
      utils.ref.current!.getEditor()!.commands.focus()
      // Tiptap's focus command focuses on the next animation frame.
      await waitFor(() => expect(document.activeElement).toBe(utils.container.querySelector('.ProseMirror')))
      return { ...utils, restore }
    }

    function cleanupFocus(restore: () => void) {
      // jsdom keeps focus and the document selection across tests.
      ;(document.activeElement as HTMLElement | null)?.blur()
      window.getSelection()?.removeAllRanges()
      restore()
    }

    it('uses the volume surface by default', async () => {
      const { container } = await renderReadyEditor()
      expect(root(container)).toHaveAttribute('data-surface', 'volume')
    })

    it('applies the surface prop, and updates it live', async () => {
      const ref = createRef<EditorHandle>()
      const { container, rerender } = render(<Editor ref={ref} surface="glass" />)
      expect(root(container)).toHaveAttribute('data-surface', 'glass')
      rerender(<Editor ref={ref} surface="ring" />)
      expect(root(container)).toHaveAttribute('data-surface', 'ring')
    })

    it('shows the keyboard focus ring when the editor is reached with Tab', async () => {
      const { container, restore } = await focusWith('keyboard')
      try {
        expect(root(container)).toHaveAttribute('data-keyboard-focus')
      } finally {
        cleanupFocus(restore)
      }
    })

    it('does not show it when the editor is focused by clicking', async () => {
      const { container, restore } = await focusWith('pointer')
      try {
        expect(root(container)).not.toHaveAttribute('data-keyboard-focus')
      } finally {
        cleanupFocus(restore)
      }
    })

    it('hides it once the user starts typing, but not on Shift or Tab alone', async () => {
      const { container, restore } = await focusWith('keyboard')
      try {
        const dom = container.querySelector('.ProseMirror')!
        fireEvent.keyDown(dom, { key: 'Shift' })
        expect(root(container)).toHaveAttribute('data-keyboard-focus')
        fireEvent.keyDown(dom, { key: 'a' })
        expect(root(container)).not.toHaveAttribute('data-keyboard-focus')
      } finally {
        cleanupFocus(restore)
      }
    })

    it('hides it on a click inside, and on blur', async () => {
      const clicked = await focusWith('keyboard')
      try {
        fireEvent.pointerDown(clicked.container.querySelector('.ProseMirror')!)
        expect(root(clicked.container)).not.toHaveAttribute('data-keyboard-focus')
      } finally {
        cleanupFocus(clicked.restore)
      }
      clicked.unmount()

      const blurred = await focusWith('keyboard')
      try {
        expect(root(blurred.container)).toHaveAttribute('data-keyboard-focus')
        blurred.ref.current!.getEditor()!.commands.blur()
        await waitFor(() => expect(root(blurred.container)).not.toHaveAttribute('data-keyboard-focus'))
      } finally {
        cleanupFocus(blurred.restore)
      }
    })

    it('stops listening for keys and pointers once unmounted', async () => {
      const add = vi.spyOn(document, 'addEventListener')
      const remove = vi.spyOn(document, 'removeEventListener')
      try {
        const { unmount } = await renderReadyEditor()
        const added = add.mock.calls.filter(([type]) => type === 'keydown' || type === 'pointerdown')
        unmount()
        for (const [type, listener] of added) {
          expect(remove.mock.calls.some(([t, l]) => t === type && l === listener)).toBe(true)
        }
      } finally {
        add.mockRestore()
        remove.mockRestore()
      }
    })

    it('has a stylesheet rule for every surface', async () => {
      // ?raw: the stylesheet's source text (plain CSS imports are stubbed in tests).
      const css = (await import('../editor.css?raw')).default
      const surfaces: EditorSurface[] = ['volume', 'glass', 'hairline', 'ring', 'underline']
      for (const surface of surfaces) expect(css).toContain(`[data-surface="${surface}"]`)
      expect(css).toContain('.cw-editor[data-keyboard-focus] .ProseMirror:focus')
      // Table colours follow the page's text colour, so they show on light pages too.
      expect(css).toMatch(/--cw-table-border:\s*color-mix\(in srgb, currentColor/)
      expect(css).toMatch(/--cw-table-header-bg:\s*color-mix\(in srgb, currentColor/)
      // Floating menus are sized in --cw-u (scales with the user's font size
      // and --cw-ui-scale): no fixed pixel sizes left, except hairline borders.
      // Based on the user's default font size (medium), not the page's root size.
      expect(css).toMatch(/@property --cw-u \{\s*syntax: '<length>';\s*inherits: true;/)
      expect(css).toMatch(/\.cw-bubble-menu,\s*\.cw-link-popover,\s*\.cw-slash-menu \{\s*font-size: medium;\s*--cw-u: calc\(1em \/ 16 \* var\(--cw-ui-scale, 1\)\);/)
      expect(css).not.toContain('rem * var(--cw-ui-scale')
      // (Forced-colours outlines below are deliberately crisp fixed-width lines.)
      const scaledPart = css.slice(0, css.indexOf('@media (forced-colors: active)'))
      for (const [, selector, body] of scaledPart.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/^\s*\.cw-(bubble-menu|link-|slash-menu|table-menu)/.test(selector.trim().split('\n').pop()!)) continue
        for (const declaration of body.split(';')) {
          if (/^\s*(border|-webkit-backdrop-filter|backdrop-filter|text-underline-offset)\s*:|^\s*width:\s*1px|calc\(100vw - 16px\)/.test(declaration)) continue
          expect(declaration, selector.trim()).not.toMatch(/\d+px/)
        }
      }
      // Forced colours (Windows High Contrast) drop box shadows: real outlines instead.
      const forced = css.slice(css.indexOf('@media (forced-colors: active)'))
      expect(forced).toMatch(/\.cw-editor \.ProseMirror:focus \{\s*outline: 2px solid Highlight;/)
      expect(forced).toMatch(/\.cw-bubble-menu button:focus-visible,[^{]*\{\s*outline: 2px solid Highlight;/)
      expect(forced).toContain('.cw-slash-menu button.is-active')
      // Tokens have zero specificity, so any host selector overrides them.
      expect(css).toContain(':where(.cw-editor) {\n  --cw-bubble-bg:')
      expect(css).toContain(':where(.cw-editor[data-menu-theme="light"]) {')
      // No hard-coded menu colours outside the token blocks (a host's own palette must win).
      expect(css).not.toMatch(/\.cw-link-remove:hover \{[^}]*#/)
      // Opt-in content styles, readable column and fill.
      for (const style of ['prose', 'compact']) {
        expect(css).toMatch(new RegExp(`:where\\(\\.cw-editor\\[data-content-style="${style}"\\]\\) \\.ProseMirror p \\{`))
      }
      expect(css).toMatch(/\.cw-editor\[data-content-width\] \.ProseMirror \{\s*padding-inline: max\(1rem, calc\(\(100% - var\(--cw-content-width\)\) \/ 2\)\);/)
      expect(css).toMatch(/\.cw-editor\[data-fill\] \.ProseMirror \{\s*flex: 1;/)
      // Height limits for constrained inputs such as a comment box.
      expect(css).toContain('min-height: var(--cw-min-height, auto)')
      expect(css).toContain('max-height: var(--cw-max-height, none)')
    })
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
    let restoreTableRect: () => void
    beforeEach(() => { restoreTableRect = mockTableRect() })
    afterEach(() => restoreTableRect())

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
