/**
 * Unicode inspection: code point / grapheme segmentation, general category and script
 * (derived from Unicode property escapes), encodings and escapes, and flags for
 * invisible, combining and confusable characters.
 */
import { classifyCodePoint, hexCode } from './whitespace'

export { hexCode }

export const GENERAL_CATEGORIES: { code: string; name: string }[] = [
  { code: 'Lu', name: 'Uppercase letter' },
  { code: 'Ll', name: 'Lowercase letter' },
  { code: 'Lt', name: 'Titlecase letter' },
  { code: 'Lm', name: 'Modifier letter' },
  { code: 'Lo', name: 'Other letter' },
  { code: 'Mn', name: 'Nonspacing mark' },
  { code: 'Mc', name: 'Spacing mark' },
  { code: 'Me', name: 'Enclosing mark' },
  { code: 'Nd', name: 'Decimal number' },
  { code: 'Nl', name: 'Letter number' },
  { code: 'No', name: 'Other number' },
  { code: 'Pc', name: 'Connector punctuation' },
  { code: 'Pd', name: 'Dash punctuation' },
  { code: 'Ps', name: 'Open punctuation' },
  { code: 'Pe', name: 'Close punctuation' },
  { code: 'Pi', name: 'Initial quote' },
  { code: 'Pf', name: 'Final quote' },
  { code: 'Po', name: 'Other punctuation' },
  { code: 'Sm', name: 'Math symbol' },
  { code: 'Sc', name: 'Currency symbol' },
  { code: 'Sk', name: 'Modifier symbol' },
  { code: 'So', name: 'Other symbol' },
  { code: 'Zs', name: 'Space separator' },
  { code: 'Zl', name: 'Line separator' },
  { code: 'Zp', name: 'Paragraph separator' },
  { code: 'Cc', name: 'Control' },
  { code: 'Cf', name: 'Format' },
  { code: 'Cs', name: 'Surrogate' },
  { code: 'Co', name: 'Private use' },
]

const CATEGORY_RES = GENERAL_CATEGORIES.map((c) => ({ ...c, re: new RegExp(`^\\p{${c.code}}$`, 'u') }))

export const SCRIPTS = [
  'Latin', 'Greek', 'Cyrillic', 'Armenian', 'Hebrew', 'Arabic', 'Syriac', 'Thaana', 'Nko', 'Devanagari', 'Bengali', 'Gurmukhi',
  'Gujarati', 'Oriya', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Sinhala', 'Thai', 'Lao', 'Tibetan', 'Myanmar', 'Georgian',
  'Hangul', 'Ethiopic', 'Cherokee', 'Canadian_Aboriginal', 'Ogham', 'Runic', 'Khmer', 'Mongolian', 'Hiragana', 'Katakana', 'Bopomofo',
  'Han', 'Yi', 'Tifinagh', 'Javanese', 'Balinese', 'Braille', 'Coptic', 'Gothic', 'Common', 'Inherited',
] as const

const SCRIPT_RES = SCRIPTS.map((s) => ({ name: s, re: new RegExp(`^\\p{Script=${s}}$`, 'u') }))

export interface CategoryInfo {
  code: string
  name: string
}

const catCache = new Map<number, CategoryInfo>()
export function generalCategory(cp: number): CategoryInfo {
  const c = catCache.get(cp)
  if (c) return c
  const ch = String.fromCodePoint(cp)
  let found: CategoryInfo = { code: 'Cn', name: 'Unassigned' }
  if (cp >= 0xd800 && cp <= 0xdfff) found = { code: 'Cs', name: 'Surrogate' }
  else {
    for (const r of CATEGORY_RES) {
      if (r.re.test(ch)) {
        found = { code: r.code, name: r.name }
        break
      }
    }
  }
  catCache.set(cp, found)
  return found
}

const scriptCache = new Map<number, string>()
export function scriptOf(cp: number): string {
  const c = scriptCache.get(cp)
  if (c) return c
  let found = 'Other'
  if (cp >= 0xd800 && cp <= 0xdfff) found = 'Unknown'
  else {
    const ch = String.fromCodePoint(cp)
    for (const r of SCRIPT_RES) {
      if (r.re.test(ch)) {
        found = r.name
        break
      }
    }
  }
  scriptCache.set(cp, found)
  return found
}

// ── Encodings ──────────────────────────────────────────────────────────────────

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')
const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0')

/** UTF-8 bytes of a code point (lone surrogates encode as U+FFFD, like TextEncoder). */
export function utf8Bytes(cp: number): number[] {
  if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd
  if (cp < 0x80) return [cp]
  if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 63)]
  if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)]
  return [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)]
}

export function utf16Units(cp: number): number[] {
  if (cp < 0x10000) return [cp]
  const v = cp - 0x10000
  return [0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)]
}

const NAMED_ENTITIES: Record<number, string> = {
  0x22: '&quot;', 0x26: '&amp;', 0x27: '&apos;', 0x3c: '&lt;', 0x3e: '&gt;', 0xa0: '&nbsp;', 0xa9: '&copy;', 0xae: '&reg;',
  0xb0: '&deg;', 0xb1: '&plusmn;', 0xb7: '&middot;', 0xd7: '&times;', 0xf7: '&divide;', 0xa7: '&sect;', 0xb6: '&para;',
  0xa2: '&cent;', 0xa3: '&pound;', 0xa5: '&yen;', 0x20ac: '&euro;', 0x2013: '&ndash;', 0x2014: '&mdash;', 0x2018: '&lsquo;',
  0x2019: '&rsquo;', 0x201c: '&ldquo;', 0x201d: '&rdquo;', 0x2026: '&hellip;', 0x2022: '&bull;', 0x2122: '&trade;',
  0x2190: '&larr;', 0x2192: '&rarr;', 0x2191: '&uarr;', 0x2193: '&darr;', 0x2264: '&le;', 0x2265: '&ge;', 0x2260: '&ne;',
  0x221e: '&infin;', 0x00ad: '&shy;', 0x200b: '&ZeroWidthSpace;', 0x200c: '&zwnj;', 0x200d: '&zwj;', 0x200e: '&lrm;',
  0x200f: '&rlm;', 0x2002: '&ensp;', 0x2003: '&emsp;', 0x2009: '&thinsp;', 0xe9: '&eacute;', 0xe8: '&egrave;', 0xe0: '&agrave;',
  0xe1: '&aacute;', 0xe7: '&ccedil;', 0xf1: '&ntilde;', 0xf6: '&ouml;', 0xfc: '&uuml;', 0xe4: '&auml;', 0xdf: '&szlig;',
  0xc9: '&Eacute;', 0xc4: '&Auml;', 0xd6: '&Ouml;', 0xdc: '&Uuml;', 0x3b1: '&alpha;', 0x3b2: '&beta;', 0x3c0: '&pi;',
  0x3a9: '&Omega;', 0x3bc: '&mu;', 0x2211: '&sum;', 0x221a: '&radic;',
}

export function htmlEntity(cp: number): string {
  return NAMED_ENTITIES[cp] ?? `&#x${cp.toString(16).toUpperCase()};`
}

/** JavaScript string escape (ES2015 \u{…} for astral code points). */
export function jsEscape(cp: number): string {
  if (cp < 0x10000) return `\\u${hex4(cp)}`
  return `\\u{${cp.toString(16).toUpperCase()}}`
}

/** JSON escape (surrogate pairs for astral code points). */
export function jsonEscape(cp: number): string {
  return utf16Units(cp)
    .map((u) => `\\u${hex4(u)}`)
    .join('')
}

/** CSS escape: backslash + hex + trailing space (the space terminates the escape). */
export function cssEscape(cp: number): string {
  return `\\${cp.toString(16).toUpperCase()} `
}

// ── Flags ──────────────────────────────────────────────────────────────────────

/** Common homoglyphs of ASCII letters/digits/punctuation (subset of Unicode confusables.txt). */
export const CONFUSABLES: Record<number, string> = {
  // Cyrillic
  0x0430: 'a', 0x0435: 'e', 0x043e: 'o', 0x0440: 'p', 0x0441: 'c', 0x0443: 'y', 0x0445: 'x', 0x0455: 's', 0x0456: 'i', 0x0458: 'j',
  0x04bb: 'h', 0x0501: 'd', 0x051b: 'q', 0x051d: 'w', 0x0410: 'A', 0x0412: 'B', 0x0415: 'E', 0x041a: 'K', 0x041c: 'M', 0x041d: 'H',
  0x041e: 'O', 0x0420: 'P', 0x0421: 'C', 0x0422: 'T', 0x0425: 'X', 0x0405: 'S', 0x0406: 'I', 0x0408: 'J', 0x04c0: 'I',
  // Greek
  0x03bf: 'o', 0x03b1: 'a', 0x03bd: 'v', 0x03c1: 'p', 0x03b9: 'i', 0x0391: 'A', 0x0392: 'B', 0x0395: 'E', 0x0396: 'Z', 0x0397: 'H',
  0x0399: 'I', 0x039a: 'K', 0x039c: 'M', 0x039d: 'N', 0x039f: 'O', 0x03a1: 'P', 0x03a4: 'T', 0x03a5: 'Y', 0x03a7: 'X',
  // Latin lookalikes and punctuation
  0x0131: 'i', 0x0261: 'g', 0x01c3: '!', 0x2010: '-', 0x2011: '-', 0x2012: '-', 0x2013: '-', 0x2212: '-', 0x2044: '/', 0x2215: '/',
  0x2018: "'", 0x2019: "'", 0x201a: ',', 0x201c: '"', 0x201d: '"', 0x2032: "'", 0x2033: '"', 0x02bc: "'", 0x02b9: "'",
  0x037e: ';', 0x0589: ':', 0x2236: ':', 0xff1a: ':', 0x2024: '.', 0x0702: '.', 0xa4f8: '.', 0x01c0: 'l', 0x2223: 'l', 0x217c: 'l',
}

/** Fullwidth ASCII variants U+FF01–U+FF5E map to U+0021–U+007E. */
export function confusableWith(cp: number): string | null {
  if (cp >= 0xff01 && cp <= 0xff5e) return String.fromCharCode(cp - 0xfee0)
  if (cp >= 0x1d400 && cp <= 0x1d7ff) {
    // Mathematical alphanumerics: NFKC folds them to ASCII
    const n = String.fromCodePoint(cp).normalize('NFKC')
    return n.length === 1 && n.charCodeAt(0) < 128 ? n : null
  }
  return CONFUSABLES[cp] ?? null
}

export type CharFlag = 'invisible' | 'combining' | 'confusable' | 'control' | 'private-use' | 'unassigned' | 'surrogate' | 'non-ascii' | 'variation-selector' | 'emoji-modifier'

export interface CodePointInfo {
  cp: number
  char: string
  hex: string
  category: CategoryInfo
  script: string
  utf8: number[]
  utf16: number[]
  /** Short label for invisible/special characters (ZWSP, NBSP, LRM, NUL…). */
  label: string | null
  flags: CharFlag[]
  confusable: string | null
}

const RE_EMOJI_PRESENTATION = /^\p{Emoji_Presentation}$/u

export function describeCodePoint(cp: number): CodePointInfo {
  const category = generalCategory(cp)
  const special = cp === 0x0a ? { abbr: 'LF' } : cp === 0x0d ? { abbr: 'CR' } : cp === 0x20 ? { abbr: 'SP' } : classifyCodePoint(cp)
  const flags: CharFlag[] = []
  const c = category.code
  const invisible = c === 'Cf' || c === 'Zs' || c === 'Zl' || c === 'Zp' || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef) || cp === 0x115f || cp === 0x1160 || cp === 0x3164 || cp === 0x2800
  if (invisible && cp !== 0x20) flags.push('invisible')
  if (c === 'Cc' && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) flags.push('control')
  if (c === 'Mn' || c === 'Me' || c === 'Mc') flags.push('combining')
  if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)) flags.push('variation-selector')
  if (cp >= 0x1f3fb && cp <= 0x1f3ff) flags.push('emoji-modifier')
  const confusable = confusableWith(cp)
  if (confusable) flags.push('confusable')
  if (c === 'Co') flags.push('private-use')
  if (c === 'Cn') flags.push('unassigned')
  if (c === 'Cs') flags.push('surrogate')
  if (cp > 0x7f) flags.push('non-ascii')
  return {
    cp,
    char: c === 'Cs' ? '�' : String.fromCodePoint(cp),
    hex: hexCode(cp),
    category,
    script: scriptOf(cp),
    utf8: utf8Bytes(cp),
    utf16: utf16Units(cp),
    label: special ? special.abbr : null,
    flags,
    confusable,
  }
}

export function isEmojiPresentation(cp: number): boolean {
  return RE_EMOJI_PRESENTATION.test(String.fromCodePoint(cp))
}

// ── Representations ───────────────────────────────────────────────────────────

export type Representation = 'char' | 'codepoint' | 'decimal' | 'utf8' | 'utf16' | 'html' | 'js' | 'json' | 'css' | 'url'

export const REPRESENTATIONS: { value: Representation; label: string; example: string }[] = [
  { value: 'char', label: 'Character', example: 'é' },
  { value: 'codepoint', label: 'Code point', example: 'U+00E9' },
  { value: 'decimal', label: 'Decimal', example: '233' },
  { value: 'utf8', label: 'UTF-8 bytes', example: 'C3 A9' },
  { value: 'utf16', label: 'UTF-16 units', example: '00E9' },
  { value: 'html', label: 'HTML entity', example: '&eacute;' },
  { value: 'js', label: 'JavaScript', example: '\\u00E9' },
  { value: 'json', label: 'JSON', example: '\\u00E9' },
  { value: 'css', label: 'CSS', example: '\\E9 ' },
  { value: 'url', label: 'URL-encoded', example: '%C3%A9' },
]

/** Representation of a sequence of code points (a single code point or a grapheme cluster). */
export function represent(cps: number[], kind: Representation): string {
  switch (kind) {
    case 'char':
      return cps.map((cp) => (cp >= 0xd800 && cp <= 0xdfff ? '�' : String.fromCodePoint(cp))).join('')
    case 'codepoint':
      return cps.map(hexCode).join(' ')
    case 'decimal':
      return cps.join(' ')
    case 'utf8':
      return cps.flatMap(utf8Bytes).map(hex2).join(' ')
    case 'utf16':
      return cps.flatMap(utf16Units).map(hex4).join(' ')
    case 'html':
      return cps.map(htmlEntity).join('')
    case 'js':
      return cps.map(jsEscape).join('')
    case 'json':
      return cps.map(jsonEscape).join('')
    case 'css':
      return cps.map(cssEscape).join('').trimEnd()
    case 'url':
      return cps.flatMap(utf8Bytes).map((b) => `%${hex2(b)}`).join('')
  }
}

// ── Segmentation ──────────────────────────────────────────────────────────────

export interface InspectUnit {
  /** UTF-16 offset of the unit in the source text. */
  offset: number
  cps: number[]
}

export interface Segmentation {
  units: InspectUnit[]
  /** True when only the first `limit` units were produced. */
  truncated: boolean
}

/** Code points of a string; lone surrogates are reported as themselves (category Cs). */
export function codePointsOf(s: string): number[] {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i)!
    out.push(cp)
    if (cp > 0xffff) i++
  }
  return out
}

export function segmentCodePoints(text: string, limit = Infinity): Segmentation {
  const units: InspectUnit[] = []
  for (let i = 0; i < text.length; i++) {
    if (units.length >= limit) return { units, truncated: true }
    const cp = text.codePointAt(i)!
    units.push({ offset: i, cps: [cp] })
    if (cp > 0xffff) i++
  }
  return { units, truncated: false }
}

let graphemeSeg: Intl.Segmenter | null | undefined
function graphemeSegmenter(): Intl.Segmenter | null {
  if (graphemeSeg === undefined) graphemeSeg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
  return graphemeSeg
}

export function segmentGraphemes(text: string, limit = Infinity): Segmentation {
  const seg = graphemeSegmenter()
  if (!seg) {
    const r = segmentCodePoints(text, limit)
    return r
  }
  const units: InspectUnit[] = []
  for (const s of seg.segment(text)) {
    if (units.length >= limit) return { units, truncated: true }
    units.push({ offset: s.index, cps: codePointsOf(s.segment) })
  }
  return { units, truncated: false }
}

// ── Summary ────────────────────────────────────────────────────────────────────

export interface UnicodeSummary {
  codePoints: number
  graphemes: number
  utf16Units: number
  utf8Bytes: number
  nonAscii: number
  invisible: number
  combining: number
  confusable: number
  scripts: { name: string; count: number }[]
  normalization: { nfc: boolean; nfd: boolean; nfkc: boolean }
}

export function summarizeUnicode(text: string): UnicodeSummary {
  let codePoints = 0
  let utf8 = 0
  let nonAscii = 0
  let invisible = 0
  let combining = 0
  let confusable = 0
  const scripts = new Map<string, number>()
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i)!
    if (cp > 0xffff) i++
    codePoints++
    if (cp < 0x80) {
      utf8 += 1
      if (cp < 0x20 || cp === 0x7f) {
        if (cp !== 0x0a && cp !== 0x0d && cp !== 0x09) invisible++
      }
      const s = (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) ? 'Latin' : 'Common'
      scripts.set(s, (scripts.get(s) ?? 0) + 1)
      continue
    }
    nonAscii++
    utf8 += cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
    const info = describeCodePoint(cp)
    if (info.flags.includes('invisible')) invisible++
    if (info.flags.includes('combining')) combining++
    if (info.confusable) confusable++
    scripts.set(info.script, (scripts.get(info.script) ?? 0) + 1)
  }
  let graphemes = 0
  const seg = graphemeSegmenter()
  if (seg) for (const _ of seg.segment(text)) graphemes++
  else graphemes = codePoints
  return {
    codePoints,
    graphemes,
    utf16Units: text.length,
    utf8Bytes: utf8,
    nonAscii,
    invisible,
    combining,
    confusable,
    scripts: [...scripts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    normalization: { nfc: text === text.normalize('NFC'), nfd: text === text.normalize('NFD'), nfkc: text === text.normalize('NFKC') },
  }
}

/** Label for a cluster or code point used in the glyph column (invisible ones get their abbreviation). */
export function displayGlyph(cps: number[]): { text: string; special: boolean } {
  if (cps.length === 1) {
    const cp = cps[0]
    const info = describeCodePoint(cp)
    if (info.label && (info.flags.includes('invisible') || info.flags.includes('control') || cp === 0x20 || cp === 0x0a || cp === 0x0d)) return { text: info.label, special: true }
    if (info.flags.includes('combining')) return { text: `◌${String.fromCodePoint(cp)}`, special: false }
    if (info.flags.includes('invisible') || info.category.code === 'Cn' || info.category.code === 'Cs') return { text: info.hex, special: true }
  }
  return { text: represent(cps, 'char'), special: false }
}
