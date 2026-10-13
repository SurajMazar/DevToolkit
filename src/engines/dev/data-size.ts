/**
 * Exact data-size arithmetic. Every quantity is a rational number of BITS backed by
 * BigInt, so conversions never drift (1 PiB is exactly 1125899906842624 bytes).
 * All unit sizes are of the form 2^a·5^b, so every conversion has a finite decimal.
 */

export interface Rational {
  num: bigint
  den: bigint
}

export type UnitGroup = 'byte-si' | 'byte-iec' | 'bit-si' | 'bit-iec'

export interface SizeUnit {
  id: string
  symbol: string
  name: string
  /** Size in bits. */
  bits: bigint
  group: UnitGroup
}

const K = 1000n
const KI = 1024n

const SI_NAMES = ['kilo', 'mega', 'giga', 'tera', 'peta', 'exa']
const IEC_NAMES = ['kibi', 'mebi', 'gibi', 'tebi', 'pebi', 'exbi']
const SI_PREFIX = ['k', 'M', 'G', 'T', 'P', 'E']
const IEC_PREFIX = ['Ki', 'Mi', 'Gi', 'Ti', 'Pi', 'Ei']

function build(): SizeUnit[] {
  const units: SizeUnit[] = [
    { id: 'B', symbol: 'B', name: 'byte', bits: 8n, group: 'byte-si' },
  ]
  for (let i = 0; i < 6; i++) units.push({ id: `${SI_PREFIX[i]}B`, symbol: `${SI_PREFIX[i]}B`, name: `${SI_NAMES[i]}byte`, bits: 8n * K ** BigInt(i + 1), group: 'byte-si' })
  for (let i = 0; i < 6; i++) units.push({ id: `${IEC_PREFIX[i]}B`, symbol: `${IEC_PREFIX[i]}B`, name: `${IEC_NAMES[i]}byte`, bits: 8n * KI ** BigInt(i + 1), group: 'byte-iec' })
  units.push({ id: 'bit', symbol: 'bit', name: 'bit', bits: 1n, group: 'bit-si' })
  for (let i = 0; i < 6; i++) units.push({ id: `${SI_PREFIX[i]}bit`, symbol: `${SI_PREFIX[i]}b`, name: `${SI_NAMES[i]}bit`, bits: K ** BigInt(i + 1), group: 'bit-si' })
  for (let i = 0; i < 6; i++) units.push({ id: `${IEC_PREFIX[i]}bit`, symbol: `${IEC_PREFIX[i]}b`, name: `${IEC_NAMES[i]}bit`, bits: KI ** BigInt(i + 1), group: 'bit-iec' })
  return units
}

export const SIZE_UNITS: SizeUnit[] = build()
export const unitById = new Map(SIZE_UNITS.map((u) => [u.id, u]))

export const UNIT_GROUPS: { id: UnitGroup; title: string; note: string }[] = [
  { id: 'byte-si', title: 'Bytes · decimal (SI)', note: '1 kB = 1000 B — used by drive makers, networking and macOS' },
  { id: 'byte-iec', title: 'Bytes · binary (IEC)', note: '1 KiB = 1024 B — used by RAM, Windows (labelled “KB”) and Linux tools' },
  { id: 'bit-si', title: 'Bits · decimal', note: '1 kb = 1000 bits — used for bandwidth (Mbps)' },
  { id: 'bit-iec', title: 'Bits · binary', note: '1 Kib = 1024 bits' },
]

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a
  b = b < 0n ? -b : b
  while (b) [a, b] = [b, a % b]
  return a
}

export function rational(num: bigint, den = 1n): Rational {
  if (den === 0n) throw new RangeError('Division by zero')
  if (den < 0n) [num, den] = [-num, -den]
  const g = gcd(num, den) || 1n
  return { num: num / g, den: den / g }
}

export const mul = (a: Rational, b: Rational) => rational(a.num * b.num, a.den * b.den)
export const div = (a: Rational, b: Rational) => rational(a.num * b.den, a.den * b.num)

export type ParseNumberResult = { ok: true; value: Rational } | { ok: false; error: string }

/** Parses "1.5", "1_000", "2,048", "1e9", "6.02E-3" exactly. Rejects negatives. */
export function parseDecimal(input: string, { allowNegative = false } = {}): ParseNumberResult {
  const s = input.trim().replace(/[_\s,']/g, '')
  if (!s) return { ok: false, error: 'Enter a number' }
  const m = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s)
  if (!m || (!m[2] && !m[3])) return { ok: false, error: `“${input.trim()}” is not a number` }
  const neg = m[1] === '-'
  if (neg && !allowNegative) return { ok: false, error: 'Sizes cannot be negative' }
  const int = m[2] || '0'
  const frac = m[3] ?? ''
  const exp = Number(m[4] ?? 0)
  if (Math.abs(exp) > 400) return { ok: false, error: 'Exponent is too large' }
  let num = BigInt(int + frac)
  let den = 10n ** BigInt(frac.length)
  if (exp > 0) num *= 10n ** BigInt(exp)
  else if (exp < 0) den *= 10n ** BigInt(-exp)
  if (neg) num = -num
  return { ok: true, value: rational(num, den) }
}

/** value (in `from` units) → value in `to` units, exactly. */
export function convert(value: Rational, from: SizeUnit, to: SizeUnit): Rational {
  return rational(value.num * from.bits, value.den * to.bits)
}

export function toBits(value: Rational, unit: SizeUnit): Rational {
  return rational(value.num * unit.bits, value.den)
}

export interface FormatOptions {
  /** Fraction digits, or 'exact' for the full (finite) expansion. */
  precision: number | 'exact'
  /** Insert thousands separators in the integer part. */
  group?: boolean
  /** Keep trailing zeros up to `precision`. */
  fixed?: boolean
}

export interface Formatted {
  text: string
  /** True when `text` represents the value exactly. */
  exact: boolean
}

function groupInt(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

const MAX_EXACT_DIGITS = 80

/** Decimal rendering with round-half-up; exact when the expansion terminates in time. */
export function formatRational(r: Rational, opts: FormatOptions): Formatted {
  const neg = r.num < 0n
  const n = neg ? -r.num : r.num
  const int = n / r.den
  let rem = n % r.den
  const limit = opts.precision === 'exact' ? MAX_EXACT_DIGITS : Math.max(0, Math.min(MAX_EXACT_DIGITS, opts.precision))
  let digits = ''
  while (rem !== 0n && digits.length < limit) {
    rem *= 10n
    digits += (rem / r.den).toString()
    rem %= r.den
  }
  const exact = rem === 0n
  let intPart = int
  if (!exact) {
    // Round half up on the next digit.
    const next = (rem * 10n) / r.den
    if (next >= 5n) {
      const len = digits.length
      const bumped = (BigInt(intPart.toString() + digits) + 1n).toString()
      const intLen = bumped.length - len
      intPart = BigInt(bumped.slice(0, intLen) || '0')
      digits = bumped.slice(intLen).padStart(len, '0')
    }
  }
  if (opts.fixed && typeof opts.precision === 'number') digits = digits.padEnd(opts.precision, '0')
  else digits = digits.replace(/0+$/, '')
  const intStr = opts.group ? groupInt(intPart.toString()) : intPart.toString()
  const body = digits ? `${intStr}.${digits}` : intStr
  return { text: (neg && body !== '0' ? '-' : '') + body, exact }
}

/** Float approximation of a rational (for durations and charts), safe for huge values. */
export function approxNumber(r: Rational): number {
  const shiftN = Math.max(0, r.num.toString().length - 17)
  const shiftD = Math.max(0, r.den.toString().length - 17)
  return (Number(r.num / 10n ** BigInt(shiftN)) / Number(r.den / 10n ** BigInt(shiftD))) * 10 ** (shiftN - shiftD)
}

export interface ConversionRow {
  unit: SizeUnit
  value: Rational
  formatted: Formatted
}

export function convertAll(value: Rational, from: SizeUnit, opts: FormatOptions): ConversionRow[] {
  return SIZE_UNITS.map((unit) => {
    const v = convert(value, from, unit)
    return { unit, value: v, formatted: formatRational(v, opts) }
  })
}

/** Picks the largest unit in a group where the value is ≥ 1 (for “best fit” display). */
export function bestUnit(bits: Rational, group: UnitGroup): SizeUnit {
  const list = SIZE_UNITS.filter((u) => u.group === group).sort((a, b) => (a.bits < b.bits ? -1 : 1))
  let best = list[0]
  for (const u of list) if (bits.num >= u.bits * bits.den) best = u
  return best
}

// ---------------------------------------------------------------------------
// Bandwidth / transfer time
// ---------------------------------------------------------------------------

export interface RateUnit {
  id: string
  label: string
  /** Bits per second. */
  bps: bigint
}

export const RATE_UNITS: RateUnit[] = [
  { id: 'bps', label: 'bit/s', bps: 1n },
  { id: 'kbps', label: 'kbit/s', bps: 1000n },
  { id: 'Mbps', label: 'Mbit/s', bps: 1000n ** 2n },
  { id: 'Gbps', label: 'Gbit/s', bps: 1000n ** 3n },
  { id: 'Tbps', label: 'Tbit/s', bps: 1000n ** 4n },
  { id: 'kBps', label: 'kB/s', bps: 8000n },
  { id: 'MBps', label: 'MB/s', bps: 8n * 1000n ** 2n },
  { id: 'GBps', label: 'GB/s', bps: 8n * 1000n ** 3n },
  { id: 'KiBps', label: 'KiB/s', bps: 8n * 1024n },
  { id: 'MiBps', label: 'MiB/s', bps: 8n * 1024n ** 2n },
  { id: 'GiBps', label: 'GiB/s', bps: 8n * 1024n ** 3n },
]
export const rateById = new Map(RATE_UNITS.map((r) => [r.id, r]))

/** Seconds to transfer `bits` at `rate` (in rateUnit) with `efficiency` (0–1]. */
export function transferSeconds(bits: Rational, rate: Rational, rateUnit: RateUnit, efficiency: Rational = rational(1n)): Rational | null {
  const bps = rational(rate.num * rateUnit.bps, rate.den)
  if (bps.num === 0n || efficiency.num === 0n) return null
  return div(bits, mul(bps, efficiency))
}

export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—'
  if (seconds < 1e-6) return `${+(seconds * 1e9).toPrecision(3)} ns`
  if (seconds < 1e-3) return `${+(seconds * 1e6).toPrecision(3)} µs`
  if (seconds < 1) return `${+(seconds * 1e3).toPrecision(3)} ms`
  if (seconds < 60) return `${+seconds.toFixed(seconds < 10 ? 2 : 1)} s`
  const parts: string[] = []
  let s = Math.round(seconds)
  const units: [number, string][] = [
    [365 * 86400, 'y'],
    [86400, 'd'],
    [3600, 'h'],
    [60, 'min'],
    [1, 's'],
  ]
  for (const [size, label] of units) {
    if (s >= size) {
      parts.push(`${Math.floor(s / size)} ${label}`)
      s %= size
    }
    if (parts.length === 3) break
  }
  return parts.join(' ')
}
