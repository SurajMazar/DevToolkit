/**
 * URL slug generation: transliteration (or Unicode-preserving), custom replacements,
 * stop-word removal, separators and word-boundary length limits.
 */
import { transliterate } from '@/engines/case'

export interface SlugOptions {
  separator: string
  lowercase: boolean
  /** Convert to ASCII (café → cafe, Straße → strasse). Off = keep Unicode letters. */
  transliterate: boolean
  /** German umlauts as ae / oe / ue (with transliteration). */
  german: boolean
  /** 0 = unlimited. Cuts at a word boundary when possible. */
  maxLength: number
  removeStopWords: boolean
  keepNumbers: boolean
  /** Applied before everything else; matched literally (case-insensitive for letters). */
  replacements: { from: string; to: string }[]
}

export const DEFAULT_SLUG_OPTIONS: SlugOptions = {
  separator: '-',
  lowercase: true,
  transliterate: true,
  german: false,
  maxLength: 0,
  removeStopWords: false,
  keepNumbers: true,
  replacements: [
    { from: '&', to: 'and' },
    { from: '@', to: 'at' },
    { from: '%', to: 'percent' },
    { from: '+', to: 'plus' },
  ],
}

/** Compact English stop-word list for slugs (articles, prepositions, conjunctions). */
export const SLUG_STOP_WORDS = new Set(
  'a an the and or but nor so yet of in on at to for from by with as into onto upon about over under than then that this these those is are was were be been being it its'.split(' '),
)

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function applyReplacements(text: string, replacements: SlugOptions['replacements']): string {
  let s = text
  for (const r of replacements) {
    if (!r.from) continue
    // Surround the replacement with spaces so "R&D" → "R and D" becomes separate words.
    const to = r.to ? ` ${r.to} ` : ' '
    s = s.replace(new RegExp(escapeRegExp(r.from), 'giu'), to)
  }
  return s
}

/** Truncate a slug at a separator boundary not exceeding `max` characters. */
export function truncateSlug(slug: string, max: number, separator: string): string {
  if (max <= 0 || slug.length <= max) return slug
  const chars = Array.from(slug)
  if (chars.length <= max) return slug
  const cut = chars.slice(0, max).join('')
  if (!separator) return cut
  // If the character right after the cut is a separator, the cut is already on a boundary.
  const nextIsSep = slug.slice(cut.length).startsWith(separator)
  if (nextIsSep) return cut
  const idx = cut.lastIndexOf(separator)
  if (idx > 0) return cut.slice(0, idx)
  return cut // a single word longer than max: hard cut
}

export function slugify(input: string, options: Partial<SlugOptions> = {}): string {
  const o = { ...DEFAULT_SLUG_OPTIONS, ...options }
  let s = input.normalize('NFC')
  s = applyReplacements(s, o.replacements)
  if (o.transliterate) {
    s = transliterate(s, { german: o.german })
    // Second pass: accented letters outside the table (Greek ά, Cyrillic й…) lose their marks
    // in the first pass and can now be mapped.
    if (/[^\u0000-\u007f]/.test(s)) s = transliterate(s)
  }
  else s = s.normalize('NFC')
  // Apostrophes inside words are removed rather than separating: don't → dont
  s = s.replace(/(\p{L})['’ʼ](\p{L})/gu, '$1$2')
  if (o.lowercase) s = s.toLocaleLowerCase()
  const wordRe = o.transliterate ? (o.keepNumbers ? /[A-Za-z0-9]+/g : /[A-Za-z]+/g) : o.keepNumbers ? /[\p{L}\p{M}\p{N}]+/gu : /[\p{L}\p{M}]+/gu
  let words: string[] = s.match(wordRe) ?? []
  if (o.removeStopWords) {
    const kept = words.filter((w) => !SLUG_STOP_WORDS.has(w.toLowerCase()))
    // Never remove everything (e.g. a title that is only "The The").
    if (kept.length) words = kept
  }
  const slug = words.join(o.separator)
  return truncateSlug(slug, o.maxLength, o.separator)
}

/**
 * Letters and digits that transliteration cannot express in ASCII (e.g. CJK) and that
 * would therefore be dropped from an ASCII slug.
 */
export function untransliterable(input: string, german = false): string {
  let t = transliterate(input, { german })
  if (/[^\u0000-\u007f]/.test(t)) t = transliterate(t)
  const out = new Set<string>()
  for (const m of t.matchAll(/[\p{L}\p{N}]/gu)) if (m[0].charCodeAt(0) > 0x7f) out.add(m[0])
  return [...out].join('')
}

export interface SlugRow {
  line: number
  input: string
  slug: string
  /** 1-based index of the first row with the same slug, when this one is a duplicate. */
  duplicateOf: number | null
  /** The slug was shortened to fit `maxLength`. */
  truncated: boolean
  /** Characters dropped because they have no ASCII transliteration (ASCII mode only). */
  dropped: string
}

/** Slugify each non-empty line; optionally make duplicates unique with -2, -3… suffixes. */
export function slugifyLines(text: string, options: Partial<SlugOptions> = {}, makeUnique = false): SlugRow[] {
  const o = { ...DEFAULT_SLUG_OPTIONS, ...options }
  const rows: SlugRow[] = []
  const firstSeen = new Map<string, number>()
  const used = new Set<string>()
  const lines = text.split(/\r\n|\r|\n/)
  for (let i = 0; i < lines.length; i++) {
    const input = lines[i]
    if (!input.trim()) continue
    const full = slugify(input, { ...o, maxLength: 0 })
    let slug = truncateSlug(full, o.maxLength, o.separator)
    const truncated = slug !== full
    let duplicateOf: number | null = null
    if (slug && firstSeen.has(slug)) duplicateOf = firstSeen.get(slug)!
    else if (slug) firstSeen.set(slug, i + 1)
    if (makeUnique && slug && used.has(slug)) {
      let n = 2
      const sep = o.separator || '-'
      while (used.has(`${slug}${sep}${n}`)) n++
      slug = `${slug}${sep}${n}`
    }
    used.add(slug)
    const dropped = o.transliterate && /[^\u0000-\u007f]/.test(input) ? untransliterable(input, o.german) : ''
    rows.push({ line: i + 1, input, slug, duplicateOf, truncated, dropped })
  }
  return rows
}
