import { get, set } from 'idb-keyval'
import { useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'document'
const DEBOUNCE_MS = 500

export function useAutosave(content: string) {
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
      await set(STORAGE_KEY, content)
      setSaved(true)
      setTimeout(() => setSaved(false), 1200)
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [content])

  return { saved }
}

export async function loadDocument(): Promise<string | undefined> {
  return get<string>(STORAGE_KEY)
}
