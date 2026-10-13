import cronstrue from 'cronstrue'
import { DIALECTS, FIELD_LABELS, describeValues, type CronField, type ParsedCron } from './cron'

/** Plain-English description (cronstrue, configured per dialect) plus semantics notes. */

export interface CronDescription {
  /** Sentence from cronstrue, or a field-by-field fallback if cronstrue can't read it. */
  text: string
  /** Things cronstrue doesn't say: day-matching rule, reboot, time zone caveats. */
  notes: string[]
}

function cronstrueInput(cron: ParsedCron): string {
  const raw = cron.present.map((n) => cron.fields[n].raw)
  switch (cron.dialect) {
    case 'unix':
    case 'seconds':
      return raw.join(' ')
    case 'quartz':
      return raw.join(' ')
    case 'aws':
      // cronstrue reads 7 fields as seconds … year; EventBridge has no seconds.
      return ['0', ...raw].join(' ')
  }
}

function restricted(f: CronField) {
  return !f.star && !f.noSpec
}

export function describeCron(cron: ParsedCron, opts: { use24Hour?: boolean } = {}): CronDescription {
  const notes: string[] = []
  if (cron.reboot) {
    return { text: 'Once, when the cron daemon starts (at boot)', notes: ['@reboot has no calendar schedule, so there are no upcoming run times to list.'] }
  }
  let text: string
  try {
    text = cronstrue.toString(cronstrueInput(cron), {
      use24HourTimeFormat: opts.use24Hour ?? true,
      dayOfWeekStartIndexZero: cron.dialect === 'unix' || cron.dialect === 'seconds',
      throwExceptionOnParseError: true,
      verbose: false,
    })
  } catch {
    text = fallbackDescription(cron)
  }
  if (cron.macro && cron.macro !== '@reboot') notes.push(`${cron.macro} is shorthand for “${cron.expression}”.`)

  const dom = cron.fields.dayOfMonth
  const dow = cron.fields.dayOfWeek
  if (cron.dayRule === 'or') {
    if (restricted(dom) && restricted(dow)) {
      notes.push(`Day-of-month and day-of-week are both restricted, so it runs when EITHER matches (${describeValues(dom, cron.dialect)} OR ${describeValues(dow, cron.dialect)}) — the classic Vixie rule.`)
    } else if ((dom.star && !dom.any) || (dow.star && !dow.any)) {
      const which = dom.star && !dom.any ? 'day-of-month' : 'day-of-week'
      notes.push(
        `${which} starts with “*” (${which === 'day-of-month' ? dom.raw : dow.raw}), so Vixie/cronie require BOTH day fields to match. Some libraries (e.g. cron-parser) treat it as restricted and use OR instead.`,
      )
    }
  } else if (cron.dayRule === 'and' && (restricted(dom) || restricted(dow)) && !(dom.any || dow.any)) {
    notes.push('node-cron rule: a day must match BOTH day-of-month and day-of-week.')
  }
  if (cron.dialect === 'aws') notes.push('EventBridge rules always run in UTC; EventBridge Scheduler schedules can set a time zone.')
  return { text, notes }
}

function fallbackDescription(cron: ParsedCron): string {
  return cron.present
    .map((n) => `${FIELD_LABELS[n]}: ${describeValues(cron.fields[n], cron.dialect)}`)
    .join('; ')
}

export function dialectFieldOrder(cron: ParsedCron): string {
  return DIALECTS[cron.dialect].fields.map((f) => FIELD_LABELS[f]).join(' · ')
}
