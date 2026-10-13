import { describe, expect, it } from 'vitest'
import { applyReplacements, slugify, slugifyLines, truncateSlug, untransliterable } from './slug'

describe('slugify', () => {
  it('creates clean lowercase slugs', () => {
    expect(slugify('Hello, World!')).toBe('hello-world')
    expect(slugify('  Multiple   spaces -- and___underscores  ')).toBe('multiple-spaces-and-underscores')
    expect(slugify("Don't stop believin'")).toBe('dont-stop-believin')
    expect(slugify('')).toBe('')
    expect(slugify('!!!')).toBe('')
  })

  it('transliterates to ASCII', () => {
    expect(slugify('Crème brûlée à la café')).toBe('creme-brulee-a-la-cafe')
    expect(slugify('Straße in München')).toBe('strasse-in-munchen')
    expect(slugify('Straße in München', { german: true })).toBe('strasse-in-muenchen')
    expect(slugify('Привет мир')).toBe('privet-mir')
    expect(slugify('Ελληνικά')).toBe('ellinika')
  })

  it('keeps Unicode letters when transliteration is off', () => {
    expect(slugify('Crème Brûlée', { transliterate: false })).toBe('crème-brûlée')
    expect(slugify('東京 タワー 2024', { transliterate: false })).toBe('東京-タワー-2024')
    expect(slugify('Ünïcödé', { transliterate: false, lowercase: false })).toBe('Ünïcödé')
  })

  it('drops scripts it cannot transliterate (shown as empty slug)', () => {
    expect(slugify('東京')).toBe('')
  })

  it('applies custom replacements before slugging', () => {
    expect(slugify('Tom & Jerry')).toBe('tom-and-jerry')
    expect(slugify('R&D @ ACME: 50% off + more')).toBe('r-and-d-at-acme-50-percent-off-plus-more')
    expect(slugify('C# and F#', { replacements: [{ from: '#', to: 'sharp' }] })).toBe('c-sharp-and-f-sharp')
    expect(applyReplacements('a&b', [{ from: '', to: 'x' }])).toBe('a&b')
  })

  it('supports separators and case', () => {
    expect(slugify('Hello World', { separator: '_' })).toBe('hello_world')
    expect(slugify('Hello World', { separator: '.' })).toBe('hello.world')
    expect(slugify('Hello World', { separator: '' })).toBe('helloworld')
    expect(slugify('Hello World', { lowercase: false })).toBe('Hello-World')
  })

  it('removes English stop words but never everything', () => {
    expect(slugify('The Quick Guide to the Galaxy', { removeStopWords: true })).toBe('quick-guide-galaxy')
    expect(slugify('The The', { removeStopWords: true })).toBe('the-the')
  })

  it('optionally removes numbers', () => {
    expect(slugify('Top 10 tips for 2024', { keepNumbers: false })).toBe('top-tips-for')
    expect(slugify('Top 10 tips', { keepNumbers: true })).toBe('top-10-tips')
  })

  it('cuts at word boundaries', () => {
    expect(slugify('the quick brown fox jumps', { maxLength: 15 })).toBe('the-quick-brown')
    expect(slugify('the quick brown fox jumps', { maxLength: 14 })).toBe('the-quick')
    expect(slugify('supercalifragilistic', { maxLength: 5 })).toBe('super')
    expect(truncateSlug('ab-cd', 0, '-')).toBe('ab-cd')
    expect(truncateSlug('日本-東京', 3, '-')).toBe('日本')
  })

  it('handles emoji and mixed input', () => {
    expect(slugify('🚀 Launch day 🎉')).toBe('launch-day')
    expect(slugify('🚀 Launch', { transliterate: false })).toBe('launch')
  })
})

describe('slugifyLines', () => {
  it('slugifies each non-empty line with line numbers', () => {
    const rows = slugifyLines('First Post\r\n\r\nSecond Post\n')
    expect(rows).toEqual([
      { line: 1, input: 'First Post', slug: 'first-post', duplicateOf: null, truncated: false, dropped: '' },
      { line: 3, input: 'Second Post', slug: 'second-post', duplicateOf: null, truncated: false, dropped: '' },
    ])
  })

  it('flags duplicates and can make them unique', () => {
    const rows = slugifyLines('Hello World\nhello world!\nHello  World')
    expect(rows.map((r) => r.duplicateOf)).toEqual([null, 1, 1])
    const unique = slugifyLines('Hello World\nhello world!\nHello  World', {}, true)
    expect(unique.map((r) => r.slug)).toEqual(['hello-world', 'hello-world-2', 'hello-world-3'])
  })

  it('reports characters dropped by ASCII transliteration', () => {
    expect(untransliterable('東京 café Привет')).toBe('東京')
    expect(slugifyLines('東京 Travel')[0]).toMatchObject({ slug: 'travel', dropped: '東京' })
    expect(slugifyLines('東京 Travel', { transliterate: false })[0]).toMatchObject({ slug: '東京-travel', dropped: '' })
  })

  it('reports truncation', () => {
    const rows = slugifyLines('a very long title here\nshort', { maxLength: 10 })
    expect(rows.map((r) => [r.slug, r.truncated])).toEqual([
      ['a-very', true],
      ['short', false],
    ])
  })

  it('handles many lines', () => {
    const text = Array.from({ length: 20_000 }, (_, i) => `Article number ${i}: Ünïcödé & more`).join('\n')
    const t0 = performance.now()
    const rows = slugifyLines(text)
    expect(rows).toHaveLength(20_000)
    expect(rows[123].slug).toBe('article-number-123-unicode-and-more')
    expect(performance.now() - t0).toBeLessThan(3000)
  })
})
