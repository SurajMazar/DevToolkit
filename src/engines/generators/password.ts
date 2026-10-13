import { cryptoRng, type Rng } from './random'
import { WORDLIST } from './wordlist'

// ── Character-set passwords ─────────────────────────────────────────────────────────

export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const LOWER = 'abcdefghijklmnopqrstuvwxyz'
export const DIGITS = '0123456789'
export const DEFAULT_SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>/?~'
/** Characters commonly confused with each other in many fonts. */
export const AMBIGUOUS = 'Il1|O0o'

export const MIN_LENGTH = 4
export const MAX_LENGTH = 128
export const MAX_COUNT = 100

export interface PasswordPolicy {
  length: number
  upper: boolean
  lower: boolean
  digits: boolean
  symbols: boolean
  symbolSet: string
  excludeAmbiguous: boolean
  /** Extra characters never to use. */
  exclude: string
  /** Every enabled set must appear at least once. */
  requireEach: boolean
}

export const DEFAULT_POLICY: PasswordPolicy = {
  length: 20,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  symbolSet: DEFAULT_SYMBOLS,
  excludeAmbiguous: false,
  exclude: '',
  requireEach: true,
}

export interface CharGroup {
  id: 'upper' | 'lower' | 'digits' | 'symbols'
  label: string
  chars: string
}

export interface ResolvedPolicy {
  groups: CharGroup[]
  /** Union of all group characters (disjoint groups, so no duplicates). */
  pool: string
  /** Number of distinct characters (code points) in the pool. */
  poolSize: number
  length: number
  requireEach: boolean
}

export type PolicyResult = { ok: true; value: ResolvedPolicy } | { ok: false; error: string }

/** Unique code points of `s`, in order. */
function uniqueChars(s: string): string[] {
  return [...new Set(Array.from(s))]
}

/**
 * Turn UI settings into disjoint character groups. Characters are de-duplicated, and a
 * character appearing in several groups (e.g. a letter typed into the symbol set) is
 * kept only in the first group, so the pool has no repeated characters and the entropy
 * maths stays exact.
 */
export function resolvePolicy(p: PasswordPolicy): PolicyResult {
  if (!Number.isInteger(p.length) || p.length < MIN_LENGTH || p.length > MAX_LENGTH) return { ok: false, error: `Length must be a whole number from ${MIN_LENGTH} to ${MAX_LENGTH}.` }
  const banned = new Set(Array.from(p.exclude))
  if (p.excludeAmbiguous) for (const c of AMBIGUOUS) banned.add(c)
  const seen = new Set<string>()
  const groups: CharGroup[] = []
  const add = (id: CharGroup['id'], label: string, enabled: boolean, src: string) => {
    if (!enabled) return
    const chars = uniqueChars(src).filter((c) => !banned.has(c) && !seen.has(c) && !/\s/.test(c))
    chars.forEach((c) => seen.add(c))
    groups.push({ id, label, chars: chars.join('') })
  }
  add('upper', 'Uppercase', p.upper, UPPER)
  add('lower', 'Lowercase', p.lower, LOWER)
  add('digits', 'Digits', p.digits, DIGITS)
  add('symbols', 'Symbols', p.symbols, p.symbolSet)
  if (groups.length === 0) return { ok: false, error: 'Select at least one character set.' }
  const empty = groups.find((g) => g.chars.length === 0)
  if (empty) return { ok: false, error: `${empty.label}: every character is excluded. Remove some exclusions or turn this set off.` }
  const pool = groups.map((g) => g.chars).join('')
  const poolSize = Array.from(pool).length
  if (poolSize < 2) return { ok: false, error: 'Only one usable character remains — a password needs at least two possible characters.' }
  if (p.requireEach && groups.length > p.length) return { ok: false, error: `Length ${p.length} is too short to include all ${groups.length} required character sets.` }
  return { ok: true, value: { groups, pool, poolSize, length: p.length, requireEach: p.requireEach } }
}

/**
 * Generate one password uniformly at random from the set of strings the policy allows.
 *
 * Each character is drawn with `rng.int(pool.length)` (rejection sampling — no modulo bias).
 * When every set is required, whole candidates that miss a set are rejected and redrawn.
 * Unlike "insert one of each then shuffle", this keeps the output uniform over all valid
 * passwords, so the entropy reported by `passwordEntropy` is exact.
 */
export function generatePassword(policy: ResolvedPolicy, rng: Rng = cryptoRng): string {
  const pool = Array.from(policy.pool)
  const groupOf = new Map<string, number>()
  policy.groups.forEach((g, gi) => Array.from(g.chars).forEach((c) => groupOf.set(c, gi)))
  const need = policy.requireEach ? policy.groups.length : 0
  const out = new Array<string>(policy.length)
  for (let attempt = 0; attempt < 10_000_000; attempt++) {
    let seenMask = 0
    for (let i = 0; i < policy.length; i++) {
      const c = pool[rng.int(pool.length)]
      out[i] = c
      seenMask |= 1 << groupOf.get(c)!
    }
    if (!need || seenMask === (1 << need) - 1) return out.join('')
  }
  throw new Error('Could not satisfy the character-set requirements — try a longer length.')
}

export function generatePasswords(policy: ResolvedPolicy, count: number, rng: Rng = cryptoRng): string[] {
  return Array.from({ length: count }, () => generatePassword(policy, rng))
}

/** log2 of a positive BigInt, accurate to ~1e-12 relative. */
export function log2Big(n: bigint): number {
  if (n <= 0n) return -Infinity
  const bits = n.toString(2).length
  if (bits <= 52) return Math.log2(Number(n))
  const shift = BigInt(bits - 52)
  return Math.log2(Number(n >> shift)) + Number(shift)
}

/**
 * Number of distinct passwords the policy can produce. With `requireEach`, counts strings
 * containing at least one character from every group (inclusion–exclusion over the groups).
 */
export function countPasswords(policy: ResolvedPolicy): bigint {
  const N = BigInt(policy.poolSize)
  const L = BigInt(policy.length)
  if (!policy.requireEach) return N ** L
  const sizes = policy.groups.map((g) => BigInt(Array.from(g.chars).length))
  const k = sizes.length
  let total = 0n
  for (let mask = 0; mask < 1 << k; mask++) {
    let missing = 0n
    let bits = 0
    for (let i = 0; i < k; i++)
      if (mask & (1 << i)) {
        missing += sizes[i]
        bits++
      }
    const term = (N - missing) ** L
    total += bits % 2 ? -term : term
  }
  return total
}

/** Exact entropy in bits of a password drawn uniformly by `generatePassword`. */
export function passwordEntropy(policy: ResolvedPolicy): number {
  return log2Big(countPasswords(policy))
}

// ── Passphrases ─────────────────────────────────────────────────────────────────

export const PASSPHRASE_SYMBOLS = '!@#$%&*?-+='

export interface PassphrasePolicy {
  words: number
  separator: string
  capitalize: boolean
  /** Append one random digit to one random word. */
  addNumber: boolean
  /** Append one random symbol to one random word. */
  addSymbol: boolean
}

export const DEFAULT_PASSPHRASE: PassphrasePolicy = { words: 6, separator: '-', capitalize: false, addNumber: true, addSymbol: false }
export const MIN_WORDS = 3
export const MAX_WORDS = 20

export function validatePassphrase(p: PassphrasePolicy): string | null {
  if (!Number.isInteger(p.words) || p.words < MIN_WORDS || p.words > MAX_WORDS) return `Word count must be from ${MIN_WORDS} to ${MAX_WORDS}.`
  if (p.separator.length > 3) return 'Separator can be at most 3 characters.'
  return null
}

export function generatePassphrase(p: PassphrasePolicy, rng: Rng = cryptoRng, words: readonly string[] = WORDLIST): string {
  const parts = Array.from({ length: p.words }, () => {
    const w = words[rng.int(words.length)]
    return p.capitalize ? w[0].toUpperCase() + w.slice(1) : w
  })
  if (p.addNumber) {
    const i = rng.int(parts.length)
    parts[i] += DIGITS[rng.int(10)]
  }
  if (p.addSymbol) {
    const i = rng.int(parts.length)
    parts[i] += PASSPHRASE_SYMBOLS[rng.int(PASSPHRASE_SYMBOLS.length)]
  }
  return parts.join(p.separator)
}

export interface EntropyBreakdown {
  bits: number
  parts: { label: string; bits: number }[]
  caveats: string[]
}

/**
 * Entropy of a passphrase. Only the uniformly random choices are counted: each word, and
 * the value of the added digit/symbol. The *position* of the digit/symbol is deliberately
 * not credited (it can collide with other choices), so this is a slight underestimate.
 */
export function passphraseEntropy(p: PassphrasePolicy, listSize = WORDLIST.length): EntropyBreakdown {
  const perWord = Math.log2(listSize)
  const parts = [{ label: `${p.words} words × log2(${listSize.toLocaleString('en-US')})`, bits: p.words * perWord }]
  if (p.addNumber) parts.push({ label: 'Digit (0–9)', bits: Math.log2(10) })
  if (p.addSymbol) parts.push({ label: `Symbol (1 of ${PASSPHRASE_SYMBOLS.length})`, bits: Math.log2(PASSPHRASE_SYMBOLS.length) })
  const caveats = ['Assumes the attacker knows this wordlist and settings — the estimate holds even then.']
  if (!p.separator && !p.capitalize) caveats.push('Without a separator, word boundaries can be ambiguous, so a few combinations may coincide; true entropy is marginally lower.')
  return { bits: parts.reduce((s, x) => s + x.bits, 0), parts, caveats }
}

// ── Strength guidance ──────────────────────────────────────────────────────────

export type StrengthLabel = 'weak' | 'fair' | 'strong' | 'very strong'

export const GUESS_RATE = 1e10

export interface Strength {
  label: StrengthLabel
  /** 0–3 for meters. */
  level: 0 | 1 | 2 | 3
  explanation: string
  /** Expected time (seconds) to find it at GUESS_RATE — half the search space. */
  crackSeconds: number
  crackTime: string
}

export function strengthFor(bits: number, rate = GUESS_RATE): Strength {
  const crackSeconds = 2 ** (bits - 1) / rate
  const crackTime = humanDuration(crackSeconds)
  if (bits < 40)
    return { label: 'weak', level: 0, crackSeconds, crackTime, explanation: 'Small enough to brute-force quickly if a password hash leaks. Fine only where the service limits login attempts.' }
  if (bits < 60)
    return { label: 'fair', level: 1, crackSeconds, crackTime, explanation: 'Resists online guessing, but a determined offline attack on a fast hash could succeed. Add length for anything important.' }
  if (bits < 80)
    return { label: 'strong', level: 2, crackSeconds, crackTime, explanation: 'Out of reach for offline attacks on most hashes. Good for everyday accounts.' }
  return { label: 'very strong', level: 3, crackSeconds, crackTime, explanation: 'Beyond any realistic brute-force attack. Suitable for master passwords and encryption keys.' }
}

const UNITS: [number, string][] = [
  [1, 'second'],
  [60, 'minute'],
  [3600, 'hour'],
  [86400, 'day'],
  [86400 * 365.25, 'year'],
]
const AGE_OF_UNIVERSE_YEARS = 1.38e10

export function humanDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'longer than the age of the universe'
  if (seconds < 1) return 'less than a second'
  const years = seconds / (86400 * 365.25)
  if (years >= AGE_OF_UNIVERSE_YEARS * 1000) return `${formatMagnitude(years / AGE_OF_UNIVERSE_YEARS)} × the age of the universe`
  if (years >= 1e6) return `${formatMagnitude(years)} years`
  let unit = UNITS[0]
  for (const u of UNITS) if (seconds >= u[0]) unit = u
  const v = seconds / unit[0]
  const n = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10
  return `${n.toLocaleString('en-US')} ${unit[1]}${n === 1 ? '' : 's'}`
}

function formatMagnitude(n: number): string {
  const names: [number, string][] = [
    [1e18, 'quintillion'],
    [1e15, 'quadrillion'],
    [1e12, 'trillion'],
    [1e9, 'billion'],
    [1e6, 'million'],
    [1e3, 'thousand'],
  ]
  if (n >= 1e21) return `10${String(Math.floor(Math.log10(n))).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)])}`
  for (const [v, name] of names) if (n >= v) return `${Math.round((n / v) * 10) / 10} ${name}`
  return Math.round(n).toLocaleString('en-US')
}
