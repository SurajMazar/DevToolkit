import { describe, expect, it } from 'vitest'
import { tokenizeHtml, offsetToLineColumn } from './tokenizer'
import { DEFAULT_HTML_MINIFY, isConditionalComment, minifyHtml, type HtmlMinifyOptions } from './minify'
import { formatHtml } from './format'

const opts = (o: Partial<HtmlMinifyOptions> = {}): HtmlMinifyOptions => ({ ...DEFAULT_HTML_MINIFY, ...o })
const min = (s: string, o: Partial<HtmlMinifyOptions> = {}) => {
  const r = minifyHtml(s, opts(o))
  if (r.error) throw new Error(r.error.message)
  return r.output
}

describe('tokenizeHtml', () => {
  it('splits tags, text, comments and doctype with exact offsets', () => {
    const src = '<!DOCTYPE html><p class="a">Hi <b>there</b></p><!-- c -->'
    const { tokens, errors } = tokenizeHtml(src)
    expect(errors).toEqual([])
    expect(tokens.map((t) => t.type)).toEqual(['doctype', 'startTag', 'text', 'startTag', 'text', 'endTag', 'endTag', 'comment'])
    for (const t of tokens) expect(t.end).toBeGreaterThan(t.start)
    expect(tokens.map((t) => src.slice(t.start, t.end)).join('')).toBe(src)
  })
  it('parses quoted, unquoted and value-less attributes; quoted values may contain > and newlines', () => {
    const { tokens } = tokenizeHtml(`<input type=text value="a > b\n c" data-x='y' disabled>`)
    const t = tokens[0]
    expect(t.type).toBe('startTag')
    if (t.type !== 'startTag') return
    expect(t.attrs.map((a) => [a.name, a.value, a.quote])).toEqual([
      ['type', 'text', ''],
      ['value', 'a > b\n c', '"'],
      ['data-x', 'y', "'"],
      ['disabled', null, ''],
    ])
  })
  it('treats a < that cannot start a tag as text', () => {
    const { tokens } = tokenizeHtml('a < b and 1<2 </ x')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({ type: 'text', value: 'a < b and 1<2 </ x' })
  })
  it('consumes raw-text elements up to the matching end tag only', () => {
    const { tokens } = tokenizeHtml('<script>if (a < b) document.write("</div>")</script><style>a>b{}</style>')
    expect(tokens.map((t) => t.type)).toEqual(['startTag', 'rawText', 'endTag', 'startTag', 'rawText', 'endTag'])
    expect(tokens[1]).toMatchObject({ value: 'if (a < b) document.write("</div>")' })
  })
  it('reports unterminated comments, tags and raw-text elements with line/column', () => {
    expect(tokenizeHtml('<p>\n  <!-- never closed').errors[0]).toMatchObject({ line: 2, column: 3, message: expect.stringContaining('Unterminated comment') })
    expect(tokenizeHtml('<div class="x"').errors[0].message).toMatch(/Unterminated tag/)
    expect(tokenizeHtml('<div class="x>').errors[0].message).toMatch(/Unterminated attribute value/)
    expect(tokenizeHtml('<script>var a = 1').errors[0].message).toMatch(/Unclosed <script>/)
  })
  it('handles CDATA and processing instructions', () => {
    const { tokens } = tokenizeHtml('<?xml version="1.0"?><svg><![CDATA[a<b]]></svg>')
    expect(tokens.map((t) => t.type)).toEqual(['pi', 'startTag', 'cdata', 'endTag'])
  })
  it('converts offsets to 1-based line/column', () => {
    expect(offsetToLineColumn('ab\ncd', 4)).toEqual({ line: 2, column: 2 })
  })
})

describe('minifyHtml', () => {
  it('removes comments and whitespace between block tags', () => {
    expect(min('<div>\n  <!-- note -->\n  <p>Hello</p>\n</div>\n')).toBe('<div><p>Hello</p></div>')
  })
  it('keeps one space between inline elements and words', () => {
    expect(min('<p>\n  Hello   <b>bold</b>\n  <i>italic</i>  world\n</p>')).toBe('<p>Hello <b>bold</b> <i>italic</i> world</p>')
    expect(min('<span>a</span> <span>b</span>')).toBe('<span>a</span> <span>b</span>')
    expect(min('<a href="#">x</a>\n<a href="#">y</a>')).toBe('<a href="#">x</a> <a href="#">y</a>')
  })
  it('conservative mode never removes a whitespace run entirely', () => {
    expect(min('<div>\n  <p>x</p>\n</div>', { whitespace: 'conservative' })).toBe('<div> <p>x</p> </div>')
  })
  it('keep mode leaves text untouched', () => {
    expect(min('<div>\n  <p>x</p>\n</div>', { whitespace: 'keep' })).toBe('<div>\n  <p>x</p>\n</div>')
  })
  it('preserves <pre> (including nested markup) and <textarea> verbatim', () => {
    const pre = '<pre>\n  line 1\n    <b>indented</b>   x\n</pre>'
    expect(min(`<div>\n ${pre}\n</div>`)).toBe(`<div>${pre}</div>`)
    const ta = '<textarea name="t">  keep\n\n  this  </textarea>'
    expect(min(`<form>\n  ${ta}\n</form>`)).toBe(`<form>${ta}</form>`)
  })
  it('preserves <script> and <style> content verbatim by default', () => {
    const script = '<script>\n  const s = "a   b";  // <!-- not a comment\n  if (a<b) {}\n</script>'
    const style = '<style>\n  a  >  b { color: red }\n</style>'
    expect(min(`<body>\n${script}\n${style}\n</body>`)).toBe(`<body>${script} ${style}</body>`)
  })
  it('minifies <style> and style attributes when asked', () => {
    const r = minifyHtml('<style>\n  a { color: #ff0000; }\n</style><p style="color : red ; margin: 0px">x</p>', opts({ minifyCss: true }))
    expect(r.output).toBe('<style>a{color:red}</style><p style="color:red;margin:0">x</p>')
    expect(r.stats.stylesMinified).toBe(1)
  })
  it('leaves a <style> it cannot parse unchanged and warns', () => {
    const r = minifyHtml('<style>a { color: red;</style>', opts({ minifyCss: true }))
    expect(r.output).toBe('<style>a { color: red;</style>')
    expect(r.warnings[0]).toMatch(/could not be parsed/)
  })
  it('keeps attribute values intact, normalizes whitespace inside tags', () => {
    expect(min('<div   class="a  b"\n   title=\'x > y\'  data-v=raw   hidden  >z</div  >')).toBe(`<div class="a  b" title='x > y' data-v=raw hidden>z</div>`)
    expect(min('<img src=a.png />')).toBe('<img src=a.png />')
    expect(min('<br />')).toBe('<br/>')
    expect(min('<input value="" disabled/>')).toBe('<input value="" disabled/>')
  })
  it('keeps conditional comments and <!--! comments when configured', () => {
    const cond = '<!--[if lt IE 9]><script src="x.js"></script><![endif]-->'
    expect(min(`<head>${cond}<!--! build 42 --><!-- drop --></head>`)).toBe(`<head>${cond}<!--! build 42 --></head>`)
    expect(min(`<head>${cond}<!--! build 42 --></head>`, { keepConditionalComments: false, keepBangComments: false })).toBe('<head></head>')
    expect(min('<p><!-- c --></p>', { removeComments: false })).toBe('<p><!-- c --></p>')
    expect(isConditionalComment('<![endif]')).toBe(true)
    expect(isConditionalComment(' regular ')).toBe(false)
  })
  it('drops whitespace-only text inside <head>', () => {
    expect(min('<html>\n<head>\n  <meta charset="utf-8">\n  <script src="a.js"></script>\n  <script src="b.js"></script>\n</head>\n<body>\n  <p>x</p>\n</body>\n</html>')).toBe(
      '<html><head><meta charset="utf-8"><script src="a.js"></script><script src="b.js"></script></head><body><p>x</p></body></html>',
    )
  })
  it('keeps the doctype and non-breaking spaces', () => {
    expect(min('<!DOCTYPE html>\n<p>a&nbsp;  b</p>')).toBe('<!DOCTYPE html><p>a&nbsp;  b</p>')
  })
  it('merges text across removed comments', () => {
    expect(min('<p>a <!-- x --> b</p>')).toBe('<p>a b</p>')
    expect(min('<p>a<!-- x -->b</p>')).toBe('<p>ab</p>')
  })
  it('returns a located error for malformed markup instead of guessing', () => {
    const r = minifyHtml('<div>\n<p class="x>hi</p>')
    expect(r.output).toBe('')
    expect(r.error).toMatchObject({ line: 2 })
  })
  it('counts removed comments and whitespace', () => {
    const r = minifyHtml('<div>\n  <!-- a -->\n  <p>x</p>\n</div>')
    expect(r.stats.commentsRemoved).toBe(1)
    expect(r.stats.whitespaceRemoved).toBeGreaterThan(0)
  })
  it('handles empty input, unicode and large documents', () => {
    expect(min('')).toBe('')
    expect(min('<p>\n  café — 東京 👩‍💻\n</p>')).toBe('<p>café — 東京 👩‍💻</p>')
    const row = '<tr>\n  <td class="n">1</td>\n  <td>Some <em>text</em> here</td>\n</tr>\n'
    const big = `<table>\n${row.repeat(20_000)}</table>`
    const out = min(big)
    expect(out.startsWith('<table><tr><td class="n">1</td><td>Some <em>text</em> here</td></tr>')).toBe(true)
    expect(out.length).toBeLessThan(big.length)
  })
})

describe('formatHtml', () => {
  it('beautifies including embedded script and style', async () => {
    const r = await formatHtml('<div><script>var a=1</script><style>a{color:red}</style><p>hi</p></div>', {
      indent: 2,
      useTabs: false,
      printWidth: 80,
      whitespaceSensitivity: 'css',
      bracketSameLine: false,
    })
    expect(r.ok && r.output).toBe('<div>\n  <script>\n    var a = 1;\n  </script>\n  <style>\n    a {\n      color: red;\n    }\n  </style>\n  <p>hi</p>\n</div>\n')
  })
  it('reports errors with location', async () => {
    const r = await formatHtml('<div><p>hi</div', { indent: 2, useTabs: false, printWidth: 80, whitespaceSensitivity: 'css', bracketSameLine: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.line).toBe(1)
  })
})
