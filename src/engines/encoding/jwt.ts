/**
 * JSON Web Token (JWS compact serialization) decoding, claim explanation and optional
 * signature verification with Web Crypto. Nothing here logs or stores token content.
 */
import { isLosslessNumber, parseJson } from '@/engines/json/parse'
import { stringifyJson } from '@/engines/json/stringify'

// ─── base64url ──────────────────────────────────────────────────────────────────

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const B64_LOOKUP = (() => {
  const t = new Int16Array(128).fill(-1)
  for (let i = 0; i < 64; i++) t[B64URL.charCodeAt(i)] = i
  // Tolerate the standard alphabet too (reported as a warning by the caller).
  t['+'.charCodeAt(0)] = 62
  t['/'.charCodeAt(0)] = 63
  return t
})()

export class Base64UrlError extends Error {
  /** Offset within the segment. */
  position: number
  constructor(message: string, position: number) {
    super(message)
    this.name = 'Base64UrlError'
    this.position = position
  }
}

/** Strict base64url decoder (padding tolerated). Throws Base64UrlError with the bad position. */
export function base64UrlDecode(s: string): Uint8Array {
  let end = s.length
  while (end > 0 && s[end - 1] === '=') end--
  if (s.length - end > 2) throw new Base64UrlError('Too much "=" padding', end)
  const len = end
  if (len % 4 === 1) throw new Base64UrlError(`Invalid length (${len} characters) — the segment is truncated or has an extra character`, len - 1)
  const out = new Uint8Array(Math.floor((len * 3) / 4))
  let o = 0
  let buf = 0
  let bits = 0
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(i)
    const v = c < 128 ? B64_LOOKUP[c] : -1
    if (v < 0) throw new Base64UrlError(`Invalid character "${s[i]}" at position ${i + 1} — base64url only uses A–Z a–z 0–9 - _`, i)
    buf = (buf << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (buf >> bits) & 0xff
    }
  }
  return out.subarray(0, o)
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64URL[n >> 18] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63] + B64URL[n & 63]
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i] << 16
    out += B64URL[n >> 18] + B64URL[(n >> 12) & 63]
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += B64URL[n >> 18] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63]
  }
  return out
}

const utf8 = new TextEncoder()
const utf8Strict = new TextDecoder('utf-8', { fatal: true })

// ─── parsing ────────────────────────────────────────────────────────────────────

export type JwtSegment = 'header' | 'payload' | 'signature' | 'token'

export interface JwtError {
  segment: JwtSegment
  message: string
  /** Offset into the normalized token, when known. */
  offset?: number
}

export interface NormalizedToken {
  token: string
  /** "Bearer" (or other auth scheme) that was stripped. */
  scheme: string | null
  /** Whitespace/newlines/quotes were removed from inside the token. */
  cleaned: boolean
}

/** Accepts "Bearer xxx", "Authorization: Bearer xxx", quoted tokens and wrapped lines. */
export function normalizeToken(input: string): NormalizedToken {
  let s = input.trim()
  let scheme: string | null = null
  const header = /^authorization\s*:\s*/i.exec(s)
  if (header) s = s.slice(header[0].length)
  const m = /^(bearer|jwt|token)\s+/i.exec(s)
  if (m) {
    scheme = m[1]
    s = s.slice(m[0].length)
  }
  const before = s
  s = s.replace(/^["'`]|["'`]$/g, '').replace(/\s+/g, '')
  return { token: s, scheme, cleaned: s !== before }
}

export interface SegmentRange {
  segment: 'header' | 'payload' | 'signature' | 'encryptedKey' | 'iv' | 'ciphertext' | 'tag'
  start: number
  end: number
}

export interface DecodedJws {
  kind: 'jws'
  token: string
  scheme: string | null
  cleaned: boolean
  parts: [string, string, string]
  ranges: SegmentRange[]
  header: Record<string, unknown>
  headerJson: string
  /** Parsed JSON payload (claims), or null when the payload is not a JSON object. */
  payload: Record<string, unknown> | null
  /** Pretty-printed payload (JSON) or the raw payload text. */
  payloadText: string
  payloadIsJson: boolean
  signature: Uint8Array
  alg: string | null
  warnings: string[]
}

export interface DecodedJwe {
  kind: 'jwe'
  token: string
  scheme: string | null
  cleaned: boolean
  ranges: SegmentRange[]
  header: Record<string, unknown>
  headerJson: string
  warnings: string[]
}

export type JwtParseResult = { ok: true; value: DecodedJws | DecodedJwe } | { ok: false; error: JwtError; ranges: SegmentRange[]; token: string }

function rangesFor(parts: string[], names: SegmentRange['segment'][]): SegmentRange[] {
  const out: SegmentRange[] = []
  let at = 0
  parts.forEach((p, i) => {
    out.push({ segment: names[i] ?? 'payload', start: at, end: at + p.length })
    at += p.length + 1
  })
  return out
}

function decodeJsonSegment(seg: string, name: 'header' | 'payload', offset: number): { value: unknown; text: string } | JwtError {
  if (!seg) return { segment: name, message: `The ${name} segment is empty`, offset }
  let bytes: Uint8Array
  try {
    bytes = base64UrlDecode(seg)
  } catch (e) {
    const err = e as Base64UrlError
    return { segment: name, message: `The ${name} is not valid base64url: ${err.message}`, offset: offset + (err.position ?? 0) }
  }
  let text: string
  try {
    text = utf8Strict.decode(bytes)
  } catch {
    return { segment: name, message: `The ${name} does not decode to UTF-8 text`, offset }
  }
  const parsed = parseJson(text)
  if (!parsed.ok) return { segment: name, message: `The ${name} is not valid JSON: ${parsed.error.message}`, offset }
  return { value: parsed.value, text }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Converts LosslessNumber values to numbers for claim logic (display uses the lossless text). */
function plain(v: unknown): unknown {
  if (isLosslessNumber(v)) return Number(v.value)
  if (Array.isArray(v)) return v.map(plain)
  if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]))
  return v
}

export function parseJwt(input: string): JwtParseResult {
  const norm = normalizeToken(input)
  const { token } = norm
  const parts = token.split('.')
  const warnings: string[] = []
  if (!token) return { ok: false, error: { segment: 'token', message: 'Paste a token' }, ranges: [], token }

  if (parts.length === 5) {
    const ranges = rangesFor(parts, ['header', 'encryptedKey', 'iv', 'ciphertext', 'tag'])
    const h = decodeJsonSegment(parts[0], 'header', 0)
    if ('segment' in h) return { ok: false, error: h, ranges, token }
    if (!isRecord(h.value)) return { ok: false, error: { segment: 'header', message: 'The JWE header must be a JSON object', offset: 0 }, ranges, token }
    return {
      ok: true,
      value: { kind: 'jwe', token, scheme: norm.scheme, cleaned: norm.cleaned, ranges, header: plain(h.value) as Record<string, unknown>, headerJson: stringifyJson(h.value, { indent: 2 }), warnings },
    }
  }
  if (parts.length !== 3) {
    const ranges = rangesFor(parts, ['header', 'payload', 'signature'])
    const hint = parts.length === 1 ? 'there are no "." separators' : `found ${parts.length} segments`
    return {
      ok: false,
      error: { segment: 'token', message: `A JWT has three base64url segments separated by dots (header.payload.signature) — ${hint}. Encrypted JWE tokens have five.` },
      ranges,
      token,
    }
  }
  const ranges = rangesFor(parts, ['header', 'payload', 'signature'])
  const [hs, ps, ss] = parts as [string, string, string]
  if (/[+/=]/.test(token)) warnings.push('The token contains "+", "/" or "=" — JWTs must use unpadded base64url ("-" and "_"). Some libraries will reject it.')

  const h = decodeJsonSegment(hs, 'header', 0)
  if ('segment' in h) return { ok: false, error: h, ranges, token }
  if (!isRecord(h.value)) return { ok: false, error: { segment: 'header', message: 'The header must be a JSON object', offset: 0 }, ranges, token }
  const header = plain(h.value) as Record<string, unknown>
  const alg = typeof header.alg === 'string' ? header.alg : null
  if (!alg) warnings.push('The header has no "alg" parameter — it is required (RFC 7515 §4.1.1).')

  // Payload: usually JSON claims, but a JWS may carry any bytes.
  let payload: Record<string, unknown> | null = null
  let payloadText = ''
  let payloadIsJson = false
  if (header.b64 === false) {
    payloadText = ps
    warnings.push('The header sets "b64": false (RFC 7797) — the payload is not base64url-encoded.')
  } else {
    let bytes: Uint8Array
    try {
      bytes = base64UrlDecode(ps)
    } catch (e) {
      const err = e as Base64UrlError
      return { ok: false, error: { segment: 'payload', message: `The payload is not valid base64url: ${err.message}`, offset: hs.length + 1 + err.position }, ranges, token }
    }
    let text: string | null = null
    try {
      text = utf8Strict.decode(bytes)
    } catch {
      text = null
    }
    if (text === null) {
      payloadText = `<${bytes.length} bytes of binary data>`
      warnings.push('The payload is binary (not UTF-8 text), so there are no claims to show.')
    } else {
      const parsed = parseJson(text)
      if (parsed.ok && isRecord(parsed.value)) {
        payload = plain(parsed.value) as Record<string, unknown>
        payloadText = stringifyJson(parsed.value, { indent: 2 })
        payloadIsJson = true
      } else {
        payloadText = text
        warnings.push(parsed.ok ? 'The payload is JSON but not an object, so it has no claims.' : 'The payload is not JSON — this is a JWS with an arbitrary payload, not a JWT with claims.')
      }
    }
  }

  let signature: Uint8Array
  try {
    signature = base64UrlDecode(ss)
  } catch (e) {
    const err = e as Base64UrlError
    return { ok: false, error: { segment: 'signature', message: `The signature is not valid base64url: ${err.message}`, offset: hs.length + ps.length + 2 + err.position }, ranges, token }
  }
  if (alg && alg.toLowerCase() === 'none' && signature.length > 0) warnings.push('"alg": "none" but the token still has a signature segment — it should be empty.')
  if (alg && alg.toLowerCase() !== 'none' && signature.length === 0) warnings.push(`The header says "alg": "${alg}" but the signature segment is empty.`)

  return {
    ok: true,
    value: {
      kind: 'jws',
      token,
      scheme: norm.scheme,
      cleaned: norm.cleaned,
      parts: [hs, ps, ss],
      ranges,
      header,
      headerJson: stringifyJson(h.value, { indent: 2 }),
      payload,
      payloadText,
      payloadIsJson,
      signature,
      alg,
      warnings,
    },
  }
}

// ─── claims ─────────────────────────────────────────────────────────────────────

export interface ClaimInfo {
  name: string
  description: string
  registered?: boolean
  time?: boolean
}

export const CLAIMS: Record<string, ClaimInfo> = {
  iss: { name: 'Issuer', description: 'Who created and signed the token', registered: true },
  sub: { name: 'Subject', description: 'Whom the token is about (usually a user ID)', registered: true },
  aud: { name: 'Audience', description: 'Recipients the token is intended for — consumers must reject tokens not addressed to them', registered: true },
  exp: { name: 'Expiration time', description: 'The token must not be accepted on or after this time', registered: true, time: true },
  nbf: { name: 'Not before', description: 'The token must not be accepted before this time', registered: true, time: true },
  iat: { name: 'Issued at', description: 'When the token was issued', registered: true, time: true },
  jti: { name: 'JWT ID', description: 'Unique identifier — lets servers detect replays', registered: true },
  scope: { name: 'Scope', description: 'Space-separated OAuth 2.0 scopes granted (RFC 8693)' },
  scp: { name: 'Scopes', description: 'Granted scopes (Microsoft / Okta style)' },
  azp: { name: 'Authorized party', description: 'Client the token was issued to (OpenID Connect)' },
  client_id: { name: 'Client ID', description: 'OAuth client that requested the token (RFC 9068)' },
  email: { name: 'Email', description: 'User’s email address (OpenID Connect)' },
  email_verified: { name: 'Email verified', description: 'Whether the provider verified the email address' },
  name: { name: 'Full name', description: 'User’s display name (OpenID Connect)' },
  given_name: { name: 'Given name', description: 'First name (OpenID Connect)' },
  family_name: { name: 'Family name', description: 'Last name (OpenID Connect)' },
  preferred_username: { name: 'Username', description: 'Shorthand name the user prefers (not unique)' },
  picture: { name: 'Picture', description: 'Profile picture URL' },
  locale: { name: 'Locale', description: 'User’s locale' },
  nonce: { name: 'Nonce', description: 'Value from the authentication request — mitigates replay (OpenID Connect)' },
  auth_time: { name: 'Authentication time', description: 'When the user actually authenticated', time: true },
  updated_at: { name: 'Updated at', description: 'When the user’s profile was last updated', time: true },
  acr: { name: 'Auth context class', description: 'Authentication assurance level' },
  amr: { name: 'Auth methods', description: 'How the user authenticated (pwd, mfa, otp…)' },
  sid: { name: 'Session ID', description: 'Identifier of the user’s session at the provider' },
  at_hash: { name: 'Access token hash', description: 'Binds an ID token to an access token' },
  c_hash: { name: 'Code hash', description: 'Binds an ID token to an authorization code' },
  roles: { name: 'Roles', description: 'Roles assigned to the subject (application-defined)' },
  groups: { name: 'Groups', description: 'Groups the subject belongs to (application-defined)' },
  permissions: { name: 'Permissions', description: 'Granted permissions (application-defined, e.g. Auth0)' },
  tid: { name: 'Tenant ID', description: 'Microsoft Entra tenant' },
  oid: { name: 'Object ID', description: 'Microsoft Entra object (user) ID' },
  cnf: { name: 'Confirmation', description: 'Proof-of-possession key binding (RFC 7800)' },
  act: { name: 'Actor', description: 'Party acting on behalf of the subject (token exchange, RFC 8693)' },
  typ: { name: 'Type', description: 'Token type (application-defined)' },
}

export const HEADER_PARAMS: Record<string, string> = {
  alg: 'Signature or MAC algorithm',
  typ: 'Media type of the token (usually JWT)',
  kid: 'Key ID — which key the issuer used; look it up in the issuer’s JWKS',
  cty: 'Content type of the payload (JWT for nested tokens)',
  jku: 'URL of the issuer’s JWK Set — never fetch keys from a URL the token itself provides',
  jwk: 'Embedded public key — never trust a key the token supplies about itself',
  x5u: 'URL of an X.509 certificate chain',
  x5c: 'Embedded X.509 certificate chain',
  x5t: 'SHA-1 thumbprint of the X.509 certificate',
  'x5t#S256': 'SHA-256 thumbprint of the X.509 certificate',
  crit: 'Extensions that must be understood',
  enc: 'Content encryption algorithm (JWE)',
  zip: 'Compression applied before encryption (JWE)',
  b64: 'Whether the payload is base64url-encoded (RFC 7797)',
}

export const ALG_DESCRIPTIONS: Record<string, string> = {
  HS256: 'HMAC with SHA-256 (shared secret)',
  HS384: 'HMAC with SHA-384 (shared secret)',
  HS512: 'HMAC with SHA-512 (shared secret)',
  RS256: 'RSA PKCS#1 v1.5 with SHA-256',
  RS384: 'RSA PKCS#1 v1.5 with SHA-384',
  RS512: 'RSA PKCS#1 v1.5 with SHA-512',
  PS256: 'RSA-PSS with SHA-256',
  PS384: 'RSA-PSS with SHA-384',
  PS512: 'RSA-PSS with SHA-512',
  ES256: 'ECDSA P-256 with SHA-256',
  ES384: 'ECDSA P-384 with SHA-384',
  ES512: 'ECDSA P-521 with SHA-512',
  EdDSA: 'Edwards-curve signature (Ed25519)',
  none: 'Unsigned — no integrity protection',
}

export interface TimeClaim {
  seconds: number
  date: Date
  /** The value looks like milliseconds instead of seconds. */
  looksLikeMs: boolean
}

export function readTime(v: unknown): TimeClaim | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const looksLikeMs = v > 1e11
  return { seconds: v, date: new Date(v * 1000), looksLikeMs }
}

const UNITS: [string, number][] = [
  ['year', 365 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
]

/** "3 days", "2 hours 5 minutes", "45 seconds" — at most two units. */
export function humanizeSeconds(total: number): string {
  let s = Math.round(Math.abs(total))
  if (s === 0) return '0 seconds'
  const out: string[] = []
  for (const [name, size] of UNITS) {
    if (s >= size) {
      const n = Math.floor(s / size)
      s -= n * size
      out.push(`${n} ${name}${n === 1 ? '' : 's'}`)
      if (out.length === 2) break
    } else if (out.length) break
  }
  return out.join(' ')
}

export function relativeTime(seconds: number, nowSeconds: number): string {
  const d = seconds - nowSeconds
  if (Math.abs(d) < 1) return 'now'
  return d > 0 ? `in ${humanizeSeconds(d)}` : `${humanizeSeconds(d)} ago`
}

export type TokenState = 'valid' | 'expired' | 'not-yet-valid' | 'no-expiry' | 'invalid-claims'

export interface TokenStatus {
  state: TokenState
  label: string
  detail?: string
}

/** Time-based status of the claims at `now` (seconds). Says nothing about authenticity. */
export function tokenStatus(payload: Record<string, unknown> | null, nowSeconds: number): TokenStatus {
  if (!payload) return { state: 'no-expiry', label: 'No claims', detail: 'The payload is not a JSON object' }
  const bad: string[] = []
  for (const k of ['exp', 'nbf', 'iat'] as const) if (k in payload && readTime(payload[k]) === null) bad.push(k)
  if (bad.length) return { state: 'invalid-claims', label: `Invalid ${bad.join(', ')}`, detail: 'Time claims must be NumericDate values (seconds since 1970-01-01 UTC)' }
  const exp = readTime(payload.exp)
  const nbf = readTime(payload.nbf)
  if (nbf && nbf.seconds > nowSeconds) return { state: 'not-yet-valid', label: 'Not yet valid', detail: `Becomes valid in ${humanizeSeconds(nbf.seconds - nowSeconds)}` }
  if (!exp) return { state: 'no-expiry', label: 'No expiry', detail: 'There is no "exp" claim — the token never expires on its own' }
  if (exp.seconds <= nowSeconds) return { state: 'expired', label: `Expired ${humanizeSeconds(nowSeconds - exp.seconds)} ago` }
  return { state: 'valid', label: `Valid for ${humanizeSeconds(exp.seconds - nowSeconds).replace(/^(\d+) /, '$1 more ')}` }
}

export interface ClaimRow {
  key: string
  info?: ClaimInfo
  /** Value rendered compactly (JSON for non-strings). */
  display: string
  time?: TimeClaim
  note?: string
  tone?: 'danger' | 'warn' | 'ok'
}

export function describeClaims(payload: Record<string, unknown>, nowSeconds: number): ClaimRow[] {
  const keys = Object.keys(payload)
  const order = (k: string) => {
    const i = ['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti'].indexOf(k)
    return i === -1 ? (CLAIMS[k] ? 100 : 200) : i
  }
  return keys
    .sort((a, b) => order(a) - order(b))
    .map((key) => {
      const v = payload[key]
      const info = CLAIMS[key]
      const display = typeof v === 'string' ? v : JSON.stringify(v)
      const row: ClaimRow = { key, info, display }
      if (info?.time) {
        const t = readTime(v)
        if (!t) {
          row.note = 'Not a NumericDate (seconds since epoch)'
          row.tone = 'danger'
        } else {
          row.time = t
          if (t.looksLikeMs) {
            row.note = 'Looks like milliseconds — JWT times are in seconds'
            row.tone = 'warn'
          } else if (key === 'exp') row.tone = t.seconds <= nowSeconds ? 'danger' : 'ok'
          else if (key === 'nbf' && t.seconds > nowSeconds) row.tone = 'warn'
          else if (key === 'iat' && t.seconds > nowSeconds + 60) {
            row.note = 'Issued in the future — clock skew or a forged token'
            row.tone = 'warn'
          }
        }
      }
      if (key === 'aud' && Array.isArray(v)) row.display = v.map(String).join(', ')
      if ((key === 'scope' || key === 'scp') && typeof v === 'string') row.display = v
      return row
    })
}

// ─── verification ───────────────────────────────────────────────────────────────

export type KeyFormat = 'text' | 'base64'

export class JwtVerifyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JwtVerifyError'
  }
}

const HASH: Record<string, string> = { '256': 'SHA-256', '384': 'SHA-384', '512': 'SHA-512' }
const CURVE: Record<string, string> = { ES256: 'P-256', ES384: 'P-384', ES512: 'P-521' }
const EC_SIG_LEN: Record<string, number> = { ES256: 64, ES384: 96, ES512: 132 }

export const SUPPORTED_ALGS = ['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'] as const

export function algFamily(alg: string): 'hmac' | 'rsa' | 'pss' | 'ec' | 'ed' | null {
  if (/^HS(256|384|512)$/.test(alg)) return 'hmac'
  if (/^RS(256|384|512)$/.test(alg)) return 'rsa'
  if (/^PS(256|384|512)$/.test(alg)) return 'pss'
  if (/^ES(256|384|512)$/.test(alg)) return 'ec'
  if (alg === 'EdDSA' || alg === 'Ed25519') return 'ed'
  return null
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle
  if (!s) throw new JwtVerifyError('Web Crypto is unavailable — signature verification needs a secure context (HTTPS or localhost).')
  return s
}

// Minimal DER reader, enough to locate SubjectPublicKeyInfo in certificates and identify key types.
interface Tlv {
  tag: number
  start: number
  /** Content start. */
  body: number
  end: number
}

function readTlv(b: Uint8Array, at: number): Tlv {
  if (at + 2 > b.length) throw new JwtVerifyError('Malformed DER data (truncated)')
  const tag = b[at]
  let len = b[at + 1]
  let body = at + 2
  if (len & 0x80) {
    const n = len & 0x7f
    if (n === 0 || n > 4) throw new JwtVerifyError('Malformed DER data (bad length)')
    len = 0
    for (let i = 0; i < n; i++) len = len * 256 + b[body + i]
    body += n
  }
  const end = body + len
  if (end > b.length) throw new JwtVerifyError('Malformed DER data (length exceeds input)')
  return { tag, start: at, body, end }
}

function children(b: Uint8Array, t: Tlv): Tlv[] {
  const out: Tlv[] = []
  for (let at = t.body; at < t.end; ) {
    const c = readTlv(b, at)
    out.push(c)
    at = c.end
  }
  return out
}

const OID = {
  rsa: '2a864886f70d010101',
  rsaPss: '2a864886f70d01010a',
  ec: '2a8648ce3d0201',
  p256: '2a8648ce3d030107',
  p384: '2b81040022',
  p521: '2b81040023',
  ed25519: '2b6570',
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

export interface SpkiInfo {
  type: 'RSA' | 'RSA-PSS' | 'EC' | 'Ed25519' | 'unknown'
  curve?: 'P-256' | 'P-384' | 'P-521'
}

export function inspectSpki(spki: Uint8Array): SpkiInfo {
  const root = readTlv(spki, 0)
  const [alg] = children(spki, root)
  if (!alg) return { type: 'unknown' }
  const [oid, params] = children(spki, alg)
  const oidHex = toHex(spki.subarray(oid.body, oid.end))
  if (oidHex === OID.rsa) return { type: 'RSA' }
  if (oidHex === OID.rsaPss) return { type: 'RSA-PSS' }
  if (oidHex === OID.ed25519) return { type: 'Ed25519' }
  if (oidHex === OID.ec) {
    const c = params && params.tag === 0x06 ? toHex(spki.subarray(params.body, params.end)) : ''
    return { type: 'EC', curve: c === OID.p256 ? 'P-256' : c === OID.p384 ? 'P-384' : c === OID.p521 ? 'P-521' : undefined }
  }
  return { type: 'unknown' }
}

/** Extracts the SubjectPublicKeyInfo from an X.509 certificate (DER). */
export function spkiFromCertificate(der: Uint8Array): Uint8Array {
  const cert = readTlv(der, 0)
  const [tbs] = children(der, cert)
  if (!tbs) throw new JwtVerifyError('Malformed certificate')
  const fields = children(der, tbs)
  const i = fields[0]?.tag === 0xa0 ? 1 : 0
  // serialNumber, signature, issuer, validity, subject, subjectPublicKeyInfo
  const spki = fields[i + 5]
  if (!spki || spki.tag !== 0x30) throw new JwtVerifyError('Could not find the public key inside the certificate')
  return der.slice(spki.start, spki.end)
}

function derLength(n: number): number[] {
  if (n < 0x80) return [n]
  const out: number[] = []
  while (n > 0) {
    out.unshift(n & 0xff)
    n >>= 8
  }
  return [0x80 | out.length, ...out]
}

/** Wraps a PKCS#1 RSAPublicKey in a SubjectPublicKeyInfo. */
export function pkcs1ToSpki(pkcs1: Uint8Array): Uint8Array {
  const algId = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]
  const bitString = [0x03, ...derLength(pkcs1.length + 1), 0x00]
  const body = [...algId, ...bitString]
  const total = body.length + pkcs1.length
  const out = new Uint8Array([0x30, ...derLength(total), ...body, ...pkcs1])
  return out
}

function base64ToBytesLoose(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (/[^A-Za-z0-9+/=]/.test(clean)) throw new JwtVerifyError('The key contains characters that are not Base64')
  return base64UrlDecode(clean.replace(/=+$/, ''))
}

export interface PemBlock {
  label: string
  der: Uint8Array
}

export function parsePem(text: string): PemBlock | null {
  const m = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(text)
  if (!m) return null
  const body = m[2].replace(/^[A-Za-z-]+:.*$/gm, '') // drop RFC 1421 headers
  return { label: m[1], der: base64ToBytesLoose(body) }
}

export interface PreparedKey {
  key: CryptoKey
  description: string
  warnings: string[]
}

function importParams(alg: string, curve?: string): AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams | HmacImportParams {
  const fam = algFamily(alg)
  const hash = HASH[alg.slice(2)]
  switch (fam) {
    case 'hmac':
      return { name: 'HMAC', hash }
    case 'rsa':
      return { name: 'RSASSA-PKCS1-v1_5', hash }
    case 'pss':
      return { name: 'RSA-PSS', hash }
    case 'ec':
      return { name: 'ECDSA', namedCurve: curve ?? CURVE[alg] }
    case 'ed':
      return { name: 'Ed25519' }
    default:
      throw new JwtVerifyError(`Unsupported algorithm "${alg}"`)
  }
}

function describeKey(key: CryptoKey): string {
  const a = key.algorithm as RsaHashedKeyAlgorithm & EcKeyAlgorithm & HmacKeyAlgorithm
  if (a.name === 'HMAC') return `HMAC secret · ${a.length ?? '?'} bits`
  if (a.name === 'ECDSA') return `EC public key · ${a.namedCurve}`
  if (a.name === 'Ed25519') return 'Ed25519 public key'
  return `RSA public key · ${a.modulusLength} bits`
}

const PRIVATE_JWK = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth']

/** Imports the verification key from the user's input (secret, PEM, certificate, JWK or JWKS). */
export async function prepareKey(alg: string, input: string, opts: { format?: KeyFormat; kid?: string } = {}): Promise<PreparedKey> {
  const fam = algFamily(alg)
  if (!fam) throw new JwtVerifyError(alg.toLowerCase() === 'none' ? 'Unsigned tokens ("alg": "none") have no signature to verify.' : `"${alg}" is not supported for verification in the browser.`)
  const s = subtle()
  const warnings: string[] = []
  const text = input.trim()
  if (!text) throw new JwtVerifyError(fam === 'hmac' ? 'Enter the shared secret' : 'Paste the public key (PEM, certificate, or JWK)')

  // JWK / JWKS
  if (text.startsWith('{')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      throw new JwtVerifyError(`The key looks like JSON but does not parse: ${(e as Error).message}`)
    }
    let jwk = parsed as JsonWebKey & { kid?: string; keys?: (JsonWebKey & { kid?: string })[] }
    if (Array.isArray(jwk.keys)) {
      const keys = jwk.keys
      const byKid = opts.kid ? keys.find((k) => k.kid === opts.kid) : undefined
      if (opts.kid && !byKid) throw new JwtVerifyError(`The JWK Set has no key with "kid": "${opts.kid}" (it has: ${keys.map((k) => k.kid ?? '—').join(', ') || 'no keys'})`)
      const pick = byKid ?? (keys.length === 1 ? keys[0] : undefined)
      if (!pick) throw new JwtVerifyError('The JWK Set has several keys and the token has no "kid" — paste the single key to use')
      jwk = pick
    }
    if (typeof jwk.kty !== 'string') throw new JwtVerifyError('The JWK has no "kty" member')
    const expectedKty = fam === 'hmac' ? 'oct' : fam === 'ec' ? 'EC' : fam === 'ed' ? 'OKP' : 'RSA'
    if (jwk.kty !== expectedKty) throw new JwtVerifyError(`${alg} needs a "kty": "${expectedKty}" key, but this JWK is "${jwk.kty}"`)
    if (jwk.alg && jwk.alg !== alg) throw new JwtVerifyError(`The JWK is for "${jwk.alg}" but the token uses "${alg}"`)
    const clean: JsonWebKey = { ...jwk }
    delete (clean as { kid?: string }).kid
    delete clean.key_ops
    delete clean.use
    delete clean.alg
    if (fam !== 'hmac' && PRIVATE_JWK.some((k) => k in clean)) {
      for (const k of PRIVATE_JWK) delete (clean as Record<string, unknown>)[k]
      warnings.push('The JWK contained private key material; only the public part was used. Never share private keys.')
    }
    if (fam === 'ec' && clean.crv !== CURVE[alg]) throw new JwtVerifyError(`${alg} requires curve ${CURVE[alg]}, but the key is on ${clean.crv ?? 'an unspecified curve'}`)
    try {
      const key = await s.importKey('jwk', clean, importParams(alg), false, ['verify'])
      return { key, description: describeKey(key), warnings }
    } catch (e) {
      throw new JwtVerifyError(`The browser rejected the JWK: ${(e as Error).message}`)
    }
  }

  if (fam === 'hmac') {
    if (text.includes('-----BEGIN')) throw new JwtVerifyError(`${alg} uses a shared secret, not a PEM key. (If this is the issuer’s public key, the token may be forged with an algorithm-confusion attack.)`)
    let raw: Uint8Array
    if (opts.format === 'base64') {
      try {
        raw = base64ToBytesLoose(input.trim())
      } catch (e) {
        throw new JwtVerifyError(`The secret is not valid Base64: ${(e as Error).message}`)
      }
    } else raw = utf8.encode(input)
    if (raw.length === 0) throw new JwtVerifyError('The secret is empty')
    const minBytes = Number(alg.slice(2)) / 8
    if (raw.length < minBytes) warnings.push(`The secret is ${raw.length} bytes — RFC 7518 requires at least ${minBytes} bytes for ${alg}. Short secrets can be brute-forced.`)
    const key = await s.importKey('raw', raw as BufferSource, importParams(alg), false, ['verify'])
    return { key, description: `HMAC secret · ${raw.length} bytes`, warnings }
  }

  const pem = parsePem(text)
  if (!pem) throw new JwtVerifyError('Paste a PEM public key (-----BEGIN PUBLIC KEY-----), an X.509 certificate, or a JWK')
  if (/PRIVATE KEY/.test(pem.label)) throw new JwtVerifyError('That is a private key. Verification needs only the public key — and private keys should never be pasted into web tools.')
  let spki: Uint8Array
  if (pem.label === 'PUBLIC KEY') spki = pem.der
  else if (pem.label === 'RSA PUBLIC KEY') spki = pkcs1ToSpki(pem.der)
  else if (pem.label === 'CERTIFICATE') spki = spkiFromCertificate(pem.der)
  else throw new JwtVerifyError(`Unsupported PEM block "${pem.label}"`)

  const info = inspectSpki(spki)
  const need = fam === 'ec' ? 'EC' : fam === 'ed' ? 'Ed25519' : 'RSA'
  if (info.type === 'RSA-PSS' && fam === 'pss') throw new JwtVerifyError('RSA-PSS-only (id-RSASSA-PSS) keys cannot be imported by Web Crypto — export the key as a plain RSA public key')
  if (info.type !== need) throw new JwtVerifyError(`${alg} needs ${need === 'EC' ? 'an EC' : need === 'RSA' ? 'an RSA' : 'an Ed25519'} key, but this is ${info.type === 'unknown' ? 'an unrecognised key type' : `${info.type === 'EC' ? 'an EC' : info.type === 'RSA' ? 'an RSA' : `an ${info.type}`} key`}`)
  if (fam === 'ec' && info.curve !== CURVE[alg]) throw new JwtVerifyError(`${alg} requires curve ${CURVE[alg]}, but the key is on ${info.curve ?? 'an unsupported curve'}`)
  try {
    const key = await s.importKey('spki', spki as BufferSource, importParams(alg, info.curve), false, ['verify'])
    if (fam !== 'ec' && fam !== 'ed') {
      const bits = (key.algorithm as RsaHashedKeyAlgorithm).modulusLength
      if (bits < 2048) warnings.push(`The RSA key is only ${bits} bits — 2048 bits is the minimum considered secure.`)
    }
    return { key, description: describeKey(key) + (pem.label === 'CERTIFICATE' ? ' (from certificate)' : ''), warnings }
  } catch (e) {
    throw new JwtVerifyError(e instanceof JwtVerifyError ? e.message : `The browser rejected the key: ${(e as Error).message}`)
  }
}

export interface VerifyResult {
  valid: boolean
  alg: string
  keyDescription: string
  warnings: string[]
}

/**
 * Verifies the JWS signature with Web Crypto. Returns valid: true ONLY when
 * crypto.subtle.verify succeeded. Claims (exp, aud…) are not checked here.
 */
export async function verifyJwt(token: string, keyInput: string, opts: { format?: KeyFormat } = {}): Promise<VerifyResult> {
  const parsed = parseJwt(token)
  if (!parsed.ok) throw new JwtVerifyError(parsed.error.message)
  if (parsed.value.kind !== 'jws') throw new JwtVerifyError('Encrypted tokens (JWE) cannot be verified — they must be decrypted with the recipient’s key')
  const jws = parsed.value
  const alg = jws.alg ?? ''
  if (alg.toLowerCase() === 'none') throw new JwtVerifyError('This token is unsigned ("alg": "none") — there is no signature to verify, so it must never be trusted.')
  const fam = algFamily(alg)
  if (!fam) throw new JwtVerifyError(alg ? `"${alg}" is not supported for verification here` : 'The header has no "alg"')
  if (fam === 'ec' && jws.signature.length !== EC_SIG_LEN[alg])
    return { valid: false, alg, keyDescription: '', warnings: [`An ${alg} signature must be ${EC_SIG_LEN[alg]} bytes (raw r‖s), but this one is ${jws.signature.length} bytes — it may be DER-encoded, which JWS does not allow.`] }
  const kid = typeof jws.header.kid === 'string' ? jws.header.kid : undefined
  const prepared = await prepareKey(alg, keyInput, { format: opts.format, kid })
  const data = utf8.encode(`${jws.parts[0]}.${jws.parts[1]}`)
  const params: AlgorithmIdentifier | RsaPssParams | EcdsaParams =
    fam === 'pss' ? { name: 'RSA-PSS', saltLength: Number(alg.slice(2)) / 8 } : fam === 'ec' ? { name: 'ECDSA', hash: HASH[alg.slice(2)] } : fam === 'hmac' ? { name: 'HMAC' } : fam === 'ed' ? { name: 'Ed25519' } : { name: 'RSASSA-PKCS1-v1_5' }
  const valid = await subtle().verify(params, prepared.key, jws.signature as BufferSource, data as BufferSource)
  return { valid, alg, keyDescription: prepared.description, warnings: prepared.warnings }
}

/** Creates an HS256/384/512 token. Used for the built-in sample and tests. */
export async function signHmacJwt(header: Record<string, unknown>, payload: Record<string, unknown>, secret: string): Promise<string> {
  const alg = String(header.alg ?? 'HS256')
  if (algFamily(alg) !== 'hmac') throw new JwtVerifyError('signHmacJwt only supports HS256/384/512')
  const h = base64UrlEncode(utf8.encode(JSON.stringify(header)))
  const p = base64UrlEncode(utf8.encode(JSON.stringify(payload)))
  const key = await subtle().importKey('raw', utf8.encode(secret) as BufferSource, { name: 'HMAC', hash: HASH[alg.slice(2)] }, false, ['sign'])
  const sig = new Uint8Array(await subtle().sign('HMAC', key, utf8.encode(`${h}.${p}`) as BufferSource))
  return `${h}.${p}.${base64UrlEncode(sig)}`
}

/** Documented demo secret for the sample token (so verification can be tried). */
export const SAMPLE_SECRET = 'devtoolkit-demo-secret-do-not-use-in-production'

export function samplePayload(nowSeconds: number): Record<string, unknown> {
  return {
    iss: 'https://auth.example.com/',
    sub: 'user_8f14e45f',
    aud: ['api.example.com', 'billing.example.com'],
    exp: nowSeconds + 2 * 3600,
    nbf: nowSeconds - 60,
    iat: nowSeconds - 60,
    jti: '01J9Z6K3W4RCQ8B2V7M5N0XTAE',
    scope: 'read:invoices write:invoices',
    azp: 'web-dashboard',
    email: 'ada@example.com',
    email_verified: true,
    roles: ['admin', 'billing'],
  }
}
