/**
 * Arbitrary-precision integer base conversion (BigInt) with validation, digit grouping
 * and two's-complement helpers.
 */

export const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'

export const BASE_NAMES: Record<number, string> = { 2: 'binary', 8: 'octal', 10: 'decimal', 16: 'hexadecimal' }

const PREFIX_BASE: Record<string, number> = { b: 2, o: 8, x: 16 }

export interface IntParseError {
  message: string
  /** 1-based position of the offending character in the original input. */
  position?: number
}

export type IntParseResult = { ok: true; value: bigint } | { ok: false; error: IntParseError }

/**
 * Parses an integer in `base` (2–36). Accepts a leading sign, a 0b/0o/0x prefix that matches
 * the base, and `_`, spaces, `'` and `,` as digit separators.
 */
export function parseInteger(input: string, base: number): IntParseResult {
  if (!Number.isInteger(base) || base < 2 || base > 36) return { ok: false, error: { message: `Base must be between 2 and 36 (got ${base})` } }
  let i = 0
  const n = input.length
  while (i < n && /\s/.test(input[i])) i++
  if (i === n) return { ok: false, error: { message: 'Enter a number' } }
  let neg = false
  if (input[i] === '-' || input[i] === '+' || input[i] === '−') {
    neg = input[i] !== '+'
    i++
    while (i < n && /\s/.test(input[i])) i++
  }
  if (input[i] === '0' && i + 1 < n && /[box]/i.test(input[i + 1])) {
    const letter = input[i + 1].toLowerCase()
    const pb = PREFIX_BASE[letter]
    if (pb === base) i += 2
    // Otherwise the letter may simply be a digit of this base (e.g. "0b1" in hex is 0xB1).
    else if (DIGITS.indexOf(letter) >= base) {
      return { ok: false, error: { message: `Prefix “0${input[i + 1]}” means ${BASE_NAMES[pb]}, but this field is base ${base}`, position: i + 2 } }
    }
  }
  let digits = ''
  for (; i < n; i++) {
    const c = input[i]
    if (c === '_' || c === ' ' || c === "'" || c === ',' || c === ' ' || c === '\t') {
      continue
    }
    const d = DIGITS.indexOf(c.toLowerCase())
    if (d === -1 || d >= base) {
      const what = d === -1 ? `“${c}” is not a digit` : `“${c}” is not a valid digit in base ${base}${BASE_NAMES[base] ? ` (${BASE_NAMES[base]})` : ''}`
      const allowed = base <= 10 ? `0–${base - 1}` : `0–9, a–${DIGITS[base - 1]}`
      return { ok: false, error: { message: `${what} — allowed: ${allowed}`, position: i + 1 } }
    }
    digits += c.toLowerCase()
  }
  if (!digits) return { ok: false, error: { message: 'No digits found', position: Math.min(n, i) || 1 } }
  const value = digitsToBigInt(digits, base)
  return { ok: true, value: neg ? -value : value }
}

function digitsToBigInt(digits: string, base: number): bigint {
  if (base === 10) return BigInt(digits)
  if (base === 16) return BigInt('0x' + digits)
  if (base === 8) return BigInt('0o' + digits)
  if (base === 2) return BigInt('0b' + digits)
  // Chunked accumulation: up to 10 digits at a time stay within 2^53 for base ≤ 36.
  const b = BigInt(base)
  let v = 0n
  for (let i = 0; i < digits.length; i += 10) {
    const chunk = digits.slice(i, i + 10)
    v = v * b ** BigInt(chunk.length) + BigInt(parseInt(chunk, base))
  }
  return v
}

export interface IntFormatOptions {
  uppercase?: boolean
  /** Group size (0 = no grouping). */
  group?: number
  separator?: string
  /** Add 0b / 0o / 0x for bases 2 / 8 / 16. */
  prefix?: boolean
  /** Left-pad digits with zeros to this length. */
  minDigits?: number
}

export function formatInteger(value: bigint, base: number, opts: IntFormatOptions = {}): string {
  const neg = value < 0n
  let s = (neg ? -value : value).toString(base)
  if (opts.minDigits && s.length < opts.minDigits) s = s.padStart(opts.minDigits, '0')
  if (opts.uppercase) s = s.toUpperCase()
  if (opts.group && opts.group > 0 && s.length > opts.group) s = groupDigits(s, opts.group, opts.separator ?? ' ')
  const prefix = opts.prefix ? ({ 2: '0b', 8: '0o', 16: '0x' } as Record<number, string>)[base] ?? '' : ''
  return (neg ? '-' : '') + prefix + s
}

export function groupDigits(s: string, size: number, sep: string): string {
  const out: string[] = []
  for (let end = s.length; end > 0; end -= size) out.unshift(s.slice(Math.max(0, end - size), end))
  return out.join(sep)
}

export const defaultGroup = (base: number) => (base === 2 || base === 16 ? 4 : 3)

/** Bits needed for the magnitude (0 → 0). */
export function bitLength(v: bigint): number {
  const a = v < 0n ? -v : v
  return a === 0n ? 0 : a.toString(2).length
}

export function byteLength(v: bigint): number {
  return Math.ceil(bitLength(v) / 8)
}

/** Smallest width that holds `v` as a signed two's-complement integer. */
export function signedBitLength(v: bigint): number {
  if (v >= 0n) return bitLength(v) + 1
  return bitLength(-v - 1n) + 1
}

export const WIDTHS = [8, 16, 32, 64, 128] as const

export interface TwosComplement {
  bits: number
  /** Raw bit pattern (unsigned). */
  pattern: bigint
  fitsSigned: boolean
  fitsUnsigned: boolean
  /** The value does not fit either interpretation — the pattern is truncated. */
  overflow: boolean
  binary: string
  hex: string
}

export function twosComplement(v: bigint, bits: number): TwosComplement {
  const n = BigInt(bits)
  const minS = -(1n << (n - 1n))
  const maxS = (1n << (n - 1n)) - 1n
  const maxU = (1n << n) - 1n
  const fitsSigned = v >= minS && v <= maxS
  const fitsUnsigned = v >= 0n && v <= maxU
  const pattern = BigInt.asUintN(bits, v)
  return {
    bits,
    pattern,
    fitsSigned,
    fitsUnsigned,
    overflow: !fitsSigned && !fitsUnsigned,
    binary: groupDigits(pattern.toString(2).padStart(bits, '0'), 4, ' '),
    hex: groupDigits(pattern.toString(16).toUpperCase().padStart(bits / 4, '0'), 4, ' '),
  }
}

export interface Interpretation {
  bits: number
  signed: bigint
  unsigned: bigint
}

/** Reads a non-negative bit pattern as an N-bit signed and unsigned integer. */
export function interpretPattern(pattern: bigint, bits: number): { ok: true; value: Interpretation } | { ok: false; error: string } {
  if (pattern < 0n) return { ok: false, error: 'Enter a bit pattern (non-negative binary or hex) to interpret it.' }
  if (bitLength(pattern) > bits) return { ok: false, error: `The pattern needs ${bitLength(pattern)} bits — wider than ${bits}.` }
  return { ok: true, value: { bits, signed: BigInt.asIntN(bits, pattern), unsigned: BigInt.asUintN(bits, pattern) } }
}

export const BASE_SAMPLE = '0xDEAD_BEEF'
