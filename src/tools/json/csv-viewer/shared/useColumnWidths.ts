import { useCallback, useMemo, useRef, useState } from 'react'

/**
 * Per-column widths keyed by column name: defaults come from content estimates, user
 * resizes override them and survive re-conversions. A width of -1 resets to the default.
 */
export function useColumnWidths(keys: string[], defaults: number[]) {
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const keysRef = useRef(keys)
  keysRef.current = keys
  const widths = useMemo(() => keys.map((k, i) => overrides[k] ?? defaults[i] ?? 120), [keys, defaults, overrides])
  const onResize = useCallback((col: number, width: number) => {
    const k = keysRef.current[col]
    if (k === undefined) return
    setOverrides((o) => {
      if (width < 0) {
        const next = { ...o }
        delete next[k]
        return next
      }
      return { ...o, [k]: width }
    })
  }, [])
  return [widths, onResize] as const
}
