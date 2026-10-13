import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type ThemePref = 'system' | 'dark' | 'light'

interface Prefs {
  theme: ThemePref
  sidebarCollapsed: boolean
  expandedCategories: string[]
  favorites: string[]
  recents: { id: string; at: number }[]
  /** Remember tool inputs locally in IndexedDB (never for tools marked sensitive). */
  rememberInputs: boolean
  /** While enabled nothing about tool content or usage is written to local storage. */
  privateMode: boolean
  editorFontSize: number
  editorWordWrap: boolean
  editorMinimap: boolean
  caseLocale: string

  setTheme: (t: ThemePref) => void
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  toggleCategory: (id: string, open?: boolean) => void
  toggleFavorite: (id: string) => void
  moveFavorite: (id: string, dir: -1 | 1) => void
  pushRecent: (id: string) => void
  clearRecents: () => void
  set: (patch: Partial<Prefs>) => void
}

const MAX_RECENTS = 12

export const usePrefs = create<Prefs>()(
  persist(
    (set, get) => ({
      theme: 'system',
      sidebarCollapsed: false,
      expandedCategories: ['text', 'compare', 'json'],
      favorites: [],
      recents: [],
      rememberInputs: true,
      privateMode: false,
      editorFontSize: 13,
      editorWordWrap: false,
      editorMinimap: false,
      caseLocale: 'auto',

      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleCategory: (id, open) => {
        const cur = get().expandedCategories
        const isOpen = cur.includes(id)
        const next = open ?? !isOpen
        if (next === isOpen) return
        set({ expandedCategories: next ? [...cur, id] : cur.filter((c) => c !== id) })
      },
      toggleFavorite: (id) => {
        const f = get().favorites
        set({ favorites: f.includes(id) ? f.filter((x) => x !== id) : [...f, id] })
      },
      moveFavorite: (id, dir) => {
        const f = [...get().favorites]
        const i = f.indexOf(id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= f.length) return
        ;[f[i], f[j]] = [f[j], f[i]]
        set({ favorites: f })
      },
      pushRecent: (id) => {
        if (get().privateMode) return
        const r = get().recents.filter((x) => x.id !== id)
        set({ recents: [{ id, at: Date.now() }, ...r].slice(0, MAX_RECENTS) })
      },
      clearRecents: () => set({ recents: [] }),
      set: (patch) => set(patch),
    }),
    {
      name: 'devtoolkit:prefs',
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
