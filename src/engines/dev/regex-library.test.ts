import { describe, expect, it } from 'vitest'
import { REGEX_LIBRARY } from './regex-library'
import { generateSamples, toRandexpPattern } from './regex-samples'
import { compileRegex, findMatches } from '@/engines/regex/core'

const full = (pattern: string, flags: string) => new RegExp(`^(?:${pattern})$`, flags.replace(/[gy]/g, ''))

describe('regex library', () => {
  it('has unique ids and complete metadata', () => {
    expect(new Set(REGEX_LIBRARY.map((p) => p.id)).size).toBe(REGEX_LIBRARY.length)
    for (const p of REGEX_LIBRARY) {
      expect(p.description.length, p.id).toBeGreaterThan(10)
      expect(p.caveats.length, p.id).toBeGreaterThan(10)
      expect(compileRegex(p.pattern, p.flags).ok, p.id).toBe(true)
    }
  })

  for (const p of REGEX_LIBRARY) {
    it(`${p.id}: matches and rejects its examples`, () => {
      const re = full(p.pattern, p.flags)
      for (const m of p.matches) expect(re.test(m), `${p.id} should match ${m}`).toBe(true)
      for (const r of p.rejects) expect(re.test(r), `${p.id} should reject ${r}`).toBe(false)
    })
    it(`${p.id}: finds something in its sample text`, () => {
      expect(findMatches(p.pattern, p.flags, p.sample).total).toBeGreaterThan(0)
    })
  }
})

describe('sample generation', () => {
  it('generates verified samples for simple patterns', () => {
    const r = generateSamples('[a-f]{3}-\\d{2}', '', { count: 8 })
    expect(r.error).toBeUndefined()
    expect(r.samples).toHaveLength(8)
    expect(r.samples.every((s) => s.verdict === 'full' && /^[a-f]{3}-\d{2}$/.test(s.text))).toBe(true)
  })

  it('caps unbounded repetition', () => {
    const r = generateSamples('a+', '', { count: 30, maxRepeat: 3 })
    expect(r.samples.every((s) => s.text.length <= 4)).toBe(true)
    expect(r.notes.some((n) => /distinct/.test(n))).toBe(true)
  })

  it('rewrites named groups and named backreferences', () => {
    expect(toRandexpPattern('(?<q>a)\\k<q>', '').pattern).toBe('(a)\\1')
    const r = generateSamples('(?<w>[xy])-\\k<w>', '', { count: 4 })
    expect(r.samples.every((s) => s.verdict === 'full')).toBe(true)
  })

  it('drops lookbehind with a note and approximates unicode properties', () => {
    const lb = toRandexpPattern('(?<=\\$)\\d+', '')
    expect(lb.pattern).toBe('\\d+')
    expect(lb.notes.join(' ')).toMatch(/Lookbehind/)
    const up = generateSamples('\\p{Lu}\\p{Ll}+', 'u', { count: 5 })
    expect(up.error).toBeUndefined()
    expect(up.samples.every((s) => s.verdict === 'full')).toBe(true)
  })

  it('reports invalid patterns', () => {
    expect(generateSamples('(', '').error).toBeTruthy()
  })

  it('marks samples that fail assertions', () => {
    const r = generateSamples('(?!abc)[abc]{3}', '', { count: 27, maxRepeat: 3 })
    expect(r.samples.some((s) => s.verdict === 'none' || s.verdict === 'partial') || r.samples.every((s) => s.text !== 'abc')).toBe(true)
  })
})
