import { describe, expect, it } from 'vitest'
import {
  ALPHABETS,
  collisionProbability,
  createUlid,
  CROCKFORD,
  decodeUlid,
  encodeTime,
  formatBigCount,
  idBits,
  idsForCollisionProbability,
  incrementBase32,
  nanoid,
  randomToken,
  resolveAlphabet,
  tokenBits,
  tokenLength,
} from './randomId'
import { chiSquareUniform, createSeededRng } from './random'

describe('nanoid', () => {
  it('uses only alphabet characters at the requested length', () => {
    const a = Array.from(ALPHABETS.urlsafe.chars)
    expect(new Set(a).size).toBe(64)
    for (let i = 0; i < 200; i++) {
      const id = nanoid(a, 21)
      expect(id).toMatch(/^[A-Za-z0-9_-]{21}$/)
    }
  })

  it('is unbiased for alphabets that are not powers of two', () => {
    const a = Array.from(ALPHABETS.alphanumeric.chars)
    const counts = new Array(62).fill(0)
    const idx = new Map(a.map((c, i) => [c, i]))
    for (let i = 0; i < 2000; i++) for (const c of nanoid(a, 50)) counts[idx.get(c)!]++
    // 61 dof, p≈0.0001 critical ≈ 112. A modulo-256 implementation fails this (first 8 chars +25%).
    expect(chiSquareUniform(counts)).toBeLessThan(112)
  })

  it('supports unicode custom alphabets and validates them', () => {
    const r = resolveAlphabet('custom', 'αβγ😀')
    expect(r.ok && r.chars).toEqual(['α', 'β', 'γ', '😀'])
    if (r.ok) expect(Array.from(nanoid(r.chars, 10))).toHaveLength(10)
    expect(resolveAlphabet('custom', 'a').ok).toBe(false)
    const dup = resolveAlphabet('custom', 'abca')
    expect(!dup.ok && dup.error).toMatch(/“a” appears more than once/)
    expect(resolveAlphabet('custom', 'ab c').ok).toBe(false)
    for (const k of Object.keys(ALPHABETS) as (keyof typeof ALPHABETS)[]) expect(resolveAlphabet(k, '').ok).toBe(true)
  })
})

describe('ULID', () => {
  it('encodes time per the spec example', () => {
    // From the ULID reference implementation README.
    expect(encodeTime(1469918176385)).toBe('01ARYZ6S41')
    expect(encodeTime(0)).toBe('0000000000')
    expect(encodeTime(2 ** 48 - 1)).toBe('7ZZZZZZZZZ')
    expect(() => encodeTime(2 ** 48)).toThrow()
    expect(() => encodeTime(-1)).toThrow()
  })

  it('decodes the spec example timestamp', () => {
    const r = decodeUlid('01ARYZ6S41TSV4RRFFQ69G5FAV')
    expect(r.ok && r.timestampMs).toBe(1469918176385)
    // Lowercase and Crockford aliases are accepted.
    const l = decodeUlid('01aryz6s41tsv4rrffq69g5fav')
    expect(l.ok && l.timestampMs).toBe(1469918176385)
    const alias = decodeUlid('O1ARYZ6S4ITSV4RRFFQ69G5FAV')
    expect(alias.ok && alias.canonical).toBe('01ARYZ6S41TSV4RRFFQ69G5FAV')
  })

  it('reproduces the reference monotonic sequence', () => {
    const random = () => Uint8Array.from([0x56, 0x95, 0x72, 0xb9, 0xe7, 0x76, 0x0f, 0x4f, 0x5a, 0x07])
    const ulid = createUlid({ monotonic: true, random })
    const a = ulid(150000)
    const b = ulid(150000)
    const c = ulid(150000)
    expect(a.slice(0, 10)).toBe('0000004JFG')
    expect(a.slice(10)).toBe('ATAQ5EF7ER7MYPG7') // computed independently (Python big-int → Crockford)
    expect(b.slice(10)).toBe(incrementBase32(a.slice(10)))
    expect(c.slice(10)).toBe(incrementBase32(b.slice(10)))
    expect(a < b && b < c).toBe(true)
    // A clock going backwards still yields increasing IDs.
    const d = ulid(149999)
    expect(d > c).toBe(true)
    // A new millisecond draws fresh randomness.
    expect(ulid(150001).slice(0, 10)).toBe(encodeTime(150001))
  })

  it('round-trips generated ULIDs and sorts lexicographically by time', () => {
    const ulid = createUlid({ monotonic: true })
    const ids = Array.from({ length: 5000 }, () => ulid())
    for (const id of ids) expect(id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/)
    for (let i = 1; i < ids.length; i++) expect(ids[i] > ids[i - 1]).toBe(true)
    const now = Date.now()
    const r = decodeUlid(ids[ids.length - 1])
    expect(r.ok && Math.abs(r.timestampMs - now)).toBeLessThan(1000)
  })

  it('non-monotonic mode draws fresh randomness every time', () => {
    const ulid = createUlid({ monotonic: false })
    const a = ulid(1000)
    const b = ulid(1000)
    expect(a.slice(0, 10)).toBe(b.slice(0, 10))
    expect(a).not.toBe(b)
  })

  it('increment carries and overflows', () => {
    // Sequence from the ulid/javascript README monotonic example.
    let r = 'ACTAV9WEVGEMMVR8'
    for (const want of ['ACTAV9WEVGEMMVR9', 'ACTAV9WEVGEMMVRA', 'ACTAV9WEVGEMMVRB', 'ACTAV9WEVGEMMVRC']) {
      r = incrementBase32(r)
      expect(r).toBe(want)
    }
    expect(incrementBase32('0000')).toBe('0001')
    expect(incrementBase32('000Z')).toBe('0010')
    expect(() => incrementBase32('ZZZZ')).toThrow(/overflow/)
  })

  it('reports invalid ULIDs', () => {
    expect(decodeUlid('').ok).toBe(false)
    expect(!decodeUlid('01ARYZ6S41').ok && (decodeUlid('01ARYZ6S41') as { error: string }).error).toMatch(/26 characters/)
    const u = decodeUlid('01ARYZ6S41TSV4RRFFQ69G5FAU')
    expect(!u.ok && u.error).toMatch(/“U” at position 26/)
    expect(decodeUlid('81ARYZ6S41TSV4RRFFQ69G5FAV').ok).toBe(false)
    expect(CROCKFORD).toHaveLength(32)
  })
})

describe('tokens', () => {
  it('hex and base64url tokens carry the requested bytes', () => {
    expect(randomToken(32, 'hex')).toMatch(/^[0-9a-f]{64}$/)
    expect(randomToken(32, 'base64url', 'sk_test_')).toMatch(/^sk_test_[A-Za-z0-9_-]{43}$/)
    expect(randomToken(24, 'base62')).toMatch(/^[A-Za-z0-9]{33}$/)
    expect(tokenLength(16, 'hex')).toBe(32)
    expect(tokenLength(16, 'base64url')).toBe(22)
    expect(tokenBits(16, 'hex')).toBe(128)
    expect(tokenBits(16, 'base62')).toBeGreaterThanOrEqual(128)
  })
  it('seeded tokens are reproducible', () => {
    expect(randomToken(8, 'hex', '', createSeededRng('a'))).toBe(randomToken(8, 'hex', '', createSeededRng('a')))
  })
})

describe('collision maths', () => {
  it('matches the birthday bound', () => {
    // 64 bits: ~609 million IDs for 1%.
    const n = idsForCollisionProbability(64, 0.01)
    expect(n / 1e6).toBeGreaterThan(600)
    expect(n / 1e6).toBeLessThan(620)
    expect(collisionProbability(64, n)).toBeCloseTo(0.01, 4)
    // NanoID default (21 chars × 6 bits = 126 bits).
    expect(idBits(64, 21)).toBe(126)
    expect(collisionProbability(126, 1000)).toBeGreaterThan(0)
    expect(collisionProbability(126, 1000)).toBeLessThan(1e-30)
    expect(collisionProbability(10, 1)).toBe(0)
    // Tiny space: 365 "days", 23 people ≈ 50%.
    expect(collisionProbability(Math.log2(365), 23)).toBeGreaterThan(0.49)
    expect(collisionProbability(Math.log2(365), 23)).toBeLessThan(0.52)
  })
  it('formats big counts', () => {
    expect(formatBigCount(1234)).toBe('1,234')
    expect(formatBigCount(2.5e9)).toBe('2.5 billion')
    expect(formatBigCount(1e40)).toBe('10⁴⁰')
  })
})
