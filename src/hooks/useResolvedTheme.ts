import { useSyncExternalStore } from 'react'
import { usePrefs } from '@/stores/prefs'

const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

function subscribe(cb: () => void) {
  mq?.addEventListener('change', cb)
  return () => mq?.removeEventListener('change', cb)
}

export function useSystemDark() {
  return useSyncExternalStore(subscribe, () => mq?.matches ?? true, () => true)
}

export function useResolvedTheme(): 'dark' | 'light' {
  const pref = usePrefs((s) => s.theme)
  const systemDark = useSystemDark()
  if (pref === 'system') return systemDark ? 'dark' : 'light'
  return pref
}
