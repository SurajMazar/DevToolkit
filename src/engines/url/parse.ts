import { hostnameToUnicode } from './punycode'

export const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443, 'ws:': 80, 'wss:': 443, 'ftp:': 21 }
const SPECIAL = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:', 'file:'])

export interface QueryParam {
  key: string
  value: string
  /** Written without `=` (e.g. `?debug`). Serialized the same way while the value stays empty. */
  bare?: boolean
}

export interface ParsedUrl {
  href: string
  protocol: string
  username: string
  password: string
  /** ASCII (punycode) hostname, as the URL API returns it. */
  hostname: string
  /** Hostname with punycode labels decoded for display. */
  hostnameUnicode: string
  port: string
  /** Default port of the scheme, if it has one. */
  defaultPort: number | null
  host: string
  origin: string
  pathname: string
  /** Decoded path segments. */
  segments: string[]
  search: string
  hash: string
  hashDecoded: string
  params: QueryParam[]
  isSpecial: boolean
  /** The input explicitly wrote the scheme's default port (the URL API drops it). */
  droppedDefaultPort: boolean
}

export type ParseUrlResult = { ok: true; url: ParsedUrl } | { ok: false; error: string }

/** decodeURIComponent that never throws (malformed `%` sequences are kept literally). */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s.replace(/%[0-9a-f]{2}/gi, (m) => {
      try {
        return decodeURIComponent(m)
      } catch {
        return m
      }
    })
  }
}

/** Decodes an `application/x-www-form-urlencoded` component (`+` is a space). */
export function decodeQueryComponent(s: string): string {
  return safeDecode(s.replace(/\+/g, ' '))
}

/**
 * Percent-encodes a query key or value. Keeps RFC 3986 unreserved characters and the
 * readable query-safe characters `! $ ( ) * , ; : @ /  ?`; encodes `& = + # %` and spaces.
 */
export function encodeQueryComponent(s: string, spaceAsPlus = true): string {
  let out = ''
  for (const ch of s) {
    if (/[A-Za-z0-9\-._~!$()*,;:@/?]/.test(ch)) out += ch
    else if (ch === ' ') out += spaceAsPlus ? '+' : '%20'
    else {
      try {
        out += encodeURIComponent(ch)
      } catch {
        // Lone surrogate — encode as U+FFFD like the URL standard does.
        out += '%EF%BF%BD'
      }
    }
  }
  return out
}

export function parseQuery(search: string): QueryParam[] {
  const s = search.startsWith('?') ? search.slice(1) : search
  if (!s) return []
  return s
    .split('&')
    .filter((part) => part !== '')
    .map((part) => {
      const eq = part.indexOf('=')
      if (eq === -1) return { key: decodeQueryComponent(part), value: '', bare: true }
      return { key: decodeQueryComponent(part.slice(0, eq)), value: decodeQueryComponent(part.slice(eq + 1)) }
    })
}

export function serializeQuery(params: QueryParam[], spaceAsPlus = true): string {
  return params
    .map((p) => {
      const k = encodeQueryComponent(p.key, spaceAsPlus)
      return p.bare && p.value === '' ? k : `${k}=${encodeQueryComponent(p.value, spaceAsPlus)}`
    })
    .join('&')
}

function explainInvalid(input: string, base?: string): string {
  const s = input.trim()
  if (!s) return 'Enter a URL'
  if (/\s/.test(s.replace(/^\s+|\s+$/g, '')) && !/^[a-z][a-z0-9+.-]*:/i.test(s)) return 'URLs cannot contain unencoded spaces before the scheme'
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && !base) {
    if (/^\/\//.test(s)) return 'Protocol-relative URL (“//host…”) — set a base URL to resolve it'
    if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(s)) return `Missing scheme — did you mean “https://${s}”?`
    return 'Relative URL — add a scheme (e.g. https://) or set a base URL to resolve it against'
  }
  const portMatch = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(?:\[[^\]]*\]|[^:/?#]*):([^/?#]*)/i.exec(s)
  if (portMatch) {
    const port = portMatch[1]
    if (!/^\d*$/.test(port)) return `Invalid port “${port}” — ports are numbers`
    if (port && Number(port) > 65535) return `Invalid port ${port} — the maximum is 65535`
  }
  if (/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?[^/?#]*[\s<>^|%"]/i.test(s)) return 'The host contains characters that are not allowed (spaces, <, >, ^, |, ", or a bad % escape)'
  if (/^(https?|wss?|ftp):\/\/(?:[^@/?#]*@)?(?:[/?#]|$)/i.test(s)) return 'The URL has no host'
  if (base && !/^[a-z][a-z0-9+.-]*:/i.test(base.trim())) return 'The base URL must be absolute (start with a scheme like https://)'
  return 'Invalid URL'
}

export function parseUrl(input: string, base?: string): ParseUrlResult {
  const s = input.trim()
  if (!s) return { ok: false, error: 'Enter a URL' }
  let u: URL
  try {
    u = base?.trim() ? new URL(s, base.trim()) : new URL(s)
  } catch {
    return { ok: false, error: explainInvalid(s, base?.trim() || undefined) }
  }
  const defaultPort = DEFAULT_PORTS[u.protocol] ?? null
  let droppedDefaultPort = false
  if (defaultPort !== null && u.port === '') {
    const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(?:\[[^\]]*\]|[^:/?#]*):(\d+)/i.exec(s)
    if (m && Number(m[1]) === defaultPort) droppedDefaultPort = true
  }
  const pathname = u.pathname
  const segments = pathname.startsWith('/') ? pathname.slice(1).split('/').map(safeDecode) : pathname ? [safeDecode(pathname)] : []
  return {
    ok: true,
    url: {
      href: u.href,
      protocol: u.protocol,
      username: safeDecode(u.username),
      password: safeDecode(u.password),
      hostname: u.hostname,
      hostnameUnicode: hostnameToUnicode(u.hostname),
      port: u.port,
      defaultPort,
      host: u.host,
      origin: u.origin,
      pathname,
      segments: pathname === '/' ? [] : segments,
      search: u.search,
      hash: u.hash,
      hashDecoded: safeDecode(u.hash.replace(/^#/, '')),
      params: parseQuery(u.search),
      isSpecial: SPECIAL.has(u.protocol),
      droppedDefaultPort,
    },
  }
}

export type UrlPart = 'protocol' | 'username' | 'password' | 'hostname' | 'port' | 'pathname' | 'hash'

export type ApplyResult = { ok: true; href: string } | { ok: false; error: string }

/**
 * Sets one part of a URL through the WHATWG setters, but reports values the setters would
 * silently ignore (an invalid port, switching between special and non-special schemes…).
 */
export function applyUrlPart(href: string, part: UrlPart, value: string): ApplyResult {
  let u: URL
  try {
    u = new URL(href)
  } catch {
    return { ok: false, error: 'Invalid URL' }
  }
  const v = value.trim()
  switch (part) {
    case 'protocol': {
      const scheme = v.replace(/:?$/, ':').toLowerCase()
      if (!/^[a-z][a-z0-9+.-]*:$/.test(scheme)) return { ok: false, error: 'A scheme starts with a letter and may contain letters, digits, +, - and .' }
      if (SPECIAL.has(scheme) !== SPECIAL.has(u.protocol)) return { ok: false, error: `Cannot switch between ${u.protocol} and ${scheme} — the URL standard forbids changing between special and non-special schemes. Edit the full URL instead.` }
      u.protocol = scheme
      if (u.protocol !== scheme) return { ok: false, error: `The scheme cannot be changed to ${scheme} for this URL` }
      break
    }
    case 'port': {
      if (v && !/^\d+$/.test(v)) return { ok: false, error: 'The port must be a number' }
      if (v && Number(v) > 65535) return { ok: false, error: 'The port must be at most 65535' }
      if (u.protocol === 'file:') return { ok: false, error: 'file: URLs cannot have a port' }
      u.port = v
      break
    }
    case 'hostname': {
      if (!v && u.protocol !== 'file:' && SPECIAL.has(u.protocol)) return { ok: false, error: `${u.protocol} URLs need a host` }
      if (/[/?#@\s]/.test(v) || (/:/.test(v) && !/^\[.*\]$/.test(v))) return { ok: false, error: 'Enter the hostname only (no port, path or credentials)' }
      let probe: URL
      try {
        probe = new URL(`${SPECIAL.has(u.protocol) ? u.protocol : 'http:'}//${v}/`)
      } catch {
        return { ok: false, error: `“${v}” is not a valid host` }
      }
      u.hostname = SPECIAL.has(u.protocol) ? probe.hostname : v
      break
    }
    case 'username':
      u.username = value
      break
    case 'password':
      u.password = value
      break
    case 'pathname':
      u.pathname = value
      break
    case 'hash':
      u.hash = value
      break
  }
  return { ok: true, href: u.href }
}

/** Rebuilds the URL with a new query string (from the parameter table). */
export function withQuery(href: string, params: QueryParam[], spaceAsPlus = true): string {
  const u = new URL(href)
  const q = serializeQuery(params, spaceAsPlus)
  u.search = q ? `?${q}` : ''
  // `u.search = ''` leaves no "?"; `URL` would otherwise keep an empty "?" for "?".
  return u.href
}

export function percentEncode(s: string): string {
  try {
    return encodeURIComponent(s)
  } catch {
    return s
  }
}
