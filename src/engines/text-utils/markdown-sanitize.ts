/**
 * Sanitizes rendered Markdown HTML for display. Requires a DOM (browser, or jsdom in tests).
 *
 * - DOMPurify removes scripts, event handlers, javascript: URLs, SVG/MathML and styles.
 * - Media tags and attributes that could trigger network requests are removed.
 * - With `blockRemoteImages`, every <img> whose source is not a data: URI is replaced by a
 *   visible placeholder showing its URL — the app never makes network requests.
 * - External links open in a new tab with rel="noopener noreferrer".
 */
import DOMPurify from 'dompurify'

export interface SanitizeOptions {
  /** Replace non-data: images with a placeholder (in-app preview). Keep them for exports. */
  blockRemoteImages: boolean
}

export interface SanitizedHtml {
  html: string
  /** URLs of images that were not loaded (only when blockRemoteImages). */
  blockedImages: string[]
}

const FORBID_TAGS = ['style', 'form', 'video', 'audio', 'source', 'track', 'picture', 'iframe', 'frame', 'object', 'embed', 'link', 'meta', 'base', 'button', 'select', 'textarea', 'dialog', 'template']
const FORBID_ATTR = ['style', 'srcset', 'ping', 'background', 'poster', 'formaction', 'action', 'autofocus', 'contenteditable']

/** Classes for the remote-image placeholder (tokens only — rendered inside the app). */
export const REMOTE_IMAGE_CLASS =
  'md-remote-image inline-flex max-w-full items-center gap-1.5 rounded-md border border-dashed border-border-strong bg-surface px-2 py-1 align-middle text-xs text-muted'

/** Task list items render without a bullet (GitHub style). */
export const TASK_ITEM_CLASS = 'task-list-item list-none -ml-[1.3em]'

export function isDataImageSrc(src: string): boolean {
  return /^data:image\/(png|gif|jpe?g|webp|avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon)[;,]/i.test(src.trim())
}

export function sanitizeRenderedHtml(html: string, opts: SanitizeOptions): SanitizedHtml {
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS,
    FORBID_ATTR,
    ADD_ATTR: ['target'],
  })
  // Post-process inside an inert document (no browsing context → nothing is fetched).
  const doc = document.implementation.createHTMLDocument('')
  doc.body.innerHTML = clean
  const fragment = doc.body
  const blockedImages: string[] = []

  for (const input of Array.from(fragment.querySelectorAll('input'))) {
    if (input.getAttribute('type') !== 'checkbox') {
      input.remove()
      continue
    }
    input.setAttribute('disabled', '')
    input.removeAttribute('name')
    const li = input.parentElement
    if (li?.tagName === 'LI' && li.firstElementChild === input) li.setAttribute('class', TASK_ITEM_CLASS)
  }

  for (const a of Array.from(fragment.querySelectorAll('a'))) {
    const href = a.getAttribute('href') ?? ''
    if (href.startsWith('#')) {
      a.removeAttribute('target')
      continue
    }
    if (!href) continue
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  }

  for (const img of Array.from(fragment.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    if (!src) {
      img.remove()
      continue
    }
    if (isDataImageSrc(src)) continue
    if (!opts.blockRemoteImages) continue
    blockedImages.push(src)
    const ph = doc.createElement('span')
    ph.setAttribute('class', REMOTE_IMAGE_CLASS)
    ph.setAttribute('title', `Remote image not loaded: ${src}`)
    ph.setAttribute('role', 'img')
    const alt = img.getAttribute('alt') ?? ''
    ph.setAttribute('aria-label', `Image not loaded${alt ? `: ${alt}` : ''} (${src})`)
    const label = doc.createElement('span')
    label.setAttribute('class', 'shrink-0 font-medium text-fg')
    label.textContent = alt ? `Image: ${alt}` : 'Image'
    const url = doc.createElement('span')
    url.setAttribute('class', 'mono min-w-0 truncate text-subtle')
    url.textContent = src
    ph.append(label, url)
    img.replaceWith(ph)
  }

  return { html: fragment.innerHTML, blockedImages }
}
