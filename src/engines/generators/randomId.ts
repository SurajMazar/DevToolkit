import { bytesToBase64 } from '@/engines/encoding/base64'
import { cryptoRng, randomBytes, type Rng } from './random'

// ── NanoID-style IDs ────────────────────────────────────────────────────────────

export const ALPHABETS = {
  urlsafe: { label: 'URL-safe (64)', chars: 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict' },
  alphanumeric: { label: 'Alphanumeric (62)', chars: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' },
  hex: { label: 'Hex lowercase (16)', chars: '0123456789abcdef' },
  lowercase: { label: 'Lowercase + digits (36)', chars: '0123456789abcdefghijklmnopqrstuvwxyz' },
  nolookalikes: { label: 'No look-alikes (49)', chars: '346789ABCDEFGHJKLMNPQRTUVWXYabcdefghijkmnpqrtwxyz' },
  numbers: { label: 'Numbers (10)', chars: '0123456789' },
} as const

export type AlphabetPreset = keyof typeof ALPHABETS | 'custom'

export const MAX_ID_COUNT = 10_000
export const MAX_ID_LENGTH = 512

export type AlphabetResult = { ok: true; chars: string[] } | { ok: false; error: string }

export function resolveAlphabet(preset: AlphabetPreset, custom: string): AlphabetResult {
  const src = preset === 'custom' ? custom : ALPHABETS[preset].chars
  const chars = Array.from(src)
  if (chars.length < 2) return { ok: false, error: 'The alphabet needs at least 2 characters.' }
  const seen = new Set<string>()
  for (const c of chars) {
    if (seen.has(c)) return { ok: false, error: `“${c}” appears more than once — duplicates would make some characters more likely.` }
    if (/\s/.test(c)) return { ok: false, error: 'The alphabet must not contain whitespace.' }
    seen.add(c)
  }
  if (chars.length > 65536) return { ok: false, error: 'The alphabet can have at most 65,536 characters.' }
  return { ok: true, chars }
}

/** Uniform random ID: every character drawn with rejection sampling (no modulo bias). */
export function nanoid(alphabet: readonly string[], length: number, rng: Rng = cryptoRng): string {
  let s = ''
  for (let i = 0; i < length; i++) s += alphabet[rng.int(alphabet.length)]
  return s
}

// ── ULID (https://github.com/ulid/spec) ─────────────────────────────────────────

export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const MAX_TIME = 2 ** 48 - 1

export function encodeTime(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_TIME) throw new RangeError('ULID time must be an integer in 0..2^48−1')
  let s = ''
  for (let i = 0; i < 10; i++) {
    const mod = ms % 32
    s = CROCKFORD[mod] + s
    ms = (ms - mod) / 32
  }
  return s
}

/** 80 random bits as 16 Crockford characters (5 bits each). */
function encodeRandom(bytes: Uint8Array): string {
  // 10 bytes = 80 bits = 16 × 5-bit groups.
  let bits = 0n
  for (const b of bytes) bits = (bits << 8n) | BigInt(b)
  let s = ''
  for (let i = 0; i < 16; i++) {
    s = CROCKFORD[Number(bits & 31n)] + s
    bits >>= 5n
  }
  return s
}

/** Increment a Crockford base32 string by one; throws on overflow. */
export function incrementBase32(s: string): string {
  const chars = s.split('')
  for (let i = chars.length - 1; i >= 0; i--) {
    const v = CROCKFORD.indexOf(chars[i])
    if (v < 31) {
      chars[i] = CROCKFORD[v + 1]
      return chars.join('')
    }
    chars[i] = '0'
  }
  throw new RangeError('ULID random component overflowed within one millisecond')
}

export interface UlidFactory {
  (now?: number): string
}

/**
 * ULID generator. With `monotonic`, IDs created in the same millisecond reuse the previous
 * random part incremented by one, so they sort in creation order (spec "Monotonicity").
 */
export function createUlid({ monotonic, random = (n: number) => randomBytes(n) }: { monotonic: boolean; random?: (n: number) => Uint8Array }): UlidFactory {
  let lastTime = -1
  let lastRandom = ''
  return (now = Date.now()) => {
    if (monotonic && now <= lastTime) {
      lastRandom = incrementBase32(lastRandom)
      return encodeTime(lastTime) + lastRandom
    }
    lastTime = now
    lastRandom = encodeRandom(random(10))
    return encodeTime(now) + lastRandom
  }
}

export type UlidDecode = { ok: true; timestampMs: number; randomHex: string; canonical: string } | { ok: false; error: string }

/** Decode a ULID. Accepts lowercase and Crockford aliases (I/L → 1, O → 0). */
export function decodeUlid(raw: string): UlidDecode {
  const s = raw.trim()
  if (!s) return { ok: false, error: 'Paste a ULID to decode it.' }
  if (s.length !== 26) return { ok: false, error: `A ULID is 26 characters; this has ${s.length}.` }
  const up = s.toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0')
  for (let i = 0; i < 26; i++) {
    if (!CROCKFORD.includes(up[i])) return { ok: false, error: `Invalid character “${s[i]}” at position ${i + 1} (Crockford base32 excludes U).` }
  }
  if (CROCKFORD.indexOf(up[0]) > 7) return { ok: false, error: 'First character must be 0–7: the timestamp would exceed 48 bits.' }
  let ms = 0
  for (let i = 0; i < 10; i++) ms = ms * 32 + CROCKFORD.indexOf(up[i])
  let bits = 0n
  for (let i = 10; i < 26; i++) bits = (bits << 5n) | BigInt(CROCKFORD.indexOf(up[i]))
  return { ok: true, timestampMs: ms, randomHex: bits.toString(16).padStart(20, '0'), canonical: up }
}

// ── Tokens ──────────────────────────────────────────────────────────────────────

export type TokenEncoding = 'hex' | 'base64url' | 'base62'

const BASE62 = ALPHABETS.alphanumeric.chars

/** Random secret token of `bytes` bytes of entropy. base62 draws ⌈bytes·8/log2 62⌉ characters. */
export function randomToken(bytes: number, encoding: TokenEncoding, prefix = '', rng: Rng = cryptoRng): string {
  if (encoding === 'base62') {
    const len = tokenLength(bytes, 'base62')
    return prefix + nanoid(Array.from(BASE62), len, rng)
  }
  const b = rng === cryptoRng ? randomBytes(bytes) : Uint8Array.from({ length: bytes }, () => rng.int(256))
  if (encoding === 'hex') return prefix + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return prefix + bytesToBase64(b, { urlSafe: true }).replace(/=+$/, '')
}

export function tokenLength(bytes: number, encoding: TokenEncoding): number {
  if (encoding === 'hex') return bytes * 2
  if (encoding === 'base64url') return Math.ceil((bytes * 8) / 6)
  return Math.ceil((bytes * 8) / Math.log2(62))
}

export function tokenBits(bytes: number, encoding: TokenEncoding): number {
  return encoding === 'base62' ? tokenLength(bytes, 'base62') * Math.log2(62) : bytes * 8
}

// ── Collision maths ─────────────────────────────────────────────────────────────

/** Entropy in bits of a uniformly random ID. */
export function idBits(alphabetSize: number, length: number): number {
  return length * Math.log2(alphabetSize)
}

/**
 * Birthday bound: how many IDs must be generated for collision probability `p`, given
 * `bits` of entropy per ID. n ≈ √(2·H·ln(1/(1−p))) with H = 2^bits.
 */
export function idsForCollisionProbability(bits: number, p = 0.01): number {
  return Math.sqrt(2 * Math.log(1 / (1 - p))) * 2 ** (bits / 2)
}

/** Probability of at least one collision among `n` IDs with `bits` of entropy. */
export function collisionProbability(bits: number, n: number): number {
  if (n < 2) return 0
  // 1 − exp(−n(n−1)/(2H)), computed stably for tiny values.
  const x = (n * (n - 1)) / 2 / 2 ** bits
  return -Math.expm1(-x)
}

export function formatBigCount(n: number): string {
  if (!Number.isFinite(n)) return '∞'
  if (n < 1e6) return Math.max(1, Math.round(n)).toLocaleString('en-US')
  const units: [number, string][] = [
    [1e33, 'decillion'],
    [1e30, 'nonillion'],
    [1e27, 'octillion'],
    [1e24, 'septillion'],
    [1e21, 'sextillion'],
    [1e18, 'quintillion'],
    [1e15, 'quadrillion'],
    [1e12, 'trillion'],
    [1e9, 'billion'],
    [1e6, 'million'],
  ]
  if (n >= 1e36) return `10${superscript(Math.floor(Math.log10(n)))}`
  for (const [v, name] of units) if (n >= v) return `${(n / v).toFixed(n / v >= 100 ? 0 : 1)} ${name}`
  return String(n)
}

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
function superscript(n: number): string {
  return String(n).replace(/\d/g, (d) => SUP[Number(d)])
}
