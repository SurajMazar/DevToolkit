import { Temporal } from 'temporal-polyfill'
import { formatOffsetNs, zoneAbbreviation } from './zones'

/** Wall-time resolution across zones, with explicit handling of DST gaps and overlaps. */

export type Disambiguation = 'compatible' | 'earlier' | 'later' | 'reject'

export interface WallResolution {
  /** ok = exactly one instant; gap = wall time skipped; ambiguous = wall time occurs twice. */
  status: 'ok' | 'gap' | 'ambiguous'
  /** Chosen instant (absent when status ≠ ok and disambiguation = reject). */
  chosen: Temporal.ZonedDateTime | null
  /** Interpretation with the offset in effect before the transition. */
  earlier: Temporal.ZonedDateTime
  /** Interpretation with the offset in effect after the transition. */
  later: Temporal.ZonedDateTime
  /** Length of the gap/overlap in minutes (0 when ok). */
  shiftMinutes: number
  explanation: string
}

const pad = (n: number) => String(n).padStart(2, '0')
function hm(p: Temporal.PlainDateTime | Temporal.ZonedDateTime) {
  return `${pad(p.hour)}:${pad(p.minute)}`
}

export function resolveWallTime(wall: Temporal.PlainDateTime, zone: string, disambiguation: Disambiguation): WallResolution {
  const earlier = wall.toZonedDateTime(zone, { disambiguation: 'earlier' })
  const later = wall.toZonedDateTime(zone, { disambiguation: 'later' })
  const exists = earlier.toPlainDateTime().equals(wall)
  const twice = exists && earlier.epochNanoseconds !== later.epochNanoseconds
  if (exists && !twice) return { status: 'ok', chosen: earlier, earlier, later, shiftMinutes: 0, explanation: '' }

  const date = wall.toPlainDate().toString()
  if (!exists) {
    // In a gap, 'earlier' shifts backwards and 'later' forwards by the gap length.
    const gap = Math.round((later.epochMilliseconds - earlier.epochMilliseconds) / 60_000)
    const transition = earlier.getTimeZoneTransition('next')
    const before = transition ? transition.subtract({ nanoseconds: 1 }) : earlier
    const jumpFrom = transition ? hm(transition.toInstant().toZonedDateTimeISO(formatOffsetNs(before.offsetNanoseconds))) : '?'
    const jumpTo = transition ? hm(transition) : '?'
    const chosen = disambiguation === 'reject' ? null : disambiguation === 'earlier' ? earlier : later
    return {
      status: 'gap',
      chosen,
      earlier,
      later,
      shiftMinutes: gap,
      explanation: `${hm(wall)} doesn’t exist on ${date} in ${zone}: clocks jump from ${jumpFrom} to ${jumpTo} (${earlier.offset} → ${later.offset}). “Earlier” reads it with the old offset (= ${hm(earlier)} ${earlier.offset}); “Later” with the new one (= ${hm(later)} ${later.offset}).`,
    }
  }
  const overlap = Math.round((later.epochMilliseconds - earlier.epochMilliseconds) / 60_000)
  const chosen = disambiguation === 'reject' ? null : disambiguation === 'later' ? later : earlier
  return {
    status: 'ambiguous',
    chosen,
    earlier,
    later,
    shiftMinutes: overlap,
    explanation: `${hm(wall)} happens twice on ${date} in ${zone}: clocks fall back ${overlap} min. First occurrence ${earlier.offset} (${zoneAbbreviation(earlier.epochMilliseconds, zone)}), second ${later.offset} (${zoneAbbreviation(later.epochMilliseconds, zone)}), ${overlap} min apart.`,
  }
}

/** Calendar-day difference of `z`'s local date relative to `ref`'s local date (−1, 0, +1…). */
export function dayDelta(z: Temporal.ZonedDateTime, ref: Temporal.ZonedDateTime): number {
  return ref.toPlainDate().until(z.toPlainDate(), { largestUnit: 'days' }).days
}

export interface TimelineCell {
  /** Local hour (0–23) and minute at the start of this cell. */
  hour: number
  minute: number
  /** Local date offset relative to the source date. */
  dayDelta: number
  kind: 'work' | 'edge' | 'night'
}

export interface TimelineRow {
  zone: string
  cells: TimelineCell[]
}

export interface DayTimeline {
  /** Number of hourly cells (23/24/25 on source DST days). */
  hours: number
  startEpochMs: number
  rows: TimelineRow[]
  /** For each cell: true when every zone is inside working hours. */
  overlap: boolean[]
  /** Index of the cell containing the selected instant (fractional position 0–hours). */
  markerPosition: number
}

/**
 * Hour-by-hour strip of the source zone's calendar day, mapped into each zone. Cells are exact
 * hours after the source day's start, so DST days in the source have 23 or 25 cells.
 */
export function dayTimeline(selected: Temporal.ZonedDateTime, zones: string[], workStart = 9, workEnd = 17): DayTimeline {
  const start = selected.startOfDay()
  const nextStart = start.add({ days: 1 }).startOfDay()
  const hours = Math.round((nextStart.epochMilliseconds - start.epochMilliseconds) / 3_600_000)
  const instants = Array.from({ length: hours }, (_, i) => start.toInstant().add({ hours: i }))
  const rows: TimelineRow[] = zones.map((zone) => ({
    zone,
    cells: instants.map((inst) => {
      const z = inst.toZonedDateTimeISO(zone)
      const h = z.hour + z.minute / 60
      const kind: TimelineCell['kind'] = h >= workStart && h < workEnd ? 'work' : h >= workStart - 2 && h < workEnd + 4 ? 'edge' : 'night'
      return { hour: z.hour, minute: z.minute, dayDelta: dayDelta(z, start), kind }
    }),
  }))
  const overlap = instants.map((_, i) => rows.length > 0 && rows.every((r) => r.cells[i].kind === 'work'))
  return {
    hours,
    startEpochMs: start.epochMilliseconds,
    rows,
    overlap,
    markerPosition: (selected.epochMilliseconds - start.epochMilliseconds) / 3_600_000,
  }
}

/** Ranges of consecutive overlapping cells as [startIndex, endIndexExclusive]. */
export function overlapRanges(overlap: boolean[]): [number, number][] {
  const out: [number, number][] = []
  let s = -1
  overlap.forEach((v, i) => {
    if (v && s < 0) s = i
    if (!v && s >= 0) {
      out.push([s, i])
      s = -1
    }
  })
  if (s >= 0) out.push([s, overlap.length])
  return out
}
