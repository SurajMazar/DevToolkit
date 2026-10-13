/**
 * Heuristic sample generation for a regex using `randexp`, with every sample verified
 * against the real JavaScript engine. randexp predates named groups, lookbehind and
 * unicode property escapes, so the pattern is first rewritten into an approximation.
 *
 * Call this from a worker: verification runs the user's pattern.
 */
import RandExp from 'randexp'

export interface GeneratedSample {
  text: string
  /** full = the whole sample matches; partial = only part of it matches; none = no match. */
  verdict: 'full' | 'partial' | 'none'
}

export interface SampleResult {
  samples: GeneratedSample[]
  notes: string[]
  error?: string
}

const SCRIPT_RANGES: Record<string, string> = {
  Latin: 'A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u00FF',
  Greek: '\\u0391-\\u03A1\\u03A3-\\u03C9',
  Cyrillic: '\\u0410-\\u044F',
  Han: '\\u4E00-\\u9FA5',
  Arabic: '\\u0627-\\u064A',
  Hebrew: '\\u05D0-\\u05EA',
  Hiragana: '\\u3041-\\u3096',
  Katakana: '\\u30A1-\\u30FA',
  Thai: '\\u0E01-\\u0E30',
  Devanagari: '\\u0905-\\u0939',
}

/** Class-body approximation (no brackets) of a unicode property. */
function propertyRange(body: string): string | null {
  const [name, value] = body.includes('=') ? body.split('=') : [body, '']
  if (value && /^(Script|sc|Script_Extensions|scx)$/.test(name)) return SCRIPT_RANGES[value] ?? null
  const key = value && /^(General_Category|gc)$/.test(name) ? value : name
  switch (key) {
    case 'L': case 'Letter': case 'Alphabetic': case 'Alpha': case 'LC': case 'Cased_Letter':
      return 'A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u00FF\\u0391-\\u03C9\\u0410-\\u044F'
    case 'Lu': case 'Uppercase_Letter': case 'Uppercase':
      return 'A-Z\\u00C0-\\u00D6\\u0391-\\u03A9\\u0410-\\u042F'
    case 'Ll': case 'Lowercase_Letter': case 'Lowercase':
      return 'a-z\\u00DF-\\u00F6\\u03B1-\\u03C9\\u0430-\\u044F'
    case 'Lo': case 'Other_Letter': case 'Ideographic':
      return '\\u4E00-\\u9FA5'
    case 'M': case 'Mark': case 'Mn': case 'Nonspacing_Mark':
      return '\\u0300-\\u036F'
    case 'N': case 'Number': case 'Nd': case 'Decimal_Number': case 'ASCII_Hex_Digit': case 'Hex_Digit':
      return key.includes('Hex') ? '0-9a-f' : '0-9'
    case 'P': case 'Punctuation': case 'Po':
      return '!-#%-*,-/:;?@\\[-\\]_{}'
    case 'Pd': case 'Dash':
      return '\\-\\u2013\\u2014'
    case 'S': case 'Symbol': case 'Sm': case 'Math_Symbol':
      return '+<=>|~\\u00D7\\u00F7'
    case 'Sc': case 'Currency_Symbol':
      return '$\\u00A2-\\u00A5\\u20AC'
    case 'Z': case 'Zs': case 'Separator': case 'Space_Separator': case 'White_Space': case 'space':
      return ' '
    case 'Emoji': case 'Emoji_Presentation': case 'Extended_Pictographic': case 'So': case 'RGI_Emoji':
      return '\\u2600-\\u26FF\\u2700-\\u27BF'
    case 'Emoji_Modifier':
      return '\\u2600-\\u2601'
    case 'ASCII':
      return ' -~'
    case 'Any': case 'Assigned':
      return ' -~'
    default:
      return null
  }
}

/** Index of the `)` closing the group that opens at `open`. */
function closingParen(src: string, open: number): number {
  let depth = 0
  let inClass = false
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '\\') {
      i++
      continue
    }
    if (inClass) {
      if (c === ']') inClass = false
      continue
    }
    if (c === '[') inClass = true
    else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i
  }
  return src.length
}

/** Rewrites modern syntax into something randexp understands. */
export function toRandexpPattern(pattern: string, flags: string): { pattern: string; notes: string[] } {
  const unicode = flags.includes('u') || flags.includes('v')
  const notes = new Set<string>()
  const names: string[] = []
  let out = ''
  let inClass = false
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    const rest = pattern.slice(i)
    if (c === '\\') {
      const n = pattern[i + 1]
      if (unicode && (n === 'p' || n === 'P')) {
        const m = /^\\[pP]\{([^}]*)\}/.exec(rest)
        if (m) {
          const range = propertyRange(m[1])
          if (!range) notes.add(`\\${n}{${m[1]}} is approximated with ASCII letters.`)
          else notes.add('Unicode property escapes are approximated with a few representative ranges.')
          const body = range ?? 'a-z'
          if (n === 'P') {
            out += inClass ? '' : '[^' + body + ']'
            if (inClass) notes.add('Negated property escapes inside a class are dropped by the generator.')
          } else out += inClass ? body : `[${body}]`
          i += m[0].length - 1
          continue
        }
      }
      if (n === 'k') {
        const m = /^\\k<([^>]*)>/.exec(rest)
        if (m) {
          const idx = names.indexOf(m[1])
          // Named groups are numbered in order of appearance; `names` holds them in order.
          out += idx === -1 ? '' : `\\${groupNumberOf(pattern, m[1])}`
          i += m[0].length - 1
          continue
        }
      }
      if (n === 'u' && pattern[i + 2] === '{') {
        const m = /^\\u\{([0-9a-fA-F]+)\}/.exec(rest)
        if (m) {
          const cp = parseInt(m[1], 16)
          out += cp <= 0xffff ? `\\u${cp.toString(16).padStart(4, '0')}` : String.fromCodePoint(cp)
          i += m[0].length - 1
          continue
        }
      }
      out += c + (n ?? '')
      i++
      continue
    }
    if (inClass) {
      if (c === ']') inClass = false
      out += c
      continue
    }
    if (c === '[') {
      inClass = true
      if (flags.includes('v') && /\[[^\]]*(&&|--)/.test(rest)) notes.add('v-flag set operations (&&, --) are not supported by the generator; samples may not match.')
      out += c
      continue
    }
    if (c === '(' && pattern[i + 1] === '?') {
      if (rest.startsWith('(?<=') || rest.startsWith('(?<!')) {
        notes.add('Lookbehind assertions are ignored while generating.')
        i = closingParen(pattern, i)
        continue
      }
      const named = /^\(\?<([^>=!][^>]*)>/.exec(rest)
      if (named) {
        names.push(named[1])
        out += '('
        i += named[0].length - 1
        continue
      }
      const modifier = /^\(\?[a-zA-Z]*(?:-[a-zA-Z]*)?:/.exec(rest)
      if (modifier && modifier[0] !== '(?:') {
        notes.add('Pattern modifiers (?i:…) are treated as plain groups.')
        out += '(?:'
        i += modifier[0].length - 1
        continue
      }
      if (rest.startsWith('(?=') || rest.startsWith('(?!')) notes.add('Lookahead assertions are not enforced by the generator; samples that violate them are filtered out.')
    }
    out += c
  }
  return { pattern: out, notes: [...notes] }
}

function groupNumberOf(pattern: string, name: string): number {
  let n = 0
  let inClass = false
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\') {
      i++
      continue
    }
    if (inClass) {
      if (c === ']') inClass = false
      continue
    }
    if (c === '[') inClass = true
    else if (c === '(') {
      if (pattern[i + 1] !== '?') n++
      else if (pattern[i + 2] === '<' && pattern[i + 3] !== '=' && pattern[i + 3] !== '!') {
        n++
        if (pattern.startsWith(`(?<${name}>`, i)) return n
      }
    }
  }
  return n
}

function secureInt(maxExclusive: number): number {
  if (maxExclusive <= 1) return 0
  const buf = new Uint32Array(1)
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive
  let x: number
  do {
    crypto.getRandomValues(buf)
    x = buf[0]
  } while (x >= limit)
  return x % maxExclusive
}

export function generateSamples(pattern: string, flags: string, opts: { count?: number; maxRepeat?: number } = {}): SampleResult {
  const count = Math.max(1, Math.min(opts.count ?? 10, 100))
  const maxRepeat = Math.max(0, Math.min(opts.maxRepeat ?? 6, 50))
  let verifier: RegExp
  try {
    verifier = new RegExp(pattern, flags.replace(/[gy]/g, ''))
  } catch (e) {
    return { samples: [], notes: [], error: (e as Error).message.replace(/^Invalid regular expression: /, '') }
  }
  const { pattern: rewritten, notes } = toRandexpPattern(pattern, flags)
  let gen: RandExp
  try {
    gen = new RandExp(rewritten, flags.replace(/[^im]/g, ''))
  } catch (e) {
    return { samples: [], notes, error: `The generator could not parse this pattern: ${(e as Error).message.replace(/^Invalid regular expression: /, '')}` }
  }
  gen.max = maxRepeat
  gen.randInt = (a: number, b: number) => a + secureInt(b - a + 1)
  const seen = new Set<string>()
  const samples: GeneratedSample[] = []
  for (let attempt = 0; attempt < count * 6 && samples.length < count; attempt++) {
    let text: string
    try {
      text = gen.gen()
    } catch (e) {
      return { samples, notes, error: `Generation failed: ${(e as Error).message}` }
    }
    if (seen.has(text)) continue
    seen.add(text)
    const m = verifier.exec(text)
    samples.push({ text, verdict: !m ? 'none' : m.index === 0 && m[0].length === text.length ? 'full' : 'partial' })
  }
  if (samples.length < count && samples.length > 0) notes.push(`Only ${samples.length} distinct samples exist within the repetition cap.`)
  if (samples.some((s) => s.verdict === 'none')) notes.push('Some generated strings do not match the real engine (assertions or approximations) — they are marked.')
  return { samples, notes }
}
