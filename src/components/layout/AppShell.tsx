import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { MobileNav } from './MobileNav'
import { CommandPalette } from './CommandPalette'
import { usePrefs } from '@/stores/prefs'
import { useUI } from '@/stores/ui'

function useGlobalShortcuts() {
  const setPalette = useUI((s) => s.setPaletteOpen)
  const toggleSidebar = usePrefs((s) => s.toggleSidebar)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette(!useUI.getState().paletteOpen)
      } else if (mod && e.key === '\\') {
        e.preventDefault()
        toggleSidebar()
      } else if (e.key === '/' && !mod && !isTyping(e.target)) {
        e.preventDefault()
        setPalette(true)
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [setPalette, toggleSidebar])
}

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!el.closest('.monaco-editor')
}

export function AppShell() {
  useGlobalShortcuts()
  const { pathname } = useLocation()
  useEffect(() => {
    document.getElementById('main')?.scrollTo({ top: 0 })
  }, [pathname])
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-raised focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Header />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main id="main" className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-bg">
          <Outlet />
        </main>
      </div>
      <MobileNav />
      <CommandPalette />
    </div>
  )
}
