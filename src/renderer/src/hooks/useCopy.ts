import { useCallback, useEffect, useRef, useState } from 'react'

/** Copies text to the clipboard; `copied` is true for 1.5 s afterwards. */
export function useCopy(): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = useCallback((text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }, [])

  return { copied, copy }
}
