/**
 * Randomness primitives shared by the generator tools.
 *
 * Two sources implement the same `Rng` interface:
 * - `cryptoRng`: backed by `crypto.getRandomValues`. Integers use rejection sampling, so
 *   there is no modulo bias. Use it for anything security-relevant (passwords, IDs, tokens).
 * - `createSeededRng(seed)`: a fast, reproducible PRNG (sfc32 seeded via cyrb128) for sample
 *   data and placeholder text, where "same seed → same output" matters more than secrecy.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
  /** Uniform integer in [0, max). `max` must be a positive integer ≤ 2^32. */
  int(max: number): number
}

const U32 = 0x1_0000_0000

/** Fill a buffer from the platform CSPRNG (handles the 65,536-byte per-call limit). */
export function fillRandom<T extends Uint8Array<ArrayBuffer> | Uint32Array<ArrayBuffer>>(buf: T): T {
  const max = 65536 / buf.BYTES_PER_ELEMENT
  for (let i = 0; i < buf.length; i += max) crypto.getRandomValues(buf.subarray(i, Math.min(buf.length, i + max)) as Uint8Array<ArrayBuffer>)
  return buf
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return fillRandom(new Uint8Array(n))
}

/**
 * Buffered CSPRNG: draws 32-bit words from `crypto.getRandomValues` in blocks so bulk
 * generation (10k IDs) doesn't make one syscall per character.
 */
class CryptoRng implements Rng {
  private buf = new Uint32Array(256)
  private pos = 256

  u32(): number {
    if (this.pos >= this.buf.length) {
      fillRandom(this.buf)
      this.pos = 0
    }
    return this.buf[this.pos++]
  }

  next(): number {
    // 53 random bits → exact double in [0, 1).
    const hi = this.u32() >>> 5 // 27 bits
    const lo = this.u32() >>> 6 // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992
  }

  int(max: number): number {
    if (!Number.isInteger(max) || max <= 0 || max > U32) throw new RangeError(`int(max): max must be an integer in 1..2^32, got ${max}`)
    if (max === 1) return 0
    // Rejection sampling: accept only values below the largest multiple of `max`.
    const limit = U32 - (U32 % max)
    for (;;) {
      const x = this.u32()
      if (x < limit) return x % max
    }
  }
}

export const cryptoRng: Rng & { u32(): number } = new CryptoRng()

/** cyrb128 string hash → four 32-bit seeds. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1
  h3 ^= h1
  h4 ^= h1
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]
}

/** Seedable PRNG (sfc32). Not for secrets — reproducibility only. */
export function createSeededRng(seed: string): Rng {
  let [a, b, c, d] = cyrb128(seed)
  const u32 = () => {
    a >>>= 0
    b >>>= 0
    c >>>= 0
    d >>>= 0
    let t = (a + b) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    d = (d + 1) | 0
    t = (t + d) | 0
    c = (c + t) | 0
    return t >>> 0
  }
  // Discard the first outputs to decorrelate similar seeds.
  for (let i = 0; i < 15; i++) u32()
  return {
    next: () => u32() / U32,
    int(max: number) {
      if (!Number.isInteger(max) || max <= 0 || max > U32) throw new RangeError(`int(max): max must be an integer in 1..2^32, got ${max}`)
      if (max === 1) return 0
      const limit = U32 - (U32 % max)
      for (;;) {
        const x = u32()
        if (x < limit) return x % max
      }
    },
  }
}

const SEED_ALPHABET = '0123456789abcdefghijkmnpqrstuvwxyz'

/** A short, human-friendly seed drawn from the CSPRNG (≈41 bits). */
export function randomSeed(length = 8): string {
  let s = ''
  for (let i = 0; i < length; i++) s += SEED_ALPHABET[cryptoRng.int(SEED_ALPHABET.length)]
  return s
}

/** Uniform integer in [min, max] (inclusive). Supports ranges wider than 2^32 via two draws. */
export function intBetween(rng: Rng, min: number, max: number): number {
  if (max < min) [min, max] = [max, min]
  const span = max - min + 1
  if (span <= U32) return min + rng.int(span)
  // Wide range: compose 53 bits uniformly, reject out-of-range.
  if (span > Number.MAX_SAFE_INTEGER) return Math.floor(min + rng.next() * span)
  const limit = Math.floor(2 ** 53 / span) * span
  for (;;) {
    const x = rng.int(2 ** 21) * U32 + rng.int(U32)
    if (x < limit) return min + (x % span)
  }
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[rng.int(items.length)]
}

/** Unbiased Fisher–Yates shuffle (in place). */
export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    const t = arr[i]
    arr[i] = arr[j]
    arr[j] = t
  }
  return arr
}

/** Chi-square statistic for observed counts against a uniform expectation. Used by tests and sanity checks. */
export function chiSquareUniform(counts: ArrayLike<number>): number {
  let total = 0
  for (let i = 0; i < counts.length; i++) total += counts[i]
  const expected = total / counts.length
  let chi = 0
  for (let i = 0; i < counts.length; i++) chi += (counts[i] - expected) ** 2 / expected
  return chi
}
