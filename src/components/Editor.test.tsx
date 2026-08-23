import { createRef } from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Extension } from '@tiptap/react'
import { Editor, type EditorHandle } from './Editor'

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
      const buttons = container.querySelectorAll('.cw-table-menu button')
      await waitFor(() => expect(document.activeElement).toBe(buttons[0]))

      fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
      expect(document.activeElement).toBe(buttons[1])
      expect(buttons[1].getAttribute('tabindex')).toBe('0')
      expect(buttons[0].getAttribute('tabindex')).toBe('-1')
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
