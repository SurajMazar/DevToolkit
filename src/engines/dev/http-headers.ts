/**
 * Raw HTTP header parsing, structured value parsers and a response security audit.
 * Pure and DOM-free.
 */

// ---------------------------------------------------------------------------
// Raw parsing
// ---------------------------------------------------------------------------

export interface HeaderEntry {
  name: string
  lower: string
  value: string
  /** 1-based line where the header starts. */
  line: number
  /** True when the value was continued with obsolete line folding. */
  folded: boolean
}

export interface ParseIssue {
  line: number
  message: string
  severity: 'error' | 'warning'
}

export type StartLine =
  | { kind: 'request'; method: string; target: string; version: string }
  | { kind: 'response'; version: string; status: number; reason: string }

export interface ParsedHeaders {
  kind: 'request' | 'response' | 'unknown'
  startLine: StartLine | null
  headers: HeaderEntry[]
  issues: ParseIssue[]
  /** Lowercase names that appear more than once. */
  duplicates: string[]
  /** Text after the blank line that ends the header block, if any. */
  bodyLines: number
}

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const REQUEST_LINE = /^([A-Z][A-Z-]*)\s+(\S+)\s+(HTTP\/\d(?:\.\d)?)$/
const STATUS_LINE = /^(HTTP\/\d(?:\.\d)?)\s+(\d{3})(?:\s+(.*))?$/

/** Headers that may legally be combined with commas; others must not repeat. */
const SINGLETON = new Set([
  'content-type', 'content-length', 'host', 'authorization', 'strict-transport-security', 'content-security-policy-report-only',
  'x-frame-options', 'x-content-type-options', 'referrer-policy', 'location', 'etag', 'last-modified', 'expires', 'date',
  'age', 'retry-after', 'user-agent', 'referer', 'from', 'max-forwards', 'if-modified-since', 'if-unmodified-since',
  'cross-origin-opener-policy', 'cross-origin-embedder-policy', 'cross-origin-resource-policy', 'access-control-allow-origin',
])

export function parseHeaders(text: string): ParsedHeaders {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const headers: HeaderEntry[] = []
  const issues: ParseIssue[] = []
  let startLine: StartLine | null = null
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  const first = lines[i]?.trim() ?? ''
  const req = REQUEST_LINE.exec(first)
  const res = STATUS_LINE.exec(first)
  if (req) {
    startLine = { kind: 'request', method: req[1], target: req[2], version: req[3] }
    i++
  } else if (res) {
    startLine = { kind: 'response', version: res[1], status: Number(res[2]), reason: res[3] ?? '' }
    i++
  }
  let bodyLines = 0
  for (; i < lines.length; i++) {
    const raw = lines[i]
    const lineNo = i + 1
    if (!raw.trim()) {
      // A blank line ends the header block; anything after is body.
      const rest = lines.slice(i + 1).filter((l) => l.trim())
      bodyLines = rest.length
      if (bodyLines && headers.length) issues.push({ line: lineNo + 1, message: `${bodyLines} line${bodyLines === 1 ? '' : 's'} after the blank line treated as body and ignored.`, severity: 'warning' })
      break
    }
    if (/^[ \t]/.test(raw)) {
      const prev = headers[headers.length - 1]
      if (prev) {
        prev.value = (prev.value + ' ' + raw.trim()).trim()
        prev.folded = true
        continue
      }
      issues.push({ line: lineNo, message: 'Continuation line without a preceding header.', severity: 'error' })
      continue
    }
    // HTTP/2 pseudo-headers (:status: 200 / :method GET from devtools).
    const pseudo = /^:([a-z]+):?\s*(.*)$/.exec(raw.trim())
    if (pseudo) {
      headers.push({ name: `:${pseudo[1]}`, lower: `:${pseudo[1]}`, value: pseudo[2].trim(), line: lineNo, folded: false })
      continue
    }
    const colon = raw.indexOf(':')
    if (colon <= 0) {
      issues.push({ line: lineNo, message: `Missing “:” — “${raw.trim().slice(0, 60)}” is not a header.`, severity: 'error' })
      continue
    }
    const name = raw.slice(0, colon)
    const value = raw.slice(colon + 1).trim()
    if (!TOKEN.test(name)) {
      issues.push({
        line: lineNo,
        message: /\s$/.test(name) ? `Whitespace before the colon in “${name.trim()}” is not allowed (RFC 9112 §5.1).` : `“${name}” contains characters not allowed in a header name.`,
        severity: 'error',
      })
    }
    headers.push({ name: name.trim(), lower: name.trim().toLowerCase(), value, line: lineNo, folded: false })
  }
  if (headers.some((h) => h.folded)) issues.push({ line: headers.find((h) => h.folded)!.line, message: 'Obsolete line folding was unfolded (deprecated since RFC 7230).', severity: 'warning' })

  const counts = new Map<string, number>()
  for (const h of headers) counts.set(h.lower, (counts.get(h.lower) ?? 0) + 1)
  const duplicates = [...counts].filter(([, n]) => n > 1).map(([k]) => k)
  for (const d of duplicates) {
    if (SINGLETON.has(d)) {
      const where = headers.filter((h) => h.lower === d).map((h) => h.line)
      issues.push({ line: where[1], message: `“${headers.find((h) => h.lower === d)!.name}” appears ${where.length} times (lines ${where.join(', ')}) but must not repeat — clients may reject or pick either.`, severity: 'warning' })
    }
  }

  const pseudoStatus = headers.find((h) => h.lower === ':status')
  const pseudoMethod = headers.find((h) => h.lower === ':method')
  let kind: ParsedHeaders['kind'] = startLine?.kind ?? 'unknown'
  if (kind === 'unknown') {
    if (pseudoStatus) kind = 'response'
    else if (pseudoMethod) kind = 'request'
    else {
      const resHints = ['set-cookie', 'server', 'content-security-policy', 'strict-transport-security', 'x-frame-options', 'etag', 'last-modified', 'access-control-allow-origin', 'location', 'www-authenticate', 'x-powered-by']
      const reqHints = ['host', 'user-agent', 'accept', 'cookie', 'authorization', 'referer', 'origin', 'accept-language', 'if-none-match', 'sec-fetch-mode']
      const rs = headers.filter((h) => resHints.includes(h.lower)).length
      const rq = headers.filter((h) => reqHints.includes(h.lower)).length
      kind = rs > rq ? 'response' : rq > rs ? 'request' : 'unknown'
    }
  }
  return { kind, startLine, headers, issues, duplicates, bodyLines }
}

// ---------------------------------------------------------------------------
// Header knowledge base
// ---------------------------------------------------------------------------

export type HeaderCategory = 'Security' | 'Caching' | 'CORS' | 'Content' | 'Cookies' | 'Auth' | 'Conditional' | 'Connection' | 'Request context' | 'Response context' | 'Range' | 'Proxy' | 'Fetch metadata' | 'Client hints' | 'Pseudo-header' | 'Non-standard'

export interface HeaderInfo {
  category: HeaderCategory
  description: string
  context: 'request' | 'response' | 'both'
}

const H = (category: HeaderCategory, context: HeaderInfo['context'], description: string): HeaderInfo => ({ category, context, description })

export const HEADER_INFO: Record<string, HeaderInfo> = {
  accept: H('Content', 'request', 'Media types the client can handle, with optional q-value preferences.'),
  'accept-encoding': H('Content', 'request', 'Compression algorithms the client accepts (gzip, br, zstd…).'),
  'accept-language': H('Content', 'request', 'Preferred natural languages for the response.'),
  'accept-charset': H('Content', 'request', 'Character encodings the client accepts (ignored by modern browsers).'),
  'accept-ranges': H('Range', 'response', 'Whether the server supports range requests (bytes or none).'),
  'access-control-allow-origin': H('CORS', 'response', 'Which origin may read the response cross-origin (* or a single origin).'),
  'access-control-allow-credentials': H('CORS', 'response', 'Whether cross-origin requests may include credentials (cookies, auth).'),
  'access-control-allow-methods': H('CORS', 'response', 'Methods allowed in cross-origin requests (preflight response).'),
  'access-control-allow-headers': H('CORS', 'response', 'Request headers allowed in cross-origin requests (preflight response).'),
  'access-control-expose-headers': H('CORS', 'response', 'Response headers that cross-origin scripts may read.'),
  'access-control-max-age': H('CORS', 'response', 'Seconds a preflight result may be cached.'),
  'access-control-request-method': H('CORS', 'request', 'Method the actual request will use (sent in preflight).'),
  'access-control-request-headers': H('CORS', 'request', 'Headers the actual request will send (sent in preflight).'),
  age: H('Caching', 'response', 'Seconds the response has been in a shared cache.'),
  allow: H('Response context', 'response', 'Methods supported by the target resource.'),
  'alt-svc': H('Connection', 'response', 'Alternative services (e.g. HTTP/3 on another port) for the same origin.'),
  authorization: H('Auth', 'request', 'Credentials for the request (Basic, Bearer, Digest…). Treat as a secret.'),
  'cache-control': H('Caching', 'both', 'Caching directives for browsers and shared caches.'),
  'clear-site-data': H('Security', 'response', 'Asks the browser to clear cookies, storage or cache for this origin.'),
  connection: H('Connection', 'both', 'Connection options (keep-alive, close). Forbidden in HTTP/2 and HTTP/3.'),
  'content-disposition': H('Content', 'response', 'Display inline or download as attachment, with a suggested filename.'),
  'content-encoding': H('Content', 'both', 'Compression applied to the body (gzip, br, zstd).'),
  'content-language': H('Content', 'response', 'Natural language of the content.'),
  'content-length': H('Content', 'both', 'Body size in bytes.'),
  'content-location': H('Content', 'response', 'Direct URL of the returned representation.'),
  'content-range': H('Range', 'response', 'Which part of the full body a partial response contains.'),
  'content-security-policy': H('Security', 'response', 'Restricts where scripts, styles, frames and other resources may load from.'),
  'content-security-policy-report-only': H('Security', 'response', 'Reports CSP violations without enforcing the policy.'),
  'content-type': H('Content', 'both', 'Media type of the body, with parameters such as charset or boundary.'),
  cookie: H('Cookies', 'request', 'Cookies previously set by the server. Treat as a secret.'),
  'cross-origin-embedder-policy': H('Security', 'response', 'Requires cross-origin resources to opt in (COEP) — needed for cross-origin isolation.'),
  'cross-origin-opener-policy': H('Security', 'response', 'Isolates the browsing context from cross-origin popups/openers (COOP).'),
  'cross-origin-resource-policy': H('Security', 'response', 'Which sites may embed this resource (CORP): same-origin, same-site or cross-origin.'),
  date: H('Response context', 'both', 'When the message was generated.'),
  dnt: H('Request context', 'request', 'Do Not Track preference (deprecated).'),
  etag: H('Conditional', 'response', 'Opaque version identifier of the representation, used for revalidation.'),
  expect: H('Request context', 'request', 'Expectations the server must meet (100-continue).'),
  expires: H('Caching', 'response', 'Date after which the response is stale (overridden by Cache-Control max-age).'),
  forwarded: H('Proxy', 'request', 'Standard form of client/proxy information (for, by, proto, host).'),
  from: H('Request context', 'request', 'Email of the human user or bot operator.'),
  host: H('Request context', 'request', 'Host and port of the target server. Required in HTTP/1.1.'),
  'if-match': H('Conditional', 'request', 'Only perform the request if the ETag matches (optimistic locking).'),
  'if-modified-since': H('Conditional', 'request', 'Only return the body if modified after this date.'),
  'if-none-match': H('Conditional', 'request', 'Only return the body if the ETag differs (cache revalidation).'),
  'if-range': H('Conditional', 'request', 'Range request that falls back to the full body if the resource changed.'),
  'if-unmodified-since': H('Conditional', 'request', 'Only perform the request if unmodified since this date.'),
  'keep-alive': H('Connection', 'both', 'Timeout and max requests for a persistent HTTP/1.1 connection.'),
  'last-modified': H('Conditional', 'response', 'When the resource was last changed.'),
  link: H('Response context', 'both', 'Typed links to related resources (preload, next page, canonical…).'),
  location: H('Response context', 'response', 'Redirect target or URL of a newly created resource.'),
  nel: H('Response context', 'response', 'Network Error Logging policy.'),
  origin: H('Request context', 'request', 'Origin that initiated the request (scheme, host, port).'),
  'permissions-policy': H('Security', 'response', 'Enables or disables browser features (camera, geolocation…) for the page and its iframes.'),
  pragma: H('Caching', 'both', 'HTTP/1.0 cache directive (no-cache); superseded by Cache-Control.'),
  'proxy-authorization': H('Auth', 'request', 'Credentials for a proxy. Treat as a secret.'),
  'proxy-authenticate': H('Auth', 'response', 'Authentication scheme required by a proxy.'),
  range: H('Range', 'request', 'Request only part of the body (e.g. bytes=0-1023).'),
  referer: H('Request context', 'request', 'Address of the page that linked to the resource (misspelt in the spec).'),
  'referrer-policy': H('Security', 'response', 'How much referrer information is sent with requests from this page.'),
  'report-to': H('Response context', 'response', 'Reporting API endpoints (legacy; see Reporting-Endpoints).'),
  'reporting-endpoints': H('Response context', 'response', 'Named endpoints for CSP and other reports.'),
  'retry-after': H('Response context', 'response', 'How long to wait before retrying (with 429 or 503).'),
  'sec-fetch-dest': H('Fetch metadata', 'request', 'Destination of the request (document, script, image…).'),
  'sec-fetch-mode': H('Fetch metadata', 'request', 'Request mode (navigate, cors, no-cors, same-origin).'),
  'sec-fetch-site': H('Fetch metadata', 'request', 'Relationship between initiator and target (same-origin, cross-site…).'),
  'sec-fetch-user': H('Fetch metadata', 'request', 'Whether a navigation was triggered by user activation.'),
  'sec-ch-ua': H('Client hints', 'request', 'Browser brand and major version (User-Agent client hint).'),
  'sec-ch-ua-mobile': H('Client hints', 'request', 'Whether the browser is on a mobile device.'),
  'sec-ch-ua-platform': H('Client hints', 'request', 'Operating system of the client.'),
  server: H('Response context', 'response', 'Software that handled the request. Version numbers help attackers.'),
  'server-timing': H('Response context', 'response', 'Server-side timing metrics shown in browser devtools.'),
  'set-cookie': H('Cookies', 'response', 'Sets a cookie with attributes such as Secure, HttpOnly and SameSite.'),
  'strict-transport-security': H('Security', 'response', 'HSTS: forces HTTPS for this host for max-age seconds.'),
  te: H('Connection', 'request', 'Transfer codings the client accepts (trailers).'),
  'timing-allow-origin': H('CORS', 'response', 'Origins allowed to see Resource Timing details.'),
  trailer: H('Connection', 'both', 'Headers that will be sent after a chunked body.'),
  'transfer-encoding': H('Connection', 'both', 'Transfer coding applied to the body (chunked). Not used in HTTP/2+.'),
  upgrade: H('Connection', 'both', 'Switch protocols (e.g. to websocket).'),
  'upgrade-insecure-requests': H('Request context', 'request', 'Client prefers an encrypted, authenticated response.'),
  'user-agent': H('Request context', 'request', 'Client software identification string.'),
  vary: H('Caching', 'response', 'Request headers that change the response — caches key on them.'),
  via: H('Proxy', 'both', 'Proxies the message passed through.'),
  'www-authenticate': H('Auth', 'response', 'Authentication scheme(s) the server requires (with 401).'),
  'x-content-type-options': H('Security', 'response', 'nosniff stops browsers from guessing the MIME type.'),
  'x-dns-prefetch-control': H('Non-standard', 'response', 'Controls DNS prefetching of links on the page.'),
  'x-forwarded-for': H('Proxy', 'request', 'Client IP chain added by proxies (de-facto standard).'),
  'x-forwarded-host': H('Proxy', 'request', 'Original Host requested by the client before a proxy.'),
  'x-forwarded-proto': H('Proxy', 'request', 'Original protocol (http/https) before a proxy.'),
  'x-frame-options': H('Security', 'response', 'Legacy clickjacking protection: DENY or SAMEORIGIN. Superseded by CSP frame-ancestors.'),
  'x-powered-by': H('Non-standard', 'response', 'Framework or language that generated the response. Leaks implementation details.'),
  'x-request-id': H('Non-standard', 'both', 'Correlation ID for tracing a request across services.'),
  'x-requested-with': H('Non-standard', 'request', 'Usually XMLHttpRequest — used by some frameworks to detect AJAX.'),
  'x-xss-protection': H('Security', 'response', 'Legacy XSS filter (removed from browsers). Use “0” or omit it; rely on CSP.'),
  'x-aspnet-version': H('Non-standard', 'response', 'ASP.NET version. Leaks implementation details.'),
  'x-aspnetmvc-version': H('Non-standard', 'response', 'ASP.NET MVC version. Leaks implementation details.'),
  'x-ratelimit-limit': H('Non-standard', 'response', 'Requests allowed in the current rate-limit window.'),
  'x-ratelimit-remaining': H('Non-standard', 'response', 'Requests left in the current rate-limit window.'),
  'x-ratelimit-reset': H('Non-standard', 'response', 'When the rate-limit window resets.'),
  ':status': H('Pseudo-header', 'response', 'HTTP/2+ response status code.'),
  ':method': H('Pseudo-header', 'request', 'HTTP/2+ request method.'),
  ':path': H('Pseudo-header', 'request', 'HTTP/2+ request path and query.'),
  ':authority': H('Pseudo-header', 'request', 'HTTP/2+ equivalent of Host.'),
  ':scheme': H('Pseudo-header', 'request', 'HTTP/2+ request scheme.'),
}

export function headerInfo(lower: string): HeaderInfo | undefined {
  return HEADER_INFO[lower]
}

// ---------------------------------------------------------------------------
// Structured value parsers
// ---------------------------------------------------------------------------

/** Splits on a delimiter outside double-quoted strings. */
export function splitOutsideQuotes(value: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (c === '\\' && q) {
      cur += c + (value[i + 1] ?? '')
      i++
      continue
    }
    if (c === '"') q = !q
    if (c === sep && !q) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

const unquote = (s: string) => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/\\(.)/g, '$1') : s)

export interface Directive {
  name: string
  value?: string
  description?: string
}

const CACHE_DIRECTIVES: Record<string, string> = {
  'max-age': 'Fresh for this many seconds.',
  's-maxage': 'Freshness lifetime for shared caches (CDNs), overriding max-age there.',
  'no-cache': 'May be stored, but must be revalidated with the server before every use.',
  'no-store': 'Must not be stored by any cache.',
  'no-transform': 'Intermediaries must not modify the body (e.g. recompress images).',
  'must-revalidate': 'Once stale, must not be served without successful revalidation.',
  'proxy-revalidate': 'Like must-revalidate, but only for shared caches.',
  'must-understand': 'Store only if the cache understands the status code.',
  private: 'Only the browser may store it — not CDNs or shared proxies.',
  public: 'Any cache may store it, even for authenticated requests.',
  immutable: 'Will not change while fresh — skip revalidation on reload.',
  'stale-while-revalidate': 'May serve stale for this many seconds while revalidating in the background.',
  'stale-if-error': 'May serve stale for this many seconds if the origin errors.',
  'max-stale': 'Client accepts a stale response up to this many seconds old.',
  'min-fresh': 'Client wants a response that stays fresh for at least this many seconds.',
  'only-if-cached': 'Client only wants a cached response (504 otherwise).',
}

function humanSeconds(s: string): string {
  const n = Number(s)
  if (!Number.isFinite(n)) return ''
  if (n < 60) return `${n} s`
  if (n < 3600) return `${+(n / 60).toFixed(1)} min`
  if (n < 86400) return `${+(n / 3600).toFixed(1)} h`
  if (n < 86400 * 365) return `${+(n / 86400).toFixed(1)} days`
  return `${+(n / 86400 / 365).toFixed(2)} years`
}

export function parseCacheControl(value: string): Directive[] {
  return splitOutsideQuotes(value, ',').map((part) => {
    const eq = part.indexOf('=')
    const name = (eq === -1 ? part : part.slice(0, eq)).trim().toLowerCase()
    const v = eq === -1 ? undefined : unquote(part.slice(eq + 1).trim())
    let description = CACHE_DIRECTIVES[name] ?? 'Unrecognised or extension directive.'
    if (v && /^\d+$/.test(v) && /age|stale|fresh/.test(name)) description += ` (${humanSeconds(v)})`
    return { name, value: v, description }
  })
}

export interface MediaType {
  type: string
  params: Record<string, string>
}

export function parseContentType(value: string): MediaType {
  const [type, ...params] = splitOutsideQuotes(value, ';')
  const out: Record<string, string> = {}
  for (const p of params) {
    const eq = p.indexOf('=')
    if (eq === -1) continue
    out[p.slice(0, eq).trim().toLowerCase()] = unquote(p.slice(eq + 1).trim())
  }
  return { type: (type ?? '').toLowerCase(), params: out }
}

export interface SetCookie {
  name: string
  value: string
  expires?: string
  maxAge?: number
  domain?: string
  path?: string
  secure: boolean
  httpOnly: boolean
  sameSite?: string
  partitioned: boolean
  other: Record<string, string | true>
  issues: { severity: 'fail' | 'warn'; message: string }[]
}

export function parseSetCookie(value: string): SetCookie {
  const parts = value.split(';')
  const first = parts.shift() ?? ''
  const eq = first.indexOf('=')
  const c: SetCookie = {
    name: (eq === -1 ? '' : first.slice(0, eq)).trim(),
    value: (eq === -1 ? first : first.slice(eq + 1)).trim(),
    secure: false,
    httpOnly: false,
    partitioned: false,
    other: {},
    issues: [],
  }
  for (const raw of parts) {
    const p = raw.trim()
    if (!p) continue
    const i = p.indexOf('=')
    const k = (i === -1 ? p : p.slice(0, i)).trim().toLowerCase()
    const v = i === -1 ? '' : p.slice(i + 1).trim()
    if (k === 'expires') c.expires = v
    else if (k === 'max-age') c.maxAge = Number(v)
    else if (k === 'domain') c.domain = v
    else if (k === 'path') c.path = v
    else if (k === 'secure') c.secure = true
    else if (k === 'httponly') c.httpOnly = true
    else if (k === 'samesite') c.sameSite = v
    else if (k === 'partitioned') c.partitioned = true
    else c.other[i === -1 ? p : p.slice(0, i).trim()] = i === -1 ? true : v
  }
  const ss = c.sameSite?.toLowerCase()
  if (!c.name) c.issues.push({ severity: 'warn', message: 'Cookie has no name (nameless cookies are rejected by some browsers).' })
  if (!c.secure) c.issues.push({ severity: 'fail', message: 'Missing Secure — the cookie can be sent over plain HTTP.' })
  if (!c.httpOnly) c.issues.push({ severity: 'warn', message: 'Missing HttpOnly — JavaScript can read it (fine only for non-sensitive cookies).' })
  if (!ss) c.issues.push({ severity: 'warn', message: 'No SameSite — browsers default to Lax, but being explicit avoids surprises.' })
  else if (ss === 'none' && !c.secure) c.issues.push({ severity: 'fail', message: 'SameSite=None requires Secure; browsers reject this cookie.' })
  else if (!['lax', 'strict', 'none'].includes(ss)) c.issues.push({ severity: 'warn', message: `Unknown SameSite value “${c.sameSite}”.` })
  if (c.partitioned && !c.secure) c.issues.push({ severity: 'fail', message: 'Partitioned requires Secure.' })
  if (c.name.startsWith('__Host-') && (!c.secure || c.domain || c.path !== '/')) c.issues.push({ severity: 'fail', message: '__Host- cookies must be Secure, have Path=/ and no Domain.' })
  if (c.name.startsWith('__Secure-') && !c.secure) c.issues.push({ severity: 'fail', message: '__Secure- cookies must be Secure.' })
  if (c.maxAge !== undefined && !Number.isFinite(c.maxAge)) c.issues.push({ severity: 'warn', message: 'Max-Age is not a number.' })
  return c
}

export interface Hsts {
  maxAge: number | null
  includeSubDomains: boolean
  preload: boolean
}

export function parseHsts(value: string): Hsts {
  const d = splitOutsideQuotes(value, ';').map((part) => {
    const eq = part.indexOf('=')
    return { name: (eq === -1 ? part : part.slice(0, eq)).trim().toLowerCase(), value: eq === -1 ? undefined : unquote(part.slice(eq + 1).trim()) }
  })
  const ma = d.find((x) => x.name === 'max-age')
  return {
    maxAge: ma?.value !== undefined && /^\d+$/.test(ma.value) ? Number(ma.value) : null,
    includeSubDomains: d.some((x) => x.name === 'includesubdomains'),
    preload: d.some((x) => x.name === 'preload'),
  }
}

export interface CspSource {
  value: string
  risk?: 'unsafe-inline' | 'unsafe-eval' | 'wildcard' | 'scheme' | 'unsafe-hashes'
}

export interface CspDirective {
  name: string
  sources: CspSource[]
  description: string
}

const CSP_DIRECTIVES: Record<string, string> = {
  'default-src': 'Fallback for every fetch directive that is not set.',
  'script-src': 'Where scripts may load from and whether inline/eval is allowed.',
  'script-src-elem': 'Sources for <script> elements.',
  'script-src-attr': 'Inline event handlers (onclick=…).',
  'style-src': 'Where stylesheets and inline styles may come from.',
  'style-src-elem': 'Sources for <style> and <link rel=stylesheet>.',
  'style-src-attr': 'Inline style attributes.',
  'img-src': 'Image sources.',
  'font-src': 'Font sources.',
  'connect-src': 'fetch/XHR/WebSocket/EventSource destinations.',
  'media-src': 'Audio and video sources.',
  'object-src': '<object>/<embed> sources — should be \'none\'.',
  'frame-src': 'Sources for frames this page embeds.',
  'child-src': 'Frames and workers (legacy fallback).',
  'worker-src': 'Worker and service worker scripts.',
  'manifest-src': 'Web app manifest.',
  'frame-ancestors': 'Who may embed THIS page in a frame (clickjacking protection).',
  'base-uri': 'Allowed URLs for <base> — set to \'self\' or \'none\'.',
  'form-action': 'Where forms may submit to.',
  'upgrade-insecure-requests': 'Rewrite http:// subresources to https://.',
  'block-all-mixed-content': 'Block mixed content (deprecated).',
  sandbox: 'Applies iframe-like sandbox restrictions to the page.',
  'report-uri': 'Where to POST violation reports (deprecated).',
  'report-to': 'Reporting API group for violation reports.',
  'require-trusted-types-for': 'Require Trusted Types for DOM XSS sinks.',
  'trusted-types': 'Allowed Trusted Types policy names.',
}

export function parseCsp(value: string): CspDirective[] {
  return value
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const [rawName, ...tokens] = part.split(/\s+/)
      const name = rawName.toLowerCase()
      const sources: CspSource[] = tokens.map((t) => {
        const l = t.toLowerCase()
        let risk: CspSource['risk']
        if (l === "'unsafe-inline'") risk = 'unsafe-inline'
        else if (l === "'unsafe-eval'" || l === "'wasm-unsafe-eval'") risk = l === "'unsafe-eval'" ? 'unsafe-eval' : undefined
        else if (l === "'unsafe-hashes'") risk = 'unsafe-hashes'
        else if (l === '*' || /^(https?:\/\/)?\*$/.test(l)) risk = 'wildcard'
        else if (/^(https?|data|blob|wss?):$/.test(l)) risk = 'scheme'
        return risk ? { value: t, risk } : { value: t }
      })
      return { name, sources, description: CSP_DIRECTIVES[name] ?? 'Unrecognised directive.' }
    })
}

export interface CspAssessment {
  status: AuditStatus
  findings: string[]
}

export function assessCsp(dirs: CspDirective[]): CspAssessment {
  const get = (n: string) => dirs.find((d) => d.name === n)
  const scriptDir = get('script-src') ?? get('default-src')
  const findings: string[] = []
  let status: AuditStatus = 'pass'
  const worse = (s: AuditStatus) => {
    const order: AuditStatus[] = ['pass', 'info', 'warn', 'fail']
    if (order.indexOf(s) > order.indexOf(status)) status = s
  }
  if (!scriptDir) {
    findings.push('No script-src or default-src: scripts may load from anywhere.')
    worse('warn')
  } else {
    const hasNonceOrHash = scriptDir.sources.some((s) => /^'(nonce-|sha(256|384|512)-)/i.test(s.value))
    const strictDynamic = scriptDir.sources.some((s) => s.value.toLowerCase() === "'strict-dynamic'")
    if (scriptDir.sources.some((s) => s.risk === 'unsafe-inline') && !hasNonceOrHash) {
      findings.push(`${scriptDir.name} allows 'unsafe-inline' — inline scripts (and XSS payloads) run.`)
      worse('warn')
    }
    if (scriptDir.sources.some((s) => s.risk === 'unsafe-eval')) {
      findings.push(`${scriptDir.name} allows 'unsafe-eval' — eval() and new Function() are permitted.`)
      worse('warn')
    }
    if (!strictDynamic && scriptDir.sources.some((s) => s.risk === 'wildcard' || s.risk === 'scheme')) {
      findings.push(`${scriptDir.name} allows a wildcard or whole scheme (${scriptDir.sources.filter((s) => s.risk === 'wildcard' || s.risk === 'scheme').map((s) => s.value).join(' ')}).`)
      worse('warn')
    }
  }
  const obj = get('object-src') ?? get('default-src')
  if (!obj || !obj.sources.some((s) => s.value === "'none'")) {
    findings.push("object-src is not 'none' — plugins can be embedded.")
    worse('info')
  }
  if (!get('base-uri')) {
    findings.push('No base-uri — an injected <base> tag could redirect relative script URLs.')
    worse('info')
  }
  if (!findings.length) findings.push('No obvious weaknesses found in script, object and base restrictions.')
  return { status, findings }
}

export interface PermissionEntry {
  feature: string
  allowlist: string[]
  description: string
}

export function parsePermissionsPolicy(value: string): PermissionEntry[] {
  return splitOutsideQuotes(value, ',').map((part) => {
    const eq = part.indexOf('=')
    const feature = (eq === -1 ? part : part.slice(0, eq)).trim()
    const raw = eq === -1 ? '' : part.slice(eq + 1).trim()
    let allowlist: string[]
    if (raw === '*') allowlist = ['*']
    else if (raw.startsWith('(')) allowlist = raw.replace(/^\(|\)$/g, '').split(/\s+/).filter(Boolean).map(unquote)
    else allowlist = raw ? [unquote(raw)] : []
    const description = allowlist.length === 0 ? 'Disabled everywhere.' : allowlist.includes('*') ? 'Allowed for all origins.' : `Allowed for ${allowlist.join(', ')}.`
    return { feature, allowlist, description }
  })
}

export interface QualityItem {
  value: string
  q: number
  params: Record<string, string>
}

/** Accept, Accept-Language, Accept-Encoding, Accept-Charset — sorted by preference. */
export function parseQualityList(value: string): QualityItem[] {
  const items = splitOutsideQuotes(value, ',').map((part, index) => {
    const [v, ...ps] = splitOutsideQuotes(part, ';')
    let q = 1
    const params: Record<string, string> = {}
    for (const p of ps) {
      const eq = p.indexOf('=')
      const k = (eq === -1 ? p : p.slice(0, eq)).trim().toLowerCase()
      const pv = eq === -1 ? '' : unquote(p.slice(eq + 1).trim())
      if (k === 'q') q = Number.isFinite(Number(pv)) ? Math.max(0, Math.min(1, Number(pv))) : 1
      else params[k] = pv
    }
    return { value: v, q, params, index }
  })
  return items.sort((a, b) => b.q - a.q || a.index - b.index).map(({ value, q, params }) => ({ value, q, params }))
}

export interface AuthInfo {
  scheme: string
  /** Masked credentials for display. */
  masked: string
  /** Raw credentials (only shown when the user reveals them). */
  credentials: string
  /** Decoded details: Basic → username; Bearer JWT → header/payload claims summary. */
  details: { label: string; value: string; sensitive?: boolean }[]
}

/** Fixed-length mask: reveals neither characters nor length. */
export function maskSecret(s: string): string {
  return s ? '•'.repeat(8) : ''
}

function b64decode(s: string): string | null {
  try {
    const norm = s.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(norm + '='.repeat((4 - (norm.length % 4)) % 4))
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  } catch {
    return null
  }
}

export function parseAuthorization(value: string): AuthInfo {
  const sp = value.indexOf(' ')
  const scheme = sp === -1 ? value : value.slice(0, sp)
  const credentials = sp === -1 ? '' : value.slice(sp + 1).trim()
  const details: AuthInfo['details'] = []
  const s = scheme.toLowerCase()
  if (s === 'basic') {
    const decoded = b64decode(credentials)
    if (decoded && decoded.includes(':')) {
      details.push({ label: 'Username', value: decoded.slice(0, decoded.indexOf(':')) })
      details.push({ label: 'Password', value: decoded.slice(decoded.indexOf(':') + 1), sensitive: true })
    } else details.push({ label: 'Note', value: 'Credentials are not valid base64 “user:password”.' })
  } else if (s === 'bearer') {
    const parts = credentials.split('.')
    if (parts.length === 3) {
      const header = b64decode(parts[0])
      const payload = b64decode(parts[1])
      try {
        const h = JSON.parse(header ?? '')
        const p = JSON.parse(payload ?? '')
        details.push({ label: 'Token type', value: `JWT (${h.alg ?? '?'})` })
        if (p.sub !== undefined) details.push({ label: 'sub', value: String(p.sub), sensitive: true })
        if (p.iss !== undefined) details.push({ label: 'iss', value: String(p.iss) })
        if (typeof p.exp === 'number') details.push({ label: 'exp', value: new Date(p.exp * 1000).toISOString() })
      } catch {
        details.push({ label: 'Token type', value: 'Opaque bearer token' })
      }
    } else details.push({ label: 'Token type', value: 'Opaque bearer token' })
  } else if (s === 'digest' || s === 'aws4-hmac-sha256') {
    for (const p of splitOutsideQuotes(credentials, ',')) {
      const eq = p.indexOf('=')
      if (eq === -1) continue
      const k = p.slice(0, eq).trim()
      const v = unquote(p.slice(eq + 1).trim())
      details.push({ label: k, value: v, sensitive: /response|signature|nonce|cnonce/i.test(k) })
    }
  }
  return { scheme, credentials, masked: maskSecret(credentials), details }
}

export interface LinkValue {
  uri: string
  params: Record<string, string>
}

export function parseLink(value: string): LinkValue[] {
  const out: LinkValue[] = []
  for (const part of splitOutsideQuotes(value, ',')) {
    const m = /^<([^>]*)>\s*(.*)$/.exec(part)
    if (!m) continue
    const params: Record<string, string> = {}
    for (const p of splitOutsideQuotes(m[2], ';')) {
      const eq = p.indexOf('=')
      const k = (eq === -1 ? p : p.slice(0, eq)).trim().toLowerCase()
      params[k] = eq === -1 ? '' : unquote(p.slice(eq + 1).trim())
    }
    out.push({ uri: m[1], params })
  }
  return out
}

/** Parse an RFC 9110 date for display; null if invalid. */
export function parseHttpDate(value: string): Date | null {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

// ---------------------------------------------------------------------------
// Structured view dispatcher
// ---------------------------------------------------------------------------

export type Structured =
  | { kind: 'cache-control'; directives: Directive[] }
  | { kind: 'content-type'; media: MediaType }
  | { kind: 'set-cookie'; cookie: SetCookie }
  | { kind: 'hsts'; hsts: Hsts }
  | { kind: 'csp'; directives: CspDirective[]; assessment: CspAssessment }
  | { kind: 'permissions-policy'; entries: PermissionEntry[] }
  | { kind: 'quality'; items: QualityItem[] }
  | { kind: 'authorization'; auth: AuthInfo }
  | { kind: 'link'; links: LinkValue[] }
  | { kind: 'list'; items: string[] }
  | { kind: 'date'; iso: string; relative: string }

const LIST_HEADERS = new Set(['vary', 'allow', 'access-control-allow-methods', 'access-control-allow-headers', 'access-control-expose-headers', 'content-encoding', 'accept-ranges', 'connection', 'via', 'x-forwarded-for', 'timing-allow-origin'])
const DATE_HEADERS = new Set(['date', 'expires', 'last-modified', 'if-modified-since', 'if-unmodified-since'])

export function structuredValue(lower: string, value: string, now = Date.now()): Structured | null {
  switch (lower) {
    case 'cache-control':
    case 'pragma':
      return { kind: 'cache-control', directives: parseCacheControl(value) }
    case 'content-type':
      return { kind: 'content-type', media: parseContentType(value) }
    case 'set-cookie':
      return { kind: 'set-cookie', cookie: parseSetCookie(value) }
    case 'strict-transport-security':
      return { kind: 'hsts', hsts: parseHsts(value) }
    case 'content-security-policy':
    case 'content-security-policy-report-only': {
      const directives = parseCsp(value)
      return { kind: 'csp', directives, assessment: assessCsp(directives) }
    }
    case 'permissions-policy':
      return { kind: 'permissions-policy', entries: parsePermissionsPolicy(value) }
    case 'accept':
    case 'accept-language':
    case 'accept-encoding':
    case 'accept-charset':
      return { kind: 'quality', items: parseQualityList(value) }
    case 'authorization':
    case 'proxy-authorization':
      return { kind: 'authorization', auth: parseAuthorization(value) }
    case 'link':
      return { kind: 'link', links: parseLink(value) }
  }
  if (LIST_HEADERS.has(lower)) return { kind: 'list', items: splitOutsideQuotes(value, ',') }
  if (DATE_HEADERS.has(lower)) {
    const d = parseHttpDate(value)
    if (!d) return null
    const diff = d.getTime() - now
    const abs = Math.abs(diff) / 1000
    const rel = humanSeconds(String(Math.round(abs)))
    return { kind: 'date', iso: d.toISOString(), relative: diff >= 0 ? `in ${rel}` : `${rel} ago` }
  }
  return null
}

// ---------------------------------------------------------------------------
// Security audit
// ---------------------------------------------------------------------------

export type AuditStatus = 'pass' | 'warn' | 'fail' | 'info'

export interface AuditCheck {
  id: string
  title: string
  status: AuditStatus
  /** One-line reason. */
  detail: string
  header?: string
}

const SIX_MONTHS = 15_552_000

export function auditResponse(headers: HeaderEntry[]): AuditCheck[] {
  const all = (n: string) => headers.filter((h) => h.lower === n)
  const get = (n: string) => all(n)[0]?.value
  const checks: AuditCheck[] = []

  // HSTS
  const hstsRaw = get('strict-transport-security')
  if (!hstsRaw) checks.push({ id: 'hsts', title: 'Strict-Transport-Security', status: 'fail', detail: 'Missing — browsers may connect over plain HTTP first, enabling SSL-stripping.', header: 'strict-transport-security' })
  else {
    const h = parseHsts(hstsRaw)
    if (h.maxAge === null) checks.push({ id: 'hsts', title: 'Strict-Transport-Security', status: 'fail', detail: 'max-age is missing or invalid, so the policy is ignored.', header: 'strict-transport-security' })
    else if (h.maxAge < SIX_MONTHS) checks.push({ id: 'hsts', title: 'Strict-Transport-Security', status: 'warn', detail: `max-age is ${humanSeconds(String(h.maxAge))} — use at least 6 months (15552000), ideally 1–2 years.`, header: 'strict-transport-security' })
    else if (!h.includeSubDomains) checks.push({ id: 'hsts', title: 'Strict-Transport-Security', status: 'warn', detail: 'No includeSubDomains — subdomains can still be reached over HTTP.', header: 'strict-transport-security' })
    else checks.push({ id: 'hsts', title: 'Strict-Transport-Security', status: 'pass', detail: `max-age ${humanSeconds(String(h.maxAge))}, includeSubDomains${h.preload ? ', preload' : ' (add preload to be eligible for the browser preload list)'}.`, header: 'strict-transport-security' })
  }

  // CSP
  const csp = get('content-security-policy')
  const cspRo = get('content-security-policy-report-only')
  const cspDirs = csp ? parseCsp(csp) : []
  if (!csp) {
    checks.push({
      id: 'csp',
      title: 'Content-Security-Policy',
      status: cspRo ? 'warn' : 'fail',
      detail: cspRo ? 'Only a Report-Only policy is set — violations are reported but not blocked.' : 'Missing — no defence-in-depth against XSS and injected resources.',
      header: cspRo ? 'content-security-policy-report-only' : 'content-security-policy',
    })
  } else {
    const a = assessCsp(cspDirs)
    checks.push({ id: 'csp', title: 'Content-Security-Policy', status: a.status === 'info' ? 'pass' : a.status, detail: a.findings[0], header: 'content-security-policy' })
  }

  // nosniff
  const xcto = get('x-content-type-options')
  checks.push(
    xcto?.trim().toLowerCase() === 'nosniff'
      ? { id: 'nosniff', title: 'X-Content-Type-Options', status: 'pass', detail: 'nosniff — browsers will not MIME-sniff responses into scripts or styles.', header: 'x-content-type-options' }
      : { id: 'nosniff', title: 'X-Content-Type-Options', status: 'fail', detail: xcto ? `Value “${xcto}” is invalid — only “nosniff” is recognised.` : 'Missing — browsers may MIME-sniff uploads into executable content.', header: 'x-content-type-options' },
  )

  // Framing
  const xfo = get('x-frame-options')?.trim().toUpperCase()
  const fa = cspDirs.find((d) => d.name === 'frame-ancestors')
  if (fa) {
    const wild = fa.sources.some((s) => s.risk === 'wildcard' || s.risk === 'scheme')
    checks.push({ id: 'framing', title: 'Frame protection', status: wild ? 'warn' : 'pass', detail: wild ? 'CSP frame-ancestors allows any origin to embed the page.' : `CSP frame-ancestors ${fa.sources.map((s) => s.value).join(' ') || '(empty = none)'}.`, header: 'content-security-policy' })
  } else if (xfo === 'DENY' || xfo === 'SAMEORIGIN') checks.push({ id: 'framing', title: 'Frame protection', status: 'pass', detail: `X-Frame-Options ${xfo} (consider CSP frame-ancestors, its modern replacement).`, header: 'x-frame-options' })
  else if (xfo?.startsWith('ALLOW-FROM')) checks.push({ id: 'framing', title: 'Frame protection', status: 'warn', detail: 'X-Frame-Options ALLOW-FROM is ignored by modern browsers — use CSP frame-ancestors.', header: 'x-frame-options' })
  else checks.push({ id: 'framing', title: 'Frame protection', status: 'fail', detail: 'Neither X-Frame-Options nor CSP frame-ancestors — the page can be framed (clickjacking).', header: 'x-frame-options' })

  // Referrer-Policy
  const rp = get('referrer-policy')
  if (!rp) checks.push({ id: 'referrer', title: 'Referrer-Policy', status: 'warn', detail: 'Missing — browsers default to strict-origin-when-cross-origin, but setting it explicitly is safer.', header: 'referrer-policy' })
  else {
    const last = splitOutsideQuotes(rp, ',').pop()!.toLowerCase()
    const leaky = last === 'unsafe-url' || last === 'no-referrer-when-downgrade' || last === 'origin-when-cross-origin'
    checks.push({ id: 'referrer', title: 'Referrer-Policy', status: leaky ? 'warn' : 'pass', detail: leaky ? `“${last}” sends full URLs (paths, query tokens) to other sites.` : `“${last}” limits what is sent to other sites.`, header: 'referrer-policy' })
  }

  // Permissions-Policy
  const pp = get('permissions-policy')
  checks.push(
    pp
      ? { id: 'permissions', title: 'Permissions-Policy', status: 'pass', detail: `${parsePermissionsPolicy(pp).length} features restricted.`, header: 'permissions-policy' }
      : { id: 'permissions', title: 'Permissions-Policy', status: 'warn', detail: 'Missing — powerful features (camera, geolocation…) are not explicitly restricted for embedded content.', header: 'permissions-policy' },
  )

  // COOP / COEP / CORP
  const coop = get('cross-origin-opener-policy')?.toLowerCase()
  checks.push(
    coop && coop.startsWith('same-origin')
      ? { id: 'coop', title: 'Cross-Origin-Opener-Policy', status: 'pass', detail: `${coop} — isolates the window from cross-origin openers/popups.`, header: 'cross-origin-opener-policy' }
      : { id: 'coop', title: 'Cross-Origin-Opener-Policy', status: 'warn', detail: coop ? `“${coop}” does not isolate the browsing context.` : 'Missing — cross-origin windows keep a reference to this page (XS-Leaks).', header: 'cross-origin-opener-policy' },
  )
  const coep = get('cross-origin-embedder-policy')?.toLowerCase()
  checks.push(
    coep === 'require-corp' || coep === 'credentialless'
      ? { id: 'coep', title: 'Cross-Origin-Embedder-Policy', status: 'pass', detail: `${coep} — together with COOP enables cross-origin isolation.`, header: 'cross-origin-embedder-policy' }
      : { id: 'coep', title: 'Cross-Origin-Embedder-Policy', status: 'info', detail: 'Not set — only needed for cross-origin isolation (SharedArrayBuffer, precise timers).', header: 'cross-origin-embedder-policy' },
  )
  const corp = get('cross-origin-resource-policy')?.toLowerCase()
  checks.push(
    corp
      ? { id: 'corp', title: 'Cross-Origin-Resource-Policy', status: corp === 'cross-origin' ? 'info' : 'pass', detail: `${corp}${corp === 'cross-origin' ? ' — any site may embed this resource.' : ' — limits which sites can load this resource.'}`, header: 'cross-origin-resource-policy' }
      : { id: 'corp', title: 'Cross-Origin-Resource-Policy', status: 'warn', detail: 'Missing — other sites can embed this resource (Spectre-style side channels).', header: 'cross-origin-resource-policy' },
  )

  // CORS
  const acao = get('access-control-allow-origin')
  const acac = get('access-control-allow-credentials')?.toLowerCase() === 'true'
  if (acao) {
    if (acao.trim() === '*' && acac) checks.push({ id: 'cors', title: 'CORS', status: 'fail', detail: 'Allow-Origin * with Allow-Credentials true is invalid and suggests origin reflection elsewhere.', header: 'access-control-allow-origin' })
    else if (acao.trim() === 'null') checks.push({ id: 'cors', title: 'CORS', status: 'fail', detail: 'Allow-Origin “null” can be obtained by sandboxed iframes and file:// pages.', header: 'access-control-allow-origin' })
    else if (acao.trim() === '*') checks.push({ id: 'cors', title: 'CORS', status: 'info', detail: 'Any origin may read this response (fine for public, non-credentialed APIs).', header: 'access-control-allow-origin' })
    else checks.push({ id: 'cors', title: 'CORS', status: 'pass', detail: `Restricted to ${acao}${acac ? ' with credentials' : ''}.`, header: 'access-control-allow-origin' })
  }

  // Cookies
  const cookies = all('set-cookie').map((h) => parseSetCookie(h.value))
  if (cookies.length) {
    const fails = cookies.filter((c) => c.issues.some((i) => i.severity === 'fail'))
    const warns = cookies.filter((c) => c.issues.some((i) => i.severity === 'warn'))
    checks.push({
      id: 'cookies',
      title: `Cookie flags (${cookies.length})`,
      status: fails.length ? 'fail' : warns.length ? 'warn' : 'pass',
      detail: fails.length
        ? `${fails.map((c) => c.name || '(unnamed)').join(', ')}: ${fails[0].issues.find((i) => i.severity === 'fail')!.message}`
        : warns.length
          ? `${warns.map((c) => c.name || '(unnamed)').join(', ')}: ${warns[0].issues[0].message}`
          : 'All cookies are Secure, HttpOnly and have SameSite.',
      header: 'set-cookie',
    })
  }

  // Information leakage
  const leaks: string[] = []
  const server = get('server')
  if (server && /\d/.test(server)) leaks.push(`Server: ${server}`)
  for (const n of ['x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version', 'x-generator', 'x-runtime', 'x-drupal-cache', 'x-backend-server']) {
    const v = all(n)[0]
    if (v) leaks.push(`${v.name}: ${v.value}`)
  }
  checks.push(
    leaks.length
      ? { id: 'leaks', title: 'Information disclosure', status: 'warn', detail: `${leaks.join('; ')} — reveals software/versions useful for targeting known vulnerabilities.`, header: leaks[0].split(':')[0].toLowerCase() }
      : { id: 'leaks', title: 'Information disclosure', status: 'pass', detail: server ? `Server “${server}” does not expose a version.` : 'No version-revealing headers found.', header: 'server' },
  )

  // Legacy XSS filter
  const xxp = get('x-xss-protection')
  if (xxp && xxp.trim() !== '0') checks.push({ id: 'xxp', title: 'X-XSS-Protection', status: 'warn', detail: `“${xxp}” enables a removed browser filter that could itself introduce leaks — set it to 0 or remove it.`, header: 'x-xss-protection' })

  return checks
}

export function auditSummary(checks: AuditCheck[]) {
  return {
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
    info: checks.filter((c) => c.status === 'info').length,
  }
}

// ---------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------

export const SAMPLE_RESPONSE = `HTTP/2 200 OK
date: Tue, 13 Oct 2026 09:12:44 GMT
content-type: text/html; charset=utf-8
content-length: 48213
cache-control: public, max-age=300, s-maxage=3600, stale-while-revalidate=60
etag: W/"bc3a-18f2a0c41d0"
vary: Accept-Encoding, Cookie
content-encoding: br
server: nginx/1.25.3
x-powered-by: Express
strict-transport-security: max-age=31536000; includeSubDomains
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.example.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-ancestors 'none'; base-uri 'self'
x-content-type-options: nosniff
referrer-policy: strict-origin-when-cross-origin
permissions-policy: camera=(), microphone=(), geolocation=(self "https://maps.example.com"), interest-cohort=()
cross-origin-opener-policy: same-origin
set-cookie: session=8f2c1e9a7b; Path=/; Secure; HttpOnly; SameSite=Lax
set-cookie: prefs=theme%3Ddark; Path=/; Max-Age=31536000
set-cookie: __Host-csrf=Zm9vYmFy; Path=/; Secure; HttpOnly; SameSite=Strict
link: </assets/app.css>; rel=preload; as=style, <https://fonts.example.com>; rel=preconnect; crossorigin
x-request-id: 4d1f8a2e-77c0-4b3e-9d8a-2f3c1b0a9e11`

export const SAMPLE_REQUEST = `GET /api/v2/orders?status=open&limit=50 HTTP/1.1
Host: api.example.com
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36
Accept: application/json, text/plain;q=0.9, */*;q=0.8
Accept-Language: en-GB,en;q=0.9,de;q=0.7
Accept-Encoding: gzip, deflate, br, zstd
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3JfMTIzNDUiLCJpc3MiOiJodHRwczovL2F1dGguZXhhbXBsZS5jb20iLCJleHAiOjE5MjQ5OTIwMDB9.c2lnbmF0dXJl
Cookie: session=8f2c1e9a7b; prefs=theme%3Ddark
If-None-Match: W/"bc3a-18f2a0c41d0"
Origin: https://app.example.com
Referer: https://app.example.com/orders
Sec-Fetch-Site: same-site
Sec-Fetch-Mode: cors
Sec-Fetch-Dest: empty
X-Request-Id: 4d1f8a2e-77c0-4b3e-9d8a-2f3c1b0a9e11`
