import { describe, expect, it } from 'vitest'
import {
  formatOffsetNs,
  formatUtcOffsetShort,
  isValidTimeZone,
  listTimeZones,
  modernName,
  resolveZone,
  searchZones,
  transitionsBetween,
  zoneAbbreviation,
  zoneCity,
  zoneSnapshot,
} from './zones'

const MIN = 60_000_000_000

describe('zone list', () => {
  it('starts with UTC, uses modern names and has no duplicates', () => {
    const zones = listTimeZones()
    expect(zones[0]).toBe('UTC')
    expect(zones).toContain('Asia/Kolkata')
    expect(zones).toContain('Europe/Kyiv')
    expect(zones).not.toContain('Asia/Calcutta')
    expect(new Set(zones).size).toBe(zones.length)
    expect(zones.length).toBeGreaterThan(300)
  })

  it('modernizes legacy ids and validates zones', () => {
    expect(modernName('Asia/Calcutta')).toBe('Asia/Kolkata')
    expect(modernName('Europe/Paris')).toBe('Europe/Paris')
    expect(isValidTimeZone('America/New_York')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
  })

  it('resolves aliases, case-insensitive ids and rejects unknown', () => {
    expect(resolveZone('nyc')).toBe('America/New_York')
    expect(resolveZone('  Bengaluru ')).toBe('Asia/Kolkata')
    expect(resolveZone('asia/kolkata')).toBe('Asia/Kolkata')
    expect(resolveZone('Asia/Calcutta')).toBe('Asia/Kolkata')
    expect(resolveZone('new york')).toBe('America/New_York')
    expect(resolveZone('Nowhere/Land')).toBeNull()
    expect(resolveZone('')).toBeNull()
  })
})

describe('offset formatting', () => {
  it('formats signed hh:mm offsets', () => {
    expect(formatOffsetNs(345 * MIN)).toBe('+05:45')
    expect(formatOffsetNs(-210 * MIN)).toBe('-03:30')
    expect(formatOffsetNs(0)).toBe('+00:00')
    expect(formatUtcOffsetShort(0)).toBe('UTC')
    expect(formatUtcOffsetShort(330 * MIN)).toBe('UTC+5:30')
    expect(formatUtcOffsetShort(-300 * MIN)).toBe('UTC−5')
  })
  it('derives city names', () => {
    expect(zoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires')
    expect(zoneCity('UTC')).toBe('UTC')
  })
})

describe('zone snapshot (DST)', () => {
  it('America/New_York in summer: EDT, next transition is the November fall-back', () => {
    const s = zoneSnapshot(Date.parse('2024-07-01T00:00:00Z'), 'America/New_York')
    expect(s.offset).toBe('-04:00')
    expect(s.abbreviation).toBe('EDT')
    expect(s.isDst).toBe(true)
    expect(s.observesDst).toBe(true)
    expect(s.next?.instant).toBe('2024-11-03T06:00:00Z')
    expect(s.next?.deltaMinutes).toBe(-60)
    expect(s.next?.wallBefore).toBe('2024-11-03 02:00')
    expect(s.next?.wallAfter).toBe('2024-11-03 01:00')
    expect(s.previous?.instant).toBe('2024-03-10T07:00:00Z')
    expect(s.previous?.wallBefore).toBe('2024-03-10 02:00')
    expect(s.previous?.wallAfter).toBe('2024-03-10 03:00')
  })

  it('Europe/London in winter: GMT, spring-forward on 2024-03-31 01:00 UTC', () => {
    const s = zoneSnapshot(Date.parse('2024-01-15T12:00:00Z'), 'Europe/London')
    expect(s.offset).toBe('+00:00')
    expect(s.isDst).toBe(false)
    expect(s.next?.instant).toBe('2024-03-31T01:00:00Z')
    expect(s.next?.deltaMinutes).toBe(60)
    expect(s.next?.abbrAfter).toBe('BST')
  })

  it('southern hemisphere DST is detected in January', () => {
    const s = zoneSnapshot(Date.parse('2024-01-15T00:00:00Z'), 'Australia/Sydney')
    expect(s.isDst).toBe(true)
    expect(s.offset).toBe('+11:00')
    expect(s.abbreviation).toBe('AEDT')
  })

  it('zones without DST have no upcoming transition', () => {
    const s = zoneSnapshot(Date.parse('2024-07-01T00:00:00Z'), 'Asia/Kathmandu')
    expect(s.offset).toBe('+05:45')
    expect(s.observesDst).toBe(false)
    expect(s.isDst).toBe(false)
    expect(s.next).toBeNull()
    expect(zoneSnapshot(0, 'UTC').next).toBeNull()
  })

  it('lists transitions in a range', () => {
    const { list, truncated } = transitionsBetween(Date.parse('2024-01-01T00:00Z'), Date.parse('2025-01-01T00:00Z'), 'America/New_York')
    expect(truncated).toBe(false)
    expect(list.map((t) => t.instant)).toEqual(['2024-03-10T07:00:00Z', '2024-11-03T06:00:00Z'])
    const capped = transitionsBetween(Date.parse('1990-01-01T00:00Z'), Date.parse('2030-01-01T00:00Z'), 'Europe/London', 10)
    expect(capped.truncated).toBe(true)
    expect(capped.list).toHaveLength(10)
  })

  it('abbreviations fall back to GMT±h when CLDR has none', () => {
    expect(zoneAbbreviation(Date.parse('2024-07-01'), 'UTC')).toBe('UTC')
    expect(zoneAbbreviation(Date.parse('2024-07-01'), 'Asia/Kolkata')).toBe('IST')
    expect(zoneAbbreviation(Date.parse('2024-07-01'), 'America/Sao_Paulo')).toMatch(/^(GMT-3|BRT)$/)
  })
})

describe('zone search', () => {
  const at = Date.parse('2024-07-01T00:00:00Z')
  it('matches city aliases first', () => {
    expect(searchZones('mumbai', at)[0]).toEqual({ zone: 'Asia/Kolkata', matched: 'Mumbai' })
    expect(searchZones('San Francisco', at)[0].zone).toBe('America/Los_Angeles')
    expect(searchZones('pst', at)[0]).toEqual({ zone: 'America/Los_Angeles', matched: 'PST' })
  })
  it('matches id segments and partial words', () => {
    expect(searchZones('york', at)[0].zone).toBe('America/New_York')
    expect(searchZones('tokyo', at)[0].zone).toBe('Asia/Tokyo')
    expect(searchZones('buenos', at).some((r) => r.zone === 'America/Argentina/Buenos_Aires')).toBe(true)
    expect(searchZones('sao paulo', at)[0].zone).toBe('America/Sao_Paulo')
  })
  it('matches current UTC offsets', () => {
    const r = searchZones('+5:45', at)
    expect(r[0].zone).toBe('Asia/Kathmandu')
    expect(searchZones('utc-4', at).some((x) => x.zone === 'America/New_York')).toBe(true)
    // In January New York is UTC-5, not -4.
    expect(searchZones('utc-4', Date.parse('2024-01-15T00:00Z')).some((x) => x.zone === 'America/New_York')).toBe(false)
  })
  it('returns the start of the list for an empty query and nothing for garbage', () => {
    expect(searchZones('', at, undefined, 5)).toHaveLength(5)
    expect(searchZones('qqqzzz', at)).toEqual([])
  })
})
