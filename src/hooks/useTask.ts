import { useCallback, useEffect, useRef, useState } from 'react'
import { isAbort } from '@/workers/rpc'

export interface TaskState<T> {
  result: T | undefined
  error: Error | null
  running: boolean
  /** Duration of the last completed run in ms. */
  duration: number | null
}

/**
 * Latest-wins async task runner. Starting a run aborts the previous one (which, for
 * worker tasks, terminates the worker). Results of superseded runs are discarded.
 */
export function useTask<T>() {
  const [state, setState] = useState<TaskState<T>>({ result: undefined, error: null, running: false, duration: null })
  const ctrl = useRef<AbortController | null>(null)
  const seq = useRef(0)
  // Running indicator is delayed so fast tasks never flash a spinner.
  const spinnerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const cancel = useCallback(() => {
    ctrl.current?.abort()
    ctrl.current = null
    clearTimeout(spinnerTimer.current)
    setState((s) => (s.running ? { ...s, running: false } : s))
  }, [])

  const run = useCallback(async (exec: (signal: AbortSignal) => Promise<T> | T): Promise<T | undefined> => {
    ctrl.current?.abort()
    const c = new AbortController()
    ctrl.current = c
    const id = ++seq.current
    clearTimeout(spinnerTimer.current)
    spinnerTimer.current = setTimeout(() => {
      if (seq.current === id) setState((s) => ({ ...s, running: true }))
    }, 120)
    const t0 = performance.now()
    try {
      const result = await exec(c.signal)
      if (seq.current !== id) return undefined
      clearTimeout(spinnerTimer.current)
      setState({ result, error: null, running: false, duration: performance.now() - t0 })
      return result
    } catch (e) {
      if (seq.current !== id) return undefined
      clearTimeout(spinnerTimer.current)
      if (isAbort(e)) {
        setState((s) => ({ ...s, running: false }))
        return undefined
      }
      setState((s) => ({ ...s, error: e instanceof Error ? e : new Error(String(e)), running: false, duration: performance.now() - t0 }))
      return undefined
    }
  }, [])

  const reset = useCallback(() => {
    cancel()
    seq.current++
    setState({ result: undefined, error: null, running: false, duration: null })
  }, [cancel])

  useEffect(() => () => ctrl.current?.abort(), [])

  return { ...state, run, cancel, reset }
}
