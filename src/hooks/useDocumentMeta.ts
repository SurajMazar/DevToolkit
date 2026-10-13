import { useEffect } from 'react'

const SUFFIX = 'DevToolkit'

export function useDocumentMeta(title: string | null, description?: string) {
  useEffect(() => {
    document.title = title ? `${title} — ${SUFFIX}` : `${SUFFIX} — Every developer utility. One workspace.`
    if (description) document.querySelector('meta[name="description"]')?.setAttribute('content', description)
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.appendChild(canonical)
    }
    canonical.href = location.origin + location.pathname
  }, [title, description])
}
