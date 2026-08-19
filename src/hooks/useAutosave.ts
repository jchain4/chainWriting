import { useEffect, useRef, useState } from 'react'
import { saveDoc, extractTitle } from '../lib/storage'

const DEBOUNCE_MS = 500

export function useAutosave(docId: string, content: string) {
  const [saved, setSaved] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }

    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(async () => {
      await saveDoc({ id: docId, title: extractTitle(content), content, updatedAt: Date.now() })
      setSaved(true)
      setTimeout(() => setSaved(false), 1200)
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [docId, content])

  return { saved }
}
