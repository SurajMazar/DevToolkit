import { useCallback, useEffect, useRef, useState } from 'react'
import { getDraft, putDraft } from '@/services/persistence/db'
import { usePrefs } from '@/stores/prefs'
import { useToolContext } from '@/components/tools/tool-context'

/** Drafts larger than this are kept in memory only. */
const MAX_PERSIST_CHARS = 25_000_000

function sizeOf(v: unknown): number {
  if (typeof v === 'string') return v.length * 2
  try {
    return JSON.stringify(v)?.length ?? 0
  } catch {
    return 0
  }
}

/**
 * useState that restores from — and debounces writes to — IndexedDB, scoped to the
 * current tool. Writes are skipped in private mode, when "remember inputs" is off,
 * and for tools flagged as sensitive.
 */
export function usePersistentState<T>(field: string, initial: T | (() => T), delay = 600) {
  const { tool } = useToolContext()
  const remember = usePrefs((s) => s.rememberInputs && !s.privateMode)
  const enabled = remember && !tool.sensitive
  const [value, setValue] = useState<T>(initial)
  const [restored, setRestored] = useState(!enabled)
  const touched = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (!enabled) {
      setRestored(true)
      return
    }
    let cancelled = false
    getDraft<T>(tool.id, field).then((v) => {
      if (cancelled) return
      // Never clobber something the user typed before the draft finished loading.
      if (v !== undefined && !touched.current) setValue(v)
      setRestored(true)
    })
    return () => {
      cancelled = true
    }
  }, [enabled, tool.id, field])

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      touched.current = true
      setValue(next)
    },
    [],
  )

  useEffect(() => {
    if (!enabled || !restored || !touched.current) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const size = sizeOf(value)
      if (size / 2 > MAX_PERSIST_CHARS) return
      void putDraft(tool.id, field, value, size)
    }, delay)
    return () => clearTimeout(timer.current)
  }, [value, enabled, restored, tool.id, field, delay])

  return [value, set, restored] as const
}
