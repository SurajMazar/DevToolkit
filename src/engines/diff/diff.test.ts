import { describe, expect, it } from 'vitest'
import { applyOps, diffSequences, longestIncreasing, OpType } from './myers'
import { diffText, splitLines, toUnifiedPatch, RowKind } from './text-diff'
import { inlineDiff } from './inline'

function rnd(seed: number) {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32)
}

describe('myers diffSequences', () => {
  it('produces valid edit scripts on random sequences', () => {
    const r = rnd(42)
    for (let t = 0; t < 300; t++) {
      const a = Array.from({ length: Math.floor(r() * 40) }, () => Math.floor(r() * 6))
      const b = Array.from({ length: Math.floor(r() * 40) }, () => Math.floor(r() * 6))
      const { ops } = diffSequences(a, b)
      expect(applyOps(a, b, ops)).toEqual(b)
      // Equal ops really are equal.
      for (const op of ops) if (op.type === OpType.Equal) for (let i = 0; i < op.len; i++) expect(a[op.aStart + i]).toBe(b[op.bStart + i])
    }
  })
  it('finds a minimal diff for a simple case', () => {
    const { ops } = diffSequences([1, 2, 3, 4], [1, 3, 4, 5])
    const del = ops.filter((o) => o.type === OpType.Delete).reduce((n, o) => n + o.len, 0)
    const ins = ops.filter((o) => o.type === OpType.Insert).reduce((n, o) => n + o.len, 0)
    expect(del + ins).toBe(2)
  })
  it('anchored mode stays valid', () => {
    const r = rnd(7)
    const a = Array.from({ length: 6000 }, (_, i) => (r() < 0.1 ? 100000 + i : i))
    const b = a.map((v, i) => (r() < 0.05 ? 200000 + i : v)).filter(() => r() > 0.02)
    const { ops } = diffSequences(a, b, { anchorThreshold: 100 })
    expect(applyOps(a, b, ops)).toEqual(b)
  })
  it('falls back to a valid approximate diff on timeout', () => {
    const r = rnd(9)
    const a = Array.from({ length: 30000 }, () => Math.floor(r() * 1000))
    const b = Array.from({ length: 30000 }, () => Math.floor(r() * 1000))
    const res = diffSequences(a, b, { deadline: performance.now() + 5, anchorThreshold: Infinity })
    expect(applyOps(a, b, res.ops)).toEqual(b)
    expect(res.approximate).toBe(true)
  })
  it('LIS', () => expect(longestIncreasing([3, 1, 2, 5, 4, 6]).map((i) => [3, 1, 2, 5, 4, 6][i])).toEqual([1, 2, 4, 6]))
})

describe('diffText', () => {
  it('splits lines like editors', () => {
    expect(splitLines('')).toEqual([])
    expect(splitLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('a\r\nb\rc')).toEqual(['a', 'b', 'c'])
    expect(splitLines('a\n\n')).toEqual(['a', ''])
  })
  it('reports identical input', () => {
    const r = diffText('a\nb', 'a\nb')
    expect(r.identical).toBe(true)
    expect(r.stats.unchanged).toBe(2)
  })
  it('pairs modified lines and counts stats', () => {
    const r = diffText('one\ntwo\nthree\nfour', 'one\nTWO!\nthree\nfour\nfive')
    expect(r.stats).toMatchObject({ added: 2, removed: 1, modified: 1, unchanged: 3 })
    expect(Array.from(r.kinds)).toEqual([RowKind.Equal, RowKind.Modified, RowKind.Equal, RowKind.Equal, RowKind.Added])
    expect(r.hunks).toHaveLength(2)
  })
  it('ignores whitespace and case when asked', () => {
    expect(diffText('a  b \nC', 'a b\nc', { whitespace: 'collapse', ignoreCase: true }).identical).toBe(true)
    expect(diffText('a  b', 'ab', { whitespace: 'all' }).identical).toBe(true)
    expect(diffText('x   ', 'x', { whitespace: 'trailing' }).identical).toBe(true)
    expect(diffText('  x', 'x', { whitespace: 'trailing' }).identical).toBe(false)
  })
  it('ignores blank lines', () => {
    const r = diffText('a\n\nb\nc', 'a\nb\n\n\nc\nd', { ignoreBlankLines: true })
    expect(r.stats.added).toBe(1)
    expect(r.stats.removed).toBe(0)
    expect(Array.from(r.kinds).filter((k) => k === RowKind.IgnoredA || k === RowKind.IgnoredB).length).toBe(3)
  })
  it('builds unified rows with partners', () => {
    const r = diffText('a\nb\nc', 'a\nx\nc')
    expect(Array.from(r.uKinds)).toEqual([RowKind.Equal, RowKind.Removed, RowKind.Added, RowKind.Equal])
    expect(r.uPartner[1]).toBe(2)
    expect(r.uPartner[2]).toBe(1)
  })
  it('produces a git-compatible unified patch', () => {
    const A = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10'
    const B = 'l1\nl2\nl3\nCHANGED\nl5\nl6\nl7\nl8\nl9\nl10\nl11'
    const r = diffText(A, B)
    const patch = toUnifiedPatch(splitLines(A), splitLines(B), r, { context: 2 })
    expect(patch).toBe(['--- original', '+++ modified', '@@ -2,5 +2,5 @@', ' l2', ' l3', '-l4', '+CHANGED', ' l5', ' l6', '@@ -9,2 +9,3 @@', ' l9', ' l10', '+l11', ''].join('\n'))
  })
  it('patch handles insertion into empty file', () => {
    const r = diffText('', 'a\nb')
    expect(toUnifiedPatch([], ['a', 'b'], r)).toBe('--- original\n+++ modified\n@@ -0,0 +1,2 @@\n+a\n+b\n')
  })
  it('handles 100k lines with scattered edits quickly', () => {
    const a = Array.from({ length: 100_000 }, (_, i) => `line ${i} some content here`)
    const b = a.slice()
    for (let i = 0; i < 100_000; i += 997) b[i] = b[i] + ' edited'
    b.splice(50_000, 0, 'inserted line')
    const t = performance.now()
    const r = diffText(a.join('\n'), b.join('\n'))
    const ms = performance.now() - t
    expect(r.stats.modified).toBe(101)
    expect(r.stats.added).toBe(102)
    expect(r.approximate).toBe(false)
    expect(ms).toBeLessThan(3000)
  })
})

describe('inlineDiff', () => {
  it('finds changed words', () => {
    const d = inlineDiff('the quick brown fox', 'the slow brown fox', 'word')!
    expect(d.a).toEqual([{ start: 4, end: 9 }])
    expect(d.b).toEqual([{ start: 4, end: 8 }])
  })
  it('finds changed characters', () => {
    const d = inlineDiff('color', 'colour', 'char')!
    expect(d.a).toEqual([])
    expect(d.b).toEqual([{ start: 4, end: 5 }])
  })
  it('handles astral characters in char mode', () => {
    const d = inlineDiff('a😀b', 'a😁b', 'char')!
    expect(d.a).toEqual([{ start: 1, end: 3 }])
  })
  it('respects ignoreCase', () => expect(inlineDiff('Hello World', 'hello world', 'word', { ignoreCase: true })!.a).toEqual([]))
})
