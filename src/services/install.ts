import { create } from 'zustand'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface InstallState {
  event: BeforeInstallPromptEvent | null
  installed: boolean
}

export const useInstall = create<InstallState>(() => ({
  event: null,
  installed: typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches,
}))

export function listenForInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    useInstall.setState({ event: e as BeforeInstallPromptEvent })
  })
  window.addEventListener('appinstalled', () => useInstall.setState({ event: null, installed: true }))
}

export async function promptInstall() {
  const ev = useInstall.getState().event
  if (!ev) return false
  await ev.prompt()
  const choice = await ev.userChoice
  useInstall.setState({ event: null })
  return choice.outcome === 'accepted'
}
