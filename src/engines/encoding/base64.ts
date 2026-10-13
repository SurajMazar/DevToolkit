/**
 * Unicode-safe Base64. Text is encoded as UTF-8 bytes first, so "✓ café" round-trips
 * (unlike bare btoa, which throws on non-Latin-1 characters).
 */

export interface Base64EncodeOptions {
  urlSafe?: boolean
  /** Omit trailing '=' padding (common with URL-safe). */
  noPadding?: boolean
  /** Insert line breaks every N characters (76 = MIME, 64 = PEM). 0 = none. */
  lineLength?: number
}

const CHUNK = 0x8000

export function bytesToBase64(bytes: Uint8Array, opts: Base64EncodeOptions = {}): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[])
  let out = btoa(bin)
  if (opts.urlSafe) out = out.replace(/\+/g, '-').replace(/\//g, '_')
  if (opts.noPadding) out = out.replace(/=+$/, '')
  if (opts.lineLength && opts.lineLength > 0) out = out.replace(new RegExp(`(.{${opts.lineLength}})(?=.)`, 'g'), '$1\n')
  return out
}

export function encodeBase64(text: string, opts: Base64EncodeOptions = {}): string {
  return bytesToBase64(new TextEncoder().encode(text), opts)
}

export class Base64Error extends Error {
  position?: number
  constructor(message: string, position?: number) {
    super(message)
    this.name = 'Base64Error'
    this.position = position
  }
}

/** Accepts standard and URL-safe alphabets, missing padding, and embedded whitespace. */
export function base64ToBytes(input: string): Uint8Array {
  let s = input.replace(/\s+/g, '')
  if (s.startsWith('data:')) {
    const comma = s.indexOf(',')
    if (comma !== -1) s = s.slice(comma + 1)
  }
  const bad = s.search(/[^A-Za-z0-9+/\-_=]/)
  if (bad !== -1) throw new Base64Error(`Invalid character "${s[bad]}" — Base64 only contains A–Z, a–z, 0–9, + / (or - _) and =`, bad)
  const pad = s.indexOf('=')
  if (pad !== -1 && /[^=]/.test(s.slice(pad))) throw new Base64Error('Padding "=" may only appear at the end', pad)
  s = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  if (s.length % 4 === 1) throw new Base64Error('Invalid length — the input is truncated or has an extra character')
  s += '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export interface DecodedBase64 {
  text: string
  bytes: Uint8Array
  /** False when the bytes are not valid UTF-8 (likely binary data). */
  isUtf8: boolean
}

export function decodeBase64(input: string): DecodedBase64 {
  const bytes = base64ToBytes(input)
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), bytes, isUtf8: true }
  } catch {
    return { text: new TextDecoder('utf-8').decode(bytes), bytes, isUtf8: false }
  }
}

/** Guess a media type from magic bytes (for decoded binary previews/downloads). */
export function sniffMime(bytes: Uint8Array): string | null {
  const b = bytes
  const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v)
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  if (starts(0x25, 0x50, 0x44, 0x46)) return 'application/pdf'
  if (starts(0x50, 0x4b, 0x03, 0x04)) return 'application/zip'
  if (starts(0x1f, 0x8b)) return 'application/gzip'
  if (starts(0x00, 0x00, 0x01, 0x00)) return 'image/x-icon'
  const head = new TextDecoder().decode(b.subarray(0, 256)).trimStart()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml'
  return null
}
