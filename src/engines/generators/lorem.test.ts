import { describe, expect, it } from 'vitest'
import { DEFAULT_LOREM, generateLorem, LOREM_WORDS, loremCounts, validateLorem, type LoremOptions } from './lorem'

const gen = (o: Partial<LoremOptions>) => generateLorem({ ...DEFAULT_LOREM, seed: 'test', ...o })

describe('generateLorem', () => {
  it('is reproducible for a seed and varies across seeds', () => {
    expect(gen({}).output).toBe(gen({}).output)
    expect(gen({ seed: 'other' }).output).not.toBe(gen({}).output)
  })

  it('starts with the classic opening when asked', () => {
    expect(gen({}).output.startsWith('Lorem ipsum dolor sit amet, consectetur adipiscing elit')).toBe(true)
    expect(gen({ unit: 'words', count: 3 }).output).toBe('Lorem ipsum dolor')
    expect(gen({ startWithLorem: false, seed: 'zz' }).output.startsWith('Lorem ipsum dolor sit amet')).toBe(false)
  })

  it('produces the exact number of words', () => {
    const r = gen({ unit: 'words', count: 250, startWithLorem: false })
    expect(r.units).toHaveLength(250)
    expect(r.output.split(' ')).toHaveLength(250)
    for (const w of r.units) expect(LOREM_WORDS).toContain(w)
    expect(loremCounts(r, 'words').words).toBe(250)
  })

  it('sentences respect the word range and are capitalised and terminated', () => {
    const r = gen({ unit: 'sentences', count: 200, sentenceWords: [4, 9], startWithLorem: false })
    expect(r.units).toHaveLength(200)
    for (const s of r.units) {
      expect(s).toMatch(/^[A-Z][a-z, ]+[.?]$/)
      const n = s.split(' ').length
      expect(n).toBeGreaterThanOrEqual(4)
      expect(n).toBeLessThanOrEqual(9)
    }
  })

  it('paragraphs respect the sentence range', () => {
    const r = gen({ count: 50, paragraphSentences: [2, 3], startWithLorem: false })
    for (const p of r.units) {
      const n = (p.match(/[.?]( |$)/g) ?? []).length
      expect(n).toBeGreaterThanOrEqual(2)
      expect(n).toBeLessThanOrEqual(3)
    }
    expect(r.output.split('\n\n')).toHaveLength(50)
  })

  it('formats as HTML, Markdown and JSON', () => {
    const html = gen({ count: 2, format: 'html' }).output
    expect(html.split('\n')).toHaveLength(2)
    expect(html).toMatch(/^<p>Lorem.*<\/p>\n<p>.*<\/p>$/)
    const htmlH = gen({ count: 2, format: 'html', headings: true }).output
    expect(htmlH.match(/<h2>/g)).toHaveLength(2)
    const md = gen({ count: 3, format: 'markdown', headings: true }).output
    expect(md.match(/^## [A-Z]/gm)).toHaveLength(3)
    const json = JSON.parse(gen({ unit: 'sentences', count: 5, format: 'json' }).output)
    expect(json).toHaveLength(5)
    // Headings are ignored in plain text.
    expect(gen({ count: 2, headings: true }).output).not.toContain('#')
  })

  it('counts words, sentences and paragraphs', () => {
    const r = gen({ count: 3, paragraphSentences: [2, 2] })
    const c = loremCounts(r, 'paragraphs')
    expect(c.paragraphs).toBe(3)
    expect(c.sentences).toBe(6)
    expect(c.words).toBe(r.units.join(' ').split(/\s+/).length)
    expect(c.chars).toBe(r.output.length)
  })

  it('handles large counts quickly', () => {
    const t = performance.now()
    const r = gen({ unit: 'words', count: 100_000 })
    expect(r.units).toHaveLength(100_000)
    const p = gen({ count: 1000 })
    expect(p.units).toHaveLength(1000)
    expect(performance.now() - t).toBeLessThan(2000)
  })

  it('validates options', () => {
    expect(validateLorem({ ...DEFAULT_LOREM, count: 0 })).toMatch(/Count/)
    expect(validateLorem({ ...DEFAULT_LOREM, count: 1001 })).toMatch(/1,000 paragraphs/)
    expect(validateLorem({ ...DEFAULT_LOREM, sentenceWords: [10, 5] })).toMatch(/Words per sentence/)
    expect(validateLorem({ ...DEFAULT_LOREM, paragraphSentences: [0, 5] })).toMatch(/Sentences per paragraph/)
    expect(() => gen({ count: -1 })).toThrow()
  })
})
