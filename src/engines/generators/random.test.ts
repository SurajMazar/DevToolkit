import { describe, expect, it } from 'vitest'
import { chiSquareUniform, createSeededRng, cryptoRng, fillRandom, intBetween, randomBytes, randomSeed, shuffle } from './random'

describe('cryptoRng', () => {
  it('int() stays in range and is roughly uniform for awkward bounds', () => {
    for (const max of [1, 2, 3, 7, 10, 62, 255, 1000]) {
      const counts = new Array(max).fill(0)
      const n = max * 400
      let lo = Infinity
      let hi = -Infinity
      for (let i = 0; i < n; i++) {
        const v = cryptoRng.int(max)
        if (v < lo) lo = v
        if (v > hi) hi = v
        counts[v]++
      }
      expect(lo).toBeGreaterThanOrEqual(0)
      expect(hi).toBeLessThan(max)
      expect(Number.isInteger(lo) && Number.isInteger(hi)).toBe(true)
      if (max > 1) expect(chiSquareUniform(counts)).toBeLessThan(max - 1 + 6 * Math.sqrt(2 * (max - 1)))
    }
  })

  it('int() is unbiased for a bound that does not divide 2^32 (3·2^30)', () => {
    // With naive modulo, values < 2^30 would appear twice as often as the rest.
    const max = 3 * 2 ** 30
    let low = 0
    const n = 30000
    for (let i = 0; i < n; i++) if (cryptoRng.int(max) < 2 ** 30) low++
    expect(low / n).toBeGreaterThan(0.31)
    expect(low / n).toBeLessThan(0.36)
  })

  it('next() is in [0,1)', () => {
    let sum = 0
    let lo = 1
    let hi = 0
    for (let i = 0; i < 10000; i++) {
      const x = cryptoRng.next()
      lo = Math.min(lo, x)
      hi = Math.max(hi, x)
      sum += x
    }
    expect(lo).toBeGreaterThanOrEqual(0)
    expect(hi).toBeLessThan(1)
    expect(sum / 10000).toBeGreaterThan(0.47)
    expect(sum / 10000).toBeLessThan(0.53)
  })

  it('rejects invalid bounds', () => {
    expect(() => cryptoRng.int(0)).toThrow()
    expect(() => cryptoRng.int(2.5)).toThrow()
    expect(() => cryptoRng.int(2 ** 32 + 1)).toThrow()
  })

  it('fills buffers larger than the 64 KiB getRandomValues limit', () => {
    const b = fillRandom(new Uint8Array(200_000))
    expect(b.slice(150_000).some((x) => x !== 0)).toBe(true)
    expect(randomBytes(16)).toHaveLength(16)
  })
})

describe('seeded rng', () => {
  it('is reproducible and seed-sensitive', () => {
    const a = createSeededRng('hello')
    const b = createSeededRng('hello')
    const c = createSeededRng('hellp')
    const sa = Array.from({ length: 20 }, () => a.int(1000))
    expect(sa).toEqual(Array.from({ length: 20 }, () => b.int(1000)))
    expect(sa).not.toEqual(Array.from({ length: 20 }, () => c.int(1000)))
  })

  it('is roughly uniform', () => {
    const r = createSeededRng('dist')
    const counts = new Array(16).fill(0)
    for (let i = 0; i < 32000; i++) counts[Math.floor(r.next() * 16)]++
    expect(chiSquareUniform(counts)).toBeLessThan(40)
  })
})

describe('helpers', () => {
  it('intBetween is inclusive and handles wide ranges', () => {
    const r = createSeededRng('ib')
    const seen = new Set<number>()
    for (let i = 0; i < 500; i++) seen.add(intBetween(r, -2, 2))
    expect([...seen].sort()).toEqual([-1, -2, 0, 1, 2])
    for (let i = 0; i < 200; i++) {
      const v = intBetween(r, 0, 2 ** 40)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(2 ** 40)
      expect(Number.isInteger(v)).toBe(true)
    }
    expect(intBetween(r, 5, 5)).toBe(5)
    expect(intBetween(r, 9, 7)).toBeGreaterThanOrEqual(7)
  })

  it('shuffle is a permutation with uniform first-position distribution', () => {
    const counts = new Array(5).fill(0)
    for (let i = 0; i < 10000; i++) {
      const s = shuffle(cryptoRng, [0, 1, 2, 3, 4])
      expect([...s].sort()).toEqual([0, 1, 2, 3, 4])
      counts[s[0]]++
    }
    expect(chiSquareUniform(counts)).toBeLessThan(20)
  })

  it('randomSeed produces short distinct seeds', () => {
    const s = randomSeed()
    expect(s).toMatch(/^[0-9a-z]{8}$/)
    expect(randomSeed()).not.toBe(s)
  })
})
