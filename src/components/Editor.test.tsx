import { createRef } from 'react'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Extension } from '@tiptap/react'
import { Editor, type EditorHandle } from './Editor'

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
})
