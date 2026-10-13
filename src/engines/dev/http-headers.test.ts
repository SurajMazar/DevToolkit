import { describe, expect, it } from 'vitest'
import {
  assessCsp,
  auditResponse,
  auditSummary,
  HEADER_INFO,
  maskSecret,
  parseAuthorization,
  parseCacheControl,
  parseContentType,
  parseCsp,
  parseHeaders,
  parseHsts,
  parseLink,
  parsePermissionsPolicy,
  parseQualityList,
  parseSetCookie,
  SAMPLE_REQUEST,
  SAMPLE_RESPONSE,
  splitOutsideQuotes,
  structuredValue,
} from './http-headers'

describe('parseHeaders', () => {
  it('parses a response with status line', () => {
    const r = parseHeaders('HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nX-Id: 1\r\n')
    expect(r.kind).toBe('response')
    expect(r.startLine).toEqual({ kind: 'response', version: 'HTTP/1.1', status: 404, reason: 'Not Found' })
    expect(r.headers.map((h) => [h.name, h.value, h.line])).toEqual([
      ['Content-Type', 'text/plain', 2],
      ['X-Id', '1', 3],
    ])
  })

  it('parses a request line', () => {
    const r = parseHeaders(SAMPLE_REQUEST)
    expect(r.kind).toBe('request')
    expect(r.startLine).toMatchObject({ kind: 'request', method: 'GET', target: '/api/v2/orders?status=open&limit=50' })
  })

  it('works without a start line and infers the kind', () => {
    expect(parseHeaders('Host: a\nUser-Agent: x\nAccept: */*').kind).toBe('request')
    expect(parseHeaders('Server: nginx\nSet-Cookie: a=b').kind).toBe('response')
    expect(parseHeaders(':status: 200\ncontent-type: text/html').kind).toBe('response')
  })

  it('unfolds obsolete line folding', () => {
    const r = parseHeaders('X-Long: part one\n  part two\n\tpart three\nX-Next: y')
    expect(r.headers[0]).toMatchObject({ value: 'part one part two part three', folded: true })
    expect(r.headers[1].name).toBe('X-Next')
    expect(r.issues.some((i) => /folding/.test(i.message))).toBe(true)
  })

  it('keeps duplicates, matches names case-insensitively and flags invalid repeats', () => {
    const r = parseHeaders('Set-Cookie: a=1\nset-cookie: b=2\nContent-Type: text/html\ncontent-type: text/plain')
    expect(r.headers.filter((h) => h.lower === 'set-cookie')).toHaveLength(2)
    expect(r.duplicates.sort()).toEqual(['content-type', 'set-cookie'])
    expect(r.issues.filter((i) => /must not repeat/.test(i.message))).toHaveLength(1)
  })

  it('reports lines without a colon and invalid names', () => {
    const r = parseHeaders('Good: yes\nthis is not a header\nBad Name: x\nSpaced : y')
    expect(r.issues.map((i) => i.line)).toEqual([2, 3, 4])
    expect(r.issues[0].message).toMatch(/Missing “:”/)
    expect(r.issues[2].message).toMatch(/Whitespace before the colon/)
  })

  it('stops at the blank line and ignores the body', () => {
    const r = parseHeaders('HTTP/1.1 200 OK\nA: 1\n\n{"body": true}\nmore')
    expect(r.headers).toHaveLength(1)
    expect(r.bodyLines).toBe(2)
  })

  it('handles empty input and unicode values', () => {
    expect(parseHeaders('').headers).toEqual([])
    expect(parseHeaders('Content-Disposition: attachment; filename="résumé.pdf"').headers[0].value).toContain('résumé')
  })

  it('handles a large header block', () => {
    const big = Array.from({ length: 20_000 }, (_, i) => `X-H${i}: value ${i}`).join('\n')
    const t = performance.now()
    expect(parseHeaders(big).headers).toHaveLength(20_000)
    expect(performance.now() - t).toBeLessThan(8000)
  })
})

describe('value parsers', () => {
  it('splits outside quotes', () => {
    expect(splitOutsideQuotes('a, "b, c", d', ',')).toEqual(['a', '"b, c"', 'd'])
  })

  it('parses Cache-Control', () => {
    const d = parseCacheControl('public, max-age=31536000, immutable, no-cache="Set-Cookie"')
    expect(d.map((x) => [x.name, x.value])).toEqual([
      ['public', undefined],
      ['max-age', '31536000'],
      ['immutable', undefined],
      ['no-cache', 'Set-Cookie'],
    ])
    expect(d[1].description).toMatch(/1(\.0)? years|365/)
  })

  it('parses Content-Type params', () => {
    expect(parseContentType('multipart/form-data; boundary="----abc"; charset=UTF-8')).toEqual({ type: 'multipart/form-data', params: { boundary: '----abc', charset: 'UTF-8' } })
  })

  it('parses Set-Cookie attributes', () => {
    const c = parseSetCookie('id=a3fWa; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Max-Age=3600; Domain=example.com; Path=/; Secure; HttpOnly; SameSite=Strict; Partitioned; Priority=High')
    expect(c).toMatchObject({ name: 'id', value: 'a3fWa', expires: 'Wed, 21 Oct 2026 07:28:00 GMT', maxAge: 3600, domain: 'example.com', path: '/', secure: true, httpOnly: true, sameSite: 'Strict', partitioned: true })
    expect(c.other).toEqual({ Priority: 'High' })
    expect(c.issues).toEqual([])
  })

  it('flags unsafe cookies', () => {
    expect(parseSetCookie('a=b; SameSite=None').issues.map((i) => i.severity)).toContain('fail')
    expect(parseSetCookie('__Host-x=1; Secure; Path=/app').issues.some((i) => /__Host-/.test(i.message))).toBe(true)
    expect(parseSetCookie('a=b; Secure; SameSite=Lax').issues.map((i) => i.message)).toEqual([expect.stringMatching(/HttpOnly/)])
  })

  it('parses HSTS', () => {
    expect(parseHsts('max-age=63072000; includeSubDomains; preload')).toEqual({ maxAge: 63072000, includeSubDomains: true, preload: true })
    expect(parseHsts('includeSubDomains').maxAge).toBeNull()
  })

  it('parses CSP directives and flags risky sources', () => {
    const d = parseCsp("default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' *; img-src https:")
    expect(d.map((x) => x.name)).toEqual(['default-src', 'script-src', 'img-src'])
    expect(d[1].sources.map((s) => s.risk)).toEqual([undefined, 'unsafe-inline', 'unsafe-eval', 'wildcard'])
    expect(d[2].sources[0].risk).toBe('scheme')
    const a = assessCsp(d)
    expect(a.status).toBe('warn')
    expect(a.findings.join(' ')).toMatch(/unsafe-inline.*unsafe-eval|unsafe-eval/s)
  })

  it('does not flag unsafe-inline when a nonce is present', () => {
    const a = assessCsp(parseCsp("script-src 'nonce-abc' 'unsafe-inline' 'strict-dynamic'; object-src 'none'; base-uri 'none'"))
    expect(a.status).toBe('pass')
  })

  it('parses Permissions-Policy', () => {
    const p = parsePermissionsPolicy('camera=(), geolocation=(self "https://maps.example.com"), fullscreen=*')
    expect(p.map((x) => [x.feature, x.allowlist])).toEqual([
      ['camera', []],
      ['geolocation', ['self', 'https://maps.example.com']],
      ['fullscreen', ['*']],
    ])
  })

  it('parses and sorts q-values', () => {
    const q = parseQualityList('text/html;q=0.8, application/json, */*;q=0.1, text/plain;format=flowed')
    expect(q.map((x) => [x.value, x.q])).toEqual([
      ['application/json', 1],
      ['text/plain', 1],
      ['text/html', 0.8],
      ['*/*', 0.1],
    ])
    expect(q[1].params).toEqual({ format: 'flowed' })
  })

  it('masks Authorization and decodes Basic / JWT details', () => {
    const basic = parseAuthorization('Basic ' + btoa('alice:s3cret!'))
    expect(basic.scheme).toBe('Basic')
    expect(basic.masked).not.toContain('s3cret')
    expect(basic.details).toEqual([
      { label: 'Username', value: 'alice' },
      { label: 'Password', value: 's3cret!', sensitive: true },
    ])
    const jwt = parseAuthorization(SAMPLE_REQUEST.match(/Authorization: (.*)/)![1])
    expect(jwt.details[0]).toEqual({ label: 'Token type', value: 'JWT (RS256)' })
    expect(jwt.details.find((d) => d.label === 'iss')!.value).toBe('https://auth.example.com')
    expect(maskSecret('short')).toBe('••••••••')
  })

  it('parses Link headers', () => {
    expect(parseLink('<https://api.example.com/items?page=2>; rel="next", </style.css>; rel=preload; as=style')).toEqual([
      { uri: 'https://api.example.com/items?page=2', params: { rel: 'next' } },
      { uri: '/style.css', params: { rel: 'preload', as: 'style' } },
    ])
  })

  it('dispatches structured values', () => {
    expect(structuredValue('vary', 'Accept-Encoding, Origin')).toEqual({ kind: 'list', items: ['Accept-Encoding', 'Origin'] })
    expect(structuredValue('date', 'Tue, 13 Oct 2026 09:00:00 GMT', Date.parse('2026-10-13T10:00:00Z'))).toMatchObject({ kind: 'date', relative: '1 h ago' })
    expect(structuredValue('x-unknown', 'v')).toBeNull()
  })
})

describe('auditResponse', () => {
  it('audits the sample response', () => {
    const checks = auditResponse(parseHeaders(SAMPLE_RESPONSE).headers)
    const by = Object.fromEntries(checks.map((c) => [c.id, c.status]))
    expect(by).toMatchObject({ hsts: 'pass', csp: 'warn', nosniff: 'pass', framing: 'pass', referrer: 'pass', permissions: 'pass', coop: 'pass', coep: 'info', corp: 'warn', cookies: 'fail', leaks: 'warn' })
    const s = auditSummary(checks)
    expect(s.pass + s.warn + s.fail + s.info).toBe(checks.length)
  })

  it('fails an empty response', () => {
    const checks = auditResponse([])
    const by = Object.fromEntries(checks.map((c) => [c.id, c.status]))
    expect(by).toMatchObject({ hsts: 'fail', csp: 'fail', nosniff: 'fail', framing: 'fail', referrer: 'warn' })
  })

  it('checks HSTS strength and CORS misconfiguration', () => {
    const h = (s: string) => parseHeaders(s).headers
    expect(auditResponse(h('Strict-Transport-Security: max-age=86400')).find((c) => c.id === 'hsts')!.status).toBe('warn')
    expect(auditResponse(h('Strict-Transport-Security: max-age=31536000')).find((c) => c.id === 'hsts')!.detail).toMatch(/includeSubDomains/)
    expect(auditResponse(h('Access-Control-Allow-Origin: *\nAccess-Control-Allow-Credentials: true')).find((c) => c.id === 'cors')!.status).toBe('fail')
    expect(auditResponse(h('X-Frame-Options: ALLOW-FROM https://a.com')).find((c) => c.id === 'framing')!.status).toBe('warn')
    expect(auditResponse(h('X-XSS-Protection: 1; mode=block')).find((c) => c.id === 'xxp')!.status).toBe('warn')
  })

  it('has ~60+ documented headers', () => {
    expect(Object.keys(HEADER_INFO).length).toBeGreaterThanOrEqual(60)
  })
})
