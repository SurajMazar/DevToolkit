import { describe, expect, it } from 'vitest'
import { detectEol, detectPrefix, displayWidth, fillWords, isWideCodePoint, lineWidthStats, tokenizeForWrap, unwrapText, wrapText } from './wrap'

const LOREM = 'The quick brown fox jumps over the lazy dog and keeps running far beyond the hills of the valley.'

describe('displayWidth', () => {
  it('counts ASCII as 1, CJK and emoji as 2, combining marks as 0', () => {
    expect(displayWidth('hello')).toBe(5)
    expect(displayWidth('日本語')).toBe(6)
    expect(displayWidth('é')).toBe(1)
    expect(displayWidth('😀')).toBe(2)
    expect(displayWidth('👩‍💻')).toBe(2)
    expect(displayWidth('ｱ')).toBe(1) // halfwidth katakana
    expect(displayWidth('Ａ')).toBe(2) // fullwidth A
    expect(displayWidth('a​b')).toBe(2)
    expect(displayWidth('')).toBe(0)
  })

  it('isWideCodePoint covers Hangul and CJK ranges', () => {
    expect(isWideCodePoint(0xac00)).toBe(true)
    expect(isWideCodePoint(0x4e00)).toBe(true)
    expect(isWideCodePoint(0x41)).toBe(false)
    expect(isWideCodePoint(0x20000)).toBe(true)
  })
})

describe('fillWords', () => {
  it('greedily fills lines', () => {
    expect(fillWords(['aa', 'bb', 'cc', 'dd'], 5, 5, false)).toEqual(['aa bb', 'cc dd'])
  })
  it('breaks or keeps long words', () => {
    expect(fillWords(['abcdefghij'], 4, 4, true)).toEqual(['abcd', 'efgh', 'ij'])
    expect(fillWords(['abcdefghij', 'x'], 4, 4, false)).toEqual(['abcdefghij', 'x'])
    expect(fillWords(['ab', 'cdefghij'], 4, 4, true)).toEqual(['ab', 'cdef', 'ghij'])
  })
  it('never splits a grapheme cluster', () => {
    expect(fillWords(['👩‍💻👩‍💻👩‍💻'], 4, 4, true)).toEqual(['👩‍💻👩‍💻', '👩‍💻'])
  })
})

describe('wrapText', () => {
  it('wraps at the column and never exceeds it for normal words', () => {
    const r = wrapText(LOREM, { width: 30 })
    for (const line of r.text.split('\n')) expect(line.length).toBeLessThanOrEqual(30)
    expect(r.text.replace(/\n/g, ' ')).toBe(LOREM)
    expect(r.overflowLines).toBe(0)
  })

  it('reflows paragraphs and preserves blank-line breaks', () => {
    const r = wrapText('one two\nthree four\n\nfive six seven', { width: 9 })
    expect(r.text).toBe('one two\nthree\nfour\n\nfive six\nseven')
  })

  it('can merge paragraphs when preserveParagraphs is off', () => {
    expect(wrapText('a b\n\nc d', { width: 80, preserveParagraphs: false }).text).toBe('a b c d')
  })

  it('wraps each line on its own when reflow is off', () => {
    expect(wrapText('short\nalso short', { width: 80, reflow: false }).text).toBe('short\nalso short')
    expect(wrapText('aaa bbb ccc\nd', { width: 7, reflow: false }).text).toBe('aaa bbb\nccc\nd')
  })

  it('keeps indentation', () => {
    expect(wrapText('    alpha beta gamma', { width: 14 }).text).toBe('    alpha beta\n    gamma')
    expect(wrapText('    alpha beta gamma', { width: 14, preserveIndent: false }).text).toBe('alpha beta\ngamma')
  })

  it('uses hanging indents for list items and keeps them separate', () => {
    const r = wrapText('- first item has many words\n- second\n1. numbered item here', { width: 14 })
    expect(r.text).toBe('- first item\n  has many\n  words\n- second\n1. numbered\n   item here')
  })

  it('adds an explicit prefix and strips existing copies of it', () => {
    const r = wrapText('// alpha beta\n// gamma delta', { width: 14, prefix: '// ' })
    expect(r.text).toBe('// alpha beta\n// gamma delta')
    expect(wrapText('alpha beta gamma', { width: 10, prefix: '> ' }).text).toBe('> alpha\n> beta\n> gamma')
  })

  it('detects an existing comment / quote prefix', () => {
    const r = wrapText('# one two three four five six', { width: 16 })
    expect(r.prefix).toBe('# ')
    expect(r.detected).toBe(true)
    expect(r.text).toBe('# one two three\n# four five six')
    const q = wrapText('> quoted text that\n>\n> more', { width: 12 })
    expect(q.text).toBe('> quoted\n> text that\n>\n> more')
  })

  it('does not treat #include or markdown-less lines as prefixed', () => {
    expect(detectPrefix(['#include <x>', '#define Y'])).toBe('')
    expect(detectPrefix(['// a', 'b'])).toBe('')
    expect(detectPrefix(['  * a', '  * b'])).toBe('  * ')
    expect(detectPrefix(['// a', '//', '// b'])).toBe('// ')
  })

  it('keeps fenced code blocks verbatim', () => {
    const src = 'text text text\n\n```\nconst veryLongLine = "this should not be wrapped at all"\n```'
    expect(wrapText(src, { width: 10 }).text).toBe('text text\ntext\n\n```\nconst veryLongLine = "this should not be wrapped at all"\n```')
  })

  it('reports overflowing unbreakable words or breaks them', () => {
    const url = 'https://example.com/a/very/long/path/that/does/not/fit'
    const kept = wrapText(`see ${url} now`, { width: 20 })
    expect(kept.overflowLines).toBe(1)
    expect(kept.text.split('\n')).toContain(url)
    const broken = wrapText(`see ${url} now`, { width: 20, breakLongWords: true })
    expect(broken.overflowLines).toBe(0)
    expect(broken.text.split('\n').every((l) => l.length <= 20)).toBe(true)
  })

  it('counts CJK as double width', () => {
    const r = wrapText('日本語 日本語 日本語', { width: 13 })
    expect(r.text).toBe('日本語 日本語\n日本語')
  })

  it('breaks between CJK characters (no spaces) with kinsoku punctuation rules', () => {
    const r = wrapText('日本語のテキストも正しく折り返されます。', { width: 10 })
    for (const l of r.text.split('\n')) expect(displayWidth(l)).toBeLessThanOrEqual(10)
    expect(r.text.replace(/\n/g, '')).toBe('日本語のテキストも正しく折り返されます。')
    expect(r.text.split('\n').some((l) => l.startsWith('。'))).toBe(false)
    expect(r.overflowLines).toBe(0)
  })

  it('tokenizes mixed Latin and CJK', () => {
    expect(tokenizeForWrap('Hello 世界。ok')).toEqual([
      { text: 'Hello', attach: false },
      { text: '世', attach: false },
      { text: '界。', attach: true },
      { text: 'ok', attach: true },
    ])
    expect(tokenizeForWrap('「引用」です')).toEqual([
      { text: '「引', attach: false },
      { text: '用」', attach: true },
      { text: 'で', attach: true },
      { text: 'す', attach: true },
    ])
  })

  it('preserves CRLF line endings and handles empty input', () => {
    expect(wrapText('a b c\r\n\r\nd', { width: 3 }).text).toBe('a b\r\nc\r\n\r\nd')
    expect(wrapText('', { width: 10 }).text).toBe('')
  })

  it('handles a width smaller than the prefix', () => {
    const r = wrapText('ab cd', { width: 2, prefix: '>>> ' })
    expect(r.text).toBe('>>> ab\n>>> cd')
  })

  it('wraps large input', () => {
    const big = (LOREM + '\n\n').repeat(5000)
    const t0 = performance.now()
    const r = wrapText(big, { width: 72 })
    expect(r.overflowLines).toBe(0)
    expect(performance.now() - t0).toBeLessThan(3000)
  })
})

describe('unwrapText', () => {
  it('joins wrapped lines into paragraphs and keeps blank lines', () => {
    const r = unwrapText('one two\nthree four\n\nfive\nsix')
    expect(r.text).toBe('one two three four\n\nfive six')
    expect(r.paragraphs).toBe(2)
    expect(r.joinedLines).toBe(2)
  })

  it('keeps list items intact', () => {
    expect(unwrapText('- first item\n  continues\n- second\n1. third\n   more').text).toBe('- first item continues\n- second\n1. third more')
    expect(unwrapText('- a\n- b', { keepListItems: false }).text).toBe('- a - b')
  })

  it('keeps a detected prefix', () => {
    expect(unwrapText('// one\n// two\n//\n// three').text).toBe('// one two\n//\n// three')
  })

  it('optionally joins hyphenated breaks', () => {
    expect(unwrapText('infor-\nmation').text).toBe('infor- mation')
    expect(unwrapText('infor-\nmation', { joinHyphenated: true }).text).toBe('information')
    expect(unwrapText('ABC-\nDEF', { joinHyphenated: true }).text).toBe('ABC- DEF')
  })

  it('round-trips with wrap', () => {
    const para = `${LOREM}\n\n${LOREM}`
    expect(unwrapText(wrapText(para, { width: 24 }).text).text).toBe(para)
    const crlf = wrapText(para.replace(/\n/g, '\r\n'), { width: 24 }).text
    expect(unwrapText(crlf).text).toBe(para.replace(/\n/g, '\r\n'))
  })

  it('joins CJK lines without inserting spaces', () => {
    const ja = '日本語のテキストも正しく折り返されます。'
    expect(unwrapText(wrapText(ja, { width: 10 }).text).text).toBe(ja)
  })

  it('keeps code fences verbatim', () => {
    expect(unwrapText('a\nb\n```\nx\ny\n```').text).toBe('a b\n```\nx\ny\n```')
  })
})

describe('helpers', () => {
  it('detects the dominant line ending', () => {
    expect(detectEol('a\r\nb\r\nc\nd')).toBe('\r\n')
    expect(detectEol('a\nb')).toBe('\n')
    expect(detectEol('a\rb\rc')).toBe('\r')
    expect(detectEol('')).toBe('\n')
  })

  it('computes line width stats', () => {
    expect(lineWidthStats('abc\n日本\n\tx', 3, 4)).toEqual({ longest: 5, over: 2, lines: 3 })
  })
})
