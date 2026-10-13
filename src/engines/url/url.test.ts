import { describe, expect, it } from 'vitest'
import { applyUrlPart, decodeQueryComponent, encodeQueryComponent, parseQuery, parseUrl, safeDecode, serializeQuery, withQuery, type QueryParam } from './parse'
import { hostnameToUnicode, punycodeDecode, punycodeEncode } from './punycode'

const ok = (input: string, base?: string) => {
  const r = parseUrl(input, base)
  if (!r.ok) throw new Error(r.error)
  return r.url
}

describe('parseUrl', () => {
  it('breaks a URL into all parts', () => {
    const u = ok('https://user:p%40ss@api.example.com:8443/v1/users/caf%C3%A9?q=hello+world&tag=a&tag=b#section-2')
    expect(u.protocol).toBe('https:')
    expect(u.username).toBe('user')
    expect(u.password).toBe('p@ss')
    expect(u.hostname).toBe('api.example.com')
    expect(u.port).toBe('8443')
    expect(u.defaultPort).toBe(443)
    expect(u.origin).toBe('https://api.example.com:8443')
    expect(u.pathname).toBe('/v1/users/caf%C3%A9')
    expect(u.segments).toEqual(['v1', 'users', 'café'])
    expect(u.params).toEqual([
      { key: 'q', value: 'hello world' },
      { key: 'tag', value: 'a' },
      { key: 'tag', value: 'b' },
    ])
    expect(u.hash).toBe('#section-2')
    expect(u.isSpecial).toBe(true)
  })
  it('notes an explicit default port that the URL API drops', () => {
    const u = ok('https://example.com:443/')
    expect(u.port).toBe('')
    expect(u.droppedDefaultPort).toBe(true)
    expect(ok('https://example.com/').droppedDefaultPort).toBe(false)
  })
  it('decodes IDN hostnames for display', () => {
    const u = ok('https://münchen.de/straße')
    expect(u.hostname).toBe('xn--mnchen-3ya.de')
    expect(u.hostnameUnicode).toBe('münchen.de')
  })
  it('resolves relative URLs against a base', () => {
    expect(ok('../img/a.png?x=1', 'https://example.com/docs/guide/page.html').href).toBe('https://example.com/docs/img/a.png?x=1')
    expect(ok('//cdn.example.com/x.js', 'https://example.com/').href).toBe('https://cdn.example.com/x.js')
  })
  it('handles non-special schemes', () => {
    const u = ok('mailto:someone@example.com?subject=Hi%20there')
    expect(u.isSpecial).toBe(false)
    expect(u.pathname).toBe('someone@example.com')
    expect(u.params).toEqual([{ key: 'subject', value: 'Hi there' }])
    expect(u.defaultPort).toBeNull()
  })
  it('explains invalid input', () => {
    expect(parseUrl('')).toEqual({ ok: false, error: 'Enter a URL' })
    expect(parseUrl('example.com/path')).toEqual({ ok: false, error: 'Missing scheme — did you mean “https://example.com/path”?' })
    expect(parseUrl('/just/a/path')).toMatchObject({ ok: false, error: expect.stringContaining('Relative URL') })
    expect(parseUrl('//host/x')).toMatchObject({ ok: false, error: expect.stringContaining('Protocol-relative') })
    expect(parseUrl('http://example.com:99999/')).toEqual({ ok: false, error: 'Invalid port 99999 — the maximum is 65535' })
    expect(parseUrl('http://example.com:http/')).toMatchObject({ ok: false, error: expect.stringContaining('ports are numbers') })
    expect(parseUrl('http://exa mple.com/')).toMatchObject({ ok: false, error: expect.stringContaining('not allowed') })
    expect(parseUrl('https://')).toMatchObject({ ok: false, error: 'The URL has no host' })
    expect(parseUrl('x', 'not a base')).toMatchObject({ ok: false, error: expect.stringContaining('base URL must be absolute') })
  })
})

describe('query parameters', () => {
  it('parses bare keys, empty values, duplicates and malformed escapes', () => {
    expect(parseQuery('?debug&empty=&a=1&a=2&bad=%E0%A4%A')).toEqual([
      { key: 'debug', value: '', bare: true },
      { key: 'empty', value: '' },
      { key: 'a', value: '1' },
      { key: 'a', value: '2' },
      { key: 'bad', value: '%E0%A4%A' },
    ])
    expect(parseQuery('')).toEqual([])
    expect(parseQuery('?&&')).toEqual([])
  })
  it('encodes delimiters but keeps readable characters', () => {
    expect(encodeQueryComponent('a b&c=d+e#f%g')).toBe('a+b%26c%3Dd%2Be%23f%25g')
    expect(encodeQueryComponent('a b', false)).toBe('a%20b')
    expect(encodeQueryComponent('/path?x:y@z,1')).toBe('/path?x:y@z,1')
    expect(encodeQueryComponent('café 東京 👩‍💻')).toBe('caf%C3%A9+%E6%9D%B1%E4%BA%AC+%F0%9F%91%A9%E2%80%8D%F0%9F%92%BB')
    expect(encodeQueryComponent('\uD800')).toBe('%EF%BF%BD')
  })
  it('round-trips arbitrary keys and values', () => {
    const params: QueryParam[] = [
      { key: 'q', value: 'a+b = c & d' },
      { key: 'emoji', value: '👩‍💻 café' },
      { key: 'percent', value: '100%' },
      { key: 'dup', value: '1' },
      { key: 'dup', value: '2' },
      { key: 'flag', value: '', bare: true },
      { key: 'empty', value: '' },
      { key: 'k e y', value: '#hash?' },
    ]
    for (const plus of [true, false]) {
      const qs = serializeQuery(params, plus)
      expect(parseQuery(qs).map(({ key, value }) => ({ key, value }))).toEqual(params.map(({ key, value }) => ({ key, value })))
      // URLSearchParams agrees on the decoded values.
      expect([...new URLSearchParams(qs)]).toEqual(params.map((p) => [p.key, p.value]))
    }
    expect(serializeQuery([{ key: 'flag', value: '', bare: true }])).toBe('flag')
  })
  it('rebuilds the URL from an edited table, keeping the hash', () => {
    const href = 'https://example.com/search?q=old#top'
    expect(withQuery(href, [{ key: 'q', value: 'new value' }, { key: 'page', value: '2' }])).toBe('https://example.com/search?q=new+value&page=2#top')
    expect(withQuery(href, [])).toBe('https://example.com/search#top')
    const rebuilt = withQuery(href, [{ key: 'x', value: 'a&b' }])
    expect(ok(rebuilt).params).toEqual([{ key: 'x', value: 'a&b' }])
  })
  it('decodes components safely', () => {
    expect(decodeQueryComponent('a+b%20c')).toBe('a b c')
    expect(safeDecode('100%')).toBe('100%')
    expect(safeDecode('%41%zz')).toBe('A%zz')
  })
  it('handles a large query string', () => {
    const params = Array.from({ length: 5000 }, (_, i) => ({ key: `k${i}`, value: `v ${i} & more` }))
    const qs = serializeQuery(params)
    expect(parseQuery(qs)).toHaveLength(5000)
    expect(parseQuery(qs)[4999]).toEqual({ key: 'k4999', value: 'v 4999 & more' })
  })
})

describe('applyUrlPart', () => {
  const href = 'https://example.com:8080/a/b?x=1#h'
  it('sets parts via the URL setters', () => {
    expect(applyUrlPart(href, 'hostname', 'example.org')).toEqual({ ok: true, href: 'https://example.org:8080/a/b?x=1#h' })
    expect(applyUrlPart(href, 'port', '')).toEqual({ ok: true, href: 'https://example.com/a/b?x=1#h' })
    expect(applyUrlPart(href, 'port', '443')).toEqual({ ok: true, href: 'https://example.com/a/b?x=1#h' })
    expect(applyUrlPart(href, 'pathname', '/new path')).toEqual({ ok: true, href: 'https://example.com:8080/new%20path?x=1#h' })
    expect(applyUrlPart(href, 'hash', 'top')).toEqual({ ok: true, href: 'https://example.com:8080/a/b?x=1#top' })
    expect(applyUrlPart(href, 'protocol', 'http')).toEqual({ ok: true, href: 'http://example.com:8080/a/b?x=1#h' })
    expect(applyUrlPart(href, 'username', 'me@x')).toEqual({ ok: true, href: 'https://me%40x@example.com:8080/a/b?x=1#h' })
    expect(applyUrlPart(href, 'hostname', 'bücher.de')).toEqual({ ok: true, href: 'https://xn--bcher-kva.de:8080/a/b?x=1#h' })
  })
  it('reports values the setters would silently ignore', () => {
    expect(applyUrlPart(href, 'port', 'abc')).toMatchObject({ ok: false })
    expect(applyUrlPart(href, 'port', '70000')).toMatchObject({ ok: false })
    expect(applyUrlPart(href, 'protocol', 'mailto')).toMatchObject({ ok: false, error: expect.stringContaining('special') })
    expect(applyUrlPart(href, 'protocol', '1http')).toMatchObject({ ok: false })
    expect(applyUrlPart(href, 'hostname', 'a.com:90')).toMatchObject({ ok: false })
    expect(applyUrlPart(href, 'hostname', '')).toMatchObject({ ok: false })
    expect(applyUrlPart(href, 'hostname', 'bad host')).toMatchObject({ ok: false })
  })
})

describe('punycode', () => {
  it('decodes and encodes RFC 3492 samples', () => {
    expect(punycodeDecode('mnchen-3ya')).toBe('münchen')
    expect(punycodeEncode('münchen')).toBe('mnchen-3ya')
    expect(punycodeDecode('wgv71a119e')).toBe('日本語')
    expect(punycodeEncode('日本語')).toBe('wgv71a119e')
    expect(punycodeDecode('ls8h')).toBe('💩')
  })
  it('round-trips with the URL API', () => {
    for (const host of ['bücher.example', 'пример.испытание', '例え.テスト', 'ñandú.cl']) {
      const ascii = new URL(`https://${host}/`).hostname
      expect(hostnameToUnicode(ascii)).toBe(host)
    }
  })
  it('leaves invalid labels alone', () => {
    expect(hostnameToUnicode('xn--!!!.com')).toBe('xn--!!!.com')
    expect(hostnameToUnicode('plain.com')).toBe('plain.com')
  })
})
