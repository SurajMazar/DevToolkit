/**
 * Message digests and HMACs. SHA family via Web Crypto (crypto.subtle), MD5 in pure TS.
 * Hashing is one-way: there is no way to "decrypt" a hash.
 */
import { bytesToBase64 } from './base64'
import { hmacMd5, md5 } from './md5'

export type HashAlgo = 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'

export interface HashAlgoInfo {
  id: HashAlgo
  bits: number
  /** Short safety label shown next to the result. */
  status: 'broken' | 'legacy' | 'ok'
  note: string
}

export const HASH_ALGOS: HashAlgoInfo[] = [
  { id: 'MD5', bits: 128, status: 'broken', note: 'Legacy checksum — not secure. Collisions are trivial; use only to match published checksums.' },
  { id: 'SHA-1', bits: 160, status: 'legacy', note: 'Legacy — collisions are practical (SHAttered). Don’t use for signatures or certificates.' },
  { id: 'SHA-256', bits: 256, status: 'ok', note: 'SHA-2. The common default for checksums, HMACs and signatures.' },
  { id: 'SHA-384', bits: 384, status: 'ok', note: 'SHA-2 (truncated SHA-512). Used by TLS suites and Subresource Integrity.' },
  { id: 'SHA-512', bits: 512, status: 'ok', note: 'SHA-2. Faster than SHA-256 on 64-bit CPUs for large inputs.' },
]

export function subtleAvailable(): boolean {
  return typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.subtle?.digest === 'function'
}

export class HashError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HashError'
  }
}

export async function digest(algo: HashAlgo, data: Uint8Array): Promise<Uint8Array> {
  if (algo === 'MD5') return md5(data)
  if (!subtleAvailable()) throw new HashError('Web Crypto is unavailable — SHA hashing needs a secure context (HTTPS or localhost).')
  return new Uint8Array(await crypto.subtle.digest(algo, data as BufferSource))
}

export async function hmac(algo: HashAlgo, key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (algo === 'MD5') return hmacMd5(key, data)
  if (!subtleAvailable()) throw new HashError('Web Crypto is unavailable — HMAC needs a secure context (HTTPS or localhost).')
  if (key.length === 0) throw new HashError('The HMAC key is empty')
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: algo }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as BufferSource))
}

export type DigestEncoding = 'hex' | 'HEX' | 'base64' | 'base64url'

export function encodeDigest(bytes: Uint8Array, enc: DigestEncoding): string {
  if (enc === 'base64') return bytesToBase64(bytes)
  if (enc === 'base64url') return bytesToBase64(bytes, { urlSafe: true, noPadding: true })
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0')
  return enc === 'HEX' ? s.toUpperCase() : s
}

export type KeyEncoding = 'text' | 'hex' | 'base64'

/** Parses an HMAC key. Throws HashError naming the offending character. */
export function parseKey(text: string, enc: KeyEncoding): Uint8Array {
  if (enc === 'text') return new TextEncoder().encode(text)
  const s = text.replace(/\s+/g, '')
  if (enc === 'hex') {
    const h = s.replace(/^0x/i, '')
    const bad = h.search(/[^0-9a-fA-F]/)
    if (bad !== -1) throw new HashError(`"${h[bad]}" at position ${bad + 1} is not a hex digit`)
    if (h.length % 2) throw new HashError(`Hex key has an odd number of digits (${h.length})`)
    const out = new Uint8Array(h.length / 2)
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
    return out
  }
  const b = s.replace(/-/g, '+').replace(/_/g, '/')
  const bad = b.search(/[^A-Za-z0-9+/=]/)
  if (bad !== -1) throw new HashError(`"${b[bad]}" at position ${bad + 1} is not a Base64 character`)
  const unpadded = b.replace(/=+$/, '')
  if (unpadded.length % 4 === 1) throw new HashError('Base64 key has an invalid length')
  const bin = atob(unpadded + '='.repeat((4 - (unpadded.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export interface HashResult {
  algo: HashAlgo
  bytes: Uint8Array
}

export async function hashAll(data: Uint8Array, algos: HashAlgo[], key?: Uint8Array | null): Promise<HashResult[]> {
  return Promise.all(algos.map(async (algo) => ({ algo, bytes: key ? await hmac(algo, key, data) : await digest(algo, data) })))
}

export interface ExpectedMatch {
  algo: HashAlgo
  encoding: 'hex' | 'base64' | 'base64url'
}

/** Normalizes a pasted digest: trims, drops "sha256:"/"0x" prefixes, "  filename" suffixes (sha256sum output). */
export function normalizeExpected(input: string): string {
  let s = input.trim()
  const sum = /^([0-9a-fA-F]{32,128})\s+\*?\S.*$/.exec(s)
  if (sum) s = sum[1]
  s = s.replace(/^(md5|sha-?1|sha-?256|sha-?384|sha-?512)[:=-]/i, '').replace(/^0x/i, '').replace(/\s+/g, '')
  return s
}

/** Which computed digest (in which encoding) equals the expected value. Hex is compared case-insensitively. */
export function matchExpected(expected: string, results: HashResult[]): ExpectedMatch[] {
  const e = normalizeExpected(expected)
  if (!e) return []
  const matches: ExpectedMatch[] = []
  for (const r of results) {
    if (encodeDigest(r.bytes, 'hex') === e.toLowerCase()) matches.push({ algo: r.algo, encoding: 'hex' })
    else if (encodeDigest(r.bytes, 'base64') === e || encodeDigest(r.bytes, 'base64').replace(/=+$/, '') === e) matches.push({ algo: r.algo, encoding: 'base64' })
    else if (encodeDigest(r.bytes, 'base64url') === e.replace(/=+$/, '')) matches.push({ algo: r.algo, encoding: 'base64url' })
  }
  return matches
}

/** Guess what a pasted digest could be, by length — used to explain a mismatch. */
export function guessDigestShape(expected: string): string | null {
  const e = normalizeExpected(expected)
  if (/^[0-9a-fA-F]+$/.test(e)) {
    const algo = HASH_ALGOS.find((a) => a.bits / 4 === e.length)
    return algo ? `${algo.id} hex (${e.length} digits)` : `${e.length} hex digits — no supported algorithm has that length`
  }
  if (/^[A-Za-z0-9+/_-]+=*$/.test(e)) {
    const bytes = Math.floor((e.replace(/=+$/, '').length * 3) / 4)
    const algo = HASH_ALGOS.find((a) => a.bits / 8 === bytes)
    return algo ? `${algo.id} Base64 (${bytes} bytes)` : null
  }
  return null
}

/** Web Crypto digests a whole buffer at once, so files are read fully into memory. */
export const MAX_FILE_BYTES = 512 * 1024 * 1024
