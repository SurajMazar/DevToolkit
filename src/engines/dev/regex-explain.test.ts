import { describe, expect, it } from 'vitest'
import { countCaptureGroups, describeQuantifier, explainRegex, flattenExplain, parseRegexLiteral, type ExplainNode } from './regex-explain'

const kinds = (nodes: ExplainNode[]) => nodes.map((n) => n.kind)
const labels = (pattern: string, flags = '') => flattenExplain(explainRegex(pattern, flags).nodes).map((r) => r.node.label)

describe('explainRegex', () => {
  it('merges literal runs and splits off quantified chars', () => {
    const r = explainRegex('abc+')
    expect(kinds(r.nodes)).toEqual(['literal', 'literal'])
    expect(r.nodes[0].text).toBe('ab')
    expect(r.nodes[1].text).toBe('c+')
    expect(r.nodes[1].quantifier).toMatchObject({ min: 1, max: Infinity, lazy: false })
  })

  it('explains character class escapes', () => {
    const r = explainRegex('\\d\\w\\s\\D\\W\\S')
    expect(r.nodes.map((n) => n.text)).toEqual(['\\d', '\\w', '\\s', '\\D', '\\W', '\\S'])
    expect(r.nodes.every((n) => n.kind === 'escape')).toBe(true)
    expect(r.nodes[0].description).toMatch(/0–9/)
  })

  it('explains word boundaries and anchors with flag awareness', () => {
    const r = explainRegex('^\\bword\\B$')
    expect(kinds(r.nodes)).toEqual(['anchor', 'boundary', 'literal', 'boundary', 'anchor'])
    expect(r.nodes[0].label).toBe('Start of input')
    expect(explainRegex('^x$', 'm').nodes[0].label).toBe('Start of line')
    expect(explainRegex('^x$', 'm').nodes[2].label).toBe('End of line')
  })

  it('handles quantifiers: lazy, ranges and possessive-like syntax', () => {
    const r = explainRegex('a*?b{2}c{2,}d{2,5}?e??')
    const q = r.nodes.map((n) => n.quantifier)
    expect(q[0]).toMatchObject({ min: 0, max: Infinity, lazy: true })
    expect(q[1]).toMatchObject({ min: 2, max: 2 })
    expect(q[2]).toMatchObject({ min: 2, max: Infinity })
    expect(q[3]).toMatchObject({ min: 2, max: 5, lazy: true })
    expect(q[4]).toMatchObject({ min: 0, max: 1, lazy: true })
    expect(explainRegex('a++').nodes[0].quantifier).toMatchObject({ possessive: true })
    expect(explainRegex('a++').nodes[0].quantifier!.description).toMatch(/not supported in JavaScript/)
  })

  it('describes quantifier text', () => {
    expect(describeQuantifier(0, Infinity, false)).toMatch(/zero or more.*greedy/)
    expect(describeQuantifier(1, Infinity, true)).toMatch(/one or more.*lazy/)
    expect(describeQuantifier(3, 3, false)).toBe('Repeats exactly 3 times.')
  })

  it('explains groups: capturing, named, non-capturing and lookarounds', () => {
    const r = explainRegex('(a)(?<year>\\d{4})(?:x)(?=y)(?!z)(?<=w)(?<!v)')
    expect(r.nodes.map((n) => n.label)).toEqual([
      'Capturing group #1',
      'Named group “year” (#2)',
      'Non-capturing group',
      'Positive lookahead',
      'Negative lookahead',
      'Positive lookbehind',
      'Negative lookbehind',
    ])
    expect(r.nodes[1].groupName).toBe('year')
    expect(r.nodes[1].children![0].quantifier).toMatchObject({ min: 4, max: 4 })
    expect(r.groupCount).toBe(2)
    expect(r.groupNames).toEqual(['year'])
  })

  it('explains backreferences by number and name', () => {
    const r = explainRegex('(?<q>["\'])(\\w+)\\k<q>\\2')
    expect(r.nodes[2]).toMatchObject({ kind: 'backreference', text: '\\k<q>' })
    expect(r.nodes[3]).toMatchObject({ kind: 'backreference', groupIndex: 2 })
  })

  it('treats \\N without a matching group as octal / error depending on mode', () => {
    expect(explainRegex('\\1').nodes[0].label).toMatch(/Octal/)
    expect(explainRegex('\\1', 'u').nodes[0].kind).toBe('error')
    // \10 with 10 groups is a backreference; with one group it is \1 followed by "0".
    const r = explainRegex('(a)\\10')
    expect(r.nodes[1]).toMatchObject({ kind: 'backreference', text: '\\1' })
    expect(r.nodes[2].text).toBe('0')
  })

  it('explains alternation with options', () => {
    const r = explainRegex('cat|dog|')
    expect(r.nodes[0].kind).toBe('alternation')
    expect(r.nodes[0].children).toHaveLength(3)
    expect(r.nodes[0].children![2].description).toMatch(/Empty alternative/)
    const nested = explainRegex('(a|b)+')
    expect(nested.nodes[0].children![0].kind).toBe('alternation')
  })

  it('explains character classes, ranges and negation', () => {
    const r = explainRegex('[^a-z0-9_\\-]')
    const cls = r.nodes[0]
    expect(cls.kind).toBe('charClass')
    expect(cls.label).toBe('Negated character class')
    expect(cls.children!.map((c) => c.label)).toEqual(['Range a–z', 'Range 0–9', '“_”', '\\- · “-”'])
    expect(explainRegex('[z-a]').nodes[0].children![0].description).toMatch(/Invalid range/)
    expect(explainRegex('[\\b]').nodes[0].children![0].label).toMatch(/Backspace/)
    expect(explainRegex('[a-]').nodes[0].children!.map((c) => c.text)).toEqual(['a', '-'])
  })

  it('explains unicode property escapes only in unicode mode', () => {
    const r = explainRegex('\\p{L}\\P{Lu}\\p{Script=Greek}', 'u')
    expect(kinds(r.nodes)).toEqual(['unicodeProperty', 'unicodeProperty', 'unicodeProperty'])
    expect(r.nodes[0].description).toMatch(/any letter/)
    expect(r.nodes[1].description).toMatch(/not an uppercase letter/)
    expect(r.nodes[2].description).toMatch(/Greek script/)
    // Without u, \p is just "p".
    expect(explainRegex('\\p{L}').nodes[0].kind).toBe('escape')
  })

  it('supports v-flag set operations and nested classes', () => {
    const r = explainRegex('[\\p{L}--[a-z]]', 'v')
    const items = r.nodes[0].children!
    expect(items.map((i) => i.kind)).toEqual(['unicodeProperty', 'classItem', 'charClass'])
    expect(items[1].label).toBe('Subtraction')
  })

  it('explains hex, unicode and control escapes', () => {
    const r = explainRegex('\\x41\\u00e9\\u{1F600}\\cJ\\t\\n\\0', 'u')
    expect(r.nodes.map((n) => n.text)).toEqual(['\\x41', '\\u00e9', '\\u{1F600}', '\\cJ', '\\t', '\\n', '\\0'])
    expect(r.nodes[0].label).toContain('“A”')
    expect(r.nodes[3].label).toContain('Control-J')
  })

  it('reports dot semantics according to the s flag', () => {
    expect(explainRegex('.').nodes[0].description).toMatch(/except line terminators/)
    expect(explainRegex('.', 's').nodes[0].description).toMatch(/including line breaks/)
  })

  it('explains modifier groups', () => {
    const r = explainRegex('(?i:abc)(?-m:^)')
    expect(r.nodes[0].label).toContain('Modifier group')
    expect(r.nodes[0].description).toMatch(/enables ignoreCase/)
  })

  it('degrades malformed patterns to error nodes', () => {
    expect(explainRegex('(abc').nodes[0].kind).toBe('error')
    expect(explainRegex('[abc').nodes[0].kind).toBe('error')
    expect(explainRegex('abc)').nodes.some((n) => n.kind === 'error')).toBe(true)
    expect(explainRegex('*a').nodes[0].kind).toBe('error')
    expect(explainRegex('a\\').nodes.at(-1)!.kind).toBe('error')
  })

  it('flags nested quantifiers as a backtracking risk', () => {
    expect(explainRegex('(a+)+$').warnings).toHaveLength(1)
    expect(explainRegex('(\\w*)*').warnings).toHaveLength(1)
    expect(explainRegex('(ab)+c+').warnings).toHaveLength(0)
  })

  it('recognises the atomic-group emulation idiom', () => {
    const r = explainRegex('(?=(\\d+))\\1x')
    expect(r.nodes[0].note).toMatch(/atomic group/)
  })

  it('lists flags with descriptions, including unknown ones', () => {
    const r = explainRegex('a', 'gimsuydq')
    expect(r.flags.map((f) => f.name)).toEqual(['global', 'ignoreCase', 'multiline', 'dotAll', 'unicode', 'sticky', 'hasIndices', 'unknown'])
  })

  it('handles empty patterns and astral literals', () => {
    expect(explainRegex('').nodes).toEqual([])
    const r = explainRegex('😀+', 'u')
    expect(r.nodes[0]).toMatchObject({ text: '😀+', quantifier: { min: 1 } })
  })

  it('records accurate source offsets', () => {
    const p = '(?<y>\\d{4})-(\\d{2})'
    for (const row of flattenExplain(explainRegex(p).nodes)) expect(p.slice(row.node.start, row.node.end)).toBe(row.node.text)
  })

  it('flattens with depth', () => {
    expect(labels('(a|b)').length).toBeGreaterThan(3)
    const flat = flattenExplain(explainRegex('(a(b))').nodes)
    expect(flat.map((r) => r.depth)).toEqual([0, 1, 1, 2])
  })

  it('handles a large pattern quickly', () => {
    const big = Array.from({ length: 2000 }, (_, i) => `(?:item${i}|\\d{${i % 9}})`).join('|')
    const t = performance.now()
    const r = explainRegex(big)
    expect(performance.now() - t).toBeLessThan(8000)
    expect(r.nodes[0].children).toHaveLength(2000)
  })
})

describe('helpers', () => {
  it('counts capture groups ignoring classes and escapes', () => {
    expect(countCaptureGroups('(a)\\((?:b)[(](?<n>c)(?<=d)')).toEqual({ count: 2, names: ['n'] })
  })
  it('parses /pattern/flags literals', () => {
    expect(parseRegexLiteral('/a\\/b[/]/gi')).toEqual({ pattern: 'a\\/b[/]', flags: 'gi' })
    expect(parseRegexLiteral('abc')).toBeNull()
    expect(parseRegexLiteral('/abc/x')).toBeNull()
  })
})
