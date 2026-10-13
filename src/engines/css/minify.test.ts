import { describe, expect, it } from 'vitest'
import { checkCssStructure, cssoParseIssues, minifyCss, minifyDeclarations, safeMinifyCss, sizeStats } from './minify'
import { formatCss } from './format'

describe('checkCssStructure', () => {
  it('accepts balanced CSS with braces inside strings and comments', () => {
    expect(checkCssStructure('a::after { content: "}" } /* { */ b { c: d }')).toBeNull()
    expect(checkCssStructure('')).toBeNull()
  })
  it('reports an unclosed block at the opening brace', () => {
    expect(checkCssStructure('a { color: red;\n.b {\n  margin: 0;\n}')).toMatchObject({ line: 1, column: 3 })
  })
  it('reports an unmatched closing brace with its location', () => {
    expect(checkCssStructure('a { b: c }\n}')).toMatchObject({ line: 2, column: 1, message: expect.stringContaining('no matching') })
  })
  it('reports unterminated comments and strings', () => {
    expect(checkCssStructure('a { } /* oops')?.message).toMatch(/Unterminated comment/)
    expect(checkCssStructure('a { content: "x\n }')?.message).toMatch(/Unterminated string/)
  })
  it('reports mismatched bracket kinds', () => {
    expect(checkCssStructure('a { width: calc(1px + 2px; }')?.message).toMatch(/still open/)
  })
})

describe('minifyCss (csso)', () => {
  it('minifies and restructures', () => {
    const r = minifyCss('a { color: red; }\nb { color: red; }', { restructure: true, comments: 'none' })
    expect(r.engine).toBe('csso')
    expect(r.output).toBe('a,b{color:red}')
  })
  it('does not merge rules when restructure is off', () => {
    const r = minifyCss('a { color: red; }\nb { color: red; }', { restructure: false, comments: 'none' })
    expect(r.output).toBe('a{color:red}b{color:red}')
  })
  it('keeps license comments when asked', () => {
    const css = '/*! MIT */ a { color: #ff0000 } /* normal */ /*! second */ b{margin:0px}'
    expect(minifyCss(css, { restructure: false, comments: 'all' }).output).toContain('/*! MIT */')
    expect(minifyCss(css, { restructure: false, comments: 'all' }).output).toContain('/*! second */')
    const first = minifyCss(css, { restructure: false, comments: 'first' }).output
    expect(first).toContain('/*! MIT */')
    expect(first).not.toContain('second')
    expect(minifyCss(css, { restructure: false, comments: 'none' }).output).not.toContain('/*')
    expect(minifyCss(css, { restructure: false, comments: 'none' }).output).not.toContain('normal')
  })
  it('returns a located error for broken structure instead of output', () => {
    const r = minifyCss('a {\n  color: red;\n', { restructure: true, comments: 'none' })
    expect(r.output).toBe('')
    expect(r.error).toMatchObject({ line: 1, column: 3 })
  })
  it('falls back to the safe minifier for syntax csso cannot parse (nesting) — never drops rules', () => {
    const css = '.card {\n  color: red;\n  &:hover { color: blue; }\n  .title & { font-weight: 600; }\n}'
    expect(cssoParseIssues(css).length).toBeGreaterThan(0)
    const r = minifyCss(css, { restructure: true, comments: 'none' })
    expect(r.engine).toBe('safe')
    expect(r.fallback?.line).toBe(3)
    expect(r.output).toBe('.card{color:red;&:hover{color:blue}.title &{font-weight:600}}')
  })
  it('handles range media queries via the fallback without dropping them', () => {
    const r = minifyCss('@media (width >= 600px) {\n  a { b: c }\n}', { restructure: true, comments: 'none' })
    expect(r.output).toBe('@media (width>=600px){a{b:c}}')
  })
  it('handles empty input', () => {
    expect(minifyCss('', { restructure: true, comments: 'none' }).output).toBe('')
  })
})

describe('safeMinifyCss', () => {
  it('keeps significant whitespace (descendant combinators, calc operators, media "and (")', () => {
    expect(safeMinifyCss('a :hover , b  > c ~ d { x: y }')).toBe('a :hover,b>c~d{x:y}')
    expect(safeMinifyCss('a { width: calc( 100% - 2 * var(--gap) ) ; }')).toBe('a{width:calc(100% - 2 * var(--gap))}')
    expect(safeMinifyCss('@media screen and (min-width: 600px) { a { b: c } }')).toBe('@media screen and (min-width:600px){a{b:c}}')
    expect(safeMinifyCss('a { margin: 0 auto  !important; }')).toBe('a{margin:0 auto!important}')
  })
  it('keeps strings, escapes and url() verbatim', () => {
    expect(safeMinifyCss('a::before { content: "  a   b  ; } " }')).toBe('a::before{content:"  a   b  ; } "}')
    expect(safeMinifyCss('.\\31 0 { b: c }')).toBe('.\\31 0{b:c}')
    expect(safeMinifyCss('a { background: url( img/a b.png ) }')).toBe('a{background:url(img/a b.png)}')
  })
  it('removes comments without gluing tokens together', () => {
    expect(safeMinifyCss('a/* x */b { c: d }')).toBe('a b{c:d}')
    expect(safeMinifyCss('/* head */\na { /* in */ c: d; }')).toBe('a{c:d}')
  })
  it('keeps license comments', () => {
    expect(safeMinifyCss('/*! keep */\na { c: d }', 'all')).toBe('/*! keep */a{c:d}')
    expect(safeMinifyCss('/*! keep */\na { c: d }', 'none')).toBe('a{c:d}')
  })
  it('preserves an empty custom property value', () => {
    expect(safeMinifyCss('a { --empty: ; }')).toBe('a{--empty: }')
  })
  it('handles unicode and a large input linearly', () => {
    expect(safeMinifyCss('.é::after { content: "→ 東京" }')).toBe('.é::after{content:"→ 東京"}')
    const big = '.item-1 { color: red; margin: 0 auto; }\n'.repeat(20_000)
    const out = safeMinifyCss(big)
    expect(out.length).toBeLessThanOrEqual(big.length * 0.8)
    expect(out.startsWith('.item-1{color:red;margin:0 auto}.item-1')).toBe(true)
  })
})

describe('minifyDeclarations', () => {
  it('minifies style attribute declarations', () => {
    expect(minifyDeclarations(' color : #ff0000 ; margin: 0px 0px ')).toBe('color:red;margin:0 0')
  })
  it('returns the input unchanged when it cannot be parsed', () => {
    expect(minifyDeclarations('color: red; }')).toBe('color: red; }')
    expect(minifyDeclarations('')).toBe('')
  })
})

describe('sizeStats', () => {
  it('measures UTF-8 bytes', () => {
    expect(sizeStats('aé', 'a')).toEqual({ before: 3, after: 1, saved: 2, percent: (2 / 3) * 100 })
    expect(sizeStats('', '').percent).toBe(0)
  })
})

describe('formatCss', () => {
  it('beautifies with indentation options', async () => {
    const r = await formatCss('a{color:red;margin:0}', { indent: 4, useTabs: false, printWidth: 80 })
    expect(r).toEqual({ ok: true, output: 'a {\n    color: red;\n    margin: 0;\n}\n' })
    const t = await formatCss('a{color:red}', { indent: 2, useTabs: true, printWidth: 80 })
    expect(t.ok && t.output).toBe('a {\n\tcolor: red;\n}\n')
  })
  it('reports syntax errors with line and column', async () => {
    const r = await formatCss('a { color: red; }\nb { color: ', { indent: 2, useTabs: false, printWidth: 80 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.message).toMatch(/Unclosed block/)
      expect(r.error.line).toBe(2)
      expect(r.error.column).toBeGreaterThan(0)
    }
  })
  it('formats modern CSS (nesting)', async () => {
    const r = await formatCss('.a{color:red;&:hover{color:blue}}', { indent: 2, useTabs: false, printWidth: 80 })
    expect(r.ok && r.output).toBe('.a {\n  color: red;\n  &:hover {\n    color: blue;\n  }\n}\n')
  })
})
