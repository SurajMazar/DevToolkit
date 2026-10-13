/**
 * data: URIs (RFC 2397, parsed with the WHATWG "data: URL processor" rules) — creation with
 * base64 or percent-encoding, and a validating parser.
 */
import { Base64Error, base64ToBytes, bytesToBase64 } from './base64'
import { codePointToUtf8 } from './utf8'

export interface DataUriParam {
  name: string
  value: string
}

export interface ParsedDataUri {
  /** Effective MIME type ("text/plain" when omitted, per RFC 2397). */
  mime: string
  /** The URI specified a MIME type. */
  mimeExplicit: boolean
  params: DataUriParam[]
  charset: string | null
  base64: boolean
  bytes: Uint8Array
  /** Length of the URI (characters). */
  uriLength: number
  /** Length of the encoded data part (characters). */
  dataLength: number
  warnings: string[]
}

export interface DataUriError {
  message: string
  /** Offset in the (trimmed) input. */
  offset?: number
}

export type DataUriParseResult = { ok: true; value: ParsedDataUri } | { ok: false; error: DataUriError }

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const isHexCode = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
const hexVal = (c: number) => (c <= 57 ? c - 48 : (c | 0x20) - 87)

/** Percent-decodes into raw bytes; non-ASCII characters are UTF-8 encoded. Reports bad escapes. */
export function percentDecodeToBytes(s: string): { bytes: Uint8Array; badEscapes: number[] } {
  const badEscapes: number[] = []
  const n = s.length
  // Worst case: every UTF-16 unit is a 3-byte UTF-8 character.
  const out = new Uint8Array(/[^\x00-\x7f]/.test(s) ? n * 3 : n)
  let o = 0
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i)
    if (c === 0x25) {
      if (isHexCode(s.charCodeAt(i + 1)) && isHexCode(s.charCodeAt(i + 2))) {
        out[o++] = (hexVal(s.charCodeAt(i + 1)) << 4) | hexVal(s.charCodeAt(i + 2))
        i += 2
      } else {
        badEscapes.push(i)
        out[o++] = 0x25
      }
    } else if (c < 0x80) out[o++] = c
    else {
      const cp = s.codePointAt(i)!
      const enc = codePointToUtf8(cp)
      for (const b of enc) out[o++] = b
      if (cp > 0xffff) i++
    }
  }
  return { bytes: out.slice(0, o), badEscapes }
}

export function parseDataUri(input: string): DataUriParseResult {
  const s = input.trim()
  if (!s) return { ok: false, error: { message: 'Paste a data: URI' } }
  if (!/^data:/i.test(s)) {
    const hint = /^[A-Za-z0-9+/=\s]{16,}$/.test(s) ? ' — this looks like bare Base64; prefix it with "data:<type>;base64,"' : ''
    return { ok: false, error: { message: `A data URI must start with "data:"${hint}`, offset: 0 } }
  }
  const comma = s.indexOf(',')
  if (comma === -1) return { ok: false, error: { message: 'Missing "," between the media type and the data', offset: s.length } }
  const warnings: string[] = []
  let meta = s.slice(5, comma)
  const data = s.slice(comma + 1)
  let base64 = false
  const b64 = /;\s*base64\s*$/i.exec(meta)
  if (b64) {
    base64 = true
    meta = meta.slice(0, b64.index)
  }
  const [typePart, ...paramParts] = meta.split(';')
  const typeStr = typePart.trim()
  let mime = 'text/plain'
  let mimeExplicit = false
  if (typeStr) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(typeStr) || !typeStr.split('/').every((p) => TOKEN.test(p)))
      return { ok: false, error: { message: `"${typeStr}" is not a valid media type (expected type/subtype, e.g. image/png)`, offset: 5 } }
    mime = typeStr.toLowerCase()
    mimeExplicit = true
  }
  const params: DataUriParam[] = []
  let charset: string | null = null
  let at = 5 + typePart.length
  for (const p of paramParts) {
    at += 1
    const t = p.trim()
    if (t) {
      const eq = t.indexOf('=')
      if (eq <= 0) {
        if (t.toLowerCase() === 'base64') return { ok: false, error: { message: '";base64" must be the last parameter, right before the ","', offset: at } }
        return { ok: false, error: { message: `Parameter "${t}" has no value (expected name=value)`, offset: at } }
      }
      const name = t.slice(0, eq).trim().toLowerCase()
      let value = t.slice(eq + 1).trim()
      if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1)
      if (!TOKEN.test(name)) return { ok: false, error: { message: `"${name}" is not a valid parameter name`, offset: at } }
      params.push({ name, value })
      if (name === 'charset') charset = value
    }
    at += p.length
  }
  if (!mimeExplicit && charset === null) charset = 'US-ASCII'

  let bytes: Uint8Array
  const pd = data.includes('%') || !base64 ? percentDecodeToBytes(data) : { bytes: null, badEscapes: [] as number[] }
  if (pd.badEscapes.length) warnings.push(`${pd.badEscapes.length} "%" sign${pd.badEscapes.length === 1 ? ' is' : 's are'} not followed by two hex digits (first at data position ${pd.badEscapes[0] + 1}) — kept literally`)
  if (base64) {
    const text = pd.bytes ? new TextDecoder('latin1').decode(pd.bytes) : data
    try {
      bytes = base64ToBytes(text)
    } catch (e) {
      const err = e as Base64Error
      return { ok: false, error: { message: `The data is marked ;base64 but is not valid Base64: ${err.message}`, offset: err.position != null ? comma + 1 + err.position : comma + 1 } }
    }
    if (/[-_]/.test(text)) warnings.push('The data uses the URL-safe Base64 alphabet (- _). Browsers only accept standard Base64 (+ /) in data URIs.')
  } else {
    bytes = pd.bytes!
    if (/[\s]/.test(data)) warnings.push('The data contains raw whitespace — browsers keep it, but it should be percent-encoded (%20, %0A).')
    if (data.includes('#')) warnings.push('The data contains "#", which starts a URL fragment: everything after it is dropped by browsers. Encode it as %23.')
  }
  return { ok: true, value: { mime, mimeExplicit, params, charset, base64, bytes, uriLength: s.length, dataLength: data.length, warnings } }
}

/** Characters kept unencoded in percent-encoded data URIs. */
const KEEP = new Uint8Array(128)
// Encoded: controls, space, " ' % # \ ^ ` { | } and all non-ASCII. Kept: < > ( ) and the rest of
// printable ASCII — browsers accept them, and they are safe inside "…" attributes and url("…").
for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~!$&*+,;=:@/?<>()[]") KEEP[ch.charCodeAt(0)] = 1

const HEX_ESC = Array.from({ length: 256 }, (_, b) => '%' + b.toString(16).toUpperCase().padStart(2, '0'))

/** Percent-encodes bytes (URIs are ASCII: every non-ASCII byte becomes %XX). */
export function percentEncodeBytes(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    out += b < 0x80 && KEEP[b] ? String.fromCharCode(b) : HEX_ESC[b]
  }
  return out
}

export type DataUriEncoding = 'base64' | 'percent'

export interface BuildOptions {
  mime: string
  encoding: DataUriEncoding
  /** Added as ;charset=… (text types). */
  charset?: string | null
}

export function dataUriHeader(opts: BuildOptions): string {
  const cs = opts.charset ? `;charset=${opts.charset}` : ''
  return `data:${opts.mime}${cs}${opts.encoding === 'base64' ? ';base64' : ''},`
}

export function buildDataUri(bytes: Uint8Array, opts: BuildOptions): string {
  return dataUriHeader(opts) + (opts.encoding === 'base64' ? bytesToBase64(bytes) : percentEncodeBytes(bytes))
}

/** Exact URI length for both encodings, without building the strings for huge inputs. */
export function dataUriSizes(bytes: Uint8Array, opts: Omit<BuildOptions, 'encoding'>): Record<DataUriEncoding, number> {
  let percent = 0
  for (let i = 0; i < bytes.length; i++) percent += bytes[i] < 0x80 && KEEP[bytes[i]] ? 1 : 3
  return {
    base64: dataUriHeader({ ...opts, encoding: 'base64' }).length + Math.ceil(bytes.length / 3) * 4,
    percent: dataUriHeader({ ...opts, encoding: 'percent' }).length + percent,
  }
}

export function isTextMime(mime: string): boolean {
  return /^text\//.test(mime) || /(\+xml|\+json|\/json|\/xml|\/javascript|\/ecmascript|\/x-www-form-urlencoded|\/yaml|\/x-yaml|\/toml|\/sql|\/graphql|\/csv)$/.test(mime)
}

/** Images that <img> can render (SVG included — <img> never executes scripts). */
export function isImageMime(mime: string): boolean {
  return /^image\/(png|jpeg|jpg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml|apng)$/.test(mime)
}

const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp',
  txt: 'text/plain', html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', xml: 'application/xml', csv: 'text/csv', md: 'text/markdown',
  pdf: 'application/pdf', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', wasm: 'application/wasm', zip: 'application/zip',
}

export function mimeFromName(name: string): string | null {
  const i = name.lastIndexOf('.')
  return i === -1 ? null : (EXT_MIME[name.slice(i + 1).toLowerCase()] ?? null)
}

export function extensionForMime(mime: string): string {
  const hit = Object.entries(EXT_MIME).find(([, m]) => m === mime)
  if (hit) return hit[0]
  if (mime.endsWith('+xml')) return 'xml'
  if (mime.endsWith('+json')) return 'json'
  return 'bin'
}
