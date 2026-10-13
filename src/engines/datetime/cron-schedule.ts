import { Temporal } from 'temporal-polyfill'
import { matchingDays, type CronDialect, type ParsedCron } from './cron'
import { formatOffsetNs, zoneAbbreviation } from './zones'

/**
 * Next run times for a parsed cron expression in an explicit IANA zone, with DST behaviour
 * that matches each scheduler family:
 *
 *  vixie   (Unix)    — fixed-time jobs whose wall time is skipped by a spring-forward run once,
 *                      right after the jump; in a fall-back overlap they run only the first time.
 *                      Wildcard jobs (minute or hour field starting with '*') simply follow the
 *                      clock: skipped minutes don't run, repeated minutes run twice.
 *  instant (seconds) — a matcher that checks the wall clock every second (node-cron style):
 *                      skipped wall times never run, repeated ones run twice.
 *  wall    (Quartz)  — next wall time is computed on the calendar and resolved like Java's
 *                      lenient Calendar: a skipped time moves forward by the gap (02:30 → 03:30),
 *                      a repeated time fires once (first occurrence); the repeated hour itself
 *                      is not revisited.
 */

export type DstPolicy = 'vixie' | 'instant' | 'wall'

export const DEFAULT_POLICY: Record<CronDialect, DstPolicy> = { unix: 'vixie', seconds: 'instant', quartz: 'wall', aws: 'wall' }

export type RunNoteKind = 'gap-shift' | 'gap-jump' | 'overlap-once' | 'overlap-first' | 'overlap-second'

export interface CronRun {
  epochMs: number
  epochNs: bigint
  /** "2024-03-10 03:30:00" in the schedule zone. */
  wall: string
  offset: string
  abbreviation: string
  /** ISO weekday 1–7 (Mon–Sun). */
  dayOfWeek: number
  /** Set when DST changed what happened at this run. */
  note?: { kind: RunNoteKind; text: string }
}

export interface SkippedRun {
  wall: string
  text: string
}

export interface ScheduleResult {
  runs: CronRun[]
  /** Scheduled wall times that never happen because of DST (wildcard/instant policies). */
  skipped: SkippedRun[]
  /** True when fewer than `count` runs exist before the search horizon. */
  exhausted: boolean
  horizonYear: number
  policy: DstPolicy
}

export interface ScheduleOptions {
  /** Runs strictly after this instant. */
  fromMs: number
  zone: string
  count: number
  policy?: DstPolicy
  /** Search this many years ahead at most (default 400; Quartz/AWS also stop at their max year). */
  horizonYears?: number
}

type Wall = [number, number, number, number, number, number]

const MAX_CANDIDATES = 2_000_000

function* wallCandidates(cron: ParsedCron, from: Wall, endYear: number): Generator<Wall> {
  const { hour, minute, second, month, year } = cron.fields
  const hours = hour.values
  const minutes = minute.values
  const seconds = second.values
  const months = month.values
  const years = year.any || !year.values.length ? null : year.values
  const [fy, fmo, fd, fh, fmi, fs] = from
  const yearIter = years ? years.filter((y) => y >= fy && y <= endYear) : null
  const yearCount = yearIter ? yearIter.length : endYear - fy + 1
  for (let yi = 0; yi < yearCount; yi++) {
    const y = yearIter ? yearIter[yi] : fy + yi
    const firstYear = y === fy
    for (const mo of months) {
      if (firstYear && mo < fmo) continue
      const firstMonth = firstYear && mo === fmo
      for (const d of matchingDays(cron, y, mo)) {
        if (firstMonth && d < fd) continue
        const firstDay = firstMonth && d === fd
        for (const h of hours) {
          if (firstDay && h < fh) continue
          const firstHour = firstDay && h === fh
          for (const mi of minutes) {
            if (firstHour && mi < fmi) continue
            const firstMinute = firstHour && mi === fmi
            for (const s of seconds) {
              if (firstMinute && s < fs) continue
              yield [y, mo, d, h, mi, s]
            }
          }
        }
      }
    }
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
function wallText(w: Wall | Temporal.PlainDateTime | Temporal.ZonedDateTime): string {
  if (Array.isArray(w)) return `${pad(w[0], 4)}-${pad(w[1])}-${pad(w[2])} ${pad(w[3])}:${pad(w[4])}:${pad(w[5])}`
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`
}
function hm(w: Wall | Temporal.ZonedDateTime) {
  return Array.isArray(w) ? `${pad(w[3])}:${pad(w[4])}${w[5] ? `:${pad(w[5])}` : ''}` : `${pad(w.hour)}:${pad(w.minute)}${w.second ? `:${pad(w.second)}` : ''}`
}

function toWall(z: Temporal.ZonedDateTime): Wall {
  return [z.year, z.month, z.day, z.hour, z.minute, z.second]
}

function plain(w: Wall): Temporal.PlainDateTime {
  return new Temporal.PlainDateTime(w[0], w[1], w[2], w[3], w[4], w[5])
}

function makeRun(z: Temporal.ZonedDateTime, note?: CronRun['note']): CronRun {
  return {
    epochMs: z.epochMilliseconds,
    epochNs: z.epochNanoseconds,
    wall: wallText(z),
    offset: z.offset,
    abbreviation: zoneAbbreviation(z.epochMilliseconds, z.timeZoneId),
    dayOfWeek: z.dayOfWeek,
    note,
  }
}

function addSecond(w: Wall): Wall {
  const p = plain(w).add({ seconds: 1 })
  return [p.year, p.month, p.day, p.hour, p.minute, p.second]
}

function minWall(a: Wall, b: Wall): Wall {
  for (let i = 0; i < 6; i++) if (a[i] !== b[i]) return a[i] < b[i] ? a : b
  return a
}

export function nextRuns(cron: ParsedCron, opts: ScheduleOptions): ScheduleResult {
  const policy = opts.policy ?? DEFAULT_POLICY[cron.dialect]
  const zone = opts.zone
  const fromInstant = Temporal.Instant.fromEpochMilliseconds(opts.fromMs)
  const fromZ = fromInstant.toZonedDateTimeISO(zone)
  const fromNs = fromInstant.epochNanoseconds
  let horizonYear = fromZ.year + (opts.horizonYears ?? 400)
  if (cron.dialect === 'quartz') horizonYear = Math.min(horizonYear, 2099)
  if (cron.dialect === 'aws') horizonYear = Math.min(horizonYear, 2199)
  const empty: ScheduleResult = { runs: [], skipped: [], exhausted: true, horizonYear, policy }
  if (cron.reboot || opts.count <= 0) return empty

  // First candidate: the next whole second after `from`.
  const startWall = addSecond(toWall(fromZ))
  if (policy === 'wall') return wallPolicy(cron, zone, fromNs, startWall, opts.count, horizonYear)

  // Instants after `from` can have earlier wall times if a fall-back happens soon: start the wall
  // scan at the wall time right after the next transition when that comes first.
  let scanFrom = startWall
  const nextT = fromZ.getTimeZoneTransition('next')
  if (nextT && nextT.epochMilliseconds - opts.fromMs < 86_400_000) scanFrom = minWall(scanFrom, toWall(nextT))

  const fixed = !(cron.fields.minute.star || cron.fields.hour.star)
  const collected = new Map<bigint, CronRun>()
  const skipped: SkippedRun[] = []
  let threshold: bigint | null = null
  let n = 0
  for (const w of wallCandidates(cron, scanFrom, horizonYear)) {
    if (++n > MAX_CANDIDATES) break
    const p = plain(w)
    const earlier = p.toZonedDateTime(zone, { disambiguation: 'earlier' })
    if (threshold !== null && earlier.epochNanoseconds > threshold) break
    const exists = earlier.toPlainDateTime().equals(p)
    const emit = (z: Temporal.ZonedDateTime, note?: CronRun['note']) => {
      if (z.epochNanoseconds <= fromNs) return
      if (!collected.has(z.epochNanoseconds)) collected.set(z.epochNanoseconds, makeRun(z, note))
    }
    if (!exists) {
      // Skipped by a spring-forward gap.
      const jump = earlier.getTimeZoneTransition('next')
      if (policy === 'vixie' && fixed && jump) {
        const before = jump.subtract({ nanoseconds: 1 })
        const from = hm(jump.toInstant().toZonedDateTimeISO(formatOffsetNs(before.offsetNanoseconds)))
        emit(jump, {
          kind: 'gap-jump',
          text: `Scheduled ${hm(w)} doesn’t exist (clocks jump ${from} → ${hm(jump)}). Vixie cron runs missed fixed-time jobs right after the jump.`,
        })
      } else if (earlier.epochNanoseconds > fromNs || p.toZonedDateTime(zone, { disambiguation: 'later' }).epochNanoseconds > fromNs) {
        skipped.push({
          wall: wallText(w),
          text:
            policy === 'vixie'
              ? `${hm(w)} on ${wallText(w).slice(0, 10)} is skipped by DST; wildcard jobs don’t catch up.`
              : `${hm(w)} on ${wallText(w).slice(0, 10)} never occurs (DST gap), so this run is skipped.`,
        })
      }
    } else {
      const later = p.toZonedDateTime(zone, { disambiguation: 'later' })
      if (later.epochNanoseconds !== earlier.epochNanoseconds) {
        const a1 = zoneAbbreviation(earlier.epochMilliseconds, zone)
        const a2 = zoneAbbreviation(later.epochMilliseconds, zone)
        if (policy === 'vixie' && fixed) {
          emit(earlier, { kind: 'overlap-once', text: `${hm(w)} happens twice (clocks fall back); fixed-time jobs run only the first time (${a1}), not again at ${a2}.` })
        } else {
          emit(earlier, { kind: 'overlap-first', text: `First of two ${hm(w)}s (${a1}) — clocks fall back later this hour.` })
          emit(later, { kind: 'overlap-second', text: `Second ${hm(w)} (${a2}) after clocks fell back — this run happens twice.` })
        }
      } else {
        emit(earlier)
      }
    }
    if (collected.size >= opts.count) {
      const sorted = [...collected.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      threshold = sorted[opts.count - 1]
    }
  }
  const runs = [...collected.values()].sort((a, b) => (a.epochNs < b.epochNs ? -1 : 1)).slice(0, opts.count)
  const lastNs = runs.length ? runs[runs.length - 1].epochNs : null
  return {
    runs,
    skipped: lastNs === null ? skipped : skipped.filter((s) => s.wall <= wallText(Temporal.Instant.fromEpochNanoseconds(lastNs).toZonedDateTimeISO(zone))),
    exhausted: runs.length < opts.count,
    horizonYear,
    policy,
  }
}

function wallPolicy(cron: ParsedCron, zone: string, fromNs: bigint, startWall: Wall, count: number, horizonYear: number): ScheduleResult {
  const runs: CronRun[] = []
  let cursorNs = fromNs
  let next: Wall = startWall
  let n = 0
  outer: while (runs.length < count) {
    let found = false
    for (const w of wallCandidates(cron, next, horizonYear)) {
      if (++n > MAX_CANDIDATES) break outer
      const p = plain(w)
      const z = p.toZonedDateTime(zone, { disambiguation: 'compatible' })
      if (z.epochNanoseconds <= cursorNs) {
        // A repeated wall time already passed (we're in the second half of an overlap).
        next = addSecond(w)
        found = true
        break
      }
      let note: CronRun['note']
      if (!z.toPlainDateTime().equals(p)) {
        note = { kind: 'gap-shift', text: `Scheduled ${hm(w)} doesn’t exist (DST gap); Quartz’s lenient calendar moves it forward to ${hm(z)}.` }
      } else {
        const later = p.toZonedDateTime(zone, { disambiguation: 'later' })
        if (later.epochNanoseconds !== z.epochNanoseconds) {
          note = {
            kind: 'overlap-once',
            text: `${hm(w)} happens twice (clocks fall back); Quartz fires once, at the first occurrence (${zoneAbbreviation(z.epochMilliseconds, zone)}), and doesn’t revisit the repeated hour.`,
          }
        }
      }
      runs.push(makeRun(z, note))
      cursorNs = z.epochNanoseconds
      next = addSecond(toWall(z))
      found = true
      break
    }
    if (!found) break
  }
  return { runs, skipped: [], exhausted: runs.length < count, horizonYear, policy: 'wall' }
}
