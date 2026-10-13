/**
 * Case conversion engine. Pure functions, no DOM — runs on the main thread for small
 * input and inside a Web Worker for large input.
 *
 * Two families of formats:
 *  - Text formats (lowercase, Title Case, Sentence case, …) transform prose in place and
 *    preserve all punctuation, spacing and line breaks.
 *  - Identifier formats (camelCase, snake_case, …) split each line into words and re-join
 *    them; punctuation is treated as a word separator and dropped.
 *
 * Word splitting (identifier formats):
 *  1. Runs of letters, marks and digits are words; everything else separates words.
 *     Apostrophes inside words are removed ("don't" → "dont").
 *  2. Within a run, boundaries are inserted at lower→Upper ("fooBar" → foo|Bar), and at the
 *     end of an uppercase run before a capitalised word ("XMLHttp" → XML|Http).
 *  3. Optional: letter↔digit boundaries ("v2Api" → v|2|Api) when separateNumbers is on.
 *  4. Scripts without spaces (CJK, Thai…) are segmented with Intl.Segmenter when available.
 *
 * Acronyms: with acronyms = 'words', "XMLHttpRequest" → xmlHttpRequest / XmlHttpRequest.
 * With 'preserve', words written fully in capitals (≥2 letters) stay capitalised in
 * camelCase, PascalCase, Train-Case and Title Case: XMLHttpRequest → xmlHttpRequest (camel,
 * a leading acronym is lowercased) / XMLHttpRequest (Pascal). Lines with no lowercase letters
 * at all ("HELLO WORLD") are never treated as acronyms. Words in acronymList are always
 * treated as acronyms ("user id" → userID).
 */

export type TextCaseId =
  | 'lower'
  | 'upper'
  | 'title'
  | 'sentence'
  | 'capitalize-words'
  | 'capitalize-sentences'
  | 'uncapitalize-words'
  | 'toggle'
  | 'alternating'
  | 'inverse'

export type IdentifierCaseId =
  | 'camel'
  | 'pascal'
  | 'snake'
  | 'screaming-snake'
  | 'kebab'
  | 'screaming-kebab'
  | 'train'
  | 'dot'
  | 'path'
  | 'space'

export type CaseId = TextCaseId | IdentifierCaseId

export interface CaseOptions {
  /** BCP 47 locale for language-sensitive mapping (e.g. 'tr', 'nl'); undefined = default. */
  locale?: string
  acronyms: 'words' | 'preserve'
  /** Words always treated as acronyms (case-insensitive), e.g. ['ID', 'URL']. */
  acronymList: string[]
  separateNumbers: boolean
  /** Identifier formats: convert each line separately, or the whole text as one identifier. */
  scope: 'lines' | 'whole'
  /** Title Case: 'smart' keeps English minor words lowercase; 'all' capitalises every word. */
  titleStyle: 'smart' | 'all'
}

export const DEFAULT_CASE_OPTIONS: CaseOptions = {
  locale: undefined,
  acronyms: 'words',
  acronymList: [],
  separateNumbers: false,
  scope: 'lines',
  titleStyle: 'smart',
}

export interface CaseFormat {
  id: CaseId
  name: string
  example: string
  kind: 'text' | 'identifier'
  aliases?: string[]
  description: string
}

export const CASE_FORMATS: CaseFormat[] = [
  { id: 'camel', name: 'camelCase', example: 'helloWorldExample', kind: 'identifier', description: 'Words joined, first lowercase, rest capitalised.' },
  { id: 'pascal', name: 'PascalCase', example: 'HelloWorldExample', kind: 'identifier', aliases: ['UpperCamelCase'], description: 'Words joined, every word capitalised.' },
  { id: 'snake', name: 'snake_case', example: 'hello_world_example', kind: 'identifier', description: 'Lowercase words joined by underscores.' },
  { id: 'screaming-snake', name: 'SCREAMING_SNAKE_CASE', example: 'HELLO_WORLD_EXAMPLE', kind: 'identifier', aliases: ['CONSTANT_CASE'], description: 'Uppercase words joined by underscores (constants).' },
  { id: 'kebab', name: 'kebab-case', example: 'hello-world-example', kind: 'identifier', aliases: ['dash-case', 'lisp-case'], description: 'Lowercase words joined by hyphens.' },
  { id: 'screaming-kebab', name: 'SCREAMING-KEBAB-CASE', example: 'HELLO-WORLD-EXAMPLE', kind: 'identifier', aliases: ['COBOL-CASE'], description: 'Uppercase words joined by hyphens.' },
  { id: 'train', name: 'Train-Case', example: 'Hello-World-Example', kind: 'identifier', aliases: ['HTTP-Header-Case'], description: 'Capitalised words joined by hyphens.' },
  { id: 'dot', name: 'dot.case', example: 'hello.world.example', kind: 'identifier', description: 'Lowercase words joined by dots.' },
  { id: 'path', name: 'path/case', example: 'hello/world/example', kind: 'identifier', description: 'Lowercase words joined by slashes.' },
  { id: 'space', name: 'space case', example: 'hello world example', kind: 'identifier', aliases: ['no case'], description: 'Lowercase words separated by single spaces, punctuation removed.' },
  { id: 'lower', name: 'lowercase', example: 'hello world example', kind: 'text', description: 'Every letter lowercase. Punctuation and spacing kept.' },
  { id: 'upper', name: 'UPPERCASE', example: 'HELLO WORLD EXAMPLE', kind: 'text', description: 'Every letter uppercase. Punctuation and spacing kept.' },
  { id: 'title', name: 'Title Case', example: 'Hello World Example', kind: 'text', description: 'Headline capitalisation; minor words (a, of, the…) stay lowercase in smart mode.' },
  { id: 'sentence', name: 'Sentence case', example: 'Hello world example', kind: 'text', description: 'Lowercase, with the first letter of each sentence and line capitalised.' },
  { id: 'capitalize-words', name: 'Capitalize Each Word', example: 'Hello World Example', kind: 'text', description: 'Uppercases the first letter of every word; leaves the rest untouched.' },
  { id: 'capitalize-sentences', name: 'Capitalize sentences', example: 'Hello world. Example', kind: 'text', description: 'Uppercases the first letter of each sentence; leaves the rest untouched.' },
  { id: 'uncapitalize-words', name: 'uncapitalize Words', example: 'hello world example', kind: 'text', aliases: ['remove capitalization'], description: 'Removes capitalisation from the first letter of every word.' },
  { id: 'toggle', name: 'tOGGLE cASE', example: 'hELLO wORLD eXAMPLE', kind: 'text', aliases: ['swap case'], description: 'Swaps the case of every letter.' },
  { id: 'alternating', name: 'aLtErNaTiNg CaSe', example: 'hElLo WoRlD eXaMpLe', kind: 'text', description: 'Alternates lower/upper across letters (punctuation skipped).' },
  { id: 'inverse', name: 'iNVERSE cASE', example: 'hELLO wORLD eXAMPLE', kind: 'text', description: 'First letter of each word lowercase, the rest uppercase.' },
]

export const caseFormatById = new Map(CASE_FORMATS.map((f) => [f.id, f]))

// ── Character helpers ────────────────────────────────────────────────────────────

const RE_UPPER = /\p{Lu}|\p{Lt}/u
const RE_LOWER = /\p{Ll}/u
const RE_HAS_LOWER = /\p{Ll}/u
const RE_LETTER = /\p{L}/u

const lower = (s: string, locale?: string) => (locale ? s.toLocaleLowerCase(locale) : s.toLowerCase())
const upper = (s: string, locale?: string) => (locale ? s.toLocaleUpperCase(locale) : s.toUpperCase())

/** Uppercases the first code point (Dutch "ij" digraph aware). Does not touch the rest. */
function upperFirst(word: string, locale?: string): string {
  if (!word) return word
  if (locale && /^nl\b/i.test(locale) && /^ij/i.test(word)) return 'IJ' + word.slice(2)
  const cp = word.codePointAt(0)!
  const first = String.fromCodePoint(cp)
  return upper(first, locale) + word.slice(first.length)
}

function lowerFirst(word: string, locale?: string): string {
  if (!word) return word
  const cp = word.codePointAt(0)!
  const first = String.fromCodePoint(cp)
  return lower(first, locale) + word.slice(first.length)
}

/** "hELLO" → "Hello" (Dutch-aware). */
function capitalize(word: string, locale?: string): string {
  return upperFirst(lower(word, locale), locale)
}

// ── Word splitting ───────────────────────────────────────────────────────────────

const RE_RUN = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu
const RE_NOSPACE_SCRIPT = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]/u

let segmenter: Intl.Segmenter | null | undefined

function getSegmenter(): Intl.Segmenter | null {
  if (segmenter === undefined) {
    segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null
  }
  return segmenter
}

export interface Word {
  text: string
  /** Written entirely in capitals in the source (≥ 2 letters). */
  allCaps: boolean
}

function splitRun(run: string, separateNumbers: boolean): string[] {
  let s = run.replace(/['’]/g, '')
  s = s.replace(/([\p{Ll}\p{N}])([\p{Lu}\p{Lt}])/gu, '$1\u0000$2')
  s = s.replace(/([\p{Lu}\p{Lt}])([\p{Lu}\p{Lt}][\p{Ll}])/gu, '$1\u0000$2')
  if (separateNumbers) {
    s = s.replace(/([\p{L}\p{M}])(\p{N})/gu, '$1\u0000$2')
    s = s.replace(/(\p{N})([\p{L}])/gu, '$1\u0000$2')
  }
  return s.split('\u0000').filter(Boolean)
}

export function splitWords(input: string, separateNumbers = false): Word[] {
  const out: Word[] = []
  const lineHasLower = RE_HAS_LOWER.test(input)
  for (const m of input.matchAll(RE_RUN)) {
    let runs = [m[0]]
    if (RE_NOSPACE_SCRIPT.test(m[0])) {
      const seg = getSegmenter()
      if (seg) runs = Array.from(seg.segment(m[0]), (x) => x.segment).filter((x) => /[\p{L}\p{N}]/u.test(x))
    }
    for (const run of runs) {
      for (const w of splitRun(run, separateNumbers)) {
        const letters = w.replace(/[^\p{L}]/gu, '')
        const allCaps = lineHasLower && letters.length >= 2 && !RE_LOWER.test(letters) && RE_UPPER.test(letters)
        out.push({ text: w, allCaps })
      }
    }
  }
  return out
}

// ── Identifier formats ───────────────────────────────────────────────────────────

function isAcronym(w: Word, o: CaseOptions, list: Set<string>): boolean {
  if (list.size && list.has(w.text.toUpperCase())) return true
  return o.acronyms === 'preserve' && w.allCaps
}

export function joinIdentifier(words: Word[], id: IdentifierCaseId, o: CaseOptions, list: Set<string>): string {
  const loc = o.locale
  switch (id) {
    case 'camel':
      return words
        .map((w, i) => (i === 0 ? lower(w.text, loc) : isAcronym(w, o, list) ? upper(w.text, loc) : capitalize(w.text, loc)))
        .join('')
    case 'pascal':
      return words.map((w) => (isAcronym(w, o, list) ? upper(w.text, loc) : capitalize(w.text, loc))).join('')
    case 'snake':
      return words.map((w) => lower(w.text, loc)).join('_')
    case 'screaming-snake':
      return words.map((w) => upper(w.text, loc)).join('_')
    case 'kebab':
      return words.map((w) => lower(w.text, loc)).join('-')
    case 'screaming-kebab':
      return words.map((w) => upper(w.text, loc)).join('-')
    case 'train':
      return words.map((w) => (isAcronym(w, o, list) ? upper(w.text, loc) : capitalize(w.text, loc))).join('-')
    case 'dot':
      return words.map((w) => lower(w.text, loc)).join('.')
    case 'path':
      return words.map((w) => lower(w.text, loc)).join('/')
    case 'space':
      return words.map((w) => lower(w.text, loc)).join(' ')
  }
}

function convertIdentifierText(text: string, id: IdentifierCaseId, o: CaseOptions): string {
  const list = new Set(o.acronymList.map((a) => a.trim().toUpperCase()).filter(Boolean))
  if (o.scope === 'whole') return joinIdentifier(splitWords(text, o.separateNumbers), id, o, list)
  const lines = text.split(/(\r?\n)/)
  for (let i = 0; i < lines.length; i += 2) {
    const line = lines[i]
    if (!line) continue
    const lead = line.match(/^\s*/)![0]
    lines[i] = lead + joinIdentifier(splitWords(line, o.separateNumbers), id, o, list)
  }
  return lines.join('')
}

// ── Text formats ─────────────────────────────────────────────────────────────────

const MINOR_WORDS = new Set(
  'a an the and but or nor for so yet as at by in of off on per to up via vs vs. v. en if from into onto over with than'.split(' '),
)

/** Word tokens for prose: letters/digits with inner apostrophes; hyphens split words. */
const RE_PROSE_WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu

function hasInnerCaps(w: string): boolean {
  // "iPhone", "McDonald", "JavaScript": an uppercase letter after the first position
  // in a word that also contains lowercase letters.
  const rest = w.slice(String.fromCodePoint(w.codePointAt(0)!).length)
  return RE_UPPER.test(rest) && RE_LOWER.test(w)
}

function titleCase(text: string, o: CaseOptions): string {
  const loc = o.locale
  const english = !loc || /^en\b/i.test(loc)
  const smart = o.titleStyle === 'smart' && english
  const list = new Set(o.acronymList.map((a) => a.trim().toUpperCase()).filter(Boolean))
  const textHasLower = RE_HAS_LOWER.test(text)
  // Lines are independent (a line start always begins a title), so process line by line:
  // this keeps memory flat on multi-megabyte input.
  const parts = text.split(/(\r\n|\n|\r)/)
  for (let p = 0; p < parts.length; p += 2) {
    const line = parts[p]
    if (!line) continue
    const matches = Array.from(line.matchAll(RE_PROSE_WORD))
    const out: string[] = []
    let last = 0
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i]
      const word = m[0]
      const start = m.index!
      out.push(line.slice(last, start))
      last = start + word.length
      const before = i === 0 ? '' : line.slice(matches[i - 1].index! + matches[i - 1][0].length, start)
      const after = line.slice(last, matches[i + 1]?.index ?? line.length)
      const isFirst = i === 0 || /[.!?:;—–]\s*$|["“(\[]\s*$/.test(before)
      const isLast = i === matches.length - 1 || /^\s*[.!?:;—–]|^\s*[)"”\]]/.test(after)
      const letters = word.replace(/[^\p{L}]/gu, '')
      const isCaps = textHasLower && letters.length >= 2 && !RE_LOWER.test(letters)
      if (list.size && list.has(word.toUpperCase())) out.push(upper(word, loc))
      else if ((o.acronyms === 'preserve' && isCaps) || hasInnerCaps(word)) out.push(word)
      else if (smart && !isFirst && !isLast && MINOR_WORDS.has(lower(word, loc))) out.push(lower(word, loc))
      else out.push(capitalize(word, loc))
    }
    out.push(line.slice(last))
    parts[p] = out.join('')
  }
  return parts.join('')
}

/** Indices where a sentence starts: text start, after terminal punctuation, each new line. */
function forEachSentenceStart(text: string, fn: (index: number) => void) {
  let atStart = true
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (atStart) {
      if (RE_LETTER.test(ch) || /\p{N}/u.test(ch)) {
        if (RE_LETTER.test(ch)) fn(i)
        atStart = false
      }
      continue
    }
    if (ch === '\n') atStart = true
    else if (ch === '.' || ch === '!' || ch === '?' || ch === '…' || ch === '。' || ch === '！' || ch === '？') {
      // Require whitespace after the terminator so "e.g." / "3.14" / "file.txt" don't split.
      let j = i + 1
      while (j < text.length && /["'”’)\]]/.test(text[j])) j++
      if (j >= text.length || /\s/.test(text[j]) || ch === '。' || ch === '！' || ch === '？') atStart = true
    }
  }
}

function sentenceCase(text: string, o: CaseOptions, lowerRest: boolean): string {
  const loc = o.locale
  let base = text
  if (lowerRest) {
    const list = new Set(o.acronymList.map((a) => a.trim().toUpperCase()).filter(Boolean))
    const textHasLower = RE_HAS_LOWER.test(text)
    base = text.replace(RE_PROSE_WORD, (w) => {
      const letters = w.replace(/[^\p{L}]/gu, '')
      if (list.has(w.toUpperCase())) return upper(w, loc)
      if (o.acronyms === 'preserve' && textHasLower && letters.length >= 2 && !RE_LOWER.test(letters)) return w
      return lower(w, loc)
    })
    // English: the pronoun "I" and its contractions stay capitalised.
    if (!loc || /^en\b/i.test(loc)) base = base.replace(/(^|[^\p{L}\p{N}])i(?=$|[^\p{L}\p{N}'’]|['’](?:m|d|ll|ve)\b)/gu, '$1I')
  }
  const out: string[] = []
  let pos = 0
  forEachSentenceStart(base, (i) => {
    // Handle surrogate pairs and the Dutch IJ digraph: uppercase the full unit.
    const cp = base.codePointAt(i)!
    const unit = loc && /^nl\b/i.test(loc) && /^ij/i.test(base.slice(i, i + 2)) ? base.slice(i, i + 2) : String.fromCodePoint(cp)
    out.push(base.slice(pos, i), unit.length === 2 && /^ij$/i.test(unit) ? 'IJ' : upper(unit, loc))
    pos = i + unit.length
  })
  out.push(base.slice(pos))
  return out.join('')
}

function toggleCase(text: string, loc?: string): string {
  return text.replace(/\p{L}/gu, (c) => {
    const u = upper(c, loc)
    return u === c ? lower(c, loc) : u
  })
}

function alternatingCase(text: string, loc?: string): string {
  let n = 0
  return text.replace(/\p{L}/gu, (c) => (n++ % 2 === 0 ? lower(c, loc) : upper(c, loc)))
}

function inverseCase(text: string, loc?: string): string {
  return text.replace(RE_PROSE_WORD, (w) => lowerFirst(upper(w, loc), loc))
}

// ── Public API ───────────────────────────────────────────────────────────────────

export function convertCase(text: string, id: CaseId, options: Partial<CaseOptions> = {}): string {
  const o: CaseOptions = { ...DEFAULT_CASE_OPTIONS, ...options }
  const loc = o.locale
  switch (id) {
    case 'lower':
      return lower(text, loc)
    case 'upper':
      return upper(text, loc)
    case 'title':
      return titleCase(text, o)
    case 'sentence':
      return sentenceCase(text, o, true)
    case 'capitalize-sentences':
      return sentenceCase(text, o, false)
    case 'capitalize-words':
      return text.replace(RE_PROSE_WORD, (w) => upperFirst(w, loc))
    case 'uncapitalize-words':
      return text.replace(RE_PROSE_WORD, (w) => lowerFirst(w, loc))
    case 'toggle':
      return toggleCase(text, loc)
    case 'alternating':
      return alternatingCase(text, loc)
    case 'inverse':
      return inverseCase(text, loc)
    default:
      return convertIdentifierText(text, id, o)
  }
}

// ── Detection ────────────────────────────────────────────────────────────────────

export type DetectedStyle = IdentifierCaseId | 'lower' | 'upper' | 'title' | 'sentence' | 'flat' | 'FLAT' | 'mixed'

const DETECTORS: [DetectedStyle, RegExp][] = [
  ['snake', /^[\p{Ll}\p{N}]+(?:_[\p{Ll}\p{N}]+)+$/u],
  ['screaming-snake', /^[\p{Lu}\p{N}]+(?:_[\p{Lu}\p{N}]+)+$/u],
  ['kebab', /^[\p{Ll}\p{N}]+(?:-[\p{Ll}\p{N}]+)+$/u],
  ['screaming-kebab', /^[\p{Lu}\p{N}]+(?:-[\p{Lu}\p{N}]+)+$/u],
  ['train', /^\p{Lu}[\p{Ll}\p{N}]*(?:-\p{Lu}[\p{Ll}\p{N}]*)+$/u],
  ['dot', /^[\p{Ll}\p{N}]+(?:\.[\p{Ll}\p{N}]+)+$/u],
  ['path', /^[\p{Ll}\p{N}]+(?:\/[\p{Ll}\p{N}]+)+$/u],
  ['camel', /^\p{Ll}[\p{Ll}\p{N}]*(?:\p{Lu}+[\p{Ll}\p{N}]*)+$/u],
  ['pascal', /^\p{Lu}[\p{Ll}\p{N}]+(?:\p{Lu}+[\p{Ll}\p{N}]*)*$|^\p{Lu}{2,}[\p{Ll}][\p{Ll}\p{N}]*(?:\p{Lu}+[\p{Ll}\p{N}]*)*$/u],
  ['flat', /^[\p{Ll}\p{N}]+$/u],
  ['FLAT', /^[\p{Lu}\p{N}]+$/u],
]

export function detectLineStyle(line: string): DetectedStyle | null {
  const s = line.trim()
  if (!s || !RE_LETTER.test(s)) return null
  if (!/\s/.test(s)) {
    for (const [style, re] of DETECTORS) if (re.test(s)) return style
    return 'mixed'
  }
  if (!RE_HAS_LOWER.test(s)) return 'upper'
  if (!RE_UPPER.test(s)) return 'lower'
  const words = Array.from(s.matchAll(RE_PROSE_WORD), (m) => m[0]).filter((w) => RE_LETTER.test(w))
  const cap = words.filter((w) => RE_UPPER.test(String.fromCodePoint(w.codePointAt(0)!))).length
  if (cap === words.length || (words.length > 2 && cap / words.length >= 0.6 && RE_UPPER.test(words[0][0]))) return 'title'
  if (RE_UPPER.test(words[0]?.[0] ?? '') && cap <= Math.max(1, Math.ceil(words.length * 0.25))) return 'sentence'
  return 'mixed'
}

export const STYLE_LABELS: Record<DetectedStyle, string> = {
  camel: 'camelCase', pascal: 'PascalCase', snake: 'snake_case', 'screaming-snake': 'SCREAMING_SNAKE_CASE',
  kebab: 'kebab-case', 'screaming-kebab': 'SCREAMING-KEBAB-CASE', train: 'Train-Case', dot: 'dot.case', path: 'path/case',
  space: 'space case', lower: 'lowercase', upper: 'UPPERCASE', title: 'Title Case', sentence: 'Sentence case',
  flat: 'lowercase word', FLAT: 'UPPERCASE word', mixed: 'Mixed',
}

export interface DetectionSummary {
  dominant: DetectedStyle | null
  counts: Partial<Record<DetectedStyle, number>>
  lines: number
}

/** Detects the casing style of up to `maxLines` non-empty lines. */
export function detectStyles(text: string, maxLines = 2000): DetectionSummary {
  const counts: Partial<Record<DetectedStyle, number>> = {}
  let n = 0
  let start = 0
  while (start <= text.length && n < maxLines) {
    let end = text.indexOf('\n', start)
    if (end === -1) end = text.length
    const style = detectLineStyle(text.slice(start, end))
    if (style) {
      counts[style] = (counts[style] ?? 0) + 1
      n++
    }
    start = end + 1
  }
  let dominant: DetectedStyle | null = null
  let best = 0
  for (const [k, v] of Object.entries(counts) as [DetectedStyle, number][]) {
    if (v > best) {
      best = v
      dominant = k
    }
  }
  // Only report a style when it describes at least half of the lines.
  if (dominant && best < n / 2) dominant = 'mixed'
  return { dominant, counts, lines: n }
}

// ── Identifier renaming inside code ──────────────────────────────────────────────

export interface RenameOptions extends Partial<CaseOptions> {
  from: IdentifierCaseId | 'any'
  to: IdentifierCaseId
  /** Skip string literals and comments in C-like / script syntax. */
  skipStringsAndComments: boolean
}

const RE_CODE_TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|(?<=^|\s)#[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|([\p{L}_$][\p{L}\p{N}_$]*(?:-[\p{L}\p{N}]+)*)/gu
const RE_IDENT_TOKEN = /()([\p{L}_$][\p{L}\p{N}_$]*(?:-[\p{L}\p{N}]+)*)/gu

const RENAMEABLE: IdentifierCaseId[] = ['camel', 'pascal', 'snake', 'screaming-snake', 'kebab', 'screaming-kebab', 'train']
const KEBAB_FAMILY = new Set<string>(['kebab', 'screaming-kebab', 'train', 'any'])

/**
 * Renames identifiers written in one convention to another, leaving everything else
 * (keywords, punctuation, single lowercase words) untouched. Optionally skips string
 * literals and comments (//, /* *\/, # and quoted strings).
 */
export function renameIdentifiers(text: string, opts: RenameOptions): { text: string; count: number } {
  const o: CaseOptions = { ...DEFAULT_CASE_OPTIONS, ...opts }
  const list = new Set(o.acronymList.map((a) => a.trim().toUpperCase()).filter(Boolean))
  let count = 0
  const re = opts.skipStringsAndComments ? RE_CODE_TOKEN : RE_IDENT_TOKEN
  const out = text.replace(re, (match, skip: string | undefined, ident: string | undefined) => {
    if (skip || !ident) return match
    // When the source style isn't hyphenated, "a-b" is two tokens separated by a minus.
    const parts = ident.includes('-') && !KEBAB_FAMILY.has(opts.from) ? ident.split(/(-)/) : [ident]
    return parts
      .map((part) => {
        if (part === '-') return part
        const lead = part.match(/^[_$]*/)![0]
        const trail = part.slice(lead.length).match(/[_$]*$/)![0]
        const core = part.slice(lead.length, part.length - trail.length)
        const style = detectLineStyle(core)
        if (!style || !RENAMEABLE.includes(style as IdentifierCaseId)) return part
        if (opts.from !== 'any' && style !== opts.from) return part
        const next = lead + joinIdentifier(splitWords(core, o.separateNumbers), opts.to, o, list) + trail
        if (next !== part) count++
        return next
      })
      .join('')
  })
  return { text: out, count }
}

// ── Transliteration (kept separate from casing) ──────────────────────────────────

const TRANSLIT: Record<string, string> = {
  ß: 'ss', ẞ: 'SS', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ø: 'o', Ø: 'O', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ð: 'd', Ð: 'D',
  þ: 'th', Þ: 'Th', ı: 'i', ħ: 'h', Ħ: 'H', ŋ: 'ng', Ŋ: 'NG', ſ: 's', ĸ: 'k', ŀ: 'l', Ŀ: 'L', ŉ: 'n', '€': 'EUR',
  // Cyrillic
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y',
  ь: '', э: 'e', ю: 'yu', я: 'ya', є: 'ye', і: 'i', ї: 'yi', ґ: 'g', ў: 'u',
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ё: 'Yo', Ж: 'Zh', З: 'Z', И: 'I', Й: 'Y', К: 'K', Л: 'L', М: 'M', Н: 'N',
  О: 'O', П: 'P', Р: 'R', С: 'S', Т: 'T', У: 'U', Ф: 'F', Х: 'Kh', Ц: 'Ts', Ч: 'Ch', Ш: 'Sh', Щ: 'Shch', Ъ: '', Ы: 'Y',
  Ь: '', Э: 'E', Ю: 'Yu', Я: 'Ya', Є: 'Ye', І: 'I', Ї: 'Yi', Ґ: 'G', Ў: 'U',
  // Greek
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o',
  π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
  Α: 'A', Β: 'V', Γ: 'G', Δ: 'D', Ε: 'E', Ζ: 'Z', Η: 'I', Θ: 'Th', Ι: 'I', Κ: 'K', Λ: 'L', Μ: 'M', Ν: 'N', Ξ: 'X', Ο: 'O',
  Π: 'P', Ρ: 'R', Σ: 'S', Τ: 'T', Υ: 'Y', Φ: 'F', Χ: 'Ch', Ψ: 'Ps', Ω: 'O',
}

const GERMAN: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue' }

/**
 * Best-effort transliteration to ASCII: language-specific letters via a table, then
 * Unicode decomposition with combining marks removed ("café" → "cafe").
 */
export function transliterate(text: string, opts: { german?: boolean } = {}): string {
  let s = text
  if (opts.german) s = s.replace(/[äöüÄÖÜ]/g, (c) => GERMAN[c])
  s = s.replace(/[^\u0000-\u007f]/g, (c) => TRANSLIT[c] ?? c)
  return s.normalize('NFKD').replace(/\p{M}/gu, '')
}
