/**
 * HTML character references. Encoding/decoding of the full HTML5 named-reference table is
 * delegated to `he` (spec-compliant, including legacy semicolon-less references); this
 * module adds the option model and a scanner that explains ambiguous or legacy forms.
 */
import { decode as heDecode, encode as heEncode } from 'he'
import { lineColumnAt } from './utf8'

export type EntityScope = 'special' | 'nonAscii' | 'everything'
export type EntityFormat = 'named' | 'decimal' | 'hex'

export interface EntityEncodeOptions {
  /** special: only & < > " ' · nonAscii: those plus every non-ASCII character · everything: every character */
  scope: EntityScope
  /** Prefer named references (falls back to hex for characters without a name). */
  format: EntityFormat
}

const SPECIAL: Record<string, [string, number]> = {
  '&': ['&amp;', 38],
  '<': ['&lt;', 60],
  '>': ['&gt;', 62],
  '"': ['&quot;', 34],
  // &apos; is not defined in HTML 4 (and old IE); the numeric form works everywhere.
  "'": ['&#39;', 39],
}

function numeric(cp: number, format: EntityFormat) {
  return format === 'decimal' ? `&#${cp};` : `&#x${cp.toString(16).toUpperCase()};`
}

export function encodeEntities(text: string, opts: EntityEncodeOptions): string {
  if (opts.scope === 'special') {
    return text.replace(/[&<>"']/g, (ch) => {
      const [name, cp] = SPECIAL[ch]
      return opts.format === 'named' ? name : numeric(cp, opts.format)
    })
  }
  const out = heEncode(text, {
    useNamedReferences: opts.format === 'named',
    decimal: opts.format === 'decimal',
    encodeEverything: opts.scope === 'everything',
    allowUnsafeSymbols: false,
  })
  return opts.format === 'named' ? out.replace(/&apos;/g, '&#39;') : out
}

export type EntityNoteKind = 'no-semicolon' | 'legacy-prefix' | 'unknown' | 'windows-1252' | 'replacement' | 'noncharacter' | 'control'

export interface EntityNote {
  offset: number
  length: number
  line: number
  column: number
  raw: string
  kind: EntityNoteKind
  message: string
}

export interface EntityDecodeResult {
  text: string
  /** Character references found. */
  references: number
  notes: EntityNote[]
}

const NOTE_CAP = 500
const knownName = new Map<string, boolean>()
function isKnownName(name: string): boolean {
  let v = knownName.get(name)
  if (v === undefined) {
    // A full match consumes the ";". "&notit;" decodes to "¬it;" via the legacy prefix "&not" — not a name.
    const d = heDecode(`&${name};`)
    v = d !== `&${name};` && (d === ';' || !d.endsWith(';'))
    knownName.set(name, v)
  }
  return v
}

const cpLabel = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`

/**
 * Decodes named, decimal and hex references like a browser does (HTML5 tokenizer rules).
 * `attribute` applies the attribute-value rule for semicolon-less legacy references.
 */
export function decodeEntities(text: string, opts: { attribute?: boolean } = {}): EntityDecodeResult {
  const decoded = heDecode(text, { isAttributeValue: !!opts.attribute })
  const notes: EntityNote[] = []
  let references = 0
  const re = /&(?:#[xX]([0-9a-fA-F]*)|#([0-9]*)|([A-Za-z][A-Za-z0-9]*))(;?)/g
  let m: RegExpExecArray | null
  const note = (offset: number, raw: string, kind: EntityNoteKind, message: string) => {
    if (notes.length >= NOTE_CAP) return
    const { line, column } = lineColumnAt(text, offset)
    notes.push({ offset, length: raw.length, line, column, raw, kind, message })
  }
  while ((m = re.exec(text))) {
    const [raw, hex, dec, name, semi] = m
    const at = m.index
    if (hex !== undefined || dec !== undefined) {
      const digits = hex ?? dec!
      if (!digits) {
        note(at, raw, 'unknown', `"${raw}" has no digits — it is left as literal text`)
        continue
      }
      references++
      const cp = parseInt(digits, hex !== undefined ? 16 : 10)
      if (!semi) note(at, raw, 'no-semicolon', `"${raw}" is missing its ";" — browsers still decode it, but it's a parse error`)
      if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) || !Number.isFinite(cp))
        note(at, raw, 'replacement', `"${raw}" is ${cp === 0 ? 'NUL' : cp > 0x10ffff ? 'beyond U+10FFFF' : 'a surrogate'} — decoded as U+FFFD (�)`)
      else if (cp >= 0x80 && cp <= 0x9f) {
        const mapped = heDecode(`&#${cp};`)
        const mcp = mapped.codePointAt(0)!
        if (mcp !== cp) note(at, raw, 'windows-1252', `"${raw}" is a C1 control code; HTML maps it to Windows-1252 "${mapped}" (${cpLabel(mcp)})`)
        else note(at, raw, 'control', `"${raw}" is the C1 control character ${cpLabel(cp)}`)
      } else if ((cp & 0xfffe) === 0xfffe || (cp >= 0xfdd0 && cp <= 0xfdef)) note(at, raw, 'noncharacter', `"${raw}" is a Unicode noncharacter (${cpLabel(cp)})`)
      else if ((cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0c && cp !== 0x0d) || cp === 0x7f) note(at, raw, 'control', `"${raw}" is a control character (${cpLabel(cp)})`)
      continue
    }
    // Named reference.
    if (semi && isKnownName(name!)) {
      references++
      continue
    }
    // No semicolon, or unknown with semicolon: HTML matches the longest legacy prefix.
    const single = heDecode(raw, { isAttributeValue: !!opts.attribute })
    if (single === raw) {
      if (semi) note(at, raw, 'unknown', `"${raw}" is not a named character reference — left as literal text`)
      else if (isKnownName(name!)) {
        // e.g. "&hellip" without ";" — only legacy names decode without a semicolon.
        note(at, raw, 'unknown', `"${raw}" needs a ";" — only a few legacy names decode without one, so it is left as literal text`)
      } else if (opts.attribute && /^&[A-Za-z0-9]+$/.test(raw) && /[=A-Za-z0-9]/.test(text[at + raw.length] ?? '')) {
        note(at, raw, 'legacy-prefix', `"${raw}" is kept literally in an attribute value because it is followed by "${text[at + raw.length]}"`)
      }
      continue
    }
    references++
    // Find which prefix matched, for the explanation.
    let prefix = ''
    for (let len = name!.length; len >= 2; len--) {
      const cand = name!.slice(0, len)
      if (heDecode(`&${cand}`) !== `&${cand}`) {
        prefix = cand
        break
      }
    }
    if (prefix === name && !semi) note(at, raw, 'no-semicolon', `"${raw}" is a legacy reference without ";" — decoded as "${single}", but writing "${raw};" is safer`)
    else
      note(
        at,
        raw,
        'legacy-prefix',
        `"${raw}" is ambiguous: HTML decodes the legacy prefix "&${prefix}" and keeps the rest — result "${single}". Did you mean something else?`,
      )
  }
  return { text: decoded, references, notes }
}

export interface EntityRef {
  char: string
  name: string
  description: string
}

/** Small, frequently needed reference (copyable in the UI). */
export const COMMON_ENTITIES: EntityRef[] = [
  { char: '&', name: '&amp;', description: 'Ampersand' },
  { char: '<', name: '&lt;', description: 'Less-than' },
  { char: '>', name: '&gt;', description: 'Greater-than' },
  { char: '"', name: '&quot;', description: 'Double quote' },
  { char: "'", name: '&apos;', description: 'Apostrophe (HTML5; use &#39; for HTML 4)' },
  { char: ' ', name: '&nbsp;', description: 'No-break space' },
  { char: '­', name: '&shy;', description: 'Soft hyphen' },
  { char: ' ', name: '&thinsp;', description: 'Thin space' },
  { char: '​', name: '&#8203;', description: 'Zero-width space (no name)' },
  { char: '‍', name: '&zwj;', description: 'Zero-width joiner' },
  { char: '©', name: '&copy;', description: 'Copyright' },
  { char: '®', name: '&reg;', description: 'Registered' },
  { char: '™', name: '&trade;', description: 'Trademark' },
  { char: '€', name: '&euro;', description: 'Euro' },
  { char: '£', name: '&pound;', description: 'Pound' },
  { char: '¥', name: '&yen;', description: 'Yen' },
  { char: '¢', name: '&cent;', description: 'Cent' },
  { char: '§', name: '&sect;', description: 'Section' },
  { char: '¶', name: '&para;', description: 'Pilcrow' },
  { char: '°', name: '&deg;', description: 'Degree' },
  { char: '±', name: '&plusmn;', description: 'Plus-minus' },
  { char: '×', name: '&times;', description: 'Multiplication' },
  { char: '÷', name: '&divide;', description: 'Division' },
  { char: '–', name: '&ndash;', description: 'En dash' },
  { char: '—', name: '&mdash;', description: 'Em dash' },
  { char: '…', name: '&hellip;', description: 'Ellipsis' },
  { char: '‘', name: '&lsquo;', description: 'Left single quote' },
  { char: '’', name: '&rsquo;', description: 'Right single quote' },
  { char: '“', name: '&ldquo;', description: 'Left double quote' },
  { char: '”', name: '&rdquo;', description: 'Right double quote' },
  { char: '«', name: '&laquo;', description: 'Left guillemet' },
  { char: '»', name: '&raquo;', description: 'Right guillemet' },
  { char: '•', name: '&bull;', description: 'Bullet' },
  { char: '·', name: '&middot;', description: 'Middle dot' },
  { char: '→', name: '&rarr;', description: 'Right arrow' },
  { char: '←', name: '&larr;', description: 'Left arrow' },
  { char: '↑', name: '&uarr;', description: 'Up arrow' },
  { char: '↓', name: '&darr;', description: 'Down arrow' },
  { char: '≤', name: '&le;', description: 'Less-or-equal' },
  { char: '≥', name: '&ge;', description: 'Greater-or-equal' },
  { char: '≠', name: '&ne;', description: 'Not equal' },
  { char: '∞', name: '&infin;', description: 'Infinity' },
  { char: '½', name: '&frac12;', description: 'One half' },
  { char: 'µ', name: '&micro;', description: 'Micro' },
  { char: '✓', name: '&check;', description: 'Check mark (HTML5)' },
  { char: '♥', name: '&hearts;', description: 'Heart' },
]

/** Numeric forms for a reference row. */
export function entityForms(char: string): { decimal: string; hex: string; codePoint: string } {
  const cp = char.codePointAt(0)!
  return { decimal: `&#${cp};`, hex: `&#x${cp.toString(16).toUpperCase()};`, codePoint: cpLabel(cp) }
}
