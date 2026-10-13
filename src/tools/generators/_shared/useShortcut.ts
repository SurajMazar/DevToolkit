import { useEffect } from 'react'
import { useLatest } from '@/hooks/useDebounced'

/** Ctrl/⌘+Enter anywhere in the tool runs `fn` (used for "Regenerate"). */
export function useRegenerateShortcut(fn: () => void, enabled = true) {
  const ref = useLatest(fn)
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        // Leave Monaco editors alone — they may bind Ctrl+Enter themselves.
        if ((e.target as HTMLElement | null)?.closest?.('.monaco-editor')) return
        e.preventDefault()
        ref.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, ref])
}
