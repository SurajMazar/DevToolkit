import { useEffect, useState } from 'react'

/** Current epoch ms, re-rendering on each whole second (or `interval`). Pausable. */
export function useNow(paused = false, interval = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (paused) return
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const t = Date.now()
      setNow(t)
      timer = setTimeout(tick, interval - (t % interval) + 5)
    }
    tick()
    return () => clearTimeout(timer)
  }, [paused, interval])
  return now
}
