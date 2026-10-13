import { create } from 'zustand'

interface UIState {
  paletteOpen: boolean
  mobileNavOpen: boolean
  setPaletteOpen: (v: boolean) => void
  setMobileNavOpen: (v: boolean) => void
}

export const useUI = create<UIState>((set) => ({
  paletteOpen: false,
  mobileNavOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
}))
