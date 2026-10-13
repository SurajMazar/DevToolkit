import { Temporal } from 'temporal-polyfill'

/**
 * Time-zone catalogue and per-zone facts (offset, abbreviation, DST, transitions).
 * Pure: everything takes explicit instants and zone ids — never the machine's zone implicitly.
 */

const NS_PER_MINUTE = 60_000_000_000

/** Legacy ids that some engines (Chrome/ICU) still list, mapped to their current IANA names. */
const MODERN_NAMES: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Dacca': 'Asia/Dhaka',
  'Asia/Thimbu': 'Asia/Thimphu',
  'Asia/Ulan_Bator': 'Asia/Ulaanbaatar',
  'Asia/Macao': 'Asia/Macau',
  'Asia/Ujung_Pandang': 'Asia/Makassar',
  'Europe/Kiev': 'Europe/Kyiv',
  'Europe/Uzhgorod': 'Europe/Kyiv',
  'Europe/Zaporozhye': 'Europe/Kyiv',
  'America/Godthab': 'America/Nuuk',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Louisville': 'America/Kentucky/Louisville',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Pacific/Truk': 'Pacific/Chuuk',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Enderbury': 'Pacific/Kanton',
}

/** Common city names and abbreviations → IANA zone. Lower-case keys. */
export const ZONE_ALIASES: Record<string, string> = {
  // North America
  'new york': 'America/New_York', nyc: 'America/New_York', boston: 'America/New_York', washington: 'America/New_York', 'washington dc': 'America/New_York', miami: 'America/New_York', atlanta: 'America/New_York', philadelphia: 'America/New_York', detroit: 'America/Detroit', toronto: 'America/Toronto', montreal: 'America/Toronto', ottawa: 'America/Toronto',
  chicago: 'America/Chicago', dallas: 'America/Chicago', houston: 'America/Chicago', austin: 'America/Chicago', minneapolis: 'America/Chicago', 'mexico city': 'America/Mexico_City', winnipeg: 'America/Winnipeg',
  denver: 'America/Denver', 'salt lake city': 'America/Denver', calgary: 'America/Edmonton', phoenix: 'America/Phoenix', arizona: 'America/Phoenix',
  'los angeles': 'America/Los_Angeles', la: 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles', sf: 'America/Los_Angeles', seattle: 'America/Los_Angeles', portland: 'America/Los_Angeles', 'san diego': 'America/Los_Angeles', 'las vegas': 'America/Los_Angeles', vancouver: 'America/Vancouver', 'silicon valley': 'America/Los_Angeles',
  anchorage: 'America/Anchorage', alaska: 'America/Anchorage', honolulu: 'Pacific/Honolulu', hawaii: 'Pacific/Honolulu', halifax: 'America/Halifax', "st john's": 'America/St_Johns', newfoundland: 'America/St_Johns',
  // South America
  'sao paulo': 'America/Sao_Paulo', 'são paulo': 'America/Sao_Paulo', 'rio de janeiro': 'America/Sao_Paulo', rio: 'America/Sao_Paulo', 'buenos aires': 'America/Argentina/Buenos_Aires', santiago: 'America/Santiago', lima: 'America/Lima', bogota: 'America/Bogota', 'bogotá': 'America/Bogota', caracas: 'America/Caracas',
  // Europe
  london: 'Europe/London', uk: 'Europe/London', edinburgh: 'Europe/London', manchester: 'Europe/London', dublin: 'Europe/Dublin', lisbon: 'Europe/Lisbon', paris: 'Europe/Paris', berlin: 'Europe/Berlin', munich: 'Europe/Berlin', frankfurt: 'Europe/Berlin', hamburg: 'Europe/Berlin', amsterdam: 'Europe/Amsterdam', brussels: 'Europe/Brussels', madrid: 'Europe/Madrid', barcelona: 'Europe/Madrid', rome: 'Europe/Rome', milan: 'Europe/Rome', zurich: 'Europe/Zurich', geneva: 'Europe/Zurich', vienna: 'Europe/Vienna', prague: 'Europe/Prague', warsaw: 'Europe/Warsaw', stockholm: 'Europe/Stockholm', oslo: 'Europe/Oslo', copenhagen: 'Europe/Copenhagen', helsinki: 'Europe/Helsinki', athens: 'Europe/Athens', istanbul: 'Europe/Istanbul', kyiv: 'Europe/Kyiv', kiev: 'Europe/Kyiv', moscow: 'Europe/Moscow', 'st petersburg': 'Europe/Moscow', bucharest: 'Europe/Bucharest', budapest: 'Europe/Budapest',
  // Africa & Middle East
  cairo: 'Africa/Cairo', lagos: 'Africa/Lagos', nairobi: 'Africa/Nairobi', johannesburg: 'Africa/Johannesburg', 'cape town': 'Africa/Johannesburg', casablanca: 'Africa/Casablanca', accra: 'Africa/Accra', 'addis ababa': 'Africa/Addis_Ababa',
  dubai: 'Asia/Dubai', 'abu dhabi': 'Asia/Dubai', riyadh: 'Asia/Riyadh', doha: 'Asia/Qatar', 'tel aviv': 'Asia/Jerusalem', jerusalem: 'Asia/Jerusalem', tehran: 'Asia/Tehran', baghdad: 'Asia/Baghdad',
  // Asia
  karachi: 'Asia/Karachi', lahore: 'Asia/Karachi', mumbai: 'Asia/Kolkata', bombay: 'Asia/Kolkata', delhi: 'Asia/Kolkata', 'new delhi': 'Asia/Kolkata', bangalore: 'Asia/Kolkata', bengaluru: 'Asia/Kolkata', chennai: 'Asia/Kolkata', hyderabad: 'Asia/Kolkata', pune: 'Asia/Kolkata', kolkata: 'Asia/Kolkata', india: 'Asia/Kolkata',
  kathmandu: 'Asia/Kathmandu', nepal: 'Asia/Kathmandu', dhaka: 'Asia/Dhaka', colombo: 'Asia/Colombo', yangon: 'Asia/Yangon', bangkok: 'Asia/Bangkok', hanoi: 'Asia/Bangkok', 'ho chi minh': 'Asia/Ho_Chi_Minh', saigon: 'Asia/Ho_Chi_Minh', jakarta: 'Asia/Jakarta', singapore: 'Asia/Singapore', 'kuala lumpur': 'Asia/Kuala_Lumpur', manila: 'Asia/Manila',
  'hong kong': 'Asia/Hong_Kong', beijing: 'Asia/Shanghai', shanghai: 'Asia/Shanghai', shenzhen: 'Asia/Shanghai', china: 'Asia/Shanghai', taipei: 'Asia/Taipei', seoul: 'Asia/Seoul', tokyo: 'Asia/Tokyo', osaka: 'Asia/Tokyo', japan: 'Asia/Tokyo', tashkent: 'Asia/Tashkent', almaty: 'Asia/Almaty', kabul: 'Asia/Kabul',
  // Oceania
  sydney: 'Australia/Sydney', melbourne: 'Australia/Melbourne', brisbane: 'Australia/Brisbane', perth: 'Australia/Perth', adelaide: 'Australia/Adelaide', auckland: 'Pacific/Auckland', wellington: 'Pacific/Auckland', 'new zealand': 'Pacific/Auckland', fiji: 'Pacific/Fiji',
  // Abbreviations (ambiguous ones resolve to their most common meaning)
  utc: 'UTC', gmt: 'UTC', zulu: 'UTC', z: 'UTC',
  pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles', pt: 'America/Los_Angeles', pacific: 'America/Los_Angeles',
  mst: 'America/Denver', mdt: 'America/Denver', mt: 'America/Denver', mountain: 'America/Denver',
  cst: 'America/Chicago', cdt: 'America/Chicago', ct: 'America/Chicago', central: 'America/Chicago',
  est: 'America/New_York', edt: 'America/New_York', et: 'America/New_York', eastern: 'America/New_York',
  akst: 'America/Anchorage', hst: 'Pacific/Honolulu',
  bst: 'Europe/London', wet: 'Europe/Lisbon', cet: 'Europe/Paris', cest: 'Europe/Paris', eet: 'Europe/Athens', eest: 'Europe/Athens', msk: 'Europe/Moscow',
  ist: 'Asia/Kolkata', npt: 'Asia/Kathmandu', pkt: 'Asia/Karachi', sgt: 'Asia/Singapore', hkt: 'Asia/Hong_Kong', jst: 'Asia/Tokyo', kst: 'Asia/Seoul', wib: 'Asia/Jakarta', ict: 'Asia/Bangkok', gst: 'Asia/Dubai',
  aest: 'Australia/Sydney', aedt: 'Australia/Sydney', acst: 'Australia/Adelaide', awst: 'Australia/Perth', nzst: 'Pacific/Auckland', nzdt: 'Pacific/Auckland',
}

let zoneCache: string[] | null = null

/** Every IANA zone the runtime knows (modern names), plus UTC. Sorted. */
export function listTimeZones(): string[] {
  if (zoneCache) return zoneCache
  let raw: string[] = []
  try {
    raw = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  } catch {
    raw = []
  }
  const set = new Set<string>()
  for (const id of raw) set.add(modernName(id))
  for (const id of Object.values(ZONE_ALIASES)) set.add(id)
  set.add('UTC')
  zoneCache = [...set].filter(isValidTimeZone).sort((a, b) => (a === 'UTC' ? -1 : b === 'UTC' ? 1 : a.localeCompare(b)))
  return zoneCache
}

const validCache = new Map<string, boolean>()
export function isValidTimeZone(id: string): boolean {
  const hit = validCache.get(id)
  if (hit !== undefined) return hit
  let ok = false
  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(id)
    ok = true
  } catch {
    ok = false
  }
  validCache.set(id, ok)
  return ok
}

/** Maps legacy ids to the current IANA name when the runtime supports it. */
export function modernName(id: string): string {
  const m = MODERN_NAMES[id]
  return m && isValidTimeZone(m) ? m : id
}

/** Canonical-case id for user input such as "asia/kolkata", "nyc" or "PST"; null when unknown. */
export function resolveZone(input: string): string | null {
  const q = input.trim()
  if (!q) return null
  const alias = ZONE_ALIASES[q.toLowerCase()]
  if (alias) return alias
  try {
    const id = Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(q.replace(/ /g, '_')).timeZoneId
    return modernName(id)
  } catch {
    return null
  }
}

/** "+05:45", "-03:00", "+00:00". */
export function formatOffsetNs(offsetNs: number): string {
  const sign = offsetNs < 0 ? '-' : '+'
  const total = Math.round(Math.abs(offsetNs) / NS_PER_MINUTE)
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** "UTC+5:45", "UTC−3", "UTC". */
export function formatUtcOffsetShort(offsetNs: number): string {
  if (offsetNs === 0) return 'UTC'
  const sign = offsetNs < 0 ? '−' : '+'
  const total = Math.round(Math.abs(offsetNs) / NS_PER_MINUTE)
  const h = Math.floor(total / 60)
  const m = total % 60
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`
}

const dtfCache = new Map<string, Intl.DateTimeFormat>()
function dtf(locale: string, zone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${zone}|${JSON.stringify(opts)}`
  let f = dtfCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: zone })
    dtfCache.set(key, f)
  }
  return f
}

function zoneNamePart(epochMs: number, zone: string, style: 'short' | 'long', locale: string): string {
  try {
    return dtf(locale, zone, { timeZoneName: style, year: 'numeric' }).formatToParts(epochMs).find((p) => p.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

const ABBR_LOCALES = ['en-US', 'en-GB', 'en-IN', 'en-AU', 'en-NZ', 'en-SG', 'en-ZA', 'en-CA', 'en-IE']

/**
 * Best-effort short abbreviation via Intl ("EST", "BST", "IST", "AEDT"). CLDR only has
 * abbreviations for some zones per locale, so several English locales are tried; falls back
 * to the "GMT+5:45" form Intl produces when no abbreviation exists.
 */
export function zoneAbbreviation(epochMs: number, zone: string): string {
  if (zone === 'UTC' || zone === 'Etc/UTC') return 'UTC'
  let fallback = ''
  for (const loc of ABBR_LOCALES) {
    const name = zoneNamePart(epochMs, zone, 'short', loc)
    if (!fallback) fallback = name
    if (name && !/^(GMT|UTC)([+−-]|$)/.test(name)) return name
  }
  return fallback || 'GMT'
}

/** Long localized name, e.g. "Eastern Daylight Time". */
export function zoneLongName(epochMs: number, zone: string, locale = 'en-US'): string {
  return zoneNamePart(epochMs, zone, 'long', locale)
}

export function offsetNsAt(epochMs: number, zone: string): number {
  return Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(zone).offsetNanoseconds
}

export interface ZoneTransition {
  epochMs: number
  /** ISO instant string (UTC). */
  instant: string
  offsetBefore: string
  offsetAfter: string
  /** Wall time just before / at the transition, e.g. "2024-03-10T02:00" → "2024-03-10T03:00". */
  wallBefore: string
  wallAfter: string
  /** Change in minutes (positive = clocks go forward). */
  deltaMinutes: number
  abbrBefore: string
  abbrAfter: string
}

function wallString(z: Temporal.ZonedDateTime): string {
  return z.toPlainDateTime().toString({ smallestUnit: 'minute' }).replace('T', ' ')
}

/** Describes the transition at a ZonedDateTime returned by getTimeZoneTransition(). */
export function describeTransition(t: Temporal.ZonedDateTime): ZoneTransition {
  const zone = t.timeZoneId
  const before = t.subtract({ nanoseconds: 1 })
  const delta = (t.offsetNanoseconds - before.offsetNanoseconds) / NS_PER_MINUTE
  // Wall clock "just before" the change, as people say it: 02:00 → 03:00.
  const wallBefore = t.toInstant().toZonedDateTimeISO(formatOffsetNs(before.offsetNanoseconds))
  return {
    epochMs: t.epochMilliseconds,
    instant: t.toInstant().toString(),
    offsetBefore: before.offset,
    offsetAfter: t.offset,
    wallBefore: wallString(wallBefore),
    wallAfter: wallString(t),
    deltaMinutes: delta,
    abbrBefore: zoneAbbreviation(before.epochMilliseconds, zone),
    abbrAfter: zoneAbbreviation(t.epochMilliseconds, zone),
  }
}

export interface ZoneSnapshot {
  zone: string
  epochMs: number
  /** "+05:45" */
  offset: string
  offsetNs: number
  abbreviation: string
  longName: string
  /** True when the current offset is ahead of the zone's standard (winter) offset this year. */
  isDst: boolean
  /** Whether the zone changes offset during this calendar year. */
  observesDst: boolean
  next: ZoneTransition | null
  previous: ZoneTransition | null
}

/** Offset/abbreviation/DST facts for a zone at an instant. */
export function zoneSnapshot(epochMs: number, zone: string): ZoneSnapshot {
  const z = Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(zone)
  const jan = Temporal.ZonedDateTime.from({ year: z.year, month: 1, day: 1, timeZone: zone }).offsetNanoseconds
  const jul = Temporal.ZonedDateTime.from({ year: z.year, month: 7, day: 1, timeZone: zone }).offsetNanoseconds
  const observesDst = jan !== jul
  const next = safeTransition(z, 'next')
  const previous = safeTransition(z, 'previous')
  return {
    zone,
    epochMs,
    offset: z.offset,
    offsetNs: z.offsetNanoseconds,
    abbreviation: zoneAbbreviation(epochMs, zone),
    longName: zoneLongName(epochMs, zone),
    isDst: observesDst && z.offsetNanoseconds > Math.min(jan, jul),
    observesDst,
    next: next ? describeTransition(next) : null,
    previous: previous ? describeTransition(previous) : null,
  }
}

function safeTransition(z: Temporal.ZonedDateTime, dir: 'next' | 'previous'): Temporal.ZonedDateTime | null {
  try {
    return z.getTimeZoneTransition(dir) ?? null
  } catch {
    return null
  }
}

/** All offset transitions in (fromMs, toMs], capped. */
export function transitionsBetween(fromMs: number, toMs: number, zone: string, cap = 500): { list: ZoneTransition[]; truncated: boolean } {
  const list: ZoneTransition[] = []
  if (toMs <= fromMs) return { list, truncated: false }
  let cur: Temporal.ZonedDateTime | null = Temporal.Instant.fromEpochMilliseconds(fromMs).toZonedDateTimeISO(zone)
  while (cur) {
    cur = safeTransition(cur, 'next')
    if (!cur || cur.epochMilliseconds > toMs) break
    if (list.length >= cap) return { list, truncated: true }
    list.push(describeTransition(cur))
  }
  return { list, truncated: false }
}

export interface ZoneSearchResult {
  zone: string
  /** Why it matched when not obvious from the id ("alias: Mumbai", "offset UTC+5:30"). */
  matched?: string
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const OFFSET_QUERY = /^(?:utc|gmt)?\s*([+-−])\s*(\d{1,2})(?::?(\d{2}))?$/i

/**
 * Ranked search over the zone list: aliases (cities, abbreviations), id segments, and UTC offsets
 * ("+5:30", "utc-3"). `atMs` decides which offset a zone has for offset queries.
 */
export function searchZones(query: string, atMs: number, zones = listTimeZones(), limit = 60): ZoneSearchResult[] {
  const q = norm(query)
  if (!q) return zones.slice(0, limit).map((zone) => ({ zone }))
  const scored = new Map<string, { score: number; matched?: string }>()
  const add = (zone: string, score: number, matched?: string) => {
    const prev = scored.get(zone)
    if (!prev || prev.score < score) scored.set(zone, { score, matched })
  }

  const off = OFFSET_QUERY.exec(query.trim())
  if (off) {
    const sign = off[1] === '+' ? 1 : -1
    const target = sign * (Number(off[2]) * 60 + Number(off[3] ?? 0)) * NS_PER_MINUTE
    for (const z of zones) {
      try {
        if (offsetNsAt(atMs, z) === target) add(z, 50, `now ${formatUtcOffsetShort(target)}`)
      } catch {
        /* ignore */
      }
    }
  }

  for (const [alias, zone] of Object.entries(ZONE_ALIASES)) {
    const a = norm(alias)
    if (a === q) add(zone, 100, alias.length <= 5 ? alias.toUpperCase() : titleCase(alias))
    else if (a.startsWith(q) && q.length >= 2) add(zone, 70, titleCase(alias))
  }

  for (const z of zones) {
    const id = norm(z)
    const city = norm(z.split('/').pop() ?? z)
    if (id === q || city === q) add(z, 95)
    else if (city.startsWith(q)) add(z, 80)
    else if (id.startsWith(q)) add(z, 75)
    else if (id.split(' ').some((part) => part.startsWith(q))) add(z, 60)
    else if (id.includes(q)) add(z, 40)
  }

  return [...scored.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([zone, v]) => ({ zone, matched: v.matched }))
}

function titleCase(s: string): string {
  return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase())
}

/** "Asia/Kolkata" → "Kolkata"; "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export function zoneCity(zone: string): string {
  if (zone === 'UTC') return 'UTC'
  return (zone.split('/').pop() ?? zone).replace(/_/g, ' ')
}

/** The device's zone, modernized ("Asia/Calcutta" → "Asia/Kolkata"). */
export function localTimeZone(): string {
  try {
    return modernName(Temporal.Now.timeZoneId())
  } catch {
    return 'UTC'
  }
}
