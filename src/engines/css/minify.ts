import { minify as cssoMinify, minifyBlock as cssoMinifyBlock, syntax } from 'csso'

export interface CssIssue {
  message: string
  line: number
  column: number
}

export type LicenseComments = 'none' | 'all' | 'first'

export interface CssMinifyOptions {
  /** csso structural optimizations (merging rules, moving declarations). */
  restructure: boolean
  /** Keep `/*! … *\/` license comments. */
  comments: LicenseComments
}

export interface CssMinifyResult {
  output: string
  /** Hard error: the CSS is structurally broken (unbalanced braces, unterminated string/comment). */
  error?: CssIssue
  /** csso could not parse the input; a conservative minifier was used instead. */
  fallback?: CssIssue
  engine: 'csso' | 'safe'
}

export const DEFAULT_MINIFY: CssMinifyOptions = { restructure: true, comments: 'all' }

function lineCol(src: string, offset: number) {
  let line = 1
  let last = 0
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) {
      line++
      last = i + 1
    }
  }
  return { line, column: offset - last + 1 }
}

/**
 * Lexical structure check: unterminated comments and strings, unmatched `}` and unclosed
 * `{` / `(` / `[`. These are the errors that make any minifier drop or mangle content.
 */
export function checkCssStructure(css: string): CssIssue | null {
  const stack: { ch: string; at: number }[] = []
  const pairs: Record<string, string> = { '}': '{', ')': '(', ']': '[' }
  const n = css.length
  for (let i = 0; i < n; i++) {
    const c = css[i]
    if (c === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2)
      if (e === -1) return { message: 'Unterminated comment: “/*” has no closing “*/”', ...lineCol(css, i) }
      i = e + 1
      continue
    }
    if (c === '\\') {
      i++
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      for (; j < n; j++) {
        const d = css[j]
        if (d === '\\') {
          j++
          continue
        }
        if (d === c) break
        if (d === '\n') return { message: `Unterminated string: newline inside a ${c === '"' ? 'double' : 'single'}-quoted string`, ...lineCol(css, i) }
      }
      if (j >= n) return { message: 'Unterminated string', ...lineCol(css, i) }
      i = j
      continue
    }
    if (c === '{' || c === '(' || c === '[') stack.push({ ch: c, at: i })
    else if (c === '}' || c === ')' || c === ']') {
      const top = stack.pop()
      if (!top) return { message: `Unexpected “${c}” with no matching “${pairs[c]}”`, ...lineCol(css, i) }
      if (top.ch !== pairs[c]) return { message: `Unexpected “${c}”: “${top.ch}” opened at line ${lineCol(css, top.at).line} is still open`, ...lineCol(css, i) }
    }
  }
  const open = stack.pop()
  if (open) return { message: open.ch === '{' ? 'Unclosed block: “{” is never closed' : `Unclosed “${open.ch}”`, ...lineCol(css, open.at) }
  return null
}

/** Errors css-tree (csso's parser) reports — where csso would silently drop content. */
export function cssoParseIssues(css: string): CssIssue[] {
  const issues: CssIssue[] = []
  try {
    syntax.parse(css, {
      positions: true,
      onParseError(e: { message: string; line?: number; column?: number }) {
        issues.push({ message: e.message, line: e.line ?? 1, column: e.column ?? 1 })
      },
    } as Parameters<typeof syntax.parse>[1])
  } catch (e) {
    issues.push({ message: (e as Error).message, line: 1, column: 1 })
  }
  return issues
}

const NO_SPACE_AFTER = new Set(['{', '}', ';', ',', '>', '<', '=', '~', '(', ':', '!'])
const NO_SPACE_BEFORE = new Set(['{', '}', ';', ',', '>', '<', '=', '~', ')', '!'])
const isWs = (c: string) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f'
const isHex = (c: string) => /[0-9a-fA-F]/.test(c)

/**
 * Conservative minifier that only removes comments and insignificant whitespace and
 * never reorders or rewrites anything. Works on any CSS syntax (nesting, range media
 * queries, new at-rules) because it does not need to understand it.
 */
export function safeMinifyCss(css: string, comments: LicenseComments = 'all'): string {
  const out: string[] = []
  let last = '' // last emitted char
  let pendingSpace = false
  let keptLicense = 0
  const n = css.length
  let i = css.charCodeAt(0) === 0xfeff ? 1 : 0

  const emit = (s: string) => {
    if (!s) return
    if (pendingSpace) {
      const first = s[0]
      const emptyCustomValue = last === ':' && (first === ';' || first === '}')
      if (last && (emptyCustomValue || (!NO_SPACE_AFTER.has(last) && !NO_SPACE_BEFORE.has(first)))) out.push(' ')
      pendingSpace = false
    }
    out.push(s)
    last = s[s.length - 1]
  }

  while (i < n) {
    const c = css[i]
    if (c === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2)
      const end = e === -1 ? n : e + 2
      const isLicense = css[i + 2] === '!'
      if (isLicense && (comments === 'all' || (comments === 'first' && keptLicense === 0))) {
        keptLicense++
        // The comment is transparent for spacing decisions around it.
        const before = last
        emit(css.slice(i, end))
        last = before
      } else {
        // Removing a comment must not glue two tokens together.
        const prevWord = last !== '' && !NO_SPACE_AFTER.has(last)
        if (prevWord) pendingSpace = true
      }
      i = end
      continue
    }
    if (isWs(c)) {
      pendingSpace = true
      i++
      while (i < n && isWs(css[i])) i++
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      for (; j < n; j++) {
        if (css[j] === '\\') {
          j++
          continue
        }
        if (css[j] === c || css[j] === '\n') break
      }
      emit(css.slice(i, Math.min(n, j + 1)))
      i = j + 1
      continue
    }
    if (c === '\\') {
      // Escapes: `\` + up to 6 hex digits + one optional whitespace terminator, or `\` + any char.
      let j = i + 1
      if (j < n && isHex(css[j])) {
        let k = 0
        while (j < n && k < 6 && isHex(css[j])) {
          j++
          k++
        }
        if (j < n && isWs(css[j])) j += css[j] === '\r' && css[j + 1] === '\n' ? 2 : 1
      } else j = Math.min(n, j + 1)
      emit(css.slice(i, j))
      i = j
      continue
    }
    // Unquoted url(…) is a single token — copy it verbatim (minus surrounding whitespace).
    if ((c === 'u' || c === 'U') && /^url\(/i.test(css.slice(i, i + 4)) && !/[\w-]/.test(last)) {
      let j = i + 4
      while (j < n && isWs(css[j])) j++
      if (css[j] !== '"' && css[j] !== "'") {
        const close = css.indexOf(')', j)
        const end = close === -1 ? n : close
        emit('url(' + css.slice(j, end).trim() + ')')
        i = end + 1
        continue
      }
    }
    if (c === '}' && out[out.length - 1] === ';') {
      // A trailing semicolon before `}` is optional.
      out.pop()
      const prev = out[out.length - 1] ?? ''
      last = prev ? prev[prev.length - 1] : ''
      pendingSpace = false
    }
    emit(c)
    i++
  }
  return out.join('')
}

/** Minify a stylesheet with csso; falls back to the conservative minifier when csso cannot parse it. */
export function minifyCss(css: string, options: CssMinifyOptions = DEFAULT_MINIFY): CssMinifyResult {
  const structural = checkCssStructure(css)
  if (structural) return { output: '', error: structural, engine: 'safe' }
  const issues = cssoParseIssues(css)
  if (issues.length) {
    return { output: safeMinifyCss(css, options.comments), fallback: issues[0], engine: 'safe' }
  }
  try {
    const comments = options.comments === 'all' ? 'exclamation' : options.comments === 'first' ? 'first-exclamation' : false
    const out = cssoMinify(css, { restructure: options.restructure, comments }).css
    return { output: out, engine: 'csso' }
  } catch (e) {
    return { output: safeMinifyCss(css, options.comments), fallback: { message: (e as Error).message, line: 1, column: 1 }, engine: 'safe' }
  }
}

/** Minify the contents of a `style="…"` attribute. Returns the input unchanged if it cannot be parsed. */
export function minifyDeclarations(block: string): string {
  if (!block.trim()) return block
  if (checkCssStructure(block)) return block
  const issues: CssIssue[] = []
  try {
    syntax.parse(block, {
      context: 'declarationList',
      onParseError(e: { message: string }) {
        issues.push({ message: e.message, line: 1, column: 1 })
      },
    } as Parameters<typeof syntax.parse>[1])
    if (issues.length) return block
    return cssoMinifyBlock(block, { restructure: false }).css
  } catch {
    return block
  }
}

export interface SizeStats {
  before: number
  after: number
  saved: number
  /** 0–100 */
  percent: number
}

export function sizeStats(before: string, after: string): SizeStats {
  const b = new TextEncoder().encode(before).length
  const a = new TextEncoder().encode(after).length
  return { before: b, after: a, saved: b - a, percent: b === 0 ? 0 : ((b - a) / b) * 100 }
}
