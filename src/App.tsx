import { useCallback, useEffect, useRef, useState } from 'react'
import { Editor } from './components/Editor'
import { Footer } from './components/Footer'
import { Sidebar } from './components/Sidebar'
import { countWords, downloadMarkdown } from './lib/exportMarkdown'
import {
  createDoc,
  deleteDoc,
  getDoc,
  getCurrentDocId,
  listDocs,
  migrateLegacy,
  setCurrentDocId,
  type Doc,
} from './lib/storage'

export default function App() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [activeDoc, setActiveDoc] = useState<Doc | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [typewriterMode, setTypewriterMode] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [currentHtml, setCurrentHtml] = useState('')
  const [ready, setReady] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)

  // Bootstrap: migrate legacy data, load docs and active doc
  useEffect(() => {
    async function init() {
      const migrated = await migrateLegacy()
      const allDocs = await listDocs()
      const currentId = await getCurrentDocId()

      let current: Doc | null = null
      if (migrated) { current = migrated; allDocs.unshift(migrated) }
      else if (currentId) { current = (await getDoc(currentId)) ?? null }
      if (!current && allDocs.length > 0) current = allDocs[0]
      if (!current) { current = await createDoc(); allDocs.unshift(current) }

      await setCurrentDocId(current.id)
      setDocs(allDocs)
      setActiveDoc(current)
      setCurrentHtml(current.content)
      setReady(true)
    }
    init()
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key === '\\') { e.preventDefault(); setSidebarOpen(o => !o) }
      if (mod && e.key === 't') { e.preventDefault(); setTypewriterMode(m => !m) }
      if (mod && e.shiftKey && e.key === 'F') { e.preventDefault(); setFocusMode(m => !m) }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const refreshDocs = useCallback(async () => {
    setDocs(await listDocs())
  }, [])

  const handleSelect = useCallback(async (id: string) => {
    const doc = await getDoc(id)
    if (!doc) return
    await setCurrentDocId(id)
    setActiveDoc(doc)
    setCurrentHtml(doc.content)
    setSidebarOpen(false)
  }, [])

  const handleCreate = useCallback(async () => {
    const doc = await createDoc()
    await setCurrentDocId(doc.id)
    setActiveDoc(doc)
    setCurrentHtml(doc.content)
    await refreshDocs()
    setSidebarOpen(false)
  }, [refreshDocs])

  const handleDelete = useCallback(async (id: string) => {
    await deleteDoc(id)
    const remaining = await listDocs()
    setDocs(remaining)
    if (activeDoc?.id === id) {
      const next = remaining[0] ?? (await createDoc())
      if (!remaining.length) setDocs([next])
      await setCurrentDocId(next.id)
      setActiveDoc(next)
      setCurrentHtml(next.content)
    }
  }, [activeDoc])

  const handleExport = useCallback(() => {
    if (!activeDoc) return
    downloadMarkdown(activeDoc.title, currentHtml)
  }, [activeDoc, currentHtml])

  // Refresh doc list periodically (keeps titles in sync after autosave)
  useEffect(() => {
    const interval = setInterval(refreshDocs, 3000)
    return () => clearInterval(interval)
  }, [refreshDocs])

  if (!ready || !activeDoc) return null

  const wordCount = countWords(currentHtml)

  return (
    <div className={`app${focusMode ? ' app--focus' : ''}`}>
      {!sidebarOpen && !focusMode && (
        <button
          className="sidebar-trigger"
          onClick={() => setSidebarOpen(true)}
          title="Abrir documentos (Ctrl+\)"
          aria-label="Abrir documentos"
        />
      )}

      {sidebarOpen && !focusMode && (
        <Sidebar
          docs={docs}
          activeDocId={activeDoc.id}
          onSelect={handleSelect}
          onCreate={handleCreate}
          onDelete={handleDelete}
        />
      )}

      <main
        className="app__editor"
        ref={editorRef}
        onClick={() => sidebarOpen && setSidebarOpen(false)}
      >
        <Editor
          docId={activeDoc.id}
          initialContent={activeDoc.content}
          typewriterMode={typewriterMode}
          onHtmlChange={setCurrentHtml}
        />
      </main>

      <Footer
        wordCount={wordCount}
        docTitle={activeDoc.title}
        docHtml={currentHtml}
        typewriterMode={typewriterMode}
        focusMode={focusMode}
        onToggleTypewriter={() => setTypewriterMode(m => !m)}
        onToggleFocus={() => setFocusMode(m => !m)}
        onExport={handleExport}
      />
    </div>
  )
}
