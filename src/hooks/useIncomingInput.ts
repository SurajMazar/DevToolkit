import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'

/**
 * Accepts text handed over from another screen (e.g. "Paste & format" on the home page
 * or "Open in JSON Formatter" from another tool) via router state. Fires once.
 */
export function useIncomingInput(onInput: (text: string) => void) {
  const location = useLocation()
  const navigate = useNavigate()
  const done = useRef(false)
  useEffect(() => {
    const state = location.state as { input?: unknown } | null
    if (done.current || typeof state?.input !== 'string') return
    done.current = true
    onInput(state.input)
    // Drop the state so a reload doesn't re-apply it.
    navigate(location.pathname + location.search, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])
}

/** Navigate to another tool, handing over text. */
export function useSendToTool() {
  const navigate = useNavigate()
  return (path: string, input: string) => navigate(path, { state: { input } })
}
