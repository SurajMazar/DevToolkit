/**
 * UTF-8 primitives shared by the encoding tools: a strict, position-aware decoder that
 * reports malformed sequences the way the Unicode standard recommends ("maximal subpart"
 * replacement, identical to TextDecoder), plus whole-buffer statistics for the inspector.
 */

export type Utf8Problem = 'unexpected-continuation' | 'invalid-byte' | 'truncated' | 'overlong' | 'surrogate' | 'too-large'

export interface Utf8Seq {
  /** Byte offset of the first byte of the sequence. */
  start: number
  /** Bytes consumed (for invalid input: the maximal ill-formed subpart, at least 1). */
  length: number
  /** Decoded code point, or -1 when the sequence is invalid. */
  cp: number
  problem?: Utf8Problem
  /** Bytes a well-formed sequence starting with this lead byte would have. */
  expected?: number
}

/** Number of bytes a lead byte announces (0 when it can't start a sequence). */
export function utf8SequenceLength(lead: number): number {
  if (lead < 0x80) return 1
  if (lead >= 0xc2 && lead <= 0xdf) return 2
  if (lead >= 0xe0 && lead <= 0xef) return 3
  if (lead >= 0xf0 && lead <= 0xf4) return 4
  return 0
}

const isCont = (b: number | undefined) => b !== undefined && (b & 0xc0) === 0x80

/**
 * Decodes the sequence starting at `i`. Never throws; invalid input yields `cp: -1` and the
 * number of bytes that form the ill-formed subpart (decoding should resume after them).
 */
export function decodeUtf8At(bytes: Uint8Array, i: number): Utf8Seq {
  const b0 = bytes[i]
  if (b0 < 0x80) return { start: i, length: 1, cp: b0 }
  if (b0 >= 0x80 && b0 <= 0xbf) return { start: i, length: 1, cp: -1, problem: 'unexpected-continuation' }
  if (b0 === 0xc0 || b0 === 0xc1) return { start: i, length: 1, cp: -1, problem: 'overlong', expected: 2 }
  if (b0 >= 0xf5) return { start: i, length: 1, cp: -1, problem: b0 <= 0xf7 ? 'too-large' : 'invalid-byte', expected: b0 <= 0xf7 ? 4 : undefined }

  const need = utf8SequenceLength(b0)
  // Allowed range of the second byte depends on the lead byte (excludes overlongs, surrogates, > U+10FFFF).
  let lo = 0x80
  let hi = 0xbf
  let rangeProblem: Utf8Problem = 'truncated'
  if (b0 === 0xe0) { lo = 0xa0; rangeProblem = 'overlong' }
  else if (b0 === 0xed) { hi = 0x9f; rangeProblem = 'surrogate' }
  else if (b0 === 0xf0) { lo = 0x90; rangeProblem = 'overlong' }
  else if (b0 === 0xf4) { hi = 0x8f; rangeProblem = 'too-large' }

  const b1 = bytes[i + 1]
  if (b1 === undefined) return { start: i, length: 1, cp: -1, problem: 'truncated', expected: need }
  if (b1 < lo || b1 > hi) {
    const problem = isCont(b1) ? rangeProblem : 'truncated'
    return { start: i, length: 1, cp: -1, problem, expected: need }
  }
  if (need === 2) return { start: i, length: 2, cp: ((b0 & 0x1f) << 6) | (b1 & 0x3f) }

  const b2 = bytes[i + 2]
  if (!isCont(b2)) return { start: i, length: 2, cp: -1, problem: 'truncated', expected: need }
  if (need === 3) return { start: i, length: 3, cp: ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2! & 0x3f) }

  const b3 = bytes[i + 3]
  if (!isCont(b3)) return { start: i, length: 3, cp: -1, problem: 'truncated', expected: need }
  return { start: i, length: 4, cp: ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2! & 0x3f) << 6) | (b3! & 0x3f) }
}

/** Human explanation of an invalid sequence. `fmt` renders bytes (default "E0 A4"; URLs use "%E0%A4"). */
export function describeUtf8Problem(seq: Utf8Seq, bytes: Uint8Array, fmt: (b: ArrayLike<number>) => string = (b) => hexOf(b)): string {
  const hex = fmt(bytes.subarray(seq.start, seq.start + seq.length))
  const nextHex = (bytes: Uint8Array, seq: Utf8Seq) => {
    const n = bytes[seq.start + seq.length]
    return n === undefined ? '' : ` ${fmt([n])}`
  }
  switch (seq.problem) {
    case 'unexpected-continuation':
      return `${hex} is a continuation byte with no lead byte before it`
    case 'invalid-byte':
      return `${hex} never appears in UTF-8`
    case 'overlong':
      return seq.length === 1 && (bytes[seq.start] === 0xc0 || bytes[seq.start] === 0xc1)
        ? `${hex} can only start an overlong (non-shortest) encoding`
        : `${hex}${nextHex(bytes, seq)} is an overlong (non-shortest) encoding`
    case 'surrogate':
      return `${hex}${nextHex(bytes, seq)} encodes a UTF-16 surrogate (U+D800–U+DFFF), which is not allowed in UTF-8`
    case 'too-large':
      return `${hex}${nextHex(bytes, seq)} would encode a code point above U+10FFFF`
    case 'truncated': {
      const got = seq.length
      const next = bytes[seq.start + got]
      return `${hex} starts a ${seq.expected}-byte sequence but ${next === undefined ? 'the data ends' : `${fmt([next])} is not a continuation byte`} after ${got} byte${got === 1 ? '' : 's'}`
    }
    default:
      return `${hex} is not valid UTF-8`
  }
}

export function hexOf(bytes: ArrayLike<number>, sep = ' '): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += (i ? sep : '') + bytes[i].toString(16).toUpperCase().padStart(2, '0')
  return s
}

export interface Utf8Issue {
  /** Byte offset. */
  offset: number
  length: number
  problem: Utf8Problem
  message: string
}

export interface LenientDecode {
  text: string
  issues: Utf8Issue[]
  /** Total issues (may exceed `issues.length` when capped). */
  issueCount: number
}

/** Decodes bytes, replacing malformed sequences with U+FFFD and reporting each one. */
export function decodeUtf8Lenient(bytes: Uint8Array, maxIssues = 1000): LenientDecode {
  // Fast path: TextDecoder in fatal mode.
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), issues: [], issueCount: 0 }
  } catch {
    /* fall through to the detailed scan */
  }
  const issues: Utf8Issue[] = []
  let issueCount = 0
  const parts: string[] = []
  let runStart = 0
  let i = 0
  const td = new TextDecoder('utf-8', { ignoreBOM: true })
  while (i < bytes.length) {
    if (bytes[i] < 0x80) {
      i++
      continue
    }
    const seq = decodeUtf8At(bytes, i)
    if (seq.cp === -1) {
      if (runStart < i) parts.push(td.decode(bytes.subarray(runStart, i)))
      parts.push('�')
      issueCount++
      if (issues.length < maxIssues) issues.push({ offset: i, length: seq.length, problem: seq.problem!, message: describeUtf8Problem(seq, bytes) })
      runStart = i + seq.length
    }
    i += seq.length
  }
  if (runStart < bytes.length) parts.push(td.decode(bytes.subarray(runStart)))
  return { text: parts.join(''), issues, issueCount }
}

export function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** Bytes of one code point (lone surrogates encode as U+FFFD, like TextEncoder). */
export function codePointToUtf8(cp: number): number[] {
  if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd
  if (cp < 0x80) return [cp]
  if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)]
  if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)]
  return [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)]
}

export type BomKind = 'utf-8' | 'utf-16le' | 'utf-16be' | 'utf-32le' | 'utf-32be'

export function detectBom(bytes: Uint8Array): { kind: BomKind; length: number } | null {
  const [a, b, c, d] = bytes
  if (a === 0xef && b === 0xbb && c === 0xbf) return { kind: 'utf-8', length: 3 }
  if (a === 0xff && b === 0xfe && c === 0 && d === 0) return { kind: 'utf-32le', length: 4 }
  if (a === 0 && b === 0 && c === 0xfe && d === 0xff) return { kind: 'utf-32be', length: 4 }
  if (a === 0xff && b === 0xfe) return { kind: 'utf-16le', length: 2 }
  if (a === 0xfe && b === 0xff) return { kind: 'utf-16be', length: 2 }
  return null
}

export interface Utf8Stats {
  byteLength: number
  bom: { kind: BomKind; length: number } | null
  /** Number of well-formed sequences by length: index 1..4. */
  counts: [number, number, number, number, number]
  /** Code points decoded (well-formed sequences). */
  chars: number
  invalidSequences: number
  invalidBytes: number
  /** First issues (capped). */
  issues: Utf8Issue[]
  asciiOnly: boolean
  /** Control characters other than tab / LF / CR (likely binary). */
  controlChars: number
  nulBytes: number
  lines: number
}

/** One pass over the buffer. ~100 MB/s in V8; run in a worker for multi-MB inputs. */
export function analyzeUtf8(bytes: Uint8Array, maxIssues = 2000): Utf8Stats {
  const counts: Utf8Stats['counts'] = [0, 0, 0, 0, 0]
  const issues: Utf8Issue[] = []
  let invalidSequences = 0
  let invalidBytes = 0
  let controlChars = 0
  let nulBytes = 0
  let lines = bytes.length ? 1 : 0
  const n = bytes.length
  let i = 0
  while (i < n) {
    const b = bytes[i]
    if (b < 0x80) {
      counts[1]++
      if (b === 0x0a) lines++
      else if (b === 0) nulBytes++
      else if ((b < 0x20 && b !== 0x09 && b !== 0x0d) || b === 0x7f) controlChars++
      i++
      continue
    }
    const seq = decodeUtf8At(bytes, i)
    if (seq.cp === -1) {
      invalidSequences++
      invalidBytes += seq.length
      if (issues.length < maxIssues) issues.push({ offset: i, length: seq.length, problem: seq.problem!, message: describeUtf8Problem(seq, bytes) })
    } else counts[seq.length]++
    i += seq.length
  }
  const chars = counts[1] + counts[2] + counts[3] + counts[4]
  return {
    byteLength: n,
    bom: detectBom(bytes),
    counts,
    chars,
    invalidSequences,
    invalidBytes,
    issues,
    asciiOnly: invalidSequences === 0 && chars === counts[1],
    controlChars,
    nulBytes,
    lines,
  }
}

/** Finds the sequence that contains byte `i` (looks back over up to 3 continuation bytes). */
export function sequenceContaining(bytes: Uint8Array, i: number): Utf8Seq {
  // Sequence starts in a forward scan are always non-continuation bytes, or continuation
  // bytes that follow an ill-formed subpart (those stand alone). So the nearest
  // non-continuation byte within 3 positions is the only candidate lead.
  for (let start = i; start >= 0 && start >= i - 3; start--) {
    if (!isCont(bytes[start])) {
      const seq = decodeUtf8At(bytes, start)
      if (start + seq.length > i) return seq
      break
    }
  }
  return decodeUtf8At(bytes, i)
}

/** Splits a JS string offset → line/column (1-based). */
export function lineColumnAt(text: string, offset: number): { line: number; column: number } {
  let line = 1
  let last = -1
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++
    last = i
  }
  return { line, column: offset - last }
}
