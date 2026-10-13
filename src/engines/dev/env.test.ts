import { describe, expect, it } from 'vitest'
import { compareEnv, exportEnv, isSensitive, maskValue, parseEnv, quoteEnvValue, SAMPLE_ENV, SAMPLE_ENV_B, selectEntries, shellQuote, toDotenv } from './env'

const codes = (text: string) => parseEnv(text).issues.map((i) => i.code)

describe('parseEnv basics', () => {
  it('parses simple pairs, comments and blank lines', () => {
    const r = parseEnv('# comment\nA=1\n\nB = two\n')
    expect(r.entries.map((e) => [e.key, e.value, e.line])).toEqual([
      ['A', '1', 2],
      ['B', 'two', 4],
    ])
    expect(r.entries[0].comments).toEqual(['# comment'])
  })

  it('separates a header comment block from the first entry', () => {
    const r = parseEnv('# Header\n# more\n\n# about A\nA=1')
    expect(r.header).toEqual(['# Header', '# more'])
    expect(r.entries[0].comments).toEqual(['# about A'])
  })

  it('supports the export prefix', () => {
    const r = parseEnv('export TOKEN=abc\nexport  B="x y"')
    expect(r.entries.map((e) => [e.key, e.value, e.exported])).toEqual([
      ['TOKEN', 'abc', true],
      ['B', 'x y', true],
    ])
  })

  it('handles single, double and backtick quotes', () => {
    const r = parseEnv(`S='a $B \\n literal'\nD="tab\\tnew\\nquote\\" dollar\\$"\nT=\`back tick\``)
    expect(r.entries[0]).toMatchObject({ value: 'a $B \\n literal', quote: 'single', references: [] })
    expect(r.entries[1]).toMatchObject({ value: 'tab\tnew\nquote" dollar$', quote: 'double' })
    expect(r.entries[2]).toMatchObject({ value: 'back tick', quote: 'backtick' })
  })

  it('handles multiline quoted values', () => {
    const r = parseEnv('KEY="line1\nline2\nline3"\nNEXT=1')
    expect(r.entries[0]).toMatchObject({ value: 'line1\nline2\nline3', line: 1, endLine: 3 })
    expect(r.entries[1]).toMatchObject({ key: 'NEXT', line: 4 })
    const s = parseEnv("PEM='-----BEGIN-----\nabc\n-----END-----'")
    expect(s.entries[0].value).toBe('-----BEGIN-----\nabc\n-----END-----')
  })

  it('strips inline comments only after whitespace in unquoted values', () => {
    const r = parseEnv('A=value # note\nB=pass#word\nC="quoted # kept" # comment\nD=#')
    expect(r.entries.map((e) => e.value)).toEqual(['value', 'pass#word', 'quoted # kept', ''])
    expect(r.entries[0].inlineComment).toBe('note')
    expect(r.entries[2].inlineComment).toBe('comment')
  })

  it('detects interpolation references', () => {
    const r = parseEnv('HOST=x\nURL=http://${HOST}:${PORT:-80}/$PATH_PART\nQ="${HOST} \\${NOT}"\nS=\'${HOST}\'')
    expect(r.entries[1].references).toEqual(['HOST', 'PORT', 'PATH_PART'])
    expect(r.entries[2].references).toEqual(['HOST'])
    expect(r.entries[3].references).toEqual([])
    expect(r.issues.filter((i) => i.code === 'undefined-reference').map((i) => i.message)).toEqual([expect.stringContaining('PORT'), expect.stringContaining('PATH_PART')])
  })

  it('handles CRLF, BOM, unicode and empty input', () => {
    expect(parseEnv('\uFEFFA=1\r\nB=café ☕\r\n').entries.map((e) => e.value)).toEqual(['1', 'café ☕'])
    expect(parseEnv('').entries).toEqual([])
  })
})

describe('validation', () => {
  it('reports invalid and non-portable keys', () => {
    expect(codes('1A=x')).toContain('invalid-key')
    expect(codes('=x')).toContain('invalid-key')
    expect(codes('my.key=x')).toContain('non-portable-key')
    expect(codes('MY KEY=x')).toContain('invalid-key')
  })

  it('reports duplicates and documents which wins', () => {
    const r = parseEnv('A=1\nB=2\nA=3')
    expect(r.values.get('A')).toBe('3')
    const dup = r.issues.find((i) => i.code === 'duplicate')!
    expect(dup.line).toBe(1)
    expect(dup.message).toMatch(/line 3\) wins/)
  })

  it('reports missing equals, unbalanced quotes and trailing content', () => {
    const r = parseEnv('JUSTAKEY\nQ="never closed')
    expect(r.issues.map((i) => [i.line, i.code])).toEqual([
      [1, 'missing-equals'],
      [2, 'unbalanced-quote'],
    ])
    expect(parseEnv('R="ok" trailing').issues.map((i) => i.code)).toEqual(['trailing-content'])
    expect(parseEnv('R="ok" trailing').entries[0].value).toBe('ok')
    // A quote that "closes" on a later line followed by junk is almost certainly a missing quote.
    expect(parseEnv('Q="open\nR="ok" x').issues.map((i) => [i.line, i.code])).toEqual([[1, 'unbalanced-quote']])
  })

  it('reports unquoted spaces, trailing whitespace, empty values and spaces before =', () => {
    expect(codes('A=hello world')).toContain('unquoted-spaces')
    expect(codes('A=value   ')).toContain('trailing-whitespace')
    expect(codes('A=')).toContain('empty-value')
    expect(codes('A =1')).toContain('spaces-around-equals')
    expect(codes('A=""')).not.toContain('empty-value')
  })

  it('parses the sample with expected issues', () => {
    const r = parseEnv(SAMPLE_ENV)
    const c = r.issues.map((i) => i.code)
    expect(c).toEqual(expect.arrayContaining(['duplicate', 'invalid-key', 'empty-value', 'unquoted-spaces']))
    expect(r.entries.find((e) => e.key === 'JWT_PRIVATE_KEY')!.value.split('\n')).toHaveLength(3)
    expect(r.entries.find((e) => e.key === 'API_BASE')!.value).toBe('${APP_URL}/api')
  })

  it('parses a large file quickly', () => {
    const text = Array.from({ length: 50_000 }, (_, i) => `KEY_${i}="value ${i}" # c`).join('\n')
    const t = performance.now()
    expect(parseEnv(text).entries).toHaveLength(50_000)
    expect(performance.now() - t).toBeLessThan(8000)
  })
})

describe('sensitivity', () => {
  it('detects sensitive keys and values', () => {
    for (const k of ['API_KEY', 'SECRET', 'DB_PASSWORD', 'GITHUB_TOKEN', 'SENTRY_DSN', 'AUTH_HEADER', 'PRIVATE_KEY', 'AWS_SECRET_ACCESS_KEY', 'SMTP_PASS', 'DATABASE_URL']) expect(isSensitive(k), k).toBe(true)
    for (const k of ['PORT', 'NODE_ENV', 'LOG_LEVEL', 'KEYBOARD_LAYOUT', 'MONKEY_COUNT']) expect(isSensitive(k), k).toBe(false)
    expect(isSensitive('UPSTREAM', 'https://user:pw@host/x')).toBe(true)
    expect(isSensitive('X', 'Server=db;Password=hunter2')).toBe(true)
  })
  it('masks with a fixed length', () => {
    expect(maskValue('a')).toBe(maskValue('a very long secret value'))
    expect(maskValue('')).toBe('')
  })
})

describe('normalise, sort, dedupe', () => {
  const text = '# header\n\n# about Z\nZ=1\nA=two words\n# about M\nM=3\nA=final'
  it('sorts keys keeping attached comments', () => {
    const out = toDotenv(parseEnv(text), { sort: true })
    expect(out).toBe('# header\n\nA="two words"\nA=final\n\n# about M\nM=3\n\n# about Z\nZ=1\n')
  })
  it('dedupes keeping the winning (last) definition', () => {
    expect(selectEntries(parseEnv(text), { dedupe: true }).map((e) => `${e.key}=${e.value}`)).toEqual(['Z=1', 'M=3', 'A=final'])
  })
  it('round-trips values through normalised output', () => {
    const p = parseEnv(SAMPLE_ENV)
    const again = parseEnv(toDotenv(p, { dedupe: true }))
    for (const [k, v] of p.values) expect(again.values.get(k), k).toBe(v)
  })
  it('quotes values only when needed', () => {
    expect(quoteEnvValue('simple')).toBe('simple')
    expect(quoteEnvValue('has space')).toBe('"has space"')
    expect(quoteEnvValue('a"b$c\nd')).toBe('"a\\"b\\$c\\nd"')
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
  })
})

describe('export', () => {
  const p = parseEnv('B=2\nA="x y"\nA=last\nT=it\'s')
  it('exports JSON with last-wins semantics', () => {
    expect(JSON.parse(exportEnv(p, 'json'))).toEqual({ B: '2', A: 'last', T: "it's" })
  })
  it('exports YAML, shell, docker and kubernetes', () => {
    expect(exportEnv(p, 'yaml', { sort: true })).toBe('A: "last"\nB: "2"\nT: "it\'s"\n')
    expect(exportEnv(p, 'shell')).toBe("export B=2\nexport A=last\nexport T='it'\\''s'\n")
    expect(exportEnv(p, 'docker')).toBe("docker run \\\n  -e B=2 \\\n  -e A=last \\\n  -e 'T=it'\\''s' \\\n  IMAGE\n")
    expect(exportEnv(p, 'k8s')).toBe('env:\n  - name: B\n    value: "2"\n  - name: A\n    value: "last"\n  - name: T\n    value: "it\'s"\n')
  })
  it('applies a masking transform', () => {
    expect(exportEnv(parseEnv('SECRET=abc'), 'json', { transform: (_k, v) => maskValue(v) })).toContain('••••••••')
  })
})

describe('compareEnv', () => {
  it('finds missing, different and identical keys', () => {
    const r = compareEnv(parseEnv(SAMPLE_ENV), parseEnv(SAMPLE_ENV_B))
    const by = Object.fromEntries(r.rows.map((x) => [x.key, x.status]))
    expect(by).toMatchObject({ NODE_ENV: 'different', PORT: 'same', REDIS_URL: 'only-b', GREETING: 'only-a', LOG_LEVEL: 'same', SENTRY_DSN: 'same' })
    expect(r.counts['only-b']).toBe(1)
    expect(r.counts.same + r.counts.different + r.counts['only-a'] + r.counts['only-b']).toBe(r.rows.length)
  })
})
