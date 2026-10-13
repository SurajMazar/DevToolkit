import { describe, expect, it } from 'vitest'
import {
  AMBIGUOUS,
  countPasswords,
  DEFAULT_PASSPHRASE,
  DEFAULT_POLICY,
  generatePassphrase,
  generatePassword,
  generatePasswords,
  humanDuration,
  log2Big,
  passphraseEntropy,
  passwordEntropy,
  resolvePolicy,
  strengthFor,
  validatePassphrase,
  type PasswordPolicy,
} from './password'
import { chiSquareUniform, createSeededRng } from './random'
import { WORDLIST } from './wordlist'

const policy = (over: Partial<PasswordPolicy>) => {
  const r = resolvePolicy({ ...DEFAULT_POLICY, ...over })
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe('resolvePolicy', () => {
  it('builds disjoint groups from the selected sets', () => {
    const p = policy({})
    expect(p.groups.map((g) => g.id)).toEqual(['upper', 'lower', 'digits', 'symbols'])
    expect(new Set(p.pool).size).toBe(p.pool.length)
    expect(p.poolSize).toBe(26 + 26 + 10 + DEFAULT_POLICY.symbolSet.length)
  })

  it('removes ambiguous and custom-excluded characters', () => {
    const p = policy({ excludeAmbiguous: true, exclude: 'abc#' })
    for (const c of AMBIGUOUS + 'abc#') expect(p.pool).not.toContain(c)
    expect(p.pool).toContain('d')
  })

  it('dedupes symbol-set characters that already belong to another set', () => {
    const p = policy({ symbolSet: 'a!!b?' })
    expect(p.groups.find((g) => g.id === 'symbols')!.chars).toBe('!?')
  })

  it('handles non-BMP symbols as single characters', () => {
    const p = policy({ upper: false, lower: false, digits: false, symbolSet: '😀🎉' })
    expect(p.poolSize).toBe(2)
    const pw = generatePassword(p)
    expect(Array.from(pw)).toHaveLength(DEFAULT_POLICY.length)
  })

  it('reports explicit errors', () => {
    const err = (o: Partial<PasswordPolicy>) => {
      const r = resolvePolicy({ ...DEFAULT_POLICY, ...o })
      return r.ok ? null : r.error
    }
    expect(err({ upper: false, lower: false, digits: false, symbols: false })).toMatch(/at least one/)
    expect(err({ length: 3 })).toMatch(/4 to 128/)
    expect(err({ length: 129 })).toMatch(/4 to 128/)
    expect(err({ digits: true, exclude: '0123456789' })).toMatch(/Digits: every character is excluded/)
    expect(err({ symbols: true, symbolSet: '' })).toMatch(/Symbols/)
    expect(err({ upper: false, lower: false, symbols: false, exclude: '012345678' })).toMatch(/one usable/)
  })
})

describe('generatePassword', () => {
  it('respects length and only uses pool characters', () => {
    const p = policy({ length: 64 })
    for (const pw of generatePasswords(p, 50)) {
      expect(pw).toHaveLength(64)
      for (const c of pw) expect(p.pool).toContain(c)
    }
  })

  it('always contains each required set, even at the minimum length', () => {
    const p = policy({ length: 4, symbolSet: '!' })
    for (let i = 0; i < 300; i++) {
      const pw = generatePassword(p)
      expect(pw).toMatch(/[A-Z]/)
      expect(pw).toMatch(/[a-z]/)
      expect(pw).toMatch(/[0-9]/)
      expect(pw).toContain('!')
    }
  })

  it('is reproducible with a seeded rng (for testing) and differs between draws', () => {
    const p = policy({})
    expect(generatePassword(p, createSeededRng('x'))).toBe(generatePassword(p, createSeededRng('x')))
    expect(generatePassword(p)).not.toBe(generatePassword(p))
  })

  it('character distribution is roughly uniform (no modulo bias)', () => {
    // 70-char pool: a naive `byte % 70` would over-represent the first 46 characters by ~33%.
    const p = policy({ requireEach: false, symbolSet: '!@#$%^&*' })
    expect(p.poolSize).toBe(70)
    const counts = new Array(p.poolSize).fill(0)
    const index = new Map(Array.from(p.pool).map((c, i) => [c, i]))
    for (let i = 0; i < 2000; i++) for (const c of generatePassword({ ...p, length: 64 })) counts[index.get(c)!]++
    // 69 degrees of freedom: p=0.0001 critical value ≈ 122.
    expect(chiSquareUniform(counts)).toBeLessThan(122)
    const first = counts.slice(0, 46).reduce((a, b) => a + b, 0) / 46
    const rest = counts.slice(46).reduce((a, b) => a + b, 0) / 24
    expect(Math.abs(first / rest - 1)).toBeLessThan(0.05)
  })

  it('positions are unbiased when sets are required (each position sees each set equally)', () => {
    const p = policy({ length: 6, symbols: false })
    const digitAt = new Array(6).fill(0)
    for (let i = 0; i < 20000; i++) {
      const pw = generatePassword(p)
      for (let j = 0; j < 6; j++) if (/\d/.test(pw[j])) digitAt[j]++
    }
    expect(chiSquareUniform(digitAt)).toBeLessThan(25)
  })
})

describe('entropy', () => {
  it('equals L·log2(N) without requirements', () => {
    const p = policy({ requireEach: false, length: 16, symbols: false })
    expect(passwordEntropy(p)).toBeCloseTo(16 * Math.log2(62), 9)
  })

  it('counts valid strings exactly via inclusion–exclusion (small brute-force check)', () => {
    const r = resolvePolicy({ ...DEFAULT_POLICY, length: 4, upper: false, lower: false, digits: true, symbols: true, symbolSet: '!?', exclude: '23456789' })
    if (!r.ok) throw new Error(r.error)
    // Pool {0,1,!,?}, length 4, need ≥1 digit and ≥1 symbol: 4^4 − 2·2^4 = 224.
    expect(countPasswords(r.value)).toBe(224n)
    let brute = 0
    const pool = '01!?'
    for (let i = 0; i < 256; i++) {
      const s = [0, 1, 2, 3].map((k) => pool[(i >> (k * 2)) & 3]).join('')
      if (/[01]/.test(s) && /[!?]/.test(s)) brute++
    }
    expect(brute).toBe(224)
  })

  it('requirement lowers entropy slightly but stays close for long passwords', () => {
    const req = passwordEntropy(policy({ length: 20 }))
    const free = passwordEntropy(policy({ length: 20, requireEach: false }))
    expect(req).toBeLessThan(free)
    expect(free - req).toBeLessThan(1)
  })

  it('log2Big is accurate for huge values', () => {
    expect(log2Big(2n ** 700n)).toBeCloseTo(700, 9)
    expect(log2Big(91n ** 128n)).toBeCloseTo(128 * Math.log2(91), 6)
    expect(passwordEntropy(policy({ length: 128 }))).toBeGreaterThan(800)
  })
})

describe('passphrases', () => {
  it('wordlist has ≥2048 unique lowercase words of 3–8 letters', () => {
    expect(WORDLIST.length).toBeGreaterThanOrEqual(2048)
    expect(new Set(WORDLIST).size).toBe(WORDLIST.length)
    for (const w of WORDLIST) expect(w).toMatch(/^[a-z]{3,8}$/)
  })

  it('generates N words with separator, capitalization, number and symbol', () => {
    const s = generatePassphrase({ words: 6, separator: '.', capitalize: true, addNumber: true, addSymbol: true })
    const parts = s.split('.')
    expect(parts).toHaveLength(6)
    for (const w of parts) expect(w).toMatch(/^[A-Z][a-z]+\d?[!@#$%&*?\-+=]?\d?$/)
    expect(s).toMatch(/\d/)
    const plain = generatePassphrase({ ...DEFAULT_PASSPHRASE, addNumber: false })
    for (const w of plain.split('-')) expect(WORDLIST).toContain(w)
  })

  it('entropy counts words and the added character values', () => {
    const e = passphraseEntropy({ words: 5, separator: '-', capitalize: false, addNumber: true, addSymbol: false })
    expect(e.bits).toBeCloseTo(5 * Math.log2(WORDLIST.length) + Math.log2(10), 9)
    expect(passphraseEntropy({ ...DEFAULT_PASSPHRASE, separator: '' }).caveats.length).toBe(2)
  })

  it('validates', () => {
    expect(validatePassphrase({ ...DEFAULT_PASSPHRASE, words: 2 })).toMatch(/3 to 20/)
    expect(validatePassphrase({ ...DEFAULT_PASSPHRASE, separator: '----' })).toMatch(/Separator/)
    expect(validatePassphrase(DEFAULT_PASSPHRASE)).toBeNull()
  })
})

describe('strength', () => {
  it('labels by bits', () => {
    expect(strengthFor(30).label).toBe('weak')
    expect(strengthFor(50).label).toBe('fair')
    expect(strengthFor(70).label).toBe('strong')
    expect(strengthFor(100).label).toBe('very strong')
  })
  it('estimates crack time at 1e10 guesses/s (half the space on average)', () => {
    expect(strengthFor(40).crackSeconds).toBeCloseTo(2 ** 39 / 1e10, 6)
    expect(humanDuration(0.2)).toBe('less than a second')
    expect(humanDuration(90)).toBe('1.5 minutes')
    expect(humanDuration(86400 * 365.25 * 2e6)).toBe('2 million years')
    expect(humanDuration(2 ** 127 / 1e10)).toMatch(/age of the universe/)
  })
})
