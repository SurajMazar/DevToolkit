import { parse as parseColor } from 'culori'

export type OgType = 'website' | 'article' | 'profile' | 'book' | 'video.other' | 'music.song'
export type TwitterCard = 'summary' | 'summary_large_image'

export interface MetaForm {
  title: string
  description: string
  canonical: string
  image: string
  imageAlt: string
  siteName: string
  type: OgType
  locale: string
  twitterCard: TwitterCard
  twitterSite: string
  twitterCreator: string
  themeColor: string
  robots: string
  author: string
  keywords: string
  /** Also emit twitter:title / description / image (X falls back to og:* otherwise). */
  twitterDuplicates: boolean
}

export const EMPTY_META: MetaForm = {
  title: '',
  description: '',
  canonical: '',
  image: '',
  imageAlt: '',
  siteName: '',
  type: 'website',
  locale: '',
  twitterCard: 'summary_large_image',
  twitterSite: '',
  twitterCreator: '',
  themeColor: '',
  robots: '',
  author: '',
  keywords: '',
  twitterDuplicates: false,
}

export const SAMPLE_META: MetaForm = {
  title: 'Field Notes — A calm, local-first notes app for developers',
  description: 'Write Markdown, link ideas and search everything instantly. Field Notes keeps your notes on your device, syncs end-to-end encrypted and works offline.',
  canonical: 'https://fieldnotes.example/',
  image: 'https://fieldnotes.example/og/home-1200x630.png',
  imageAlt: 'The Field Notes editor showing a Markdown note beside its outline',
  siteName: 'Field Notes',
  type: 'website',
  locale: 'en_US',
  twitterCard: 'summary_large_image',
  twitterSite: '@fieldnotesapp',
  twitterCreator: '',
  themeColor: '#0f766e',
  robots: 'index, follow',
  author: '',
  keywords: '',
  twitterDuplicates: false,
}

/** Escapes text for a double-quoted HTML attribute value. */
export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Escapes text content (e.g. inside <title>). */
export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Length in user-perceived characters (code points, so emoji count once-ish). */
export function charLength(s: string): number {
  return [...s].length
}

const clean = (s: string) => s.trim().replace(/\s+/g, ' ')
const handle = (s: string) => {
  const h = s.trim()
  if (!h) return ''
  return h.startsWith('@') ? h : `@${h}`
}

/** Generates the complete `<head>` snippet. Empty fields are omitted. */
export function generateHead(f: MetaForm): string {
  const lines: string[] = []
  const meta = (attr: 'name' | 'property', key: string, value: string) => {
    const v = clean(value)
    if (v) lines.push(`<meta ${attr}="${key}" content="${escapeAttr(v)}">`)
  }
  const title = clean(f.title)
  const description = clean(f.description)
  lines.push('<meta charset="utf-8">')
  lines.push('<meta name="viewport" content="width=device-width, initial-scale=1">')
  if (title) lines.push(`<title>${escapeText(title)}</title>`)
  meta('name', 'description', description)
  if (f.canonical.trim()) lines.push(`<link rel="canonical" href="${escapeAttr(f.canonical.trim())}">`)
  meta('name', 'robots', f.robots)
  meta('name', 'author', f.author)
  meta('name', 'keywords', f.keywords)
  meta('name', 'theme-color', f.themeColor)

  const og: string[] = []
  const before = lines.length
  meta('property', 'og:type', f.type)
  meta('property', 'og:title', title)
  meta('property', 'og:description', description)
  meta('property', 'og:url', f.canonical)
  meta('property', 'og:site_name', f.siteName)
  meta('property', 'og:locale', f.locale)
  meta('property', 'og:image', f.image)
  if (f.image.trim()) meta('property', 'og:image:alt', f.imageAlt)
  og.push(...lines.splice(before))

  const tw: string[] = []
  const before2 = lines.length
  meta('name', 'twitter:card', f.twitterCard)
  meta('name', 'twitter:site', handle(f.twitterSite))
  meta('name', 'twitter:creator', handle(f.twitterCreator))
  if (f.twitterDuplicates) {
    meta('name', 'twitter:title', title)
    meta('name', 'twitter:description', description)
    meta('name', 'twitter:image', f.image)
    if (f.image.trim()) meta('name', 'twitter:image:alt', f.imageAlt)
  }
  tw.push(...lines.splice(before2))

  const out = [...lines]
  if (og.length) out.push('', '<!-- Open Graph -->', ...og)
  if (tw.length) out.push('', '<!-- Twitter / X -->', ...tw)
  return out.join('\n') + '\n'
}

export type IssueLevel = 'error' | 'warning' | 'info'
export interface MetaIssue {
  field: keyof MetaForm
  level: IssueLevel
  message: string
}

export const LENGTH_GUIDE = {
  title: { min: 30, ideal: [50, 60] as const, max: 60 },
  description: { min: 70, ideal: [150, 160] as const, max: 160 },
}

function isAbsoluteHttpUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

export function validateMeta(f: MetaForm): MetaIssue[] {
  const issues: MetaIssue[] = []
  const t = charLength(clean(f.title))
  const d = charLength(clean(f.description))
  if (!t) issues.push({ field: 'title', level: 'warning', message: 'Add a title — it is the headline of search results and link cards.' })
  else if (t < LENGTH_GUIDE.title.min) issues.push({ field: 'title', level: 'info', message: `Title is short (${t} chars). 50–60 characters use the space search results give you.` })
  else if (t > LENGTH_GUIDE.title.max) issues.push({ field: 'title', level: 'warning', message: `Title is ${t} chars — search engines usually truncate after ~60.` })
  if (!d) issues.push({ field: 'description', level: 'warning', message: 'Add a description — it is often used as the snippet under the title.' })
  else if (d < LENGTH_GUIDE.description.min) issues.push({ field: 'description', level: 'info', message: `Description is short (${d} chars). Aim for 150–160.` })
  else if (d > LENGTH_GUIDE.description.max) issues.push({ field: 'description', level: 'warning', message: `Description is ${d} chars — it will likely be truncated after ~160.` })
  if (f.canonical.trim() && !isAbsoluteHttpUrl(f.canonical.trim())) issues.push({ field: 'canonical', level: 'error', message: 'Canonical URL must be absolute (https://…).' })
  if (f.image.trim() && !isAbsoluteHttpUrl(f.image.trim())) issues.push({ field: 'image', level: 'error', message: 'og:image must be an absolute URL (https://…) — crawlers do not resolve relative paths.' })
  if (f.image.trim() && !f.imageAlt.trim()) issues.push({ field: 'imageAlt', level: 'info', message: 'Describe the image for screen-reader users (og:image:alt).' })
  if (!f.image.trim() && f.twitterCard === 'summary_large_image') issues.push({ field: 'image', level: 'warning', message: 'The large image card needs an image — without one, links show as plain text.' })
  if (f.themeColor.trim() && !parseColor(f.themeColor.trim())) issues.push({ field: 'themeColor', level: 'error', message: `“${f.themeColor.trim()}” is not a valid CSS color.` })
  for (const key of ['twitterSite', 'twitterCreator'] as const) {
    const v = f[key].trim()
    if (v && !/^@?[A-Za-z0-9_]{1,15}$/.test(v)) issues.push({ field: key, level: 'error', message: 'Handles are 1–15 letters, digits or underscores, e.g. @example.' })
  }
  if (f.locale.trim() && !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(f.locale.trim())) issues.push({ field: 'locale', level: 'error', message: 'og:locale uses language_TERRITORY, e.g. en_US or fr_FR.' })
  return issues
}

/** A tag extracted from pasted markup (by DOMParser in the UI). */
export interface ExtractedTag {
  tag: 'title' | 'meta' | 'link'
  /** Lower-cased attribute names. */
  attrs: Record<string, string>
  text?: string
}

export interface ImportResult {
  form: MetaForm
  recognized: number
  ignored: string[]
}

const OG_TYPES: OgType[] = ['website', 'article', 'profile', 'book', 'video.other', 'music.song']

/** Maps extracted head tags onto the form. Unknown tags are reported, not silently lost. */
export function formFromTags(tags: ExtractedTag[], base: MetaForm = EMPTY_META): ImportResult {
  const f: MetaForm = { ...base }
  const ignored: string[] = []
  let recognized = 0
  let ogTitle = ''
  let ogDescription = ''
  let twTitle = ''
  let twDescription = ''
  let twImage = ''
  let twImageAlt = ''
  let ogUrl = ''
  const set = <K extends keyof MetaForm>(k: K, v: MetaForm[K]) => {
    f[k] = v
    recognized++
  }
  for (const t of tags) {
    if (t.tag === 'title') {
      set('title', clean(t.text ?? ''))
      continue
    }
    if (t.tag === 'link') {
      const rel = (t.attrs.rel ?? '').toLowerCase().split(/\s+/)
      if (rel.includes('canonical') && t.attrs.href) set('canonical', t.attrs.href.trim())
      else ignored.push(`<link rel="${t.attrs.rel ?? ''}">`)
      continue
    }
    const key = (t.attrs.property ?? t.attrs.name ?? '').toLowerCase().trim()
    const content = t.attrs.content ?? ''
    if (!key) {
      if (t.attrs.charset || (t.attrs['http-equiv'] ?? '')) continue
      ignored.push('<meta> without name/property')
      continue
    }
    switch (key) {
      case 'description':
        set('description', clean(content))
        break
      case 'robots':
        set('robots', content.trim())
        break
      case 'author':
        set('author', content.trim())
        break
      case 'keywords':
        set('keywords', content.trim())
        break
      case 'theme-color':
        set('themeColor', content.trim())
        break
      case 'viewport':
        break
      case 'og:title':
        ogTitle = clean(content)
        recognized++
        break
      case 'og:description':
        ogDescription = clean(content)
        recognized++
        break
      case 'og:url':
        ogUrl = content.trim()
        recognized++
        break
      case 'og:image':
      case 'og:image:url':
      case 'og:image:secure_url':
        set('image', content.trim())
        break
      case 'og:image:alt':
        set('imageAlt', content.trim())
        break
      case 'og:site_name':
        set('siteName', content.trim())
        break
      case 'og:locale':
        set('locale', content.trim())
        break
      case 'og:type': {
        const v = content.trim().toLowerCase() as OgType
        if (OG_TYPES.includes(v)) set('type', v)
        else ignored.push(`og:type “${content.trim()}”`)
        break
      }
      case 'twitter:card': {
        const v = content.trim()
        if (v === 'summary' || v === 'summary_large_image') set('twitterCard', v)
        else ignored.push(`twitter:card “${v}”`)
        break
      }
      case 'twitter:site':
        set('twitterSite', content.trim())
        break
      case 'twitter:creator':
        set('twitterCreator', content.trim())
        break
      case 'twitter:title':
        twTitle = clean(content)
        recognized++
        break
      case 'twitter:description':
        twDescription = clean(content)
        recognized++
        break
      case 'twitter:image':
        twImage = content.trim()
        recognized++
        break
      case 'twitter:image:alt':
        twImageAlt = content.trim()
        recognized++
        break
      default:
        ignored.push(key)
    }
  }
  // Fall back to OG / Twitter values for fields the page only sets there.
  if (!f.title && (ogTitle || twTitle)) f.title = ogTitle || twTitle
  if (!f.description && (ogDescription || twDescription)) f.description = ogDescription || twDescription
  if (!f.canonical && ogUrl) f.canonical = ogUrl
  if (!f.image && twImage) f.image = twImage
  if (!f.imageAlt && twImageAlt) f.imageAlt = twImageAlt
  if (twTitle || twDescription || twImage) f.twitterDuplicates = true
  return { form: f, recognized, ignored }
}

/** Display form of a URL for the search-result mockup: `example.com › docs › page`. */
export function breadcrumbUrl(url: string): string {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean).map((p) => {
      try {
        return decodeURIComponent(p)
      } catch {
        return p
      }
    })
    return [u.hostname.replace(/^www\./, ''), ...parts].join(' › ')
  } catch {
    return url
  }
}

export function truncateChars(s: string, max: number): string {
  const chars = [...s]
  return chars.length <= max ? s : chars.slice(0, max - 1).join('').trimEnd() + '…'
}
