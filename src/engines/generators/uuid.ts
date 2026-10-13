import { v7 as uuidV7 } from 'uuid'

export type UuidVersion = 'v4' | 'v7' | 'nil' | 'max'

export const NIL_UUID = '00000000-0000-0000-0000-000000000000'
export const MAX_UUID = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

export const MAX_UUID_COUNT = 10_000

/** Generate `count` canonical (lowercase, hyphenated) UUIDs. v7 values are strictly increasing. */
export function generateUuids(version: UuidVersion, count: number): string[] {
  if (!Number.isInteger(count) || count < 1 || count > MAX_UUID_COUNT) throw new RangeError(`Count must be between 1 and ${MAX_UUID_COUNT.toLocaleString('en-US')}`)
  const out = new Array<string>(count)
  switch (version) {
    case 'v4':
      for (let i = 0; i < count; i++) out[i] = crypto.randomUUID()
      break
    case 'v7':
      // The uuid package keeps a module-level monotonic counter (RFC 9562 §6.2 method 1):
      // values generated within the same millisecond increment a 31-bit sequence.
      for (let i = 0; i < count; i++) out[i] = uuidV7()
      break
    case 'nil':
      out.fill(NIL_UUID)
      break
    case 'max':
      out.fill(MAX_UUID)
      break
  }
  return out
}

export type UuidCase = 'lower' | 'upper'
export type UuidWrap = 'none' | 'braces' | 'urn'

export interface UuidFormat {
  case: UuidCase
  hyphens: boolean
  wrap: UuidWrap
}

export const DEFAULT_UUID_FORMAT: UuidFormat = { case: 'lower', hyphens: true, wrap: 'none' }

export function formatUuid(canonical: string, f: UuidFormat): string {
  let s = f.hyphens ? canonical : canonical.replace(/-/g, '')
  if (f.case === 'upper') s = s.toUpperCase()
  if (f.wrap === 'braces') return `{${s}}`
  if (f.wrap === 'urn') return `urn:uuid:${s}`
  return s
}

export type UuidListMode = 'lines' | 'quoted' | 'json' | 'sql'

/** Join formatted UUIDs into a copyable block. */
export function joinUuids(values: string[], mode: UuidListMode): string {
  switch (mode) {
    case 'lines':
      return values.join('\n')
    case 'quoted':
      return values.map((v) => `"${v}"`).join(',\n')
    case 'json':
      return JSON.stringify(values, null, 2)
    case 'sql':
      return values.map((v) => `('${v.replace(/'/g, "''")}')`).join(',\n')
  }
}

export function uuidsToCsv(values: string[], header = 'uuid'): string {
  return [header, ...values].join('\r\n') + '\r\n'
}

// ── Inspection ───────────────────────────────────────────────────────────────────

export type UuidVariant = 'NCS (reserved)' | 'RFC 9562' | 'Microsoft (reserved)' | 'Future (reserved)'

export interface UuidInspection {
  canonical: string
  /** Detected input form (for display). */
  inputForm: 'canonical' | 'no hyphens' | 'braces' | 'urn'
  version: number
  variant: UuidVariant
  special?: 'nil' | 'max'
  /** Unix ms for v1/v6/v7. */
  timestampMs?: number
  /** Sub-millisecond 100-ns remainder for v1/v6 (0–9999). */
  timestamp100ns?: number
  clockSeq?: number
  node?: string
  versionName: string
  notes: string[]
  bytes: Uint8Array
}

export type InspectResult = { ok: true; value: UuidInspection } | { ok: false; error: string }

const VERSION_NAMES: Record<number, string> = {
  1: 'Time-based (Gregorian, MAC/node)',
  2: 'DCE Security',
  3: 'Name-based (MD5)',
  4: 'Random',
  5: 'Name-based (SHA-1)',
  6: 'Reordered time-based',
  7: 'Unix time-ordered',
  8: 'Custom / vendor-specific',
}

/** 100-ns intervals between 1582-10-15 (Gregorian epoch) and 1970-01-01. */
const GREGORIAN_OFFSET = 122192928000000000n

export function inspectUuid(raw: string): InspectResult {
  const input = raw.trim()
  if (!input) return { ok: false, error: 'Paste a UUID to inspect it.' }
  let body = input
  let inputForm: UuidInspection['inputForm'] = 'canonical'
  if (/^urn:uuid:/i.test(body)) {
    body = body.slice(9)
    inputForm = 'urn'
  } else if (body.startsWith('{') && body.endsWith('}')) {
    body = body.slice(1, -1)
    inputForm = 'braces'
  }
  let hex: string
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body)) hex = body.replace(/-/g, '')
  else if (/^[0-9a-f]{32}$/i.test(body)) {
    hex = body
    if (inputForm === 'canonical') inputForm = 'no hyphens'
  } else {
    const cleaned = body.replace(/-/g, '')
    if (/[^0-9a-f-]/i.test(body)) {
      const bad = body.match(/[^0-9a-f-]/i)![0]
      return { ok: false, error: `Not a UUID: unexpected character “${bad}”. A UUID is 32 hex digits, optionally as 8-4-4-4-12 groups.` }
    }
    if (cleaned.length !== 32) return { ok: false, error: `Not a UUID: found ${cleaned.length} hex digits, expected 32.` }
    return { ok: false, error: 'Not a UUID: hyphens must split the digits into 8-4-4-4-12 groups.' }
  }
  hex = hex.toLowerCase()
  const canonical = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)

  const notes: string[] = []
  if (canonical === NIL_UUID || canonical === MAX_UUID) {
    const special = canonical === NIL_UUID ? 'nil' : 'max'
    return {
      ok: true,
      value: {
        canonical,
        inputForm,
        version: special === 'nil' ? 0 : 15,
        variant: special === 'nil' ? 'NCS (reserved)' : 'Future (reserved)',
        special,
        versionName: special === 'nil' ? 'Nil UUID (all zeros)' : 'Max UUID (all ones)',
        notes: [special === 'nil' ? 'Special value from RFC 9562 §5.9 — often used as “no value”.' : 'Special value from RFC 9562 §5.10 — often used as a sentinel.'],
        bytes,
      },
    }
  }

  const version = bytes[6] >> 4
  const v8 = bytes[8]
  const variant: UuidVariant = (v8 & 0x80) === 0 ? 'NCS (reserved)' : (v8 & 0xc0) === 0x80 ? 'RFC 9562' : (v8 & 0xe0) === 0xc0 ? 'Microsoft (reserved)' : 'Future (reserved)'
  const versionName = VERSION_NAMES[version] ?? 'Unknown version'
  const result: UuidInspection = { canonical, inputForm, version, variant, versionName, notes, bytes }

  if (variant !== 'RFC 9562') notes.push('Variant bits are not the RFC 9562 variant — version-specific fields may not apply.')
  if (!VERSION_NAMES[version]) notes.push(`Version nibble ${version} is not defined by RFC 9562.`)

  if (variant === 'RFC 9562') {
    if (version === 1 || version === 6) {
      let ts: bigint
      if (version === 1) {
        const timeLow = BigInt((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) & 0xffffffffn
        const timeMid = BigInt((bytes[4] << 8) | bytes[5])
        const timeHi = BigInt(((bytes[6] & 0x0f) << 8) | bytes[7])
        ts = (timeHi << 48n) | (timeMid << 32n) | timeLow
      } else {
        const high = BigInt((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) & 0xffffffffn
        const mid = BigInt((bytes[4] << 8) | bytes[5])
        const low = BigInt(((bytes[6] & 0x0f) << 8) | bytes[7])
        ts = (high << 28n) | (mid << 12n) | low
      }
      const unix100ns = ts - GREGORIAN_OFFSET
      result.timestampMs = Number(unix100ns / 10000n)
      result.timestamp100ns = Number(((unix100ns % 10000n) + 10000n) % 10000n)
      result.clockSeq = ((bytes[8] & 0x3f) << 8) | bytes[9]
      result.node = Array.from(bytes.slice(10), (b) => b.toString(16).padStart(2, '0')).join(':')
      if (bytes[10] & 0x01) notes.push('Node ID has the multicast bit set — it is a random node ID, not a MAC address.')
      else notes.push('Node field may be a real MAC address of the generating machine.')
    } else if (version === 7) {
      let ms = 0
      for (let i = 0; i < 6; i++) ms = ms * 256 + bytes[i]
      result.timestampMs = ms
    } else if (version === 4) {
      notes.push('122 random bits — carries no timestamp or machine information.')
    } else if (version === 3 || version === 5) {
      notes.push('Derived from a namespace + name hash; the original name cannot be recovered.')
    }
  }
  if (result.timestampMs != null) {
    const now = Date.now()
    if (result.timestampMs > now + 86_400_000) notes.push('Embedded timestamp is in the future.')
  }
  return { ok: true, value: result }
}
