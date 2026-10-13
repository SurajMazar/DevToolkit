import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { toast } from 'sonner'

/** Registers the service worker; prompts before activating an update so no work is lost. */
export function PwaPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true })

  useEffect(() => {
    if (!offlineReady) return
    toast.success('DevToolkit is ready to work offline', { description: 'Every tool has been cached on this device.' })
    setOfflineReady(false)
  }, [offlineReady, setOfflineReady])

  useEffect(() => {
    if (!needRefresh) return
    toast('A new version of DevToolkit is available', {
      duration: Infinity,
      action: { label: 'Reload', onClick: () => void updateServiceWorker(true) },
      cancel: { label: 'Later', onClick: () => setNeedRefresh(false) },
    })
  }, [needRefresh, setNeedRefresh, updateServiceWorker])

  return null
}
