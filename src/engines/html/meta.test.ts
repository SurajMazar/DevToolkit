import { describe, expect, it } from 'vitest'
import { breadcrumbUrl, charLength, EMPTY_META, escapeAttr, formFromTags, generateHead, SAMPLE_META, truncateChars, validateMeta, type MetaForm } from './meta'

const form = (o: Partial<MetaForm>): MetaForm => ({ ...EMPTY_META, ...o })

describe('generateHead', () => {
  it('emits a complete head snippet for the sample', () => {
    const html = generateHead(SAMPLE_META)
    expect(html).toContain('<title>Field Notes — A calm, local-first notes app for developers</title>')
    expect(html).toContain('<link rel="canonical" href="https://fieldnotes.example/">')
    expect(html).toContain('<meta property="og:image" content="https://fieldnotes.example/og/home-1200x630.png">')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(html).toContain('<meta name="twitter:site" content="@fieldnotesapp">')
    expect(html).toContain('<!-- Open Graph -->')
    expect(html).not.toContain('twitter:title')
  })
  it('escapes attribute values and title text', () => {
    const html = generateHead(form({ title: 'Tom & Jerry <3', description: 'He said "hi" & left <now>' }))
    expect(html).toContain('<title>Tom &amp; Jerry &lt;3</title>')
    expect(html).toContain('<meta name="description" content="He said &quot;hi&quot; &amp; left &lt;now&gt;">')
    expect(html).toContain('<meta property="og:title" content="Tom &amp; Jerry &lt;3">')
    expect(escapeAttr('"&<>')).toBe('&quot;&amp;&lt;&gt;')
  })
  it('omits empty fields and normalizes handles', () => {
    const html = generateHead(form({ title: 'X', twitterCreator: 'jane_doe' }))
    expect(html).not.toContain('description')
    expect(html).not.toContain('og:image')
    expect(html).toContain('<meta name="twitter:creator" content="@jane_doe">')
  })
  it('optionally duplicates twitter:* tags', () => {
    const html = generateHead({ ...SAMPLE_META, twitterDuplicates: true })
    expect(html).toContain('<meta name="twitter:title"')
    expect(html).toContain('<meta name="twitter:image:alt"')
  })
})

describe('validateMeta', () => {
  it('passes the sample with no errors', () => {
    expect(validateMeta(SAMPLE_META).filter((i) => i.level !== 'info')).toEqual([])
  })
  it('flags lengths, relative URLs, bad colors, handles and locales', () => {
    const issues = validateMeta(
      form({ title: 'x'.repeat(70), description: 'short', canonical: '/about', image: 'og.png', themeColor: 'tealish', twitterSite: '@this-is-wrong', locale: 'en-us' }),
    )
    const by = (f: keyof MetaForm) => issues.filter((i) => i.field === f).map((i) => i.level)
    expect(by('title')).toEqual(['warning'])
    expect(by('description')).toEqual(['info'])
    expect(by('canonical')).toEqual(['error'])
    expect(by('image')).toEqual(['error'])
    expect(by('themeColor')).toEqual(['error'])
    expect(by('twitterSite')).toEqual(['error'])
    expect(by('locale')).toEqual(['error'])
  })
  it('counts characters by code point', () => {
    expect(charLength('👩‍💻')).toBe(3)
    expect(charLength('café')).toBe(4)
  })
})

describe('formFromTags', () => {
  it('maps head tags onto the form and reports unknown ones', () => {
    const r = formFromTags([
      { tag: 'meta', attrs: { charset: 'utf-8' } },
      { tag: 'title', attrs: {}, text: '  My   page ' },
      { tag: 'meta', attrs: { name: 'description', content: 'About it' } },
      { tag: 'link', attrs: { rel: 'canonical', href: 'https://a.example/x' } },
      { tag: 'link', attrs: { rel: 'icon', href: '/f.ico' } },
      { tag: 'meta', attrs: { property: 'og:image', content: 'https://a.example/i.png' } },
      { tag: 'meta', attrs: { property: 'og:type', content: 'article' } },
      { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary' } },
      { tag: 'meta', attrs: { name: 'twitter:site', content: '@a' } },
      { tag: 'meta', attrs: { name: 'generator', content: 'x' } },
    ])
    expect(r.form).toMatchObject({ title: 'My page', description: 'About it', canonical: 'https://a.example/x', image: 'https://a.example/i.png', type: 'article', twitterCard: 'summary', twitterSite: '@a' })
    expect(r.ignored).toEqual(['<link rel="icon">', 'generator'])
    expect(r.recognized).toBe(7)
  })
  it('falls back to og:/twitter: values', () => {
    const r = formFromTags([
      { tag: 'meta', attrs: { property: 'og:title', content: 'OG title' } },
      { tag: 'meta', attrs: { property: 'og:url', content: 'https://b.example/' } },
      { tag: 'meta', attrs: { name: 'twitter:description', content: 'TW desc' } },
    ])
    expect(r.form).toMatchObject({ title: 'OG title', canonical: 'https://b.example/', description: 'TW desc', twitterDuplicates: true })
  })
  it('round-trips generated output through the mapping', () => {
    // Simulates what the UI's DOMParser extraction produces from generateHead output.
    const html = generateHead({ ...SAMPLE_META, twitterDuplicates: true })
    const tags = [...html.matchAll(/<(meta|title|link)([^>]*)>([^<]*)/g)].map((m) => {
      const attrs: Record<string, string> = {}
      for (const a of m[2].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = a[2].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      return { tag: m[1] as 'meta' | 'title' | 'link', attrs, text: m[1] === 'title' ? m[3] : undefined }
    })
    expect(formFromTags(tags).form).toEqual({ ...SAMPLE_META, twitterDuplicates: true })
  })
})

describe('helpers', () => {
  it('formats breadcrumbs and truncates', () => {
    expect(breadcrumbUrl('https://www.example.com/docs/getting%20started')).toBe('example.com › docs › getting started')
    expect(breadcrumbUrl('not a url')).toBe('not a url')
    expect(truncateChars('abcdef', 4)).toBe('abc…')
    expect(truncateChars('abc', 4)).toBe('abc')
  })
})
