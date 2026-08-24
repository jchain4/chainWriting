import { get, set, del, keys } from 'idb-keyval'
import { getTitle } from './exportMarkdown'

export interface Doc {
  id: string
  title: string
  content: string
  updatedAt: number
}

const PREFIX = 'doc:'
const CURRENT_KEY = 'current-doc'
const LEGACY_KEY = 'document'
const EMPTY_CONTENT = '<p></p>'

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export function extractTitle(html: string): string {
  return getTitle(html) ?? 'Sin título'
}

export async function saveDoc(doc: Doc): Promise<void> {
  await set(PREFIX + doc.id, doc)
}

export async function getDoc(id: string): Promise<Doc | undefined> {
  return get<Doc>(PREFIX + id)
}

export async function deleteDoc(id: string): Promise<void> {
  await del(PREFIX + id)
}

export async function listDocs(): Promise<Doc[]> {
  const allKeys = await keys<string>()
  const docKeys = allKeys.filter((k): k is string => typeof k === 'string' && k.startsWith(PREFIX))
  const docs = await Promise.all(docKeys.map(k => get<Doc>(k)))
  return (docs.filter(Boolean) as Doc[]).sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getCurrentDocId(): Promise<string | undefined> {
  return get<string>(CURRENT_KEY)
}

export async function setCurrentDocId(id: string): Promise<void> {
  await set(CURRENT_KEY, id)
}

export async function createDoc(): Promise<Doc> {
  const doc: Doc = {
    id: newId(),
    title: 'Sin título',
    content: EMPTY_CONTENT,
    updatedAt: Date.now(),
  }
  await saveDoc(doc)
  return doc
}

// Migrates the old single-document format to the new multi-doc format
export async function migrateLegacy(): Promise<Doc | null> {
  const legacyContent = await get<string>(LEGACY_KEY)
  if (!legacyContent || legacyContent === EMPTY_CONTENT) {
    await del(LEGACY_KEY)
    return null
  }
  const doc: Doc = {
    id: newId(),
    title: extractTitle(legacyContent),
    content: legacyContent,
    updatedAt: Date.now(),
  }
  await saveDoc(doc)
  await del(LEGACY_KEY)
  return doc
}
