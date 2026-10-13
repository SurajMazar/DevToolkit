import { useEffect, useRef, useState } from 'react'

export function useDebouncedValue<T>(value: T, delay: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    if (delay <= 0) {
      setV(value)
      return
    }
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

/** Debounce delay that scales with input size: instant for small input, slower for large. */
export function adaptiveDelay(length: number): number {
  if (length < 20_000) return 0
  if (length < 500_000) return 150
  if (length < 5_000_000) return 350
  return 700
}

export function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}
