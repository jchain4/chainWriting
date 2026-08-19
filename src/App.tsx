import { useCallback, useEffect, useRef, useState } from 'react'
import { Editor } from './components/Editor'
import { Sidebar } from './components/Sidebar'
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
  const [ready, setReady] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)

  // Bootstrap: migrate legacy data, load docs and active doc
  useEffect(() => {
    async function init() {
      // Migrate old single-doc format if it exists
      const migrated = await migrateLegacy()

      const allDocs = await listDocs()
      const currentId = await getCurrentDocId()

      let current: Doc | null = null

      if (migrated) {
        current = migrated
        allDocs.unshift(migrated)
      } else if (currentId) {
        current = (await getDoc(currentId)) ?? null
      }

      if (!current && allDocs.length > 0) {
        current = allDocs[0]
      }

      if (!current) {
        current = await createDoc()
        allDocs.unshift(current)
      }

      await setCurrentDocId(current.id)
      setDocs(allDocs)
      setActiveDoc(current)
      setReady(true)
    }

    init()
  }, [])

  // Toggle sidebar with Ctrl+\
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '\\' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setSidebarOpen((o) => !o)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const refreshDocs = useCallback(async () => {
    const allDocs = await listDocs()
    setDocs(allDocs)
  }, [])

  const handleSelect = useCallback(async (id: string) => {
    const doc = await getDoc(id)
    if (!doc) return
    await setCurrentDocId(id)
    setActiveDoc(doc)
    setSidebarOpen(false)
  }, [])

  const handleCreate = useCallback(async () => {
    const doc = await createDoc()
    await setCurrentDocId(doc.id)
    setActiveDoc(doc)
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
    }
  }, [activeDoc])

  // Refresh doc list after each autosave (title may change)
  useEffect(() => {
    const interval = setInterval(refreshDocs, 3000)
    return () => clearInterval(interval)
  }, [refreshDocs])

  if (!ready || !activeDoc) return null

  return (
    <div className={`app${sidebarOpen ? ' app--sidebar-open' : ''}`}>
      {/* Left-edge tap target to open sidebar */}
      {!sidebarOpen && (
        <button
          className="sidebar-trigger"
          onClick={() => setSidebarOpen(true)}
          title="Abrir documentos (Ctrl+\)"
          aria-label="Abrir documentos"
        />
      )}

      {sidebarOpen && (
        <Sidebar
          docs={docs}
          activeDocId={activeDoc.id}
          onSelect={handleSelect}
          onCreate={handleCreate}
          onDelete={handleDelete}
        />
      )}

      <main className="app__editor" ref={editorRef} onClick={() => sidebarOpen && setSidebarOpen(false)}>
        <Editor
          docId={activeDoc.id}
          initialContent={activeDoc.content}
        />
      </main>
    </div>
  )
}
