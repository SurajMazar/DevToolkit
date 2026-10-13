/**
 * Unicode escape sequences: text → escapes in one notation, and a decoder that accepts any
 * mix of notations, reporting invalid sequences with their position.
 */
import { codePointToUtf8, lineColumnAt } from './utf8'

export type EscapeFormat = 'js' | 'es6' | 'hex' | 'html-hex' | 'html-dec' | 'uplus' | 'css' | 'python'

export interface EscapeFormatInfo {
  id: EscapeFormat
  label: string
  example: string
  description: string
}

export const ESCAPE_FORMATS: EscapeFormatInfo[] = [
  { id: 'js', label: '\\uXXXX', example: '\\u00E9 \\uD83D\\uDE00', description: 'JavaScript / JSON / Java — astral characters as surrogate pairs' },
  { id: 'es6', label: '\\u{X}', example: '\\u{E9} \\u{1F600}', description: 'ES2015+ code point escapes (also Rust, Swift \\u{…})' },
  { id: 'hex', label: '\\xXX', example: '\\xE9 \\u{1F600}', description: '\\xXX for U+0000–U+00FF; other characters fall back to \\u{…}' },
  { id: 'python', label: '\\U0001XXXX', example: '\\u00e9 \\U0001f600', description: 'Python / C / C++ — \\u for the BMP, \\U with 8 digits beyond it' },
  { id: 'html-hex', label: '&#xX;', example: '&#xE9; &#x1F600;', description: 'HTML / XML hexadecimal character reference' },
  { id: 'html-dec', label: '&#D;', example: '&#233; &#128512;', description: 'HTML / XML decimal character reference' },
  { id: 'css', label: 'CSS \\X', example: '\\E9 \\1F600 ', description: 'CSS escape — hex digits followed by a space' },
  { id: 'uplus', label: 'U+XXXX', example: 'U+00E9 U+1F600', description: 'Unicode notation, one code point per item' },
]

export interface EscapeOptions {
  /** Leave printable ASCII as-is (backslashes / ampersands are still escaped so the result round-trips). */
  onlyNonAscii?: boolean
  lowercase?: boolean
}

const H = (n: number, width: number, lower: boolean) => {
  const h = n.toString(16).padStart(width, '0')
  return lower ? h : h.toUpperCase()
}

function escapeOne(cp: number, f: EscapeFormat, lower: boolean): string {
  switch (f) {
    case 'js':
      if (cp > 0xffff) {
        const v = cp - 0x10000
        return `\\u${H(0xd800 + (v >> 10), 4, lower)}\\u${H(0xdc00 + (v & 0x3ff), 4, lower)}`
      }
      return `\\u${H(cp, 4, lower)}`
    case 'es6':
      return `\\u{${H(cp, 1, lower)}}`
    case 'hex':
      return cp <= 0xff ? `\\x${H(cp, 2, lower)}` : `\\u{${H(cp, 1, lower)}}`
    case 'python':
      return cp > 0xffff ? `\\U${H(cp, 8, lower)}` : `\\u${H(cp, 4, lower)}`
    case 'html-hex':
      return `&#x${H(cp, 1, lower)};`
    case 'html-dec':
      return `&#${cp};`
    case 'css':
      return `\\${H(cp, 1, lower)} `
    case 'uplus':
      return `U+${H(cp, 4, false)}`
  }
}

export interface EscapeResult {
  text: string
  escaped: number
  /** Unpaired UTF-16 surrogates in the input (escaped as-is, but invalid in most formats). */
  loneSurrogates: number
}

export function escapeUnicode(text: string, format: EscapeFormat, opts: EscapeOptions = {}): EscapeResult {
  const lower = !!opts.lowercase
  const only = !!opts.onlyNonAscii && format !== 'uplus'
  const conflict = format === 'html-hex' || format === 'html-dec' ? 0x26 /* & */ : format === 'uplus' ? -1 : 0x5c /* \ */
  const parts: string[] = []
  let escaped = 0
  let loneSurrogates = 0
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i)
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const d = text.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (d - 0xdc00)
        i++
      } else loneSurrogates++
    } else if (cp >= 0xdc00 && cp <= 0xdfff) loneSurrogates++
    if (only && cp < 0x80 && cp !== conflict && (cp >= 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x0d) && cp !== 0x7f) {
      parts.push(String.fromCharCode(cp))
      continue
    }
    escaped++
    parts.push(escapeOne(cp, format, lower))
  }
  return { text: format === 'uplus' ? parts.join(' ') : parts.join(''), escaped, loneSurrogates }
}

export interface UnescapeIssue {
  offset: number
  length: number
  line: number
  column: number
  raw: string
  message: string
  severity: 'error' | 'warning'
}

export interface UnescapeResult {
  text: string
  /** Escapes decoded, by notation. */
  counts: Partial<Record<EscapeFormat | 'simple' | 'percent-u', number>>
  issues: UnescapeIssue[]
}

const SIMPLE: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0', '\\': '\\', '"': '"', "'": "'", '/': '/', '`': '`' }

const RE =
  /\\u\{([^}\s]*)(\}?)|\\u([0-9a-fA-F]{0,4})|\\U([0-9a-fA-F]{0,8})|\\x([0-9a-fA-F]{0,2})|&#[xX]([0-9a-fA-F]*)(;?)|&#([0-9]*)(;?)|U\+([0-9a-fA-F]{4,6})|%u([0-9a-fA-F]{4})|\\([0-9a-fA-F]{1,6})([ \t\n]|\r\n?)?|\\([\s\S])?/g

/**
 * Decodes any mix of \uXXXX (with surrogate pairs), \u{…}, \UXXXXXXXX, \xXX, &#x…;, &#…;,
 * U+XXXX, %uXXXX, CSS \X escapes and the usual single-character escapes (\n, \t, \\ …).
 * Invalid sequences are left in place and reported.
 */
export function unescapeUnicode(text: string): UnescapeResult {
  const out: string[] = []
  const counts: UnescapeResult['counts'] = {}
  const issues: UnescapeIssue[] = []
  const bump = (k: keyof UnescapeResult['counts']) => (counts[k] = (counts[k] ?? 0) + 1)
  const issue = (offset: number, raw: string, message: string, severity: 'error' | 'warning' = 'error') => {
    if (issues.length >= 1000) return
    const { line, column } = lineColumnAt(text, offset)
    issues.push({ offset, length: raw.length, line, column, raw, message, severity })
  }
  let last = 0
  let m: RegExpExecArray | null
  RE.lastIndex = 0
  /** Pending high surrogate from a \uXXXX escape: [code unit, offset, raw]. */
  let pendingHigh: [number, number, string] | null = null
  const flushHigh = () => {
    if (!pendingHigh) return
    const [u, off, raw] = pendingHigh
    out.push(String.fromCharCode(u))
    issue(off, raw, `${raw} is a high surrogate without a following low surrogate (\\uDC00–\\uDFFF)`, 'warning')
    pendingHigh = null
  }
  const emitCp = (cp: number, at: number, raw: string, fmt: keyof UnescapeResult['counts']) => {
    if (!Number.isFinite(cp) || cp > 0x10ffff) {
      issue(at, raw, `${raw} is beyond U+10FFFF, the last Unicode code point`)
      out.push(raw)
      return
    }
    if (cp >= 0xd800 && cp <= 0xdfff) {
      issue(at, raw, `${raw} is a surrogate code point (U+D800–U+DFFF), not a character — only \\uXXXX pairs may encode surrogates`)
      out.push(raw)
      return
    }
    out.push(String.fromCodePoint(cp))
    bump(fmt)
  }

  while ((m = RE.exec(text))) {
    const at = m.index
    const raw = m[0]
    // Text between escapes.
    if (at > last) {
      flushHigh()
      out.push(text.slice(last, at))
    }
    last = at + raw.length
    const [, es6, es6Close, js, py, hx, htmlHex, htmlHexSemi, htmlDec, htmlDecSemi, uplus, pctU, css, , simple] = m

    if (js !== undefined) {
      if (js.length < 4) {
        flushHigh()
        issue(at, raw, `${raw} is incomplete — \\u needs exactly 4 hex digits`)
        out.push(raw)
        continue
      }
      const u = parseInt(js, 16)
      if (u >= 0xd800 && u <= 0xdbff) {
        flushHigh()
        pendingHigh = [u, at, raw]
        continue
      }
      if (u >= 0xdc00 && u <= 0xdfff) {
        if (pendingHigh) {
          out.push(String.fromCharCode(pendingHigh[0], u))
          pendingHigh = null
          bump('js')
          continue
        }
        out.push(String.fromCharCode(u))
        issue(at, raw, `${raw} is a low surrogate without a preceding high surrogate`, 'warning')
        continue
      }
      flushHigh()
      out.push(String.fromCharCode(u))
      bump('js')
      continue
    }
    flushHigh()
    if (es6 !== undefined) {
      if (!es6Close || !/^[0-9a-fA-F]{1,8}$/.test(es6)) {
        issue(at, raw, !es6Close ? `${raw} is missing its closing "}"` : `${raw} must contain 1–6 hex digits`)
        out.push(raw)
      } else emitCp(parseInt(es6, 16), at, raw, 'es6')
    } else if (py !== undefined) {
      if (py.length < 8) {
        issue(at, raw, `${raw} is incomplete — \\U needs exactly 8 hex digits`)
        out.push(raw)
      } else emitCp(parseInt(py, 16), at, raw, 'python')
    } else if (hx !== undefined) {
      if (hx.length < 2) {
        issue(at, raw, `${raw} is incomplete — \\x needs exactly 2 hex digits`)
        out.push(raw)
      } else emitCp(parseInt(hx, 16), at, raw, 'hex')
    } else if (htmlHex !== undefined || htmlDec !== undefined) {
      const isHex = htmlHex !== undefined
      const digits = isHex ? htmlHex : htmlDec!
      const semi = isHex ? htmlHexSemi : htmlDecSemi
      if (!digits) {
        issue(at, raw, `${raw} has no digits`)
        out.push(raw)
        continue
      }
      if (!semi) issue(at, raw, `${raw} is missing its ";" — decoded anyway`, 'warning')
      emitCp(digits.length > 8 ? Infinity : parseInt(digits, isHex ? 16 : 10), at, raw, isHex ? 'html-hex' : 'html-dec')
    } else if (uplus !== undefined) {
      emitCp(parseInt(uplus, 16), at, raw, 'uplus')
      // "U+0048 U+0069" — a single space between U+ items is a separator.
      if (text[last] === ' ' && text.startsWith('U+', last + 1)) last++
    } else if (pctU !== undefined) {
      const u = parseInt(pctU, 16)
      out.push(String.fromCharCode(u))
      bump('percent-u')
    } else if (css !== undefined) {
      // A single hex digit without the terminating space is ambiguous with C-style escapes:
      // "\b" / "\f" / "\0" are taken as JS escapes, anything else (e.g. regex "\d") is kept.
      if (css.length === 1 && !m[13]) {
        if (css in SIMPLE) {
          out.push(SIMPLE[css])
          bump('simple')
        } else {
          issue(at, raw, `${raw} is ambiguous — write it as a CSS escape with a trailing space ("${raw} ") or as \\u000${css.toUpperCase()}; kept as-is`, 'warning')
          out.push(raw)
        }
      } else emitCp(parseInt(css, 16), at, raw, 'css')
    } else if (simple !== undefined) {
      if (simple in SIMPLE) {
        out.push(SIMPLE[simple])
        bump('simple')
      } else if (simple === '\n' || simple === '\r') {
        // Line continuation.
        bump('simple')
      } else {
        issue(at, raw, `${raw} is not a recognised escape — kept as-is`, 'warning')
        out.push(raw)
      }
    } else {
      issue(at, raw, 'A trailing "\\" has nothing to escape', 'warning')
      out.push(raw)
    }
  }
  flushHigh()
  if (last < text.length) out.push(text.slice(last))
  return { text: out.join(''), counts, issues }
}

// ─── code point inspection ──────────────────────────────────────────────────────

export const CATEGORY_NAMES: Record<string, string> = {
  Lu: 'Uppercase letter',
  Ll: 'Lowercase letter',
  Lt: 'Titlecase letter',
  Lm: 'Modifier letter',
  Lo: 'Other letter',
  Mn: 'Nonspacing mark',
  Mc: 'Spacing mark',
  Me: 'Enclosing mark',
  Nd: 'Decimal digit',
  Nl: 'Letter number',
  No: 'Other number',
  Pc: 'Connector punctuation',
  Pd: 'Dash',
  Ps: 'Open punctuation',
  Pe: 'Close punctuation',
  Pi: 'Initial quote',
  Pf: 'Final quote',
  Po: 'Other punctuation',
  Sm: 'Math symbol',
  Sc: 'Currency symbol',
  Sk: 'Modifier symbol',
  So: 'Other symbol',
  Zs: 'Space separator',
  Zl: 'Line separator',
  Zp: 'Paragraph separator',
  Cc: 'Control',
  Cf: 'Format',
  Cs: 'Surrogate',
  Co: 'Private use',
  Cn: 'Unassigned',
}

const CATEGORY_RES = Object.keys(CATEGORY_NAMES).map((c) => [c, new RegExp(`^\\p{gc=${c}}$`, 'u')] as const)

export function generalCategory(cp: number): string {
  const ch = String.fromCodePoint(cp)
  for (const [c, re] of CATEGORY_RES) if (re.test(ch)) return c
  return 'Cn'
}

export interface CodePointInfo {
  /** UTF-16 offset in the source text. */
  offset: number
  cp: number
  char: string
  utf8: number[]
  utf16: number[]
  /** Unpaired surrogate. */
  lone: boolean
}

/** Splits text into code points (lone surrogates kept as their own entry). */
export function codePoints(text: string, limit = Infinity): { items: CodePointInfo[]; total: number } {
  const items: CodePointInfo[] = []
  let total = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    let cp = c
    let lone = false
    const offset = i
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = text.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        cp = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00)
        i++
      } else lone = true
    } else if (c >= 0xdc00 && c <= 0xdfff) lone = true
    total++
    if (items.length < limit) {
      items.push({
        offset,
        cp,
        char: lone ? '�' : String.fromCodePoint(cp),
        utf8: lone ? [] : codePointToUtf8(cp),
        utf16: cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp],
        lone,
      })
    }
  }
  return { items, total }
}

export const formatCodePoint = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
