/**
 * Token-by-token explanation of a JavaScript regular expression.
 *
 * This is a tolerant, purpose-built parser for *explaining* patterns — it never
 * executes them. It follows ECMAScript syntax (including the `u` and `v` flag modes,
 * named groups, lookbehind, unicode property escapes and `(?i:…)` modifiers). Syntax
 * errors are reported by `compileRegex`; here malformed input degrades to `error` nodes.
 */

export type ExplainKind =
  | 'literal'
  | 'escape'
  | 'charClass'
  | 'classItem'
  | 'any'
  | 'anchor'
  | 'boundary'
  | 'group'
  | 'lookaround'
  | 'backreference'
  | 'alternation'
  | 'alternative'
  | 'unicodeProperty'
  | 'error'

export interface QuantifierInfo {
  text: string
  min: number
  /** Infinity when unbounded. */
  max: number
  lazy: boolean
  /** `a++` style — not valid JavaScript. */
  possessive: boolean
  description: string
}

export interface ExplainNode {
  kind: ExplainKind
  /** Offsets into the pattern (end exclusive), including any quantifier. */
  start: number
  end: number
  text: string
  /** Short title, e.g. "\d" or "Capturing group #1". */
  label: string
  description: string
  children?: ExplainNode[]
  quantifier?: QuantifierInfo
  groupIndex?: number
  groupName?: string
  /** Extra remark (e.g. atomic-group emulation). */
  note?: string
}

export interface FlagInfo {
  flag: string
  name: string
  description: string
}

export interface ExplainResult {
  nodes: ExplainNode[]
  flags: FlagInfo[]
  groupCount: number
  groupNames: string[]
  /** Static risk hints (e.g. nested quantifiers that may backtrack catastrophically). */
  warnings: { start: number; end: number; message: string }[]
}

export const FLAG_INFO: Record<string, FlagInfo> = {
  g: { flag: 'g', name: 'global', description: 'Find all matches instead of stopping after the first.' },
  i: { flag: 'i', name: 'ignoreCase', description: 'Letters match regardless of case.' },
  m: { flag: 'm', name: 'multiline', description: '^ and $ match at the start and end of every line, not just the whole input.' },
  s: { flag: 's', name: 'dotAll', description: '. also matches line terminators (\\n, \\r, \\u2028, \\u2029).' },
  u: { flag: 'u', name: 'unicode', description: 'Unicode mode: code-point matching, \\u{…} and \\p{…} escapes, stricter syntax.' },
  v: { flag: 'v', name: 'unicodeSets', description: 'Unicode sets mode: everything u does plus nested classes, set operations (&&, --) and string properties. Cannot be combined with u.' },
  y: { flag: 'y', name: 'sticky', description: 'Each match must start exactly where the previous one ended (no skipping ahead).' },
  d: { flag: 'd', name: 'hasIndices', description: 'Record start/end indices for every capture group.' },
}

const GENERAL_CATEGORIES: Record<string, string> = {
  L: 'any letter', Letter: 'any letter',
  Lu: 'an uppercase letter', Uppercase_Letter: 'an uppercase letter',
  Ll: 'a lowercase letter', Lowercase_Letter: 'a lowercase letter',
  Lt: 'a titlecase letter', Titlecase_Letter: 'a titlecase letter',
  LC: 'a cased letter', Cased_Letter: 'a cased letter',
  Lm: 'a modifier letter', Modifier_Letter: 'a modifier letter',
  Lo: 'a letter without case (e.g. CJK, Arabic)', Other_Letter: 'a letter without case (e.g. CJK, Arabic)',
  M: 'a combining mark', Mark: 'a combining mark', Mn: 'a non-spacing mark', Mc: 'a spacing mark', Me: 'an enclosing mark',
  N: 'any numeric character', Number: 'any numeric character',
  Nd: 'a decimal digit in any script', Decimal_Number: 'a decimal digit in any script',
  Nl: 'a letter-like number (e.g. Roman numerals)', Letter_Number: 'a letter-like number (e.g. Roman numerals)',
  No: 'another numeric character (e.g. ², ½)', Other_Number: 'another numeric character (e.g. ², ½)',
  P: 'any punctuation', Punctuation: 'any punctuation',
  Pc: 'connector punctuation (e.g. _)', Pd: 'a dash', Ps: 'an opening bracket', Pe: 'a closing bracket', Pi: 'an initial quote', Pf: 'a final quote', Po: 'other punctuation',
  S: 'any symbol', Symbol: 'any symbol', Sm: 'a math symbol', Math_Symbol: 'a math symbol', Sc: 'a currency symbol', Currency_Symbol: 'a currency symbol', Sk: 'a modifier symbol', So: 'another symbol (e.g. emoji, ©)',
  Z: 'any separator', Separator: 'any separator', Zs: 'a space separator', Space_Separator: 'a space separator', Zl: 'a line separator', Zp: 'a paragraph separator',
  C: 'an "other" character (control, format, unassigned…)', Other: 'an "other" character', Cc: 'a control character', Control: 'a control character', Cf: 'a format character (e.g. zero-width joiner)', Format: 'a format character', Co: 'a private-use character', Cn: 'an unassigned code point', Cs: 'a surrogate',
}

const BINARY_PROPERTIES: Record<string, string> = {
  Alphabetic: 'an alphabetic character', Alpha: 'an alphabetic character',
  White_Space: 'a whitespace character', space: 'a whitespace character',
  Emoji: 'a character with the Emoji property (note: includes digits, # and *)',
  Emoji_Presentation: 'a character rendered as emoji by default',
  Extended_Pictographic: 'a pictographic character (emoji and similar symbols)',
  ASCII: 'an ASCII character (U+0000–U+007F)', Any: 'any code point', Assigned: 'any assigned code point',
  Uppercase: 'an uppercase character', Lowercase: 'a lowercase character', Ideographic: 'an ideographic (CJK) character',
  ASCII_Hex_Digit: 'an ASCII hex digit', Hex_Digit: 'a hex digit', Math: 'a math character', Dash: 'a dash character',
  RGI_Emoji: 'a recommended-for-general-interchange emoji (possibly multi-code-point; v flag only)',
}

export interface ParseState {
  src: string
  pos: number
  unicode: boolean
  vMode: boolean
  totalGroups: number
  groupNames: string[]
  captureSeq: number
  multiline: boolean
  dotAll: boolean
  ignoreCase: boolean
}

/** Counts capturing groups (numbered and named) without full parsing. */
export function countCaptureGroups(src: string, vMode = false): { count: number; names: string[] } {
  let count = 0
  const names: string[] = []
  let classDepth = 0
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '\\') {
      i++
      continue
    }
    if (classDepth > 0) {
      if (c === '[' && vMode) classDepth++
      else if (c === ']') classDepth--
      continue
    }
    if (c === '[') classDepth = 1
    else if (c === '(') {
      if (src[i + 1] !== '?') count++
      else if (src[i + 2] === '<' && src[i + 3] !== '=' && src[i + 3] !== '!') {
        count++
        const m = /^[^>]*/.exec(src.slice(i + 3))
        names.push(m ? m[0] : '')
      }
    }
  }
  return { count, names }
}

function describeChar(ch: string): string {
  const cp = ch.codePointAt(0)!
  const hex = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
  if (ch === ' ') return 'a space'
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return `control character ${hex}`
  if (/\s/u.test(ch)) return `whitespace ${hex}`
  return `“${ch}”`
}

function plural(n: number, w: string) {
  return `${n} ${w}${n === 1 ? '' : 's'}`
}

export function describeQuantifier(min: number, max: number, lazy: boolean): string {
  let range: string
  if (min === 0 && max === Infinity) range = 'zero or more times'
  else if (min === 1 && max === Infinity) range = 'one or more times'
  else if (min === 0 && max === 1) range = 'optionally (zero or one time)'
  else if (min === max) range = `exactly ${plural(min, 'time')}`
  else if (max === Infinity) range = `at least ${plural(min, 'time')}`
  else range = `between ${min} and ${plural(max, 'time')}`
  if (min === max) return `Repeats ${range}.`
  return `Repeats ${range}, ${lazy ? 'as few as possible, expanding as needed (lazy)' : 'as many as possible, giving back as needed (greedy)'}.`
}

const CONTROL_ESCAPES: Record<string, [string, string]> = {
  t: ['Tab', 'A tab character (U+0009).'],
  n: ['Line feed', 'A line feed / newline (U+000A).'],
  r: ['Carriage return', 'A carriage return (U+000D).'],
  f: ['Form feed', 'A form feed (U+000C).'],
  v: ['Vertical tab', 'A vertical tab (U+000B).'],
}

const CLASS_ESCAPES: Record<string, [string, string]> = {
  d: ['Digit', 'Any ASCII digit 0–9. Equivalent to [0-9].'],
  D: ['Non-digit', 'Any character that is not an ASCII digit. Equivalent to [^0-9].'],
  w: ['Word character', 'Any ASCII letter, digit or underscore. Equivalent to [A-Za-z0-9_].'],
  W: ['Non-word character', 'Any character that is not a letter, digit or underscore. Equivalent to [^A-Za-z0-9_].'],
  s: ['Whitespace', 'Any whitespace character: space, tab, line breaks, form feed, vertical tab and Unicode spaces (e.g. U+00A0, U+2003).'],
  S: ['Non-whitespace', 'Any character that is not whitespace.'],
}

const META = new Set(['.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|', '^', '$', '\\', '/', '-'])

function describeProperty(body: string, negated: boolean): { label: string; description: string } {
  const not = negated ? 'NOT ' : ''
  const eq = body.indexOf('=')
  if (eq !== -1) {
    const name = body.slice(0, eq)
    const value = body.slice(eq + 1)
    if (name === 'Script' || name === 'sc') return { label: `Script: ${value}`, description: `Matches any character ${not}in the ${value.replace(/_/g, ' ')} script.` }
    if (name === 'Script_Extensions' || name === 'scx') return { label: `Script extensions: ${value}`, description: `Matches any character ${not}used in the ${value.replace(/_/g, ' ')} script (including shared characters).` }
    if (name === 'General_Category' || name === 'gc') {
      const d = GENERAL_CATEGORIES[value]
      return { label: `Category: ${value}`, description: `Matches ${negated ? 'any character that is not ' : ''}${d ?? `the general category ${value}`}.` }
    }
    return { label: `${name}=${value}`, description: `Unicode property ${name} with value ${value}${negated ? ' (negated)' : ''}.` }
  }
  const d = GENERAL_CATEGORIES[body] ?? BINARY_PROPERTIES[body]
  return {
    label: `Unicode ${body}`,
    description: d ? `Matches ${negated ? 'any character that is not ' : ''}${d}.` : `Matches any character ${negated ? 'without' : 'with'} the Unicode property “${body}”.`,
  }
}

class Parser {
  s: ParseState
  constructor(state: ParseState) {
    this.s = state
  }

  get src() {
    return this.s.src
  }
  peek(o = 0) {
    return this.src[this.s.pos + o]
  }
  eof() {
    return this.s.pos >= this.src.length
  }

  parseDisjunction(inGroup: boolean): ExplainNode[] {
    const start = this.s.pos
    const alternatives: { nodes: ExplainNode[]; start: number; end: number }[] = []
    let altStart = this.s.pos
    let nodes = this.parseSequence(inGroup)
    alternatives.push({ nodes, start: altStart, end: this.s.pos })
    while (this.peek() === '|') {
      this.s.pos++
      altStart = this.s.pos
      nodes = this.parseSequence(inGroup)
      alternatives.push({ nodes, start: altStart, end: this.s.pos })
    }
    if (alternatives.length === 1) return alternatives[0].nodes
    const end = this.s.pos
    return [
      {
        kind: 'alternation',
        start,
        end,
        text: this.src.slice(start, end),
        label: `Alternation (${alternatives.length} options)`,
        description: `Matches one of ${alternatives.length} alternatives, tried left to right; the first that leads to an overall match wins.`,
        children: alternatives.map((a, i) => ({
          kind: 'alternative' as const,
          start: a.start,
          end: a.end,
          text: this.src.slice(a.start, a.end),
          label: `Option ${i + 1}`,
          description: a.nodes.length === 0 ? 'Empty alternative — always matches (zero-width).' : `Alternative ${i + 1}${i > 0 ? ' (after |)' : ''}.`,
          children: a.nodes,
        })),
      },
    ]
  }

  parseSequence(inGroup: boolean): ExplainNode[] {
    const out: ExplainNode[] = []
    while (!this.eof()) {
      const c = this.peek()
      if (c === '|') break
      if (c === ')') {
        if (inGroup) break
        out.push(this.errorNode(this.s.pos, this.s.pos + 1, 'Unmatched “)”', 'This closing parenthesis has no matching “(”.'))
        this.s.pos++
        continue
      }
      const atom = this.parseAtom()
      if (!atom) continue
      this.parseQuantifier(atom)
      out.push(atom)
    }
    return annotateAtomicEmulation(mergeLiterals(out, this.src))
  }

  errorNode(start: number, end: number, label: string, description: string): ExplainNode {
    return { kind: 'error', start, end, text: this.src.slice(start, end), label, description }
  }

  parseQuantifier(atom: ExplainNode) {
    const src = this.src
    const qStart = this.s.pos
    let min: number
    let max: number
    const c = this.peek()
    if (c === '*') [min, max] = [0, Infinity]
    else if (c === '+') [min, max] = [1, Infinity]
    else if (c === '?') [min, max] = [0, 1]
    else if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(qStart))
      if (!m) return
      min = Number(m[1])
      max = m[2] ? (m[3] ? Number(m[3]) : Infinity) : min
      this.s.pos += m[0].length - 1
    } else return
    this.s.pos++
    let lazy = false
    let possessive = false
    if (this.peek() === '?') {
      lazy = true
      this.s.pos++
    } else if (this.peek() === '+') {
      possessive = true
      this.s.pos++
    }
    const text = src.slice(qStart, this.s.pos)
    if (atom.kind === 'anchor' || atom.kind === 'boundary' || (atom.kind === 'lookaround' && this.s.unicode)) {
      atom.note = `The quantifier ${text} cannot apply to an assertion — this is a syntax error${atom.kind === 'lookaround' ? ' in unicode mode' : ''}.`
    }
    let description = describeQuantifier(min, max, lazy)
    if (possessive) description += ' The trailing “+” (possessive quantifier) is not supported in JavaScript and is a syntax error. Emulate it with (?=(…))\\1.'
    if (min > max) description = `Invalid range {${min},${max}}: the minimum exceeds the maximum (syntax error).`
    atom.quantifier = { text, min, max, lazy, possessive, description }
    atom.end = this.s.pos
    atom.text = src.slice(atom.start, atom.end)
  }

  parseAtom(): ExplainNode | null {
    const src = this.src
    const start = this.s.pos
    const c = this.peek()
    switch (c) {
      case '(':
        return this.parseGroup()
      case '[':
        return this.parseClass()
      case '.':
        this.s.pos++
        return {
          kind: 'any',
          start,
          end: this.s.pos,
          text: '.',
          label: 'Any character',
          description: this.s.dotAll ? 'Any single character, including line breaks (s flag).' : 'Any single character except line terminators (\\n, \\r, \\u2028, \\u2029). Add the s flag to include them.',
        }
      case '^':
        this.s.pos++
        return {
          kind: 'anchor',
          start,
          end: this.s.pos,
          text: '^',
          label: this.s.multiline ? 'Start of line' : 'Start of input',
          description: this.s.multiline ? 'Asserts the position is at the start of the input or right after a line break (m flag).' : 'Asserts the position is at the very start of the input. With the m flag it would match at every line start.',
        }
      case '$':
        this.s.pos++
        return {
          kind: 'anchor',
          start,
          end: this.s.pos,
          text: '$',
          label: this.s.multiline ? 'End of line' : 'End of input',
          description: this.s.multiline
            ? 'Asserts the position is at the end of the input or right before a line break (m flag).'
            : 'Asserts the position is at the very end of the input (unlike some engines, JavaScript does not allow a trailing newline here). With the m flag it matches at every line end.',
        }
      case '\\':
        return this.parseEscape(false)
      case '*':
      case '+':
      case '?': {
        this.s.pos++
        return this.errorNode(start, this.s.pos, `Nothing to repeat (${c})`, `The quantifier “${c}” has no preceding token to repeat — this is a syntax error.`)
      }
      case '{': {
        if (/^\{\d+(,\d*)?\}/.test(src.slice(start))) {
          const m = /^\{\d+(,\d*)?\}/.exec(src.slice(start))!
          this.s.pos += m[0].length
          return this.errorNode(start, this.s.pos, 'Nothing to repeat', `The quantifier ${m[0]} has no preceding token to repeat — this is a syntax error.`)
        }
        this.s.pos++
        if (this.s.unicode) return this.errorNode(start, this.s.pos, 'Lone “{”', 'An unescaped “{” is a syntax error in unicode mode. Escape it as \\{.')
        return { kind: 'literal', start, end: this.s.pos, text: '{', label: '“{”', description: 'Literal “{” (not a valid quantifier, so treated literally outside unicode mode).' }
      }
      case ']':
      case '}': {
        this.s.pos++
        if (this.s.unicode) return this.errorNode(start, this.s.pos, `Lone “${c}”`, `An unescaped “${c}” is a syntax error in unicode mode. Escape it as \\${c}.`)
        return { kind: 'literal', start, end: this.s.pos, text: c, label: `“${c}”`, description: `Literal “${c}”.` }
      }
      default: {
        const cp = src.codePointAt(start)!
        const len = this.s.unicode && cp > 0xffff ? 2 : 1
        this.s.pos += len
        const ch = src.slice(start, this.s.pos)
        return { kind: 'literal', start, end: this.s.pos, text: ch, label: describeChar(ch), description: `Matches ${describeChar(ch)} literally${this.s.ignoreCase && /\p{L}/u.test(ch) ? ' (case-insensitive)' : ''}.` }
      }
    }
  }

  parseGroup(): ExplainNode {
    const src = this.src
    const start = this.s.pos
    this.s.pos++ // (
    let kind: ExplainKind = 'group'
    let label: string
    let description: string
    let groupIndex: number | undefined
    let groupName: string | undefined
    const rest = src.slice(this.s.pos)
    if (rest.startsWith('?:')) {
      this.s.pos += 2
      label = 'Non-capturing group'
      description = 'Groups the contents without capturing them (for quantifiers or alternation).'
    } else if (rest.startsWith('?=')) {
      this.s.pos += 2
      kind = 'lookaround'
      label = 'Positive lookahead'
      description = 'Asserts that what follows matches the contents, without consuming characters.'
    } else if (rest.startsWith('?!')) {
      this.s.pos += 2
      kind = 'lookaround'
      label = 'Negative lookahead'
      description = 'Asserts that what follows does NOT match the contents, without consuming characters.'
    } else if (rest.startsWith('?<=')) {
      this.s.pos += 3
      kind = 'lookaround'
      label = 'Positive lookbehind'
      description = 'Asserts that what precedes matches the contents, without consuming characters.'
    } else if (rest.startsWith('?<!')) {
      this.s.pos += 3
      kind = 'lookaround'
      label = 'Negative lookbehind'
      description = 'Asserts that what precedes does NOT match the contents, without consuming characters.'
    } else if (rest.startsWith('?<')) {
      const m = /^\?<([^>]*)>/.exec(rest)
      groupIndex = ++this.s.captureSeq
      if (m) {
        groupName = m[1]
        this.s.pos += m[0].length
        label = `Named group “${groupName}” (#${groupIndex})`
        description = `Captures the match into group ${groupIndex}, also available by name as “${groupName}” ($<${groupName}> in replacements, \\k<${groupName}> for backreferences).`
        if (!/^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u.test(groupName)) description += ' The group name is not a valid identifier (syntax error).'
      } else {
        this.s.pos += 2
        label = 'Malformed named group'
        description = 'A named group must look like (?<name>…).'
        kind = 'error'
      }
    } else if (rest.startsWith('?')) {
      const m = /^\?([a-zA-Z]*)(?:-([a-zA-Z]*))?:/.exec(rest)
      if (m) {
        this.s.pos += m[0].length
        const on = m[1]
        const off = m[2] ?? ''
        const parts: string[] = []
        if (on) parts.push(`enables ${on.split('').map((f) => FLAG_INFO[f]?.name ?? f).join(', ')}`)
        if (off) parts.push(`disables ${off.split('').map((f) => FLAG_INFO[f]?.name ?? f).join(', ')}`)
        label = `Modifier group (?${on}${off ? `-${off}` : ''}:…)`
        description = `Non-capturing group that ${parts.join(' and ') || 'changes no flags'} for its contents only (ES2025 pattern modifiers; only i, m and s are allowed).`
      } else {
        this.s.pos += 1
        kind = 'error'
        label = 'Invalid group'
        description = 'Unknown group syntax after “(?”.'
      }
    } else {
      groupIndex = ++this.s.captureSeq
      label = `Capturing group #${groupIndex}`
      description = `Captures the match into group ${groupIndex} ($${groupIndex} in replacements, \\${groupIndex} for backreferences).`
    }
    const savedMultiline = this.s.multiline
    const savedDotAll = this.s.dotAll
    const savedIgnore = this.s.ignoreCase
    const mod = /^\(\?([a-zA-Z]*)(?:-([a-zA-Z]*))?:/.exec(src.slice(start))
    if (mod && kind === 'group') {
      const on = mod[1]
      const off = mod[2] ?? ''
      if (on.includes('m')) this.s.multiline = true
      if (off.includes('m')) this.s.multiline = false
      if (on.includes('s')) this.s.dotAll = true
      if (off.includes('s')) this.s.dotAll = false
      if (on.includes('i')) this.s.ignoreCase = true
      if (off.includes('i')) this.s.ignoreCase = false
    }
    const children = this.parseDisjunction(true)
    this.s.multiline = savedMultiline
    this.s.dotAll = savedDotAll
    this.s.ignoreCase = savedIgnore
    if (this.peek() === ')') this.s.pos++
    else {
      kind = 'error'
      description = `${label} is never closed — missing “)”. ${description}`
      label = `Unterminated ${label.toLowerCase()}`
    }
    return { kind, start, end: this.s.pos, text: src.slice(start, this.s.pos), label, description, children, groupIndex, groupName }
  }

  parseClass(): ExplainNode {
    const src = this.src
    const start = this.s.pos
    this.s.pos++ // [
    let negated = false
    if (this.peek() === '^') {
      negated = true
      this.s.pos++
    }
    const items: ExplainNode[] = []
    let closed = false
    while (!this.eof()) {
      const c = this.peek()
      if (c === ']') {
        this.s.pos++
        closed = true
        break
      }
      if (this.s.vMode) {
        if (c === '[') {
          items.push(this.parseClass())
          continue
        }
        const two = src.slice(this.s.pos, this.s.pos + 2)
        if (two === '&&' || two === '--') {
          const p = this.s.pos
          this.s.pos += 2
          items.push({ kind: 'classItem', start: p, end: p + 2, text: two, label: two === '&&' ? 'Intersection' : 'Subtraction', description: two === '&&' ? 'Set intersection: keeps only characters in both operands (v flag).' : 'Set subtraction: removes the right operand from the left (v flag).' })
          continue
        }
        if (src.startsWith('\\q{', this.s.pos)) {
          const p = this.s.pos
          const close = src.indexOf('}', p)
          this.s.pos = close === -1 ? src.length : close + 1
          const body = src.slice(p + 3, close === -1 ? src.length : close)
          items.push({ kind: 'classItem', start: p, end: this.s.pos, text: src.slice(p, this.s.pos), label: 'String literals', description: `Matches any of the strings: ${body.split('|').map((x) => `“${x}”`).join(', ')} (v flag).` })
          continue
        }
      }
      const itemStart = this.s.pos
      const first = this.parseClassAtom()
      const canRange = this.peek() === '-' && this.peek(1) !== undefined && this.peek(1) !== ']' && !(this.s.vMode && this.peek(1) === '-')
      if (canRange) {
        const save = this.s.pos
        this.s.pos++
        const second = this.parseClassAtom()
        if (first.char !== undefined && second.char !== undefined) {
          const a = first.char.codePointAt(0)!
          const b = second.char.codePointAt(0)!
          items.push({
            kind: 'classItem',
            start: itemStart,
            end: this.s.pos,
            text: src.slice(itemStart, this.s.pos),
            label: `Range ${first.display}–${second.display}`,
            description: a > b ? `Invalid range: ${first.display} comes after ${second.display} (syntax error).` : `Any character from ${first.display} to ${second.display} (${b - a + 1} code points).`,
          })
          continue
        }
        // Not a range (e.g. [\d-x]): treat '-' literally.
        this.s.pos = save
      }
      items.push(first.node)
    }
    const end = this.s.pos
    const text = src.slice(start, end)
    if (!closed) {
      return { kind: 'error', start, end, text, label: 'Unterminated character class', description: 'This character class is never closed — missing “]”.', children: items }
    }
    const summary = items.map((i) => i.label.replace(/^Range /, '')).slice(0, 8).join(', ') + (items.length > 8 ? ', …' : '')
    const description =
      items.length === 0
        ? negated
          ? 'Matches any single character (an empty negated class).'
          : 'Never matches (an empty class).'
        : negated
          ? `Matches any single character NOT in the set: ${summary}.`
          : `Matches one character from the set: ${summary}.`
    return { kind: 'charClass', start, end, text, label: negated ? 'Negated character class' : 'Character class', description, children: items }
  }

  /** One class member; returns the literal char (if single-char) for range handling. */
  parseClassAtom(): { node: ExplainNode; char?: string; display: string } {
    const src = this.src
    const start = this.s.pos
    if (this.peek() === '\\') {
      const node = this.parseEscape(true)
      const lit = (node as ExplainNode & { _char?: string })._char
      delete (node as ExplainNode & { _char?: string })._char
      return { node: { ...node, kind: node.kind === 'escape' || node.kind === 'unicodeProperty' ? node.kind : 'classItem' }, char: lit, display: node.text }
    }
    const cp = src.codePointAt(start)!
    const len = this.s.unicode && cp > 0xffff ? 2 : 1
    this.s.pos += len
    const ch = src.slice(start, this.s.pos)
    return { node: { kind: 'classItem', start, end: this.s.pos, text: ch, label: describeChar(ch), description: `The character ${describeChar(ch)}.` }, char: ch, display: ch }
  }

  parseEscape(inClass: boolean): ExplainNode {
    const src = this.src
    const start = this.s.pos
    const c = src[start + 1]
    const make = (len: number, kind: ExplainKind, label: string, description: string, char?: string): ExplainNode => {
      this.s.pos = start + len
      const n: ExplainNode & { _char?: string } = { kind, start, end: this.s.pos, text: src.slice(start, this.s.pos), label, description }
      if (char !== undefined) n._char = char
      return n
    }
    if (c === undefined) return make(1, 'error', 'Trailing backslash', 'A pattern cannot end with a lone “\\” (syntax error).')
    if (CLASS_ESCAPES[c]) {
      const [l, d] = CLASS_ESCAPES[c]
      return make(2, 'escape', `\\${c} · ${l}`, d + (this.s.ignoreCase && this.s.unicode && (c === 'w' || c === 'W') ? ' With i+u flags it also matches ſ (U+017F) and K (U+212A).' : ''))
    }
    if (c === 'b') {
      if (inClass) return make(2, 'escape', '\\b · Backspace', 'Inside a character class, \\b means the backspace character (U+0008).', '\b')
      return make(2, 'boundary', '\\b · Word boundary', 'Asserts a position between a word character (\\w) and a non-word character or the input edge. Zero-width.')
    }
    if (c === 'B') {
      if (inClass) return make(2, this.s.unicode ? 'error' : 'escape', '\\B', this.s.unicode ? 'Invalid escape inside a class in unicode mode.' : 'Literal “B”.', 'B')
      return make(2, 'boundary', '\\B · Not a word boundary', 'Asserts a position that is NOT a word boundary (both sides are word characters, or both are not).')
    }
    if (CONTROL_ESCAPES[c]) {
      const [l, d] = CONTROL_ESCAPES[c]
      return make(2, 'escape', `\\${c} · ${l}`, d, { t: '\t', n: '\n', r: '\r', f: '\f', v: '\v' }[c])
    }
    if (c === '0' && !/[0-9]/.test(src[start + 2] ?? '')) return make(2, 'escape', '\\0 · Null', 'The NUL character (U+0000).', '\0')
    if (c === 'c') {
      const l = src[start + 2]
      if (l && /[A-Za-z]/.test(l)) {
        const code = l.toUpperCase().charCodeAt(0) % 32
        return make(3, 'escape', `\\c${l} · Control-${l.toUpperCase()}`, `The control character Ctrl+${l.toUpperCase()} (U+${code.toString(16).toUpperCase().padStart(4, '0')}).`, String.fromCharCode(code))
      }
      return make(2, this.s.unicode ? 'error' : 'escape', '\\c', this.s.unicode ? 'Invalid control escape (syntax error in unicode mode).' : 'Treated as a literal backslash followed by “c”.')
    }
    if (c === 'x') {
      const h = /^[0-9a-fA-F]{2}/.exec(src.slice(start + 2))
      if (h) {
        const ch = String.fromCharCode(parseInt(h[0], 16))
        return make(4, 'escape', `\\x${h[0]} · ${describeChar(ch)}`, `The character with code U+00${h[0].toUpperCase()} (${describeChar(ch)}).`, ch)
      }
      return make(2, this.s.unicode ? 'error' : 'escape', '\\x', this.s.unicode ? 'Incomplete hex escape — needs two hex digits (syntax error).' : 'Incomplete hex escape; matches the literal “x”.', 'x')
    }
    if (c === 'u') {
      const braced = /^\{([0-9a-fA-F]+)\}/.exec(src.slice(start + 2))
      if (braced && this.s.unicode) {
        const cp = parseInt(braced[1], 16)
        if (cp > 0x10ffff) return make(2 + braced[0].length, 'error', '\\u{…}', 'Code point is above U+10FFFF (syntax error).')
        const ch = String.fromCodePoint(cp)
        return make(2 + braced[0].length, 'escape', `\\u{${braced[1]}} · ${describeChar(ch)}`, `The code point U+${braced[1].toUpperCase().padStart(4, '0')} (${describeChar(ch)}).`, ch)
      }
      const h = /^[0-9a-fA-F]{4}/.exec(src.slice(start + 2))
      if (h) {
        const ch = String.fromCharCode(parseInt(h[0], 16))
        return make(6, 'escape', `\\u${h[0]} · ${describeChar(ch)}`, `The character U+${h[0].toUpperCase()} (${describeChar(ch)}).`, ch)
      }
      return make(2, this.s.unicode ? 'error' : 'escape', '\\u', this.s.unicode ? 'Incomplete unicode escape (syntax error).' : 'Incomplete unicode escape; matches the literal “u”.', 'u')
    }
    if ((c === 'p' || c === 'P') && this.s.unicode) {
      const m = /^\{([^}]*)\}/.exec(src.slice(start + 2))
      if (!m) return make(2, 'error', `\\${c}`, 'A property escape must look like \\p{Name} (syntax error).')
      const { label, description } = describeProperty(m[1], c === 'P')
      return make(2 + m[0].length, 'unicodeProperty', `\\${c}{${m[1]}} · ${label}`, description)
    }
    if (c === 'k' && (this.s.unicode || this.s.groupNames.length > 0)) {
      const m = /^<([^>]*)>/.exec(src.slice(start + 2))
      if (m && !inClass) {
        const idx = this.s.groupNames.indexOf(m[1])
        return make(
          2 + m[0].length,
          idx === -1 ? 'error' : 'backreference',
          `\\k<${m[1]}> · Backreference`,
          idx === -1 ? `Refers to a group named “${m[1]}” that does not exist (syntax error).` : `Matches the same text most recently captured by the group “${m[1]}”.`,
        )
      }
    }
    if (/[1-9]/.test(c) && !inClass) {
      const digits = /^\d+/.exec(src.slice(start + 1))![0]
      // Use the longest number that refers to an existing group.
      for (let len = digits.length; len >= 1; len--) {
        const n = Number(digits.slice(0, len))
        if (n <= this.s.totalGroups) {
          const node = make(1 + len, 'backreference', `\\${n} · Backreference`, `Matches the same text most recently captured by group ${n}. If group ${n} has not participated yet, it matches the empty string.`)
          node.groupIndex = n
          return node
        }
      }
      if (this.s.unicode) return make(1 + digits.length, 'error', `\\${digits}`, `There is no group ${digits} to refer back to (syntax error in unicode mode).`)
      const oct = /^[0-7]{1,3}/.exec(src.slice(start + 1))
      if (oct && Number.parseInt(oct[0], 8) <= 0o377) {
        const ch = String.fromCharCode(parseInt(oct[0], 8))
        return make(1 + oct[0].length, 'escape', `\\${oct[0]} · Octal escape`, `Legacy octal escape for ${describeChar(ch)} (no group ${digits} exists). Avoid — it is a syntax error in unicode mode.`, ch)
      }
      return make(2, 'escape', `\\${c}`, `No group ${c} exists; matches the literal “${c}” (legacy behaviour).`, c)
    }
    if (/[0-7]/.test(c) && inClass && !this.s.unicode) {
      const oct = /^[0-7]{1,3}/.exec(src.slice(start + 1))!
      const ch = String.fromCharCode(parseInt(oct[0], 8) & 0xff)
      return make(1 + oct[0].length, 'escape', `\\${oct[0]} · Octal escape`, `Legacy octal escape for ${describeChar(ch)}.`, ch)
    }
    if (inClass && c === '-') return make(2, 'escape', '\\- · “-”', 'A literal hyphen.', '-')
    if (c === '-' && this.s.unicode) return make(2, 'error', '\\-', '“\\-” is only allowed inside a character class in unicode mode (syntax error).')
    if (META.has(c)) return make(2, 'escape', `\\${c} · “${c}”`, `Matches the character “${c}” literally (escaped metacharacter).`, c)
    // Identity escape of a non-meta character.
    const cp = src.codePointAt(start + 1)!
    const len = cp > 0xffff ? 2 : 1
    const ch = src.slice(start + 1, start + 1 + len)
    if (this.s.unicode) {
      return make(1 + len, 'error', `\\${ch}`, `“\\${ch}” is not a valid escape in unicode mode (syntax error).`)
    }
    return make(1 + len, 'escape', `\\${ch} · ${describeChar(ch)}`, `Unnecessary escape; matches ${describeChar(ch)} literally.`, ch)
  }
}

/** Merge runs of unquantified single literal characters into one “matches abc” node. */
function mergeLiterals(nodes: ExplainNode[], src: string): ExplainNode[] {
  const out: ExplainNode[] = []
  for (const n of nodes) {
    const prev = out[out.length - 1]
    const isPlain = (x: ExplainNode) => x.kind === 'literal' && !x.quantifier && !x.note
    if (prev && isPlain(prev) && isPlain(n) && prev.end === n.start) {
      prev.end = n.end
      prev.text = src.slice(prev.start, prev.end)
      prev.label = `“${prev.text}”`
      prev.description = `Matches the characters “${prev.text}” literally.`
      continue
    }
    out.push(n.kind === 'literal' && !n.quantifier ? { ...n } : n)
  }
  return out
}

/** Detects the `(?=(X))\N` idiom (an atomic group / possessive quantifier emulation). */
function annotateAtomicEmulation(nodes: ExplainNode[]): ExplainNode[] {
  for (let i = 0; i + 1 < nodes.length; i++) {
    const a = nodes[i]
    const b = nodes[i + 1]
    if (a.kind !== 'lookaround' || !a.text.startsWith('(?=') || a.quantifier) continue
    const inner = a.children ?? []
    if (inner.length !== 1 || inner[0].kind !== 'group' || inner[0].groupIndex == null || inner[0].quantifier) continue
    if (b.kind === 'backreference' && b.groupIndex === inner[0].groupIndex && !b.quantifier) {
      a.note = `Together with the following \\${b.groupIndex}, this emulates an atomic group (possessive-like): once the lookahead has matched, the engine cannot backtrack into it.`
    }
  }
  return nodes
}

function isUnbounded(n: ExplainNode) {
  return !!n.quantifier && n.quantifier.max === Infinity
}

function findNestedQuantifierRisks(nodes: ExplainNode[], out: ExplainResult['warnings']) {
  const walk = (n: ExplainNode) => {
    if ((n.kind === 'group' || n.kind === 'alternation') && isUnbounded(n)) {
      const inner: ExplainNode[] = []
      const collect = (x: ExplainNode) => {
        if (x !== n && isUnbounded(x) && x.kind !== 'lookaround') inner.push(x)
        if (x.kind !== 'lookaround') x.children?.forEach(collect)
      }
      collect(n)
      if (inner.length) {
        out.push({
          start: n.start,
          end: n.end,
          message: `Nested unbounded quantifiers in ${n.text.length > 40 ? n.text.slice(0, 40) + '…' : n.text} can backtrack catastrophically on inputs that almost match. Prefer a single quantifier or make the inner part unambiguous.`,
        })
        return
      }
    }
    n.children?.forEach(walk)
  }
  nodes.forEach(walk)
}

export function explainRegex(pattern: string, flags = ''): ExplainResult {
  const vMode = flags.includes('v')
  const unicode = vMode || flags.includes('u')
  const { count, names } = countCaptureGroups(pattern, vMode)
  const parser = new Parser({
    src: pattern,
    pos: 0,
    unicode,
    vMode,
    totalGroups: count,
    groupNames: names,
    captureSeq: 0,
    multiline: flags.includes('m'),
    dotAll: flags.includes('s'),
    ignoreCase: flags.includes('i'),
  })
  const nodes = parser.parseDisjunction(false)
  const warnings: ExplainResult['warnings'] = []
  findNestedQuantifierRisks(nodes, warnings)
  const flagInfos = Array.from(new Set(flags.split('')))
    .map((f) => FLAG_INFO[f] ?? { flag: f, name: 'unknown', description: `“${f}” is not a valid flag.` })
  return { nodes, flags: flagInfos, groupCount: count, groupNames: names, warnings }
}

export interface FlatExplainRow {
  node: ExplainNode
  depth: number
}

/** Depth-first flattening for list display. */
export function flattenExplain(nodes: ExplainNode[], depth = 0, out: FlatExplainRow[] = []): FlatExplainRow[] {
  for (const n of nodes) {
    out.push({ node: n, depth })
    if (n.children && n.kind !== 'charClass') flattenExplain(n.children, depth + 1, out)
    else if (n.children && n.kind === 'charClass' && n.children.some((c) => c.kind === 'charClass' || c.kind === 'unicodeProperty' || c.kind === 'escape')) {
      flattenExplain(n.children, depth + 1, out)
    }
  }
  return out
}

/** Splits `/pattern/flags` literal syntax into parts (returns null when not a literal). */
export function parseRegexLiteral(text: string): { pattern: string; flags: string } | null {
  const m = /^\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\[])+)\/([dgimsuvy]*)$/s.exec(text.trim())
  return m ? { pattern: m[1], flags: m[2] } : null
}
