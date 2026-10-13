import { Temporal } from 'temporal-polyfill'

/** "YYYY-MM-DDTHH:mm:ss" for a datetime-local input, from an instant in a zone. */
export function toInputValue(epochMs: number, zone: string): string {
  const z = Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(zone)
  return z.toPlainDateTime().toString({ smallestUnit: 'second' })
}

/** Parses a datetime-local value (seconds optional). Null when empty or invalid. */
export function parseInputValue(v: string): Temporal.PlainDateTime | null {
  if (!v) return null
  try {
    return Temporal.PlainDateTime.from(v, { overflow: 'reject' })
  } catch {
    return null
  }
}

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
