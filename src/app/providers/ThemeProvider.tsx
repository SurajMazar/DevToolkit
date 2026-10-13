import { useEffect } from 'react'
import { useResolvedTheme } from '@/hooks/useResolvedTheme'
import { getMonaco } from '@/components/editors/monaco/loader'

export function ThemeSync() {
  const theme = useResolvedTheme()
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#141517' : '#f5f4f1')
    getMonaco()?.editor.setTheme(theme === 'dark' ? 'devtoolkit-dark' : 'devtoolkit-light')
  }, [theme])
  return null
}
