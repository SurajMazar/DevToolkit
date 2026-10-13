/**
 * Line utilities shared by the text tools. Lines are split on LF, CRLF and lone CR;
 * each line remembers its own terminator so that line-wise edits never silently
 * rewrite the line endings of the untouched parts of a document.
 */

export interface SplitLines {
  /** Line contents without terminators. A trailing terminator does not create an extra empty line. */
  lines: string[]
  /** eols[i] is the terminator that followed lines[i] in the source ('' for the last line when the text has no trailing newline). */
  eols: string[]
  /** The terminator at the very end of the text ('' when the text does not end with a newline). */
  trailing: string
}

const RE_EOL = /\r\n|\r|\n/g

export function splitLines(text: string): SplitLines {
  const lines: string[] = []
  const eols: string[] = []
  if (text === '') return { lines, eols, trailing: '' }
  let last = 0
  RE_EOL.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RE_EOL.exec(text))) {
    lines.push(text.slice(last, m.index))
    eols.push(m[0])
    last = m.index + m[0].length
  }
  if (last < text.length) {
    lines.push(text.slice(last))
    eols.push('')
    return { lines, eols, trailing: '' }
  }
  // Text ends with a terminator: it belongs to the last real line.
  return { lines, eols, trailing: eols[eols.length - 1] ?? '' }
}

/** The most common line terminator in the text (LF when there are none). */
export function dominantEol(text: string): '\n' | '\r\n' | '\r' {
  let lf = 0
  let crlf = 0
  let cr = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++
        i++
      } else cr++
    } else if (c === 10) lf++
  }
  if (crlf >= lf && crlf >= cr && crlf > 0) return '\r\n'
  if (cr > lf) return '\r'
  return '\n'
}

export interface EolCounts {
  lf: number
  crlf: number
  cr: number
}

export function countEols(text: string): EolCounts {
  const r = { lf: 0, crlf: 0, cr: 0 }
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        r.crlf++
        i++
      } else r.cr++
    } else if (c === 10) r.lf++
  }
  return r
}

/**
 * Maps each line, keeping every line's own terminator. Returning null drops the line.
 * The text's trailing newline (if any) is preserved on whatever line ends up last.
 */
export function mapLines(text: string, fn: (line: string, index: number) => string | null): string {
  const { lines, eols, trailing } = splitLines(text)
  const keptLines: string[] = []
  const keptEols: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const r = fn(lines[i], i)
    if (r === null) continue
    keptLines.push(r)
    keptEols.push(eols[i])
  }
  if (keptLines.length === 0) return ''
  keptEols[keptEols.length - 1] = trailing
  let out = ''
  for (let i = 0; i < keptLines.length; i++) out += keptLines[i] + keptEols[i]
  return out
}

/**
 * Rebuilds the text from a reordered/filtered list of lines, joined with the text's
 * dominant terminator. A trailing newline is preserved.
 */
export function reorderLines(text: string, fn: (lines: string[]) => string[]): string {
  const { lines, trailing } = splitLines(text)
  if (lines.length === 0) return text
  const eol = dominantEol(text)
  const next = fn(lines)
  if (next.length === 0) return ''
  return next.join(eol) + trailing
}

/** 1-based line number containing the given UTF-16 offset. */
export function lineAtOffset(text: string, offset: number): number {
  let n = 1
  for (let i = 0; i < offset && i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 10) n++
    else if (c === 13 && text.charCodeAt(i + 1) !== 10) n++
  }
  return n
}
