import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor as TiptapEditor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { SlashCommand, type SlashCommandState } from './slashCommandExtension'

// See imageExtension.test.ts: every headless editor must be destroyed.
const liveEditors: TiptapEditor[] = []
afterEach(() => {
  while (liveEditors.length) liveEditors.pop()!.destroy()
})

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
/** Types "/" and waits for the menu's items, which the suggestion plugin resolves asynchronously. */
async function openMenu(editor: TiptapEditor) {
  editor.commands.insertContent('/')
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function makeEditor() {
  const onStateChange = vi.fn<(state: SlashCommandState | null) => void>()
  const editor = new TiptapEditor({
    extensions: [
      StarterKit,
      SlashCommand.configure({
        items: [{ id: 'quote', label: 'Cita', icon: null, execute: () => {} }],
        onStateChange,
        getKeyHandler: () => null,
      }),
    ],
    content: '<p></p>',
  })
  liveEditors.push(editor)
  await new Promise<void>((resolve) => editor.on('create', () => resolve()))
  return { editor, onStateChange }
}

describe('SlashCommand menu placement', () => {
  it('re-emits its state (so the menu is re-placed) when the page or a scroll container scrolls', async () => {
    const { editor, onStateChange } = await makeEditor()
    await openMenu(editor)
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ items: [expect.objectContaining({ id: 'quote' })] }))
    const calls = onStateChange.mock.calls.length

    window.dispatchEvent(new Event('scroll'))
    await nextFrame()
    expect(onStateChange).toHaveBeenCalledTimes(calls + 1)

    const panel = document.createElement('div')
    document.body.append(panel)
    panel.dispatchEvent(new Event('scroll'))
    await nextFrame()
    expect(onStateChange).toHaveBeenCalledTimes(calls + 2)
    panel.remove()

    window.dispatchEvent(new Event('resize'))
    await nextFrame()
    expect(onStateChange).toHaveBeenCalledTimes(calls + 3)
  })

  it('re-emits at most once per frame', async () => {
    const { editor, onStateChange } = await makeEditor()
    await openMenu(editor)
    const calls = onStateChange.mock.calls.length
    for (let i = 0; i < 10; i++) window.dispatchEvent(new Event('scroll'))
    await nextFrame()
    expect(onStateChange).toHaveBeenCalledTimes(calls + 1)
  })

  it('re-places the menu with its current items, not the ones it opened with', async () => {
    const { editor, onStateChange } = await makeEditor()
    await openMenu(editor)
    // The menu opens with no items (they arrive asynchronously, in an update):
    // a scroll must re-place it with the items it has *now*.
    window.dispatchEvent(new Event('scroll'))
    await nextFrame()
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ items: [expect.objectContaining({ id: 'quote' })] }))

    editor.commands.insertContent('x') // "/x" matches no item
    await new Promise((resolve) => setTimeout(resolve, 0))
    window.dispatchEvent(new Event('scroll'))
    await nextFrame()
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ items: [] }))
  })

  it('stops following once the menu closes', async () => {
    const { editor, onStateChange } = await makeEditor()
    await openMenu(editor)
    editor.commands.deleteRange({ from: 1, to: 2 })
    expect(onStateChange).toHaveBeenLastCalledWith(null)
    const calls = onStateChange.mock.calls.length

    window.dispatchEvent(new Event('scroll'))
    await nextFrame()
    expect(onStateChange).toHaveBeenCalledTimes(calls)
  })

  it('does not follow anything before the menu ever opens', async () => {
    const { onStateChange } = await makeEditor()
    window.dispatchEvent(new Event('scroll'))
    await nextFrame()
    expect(onStateChange).not.toHaveBeenCalled()
  })
})
