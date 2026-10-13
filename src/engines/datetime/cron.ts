/**
 * Cron expression parsing and validation, per dialect. Dialects really differ:
 *
 *  unix    — Vixie/cronie crontab: 5 fields, DOW 0–7 (0/7 = Sun), @macros, no ? L W #.
 *            Day rule: if DOM and DOW are both restricted (neither starts with '*') a day
 *            matches when EITHER matches; otherwise both must match.
 *  seconds — 6 fields with leading seconds (node-cron / cron-parser / croner style). Same
 *            value syntax as unix (no macros). Day rule configurable: OR (Vixie, cron-parser,
 *            croner) or AND (node-cron).
 *  quartz  — Quartz Scheduler: 6–7 fields (sec min hour DOM month DOW [year]), DOW 1–7 =
 *            SUN–SAT, exactly one of DOM/DOW must be '?', L, L-n, LW, nW, nL, n#k, a/n,
 *            wrap-around ranges (FRI-MON), year 1970–2099.
 *  aws     — Amazon EventBridge cron(): 6 fields (min hour DOM month DOW year), no seconds,
 *            otherwise Quartz-like (? L W #), year 1970–2199. Rules evaluate in UTC.
 *
 * Pure TypeScript; tested in Node.
 */

export type CronDialect = 'unix' | 'seconds' | 'quartz' | 'aws'
export type CronFieldName = 'second' | 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek' | 'year'
export type DayRule = 'or' | 'and'

export interface DialectInfo {
  id: CronDialect
  name: string
  short: string
  description: string
  /** Field order. For quartz the year is optional. */
  fields: CronFieldName[]
  optionalYear: boolean
  example: string
}

export const DIALECTS: Record<CronDialect, DialectInfo> = {
  unix: {
    id: 'unix',
    name: 'Unix / Vixie (5 fields)',
    short: 'Unix',
    description: 'crontab, cronie, Kubernetes CronJob, GitHub Actions',
    fields: ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'],
    optionalYear: false,
    example: '*/15 9-17 * * 1-5',
  },
  seconds: {
    id: 'seconds',
    name: '6 fields with seconds',
    short: 'Seconds',
    description: 'node-cron, cron-parser, croner, Spring (without ?)',
    fields: ['second', 'minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'],
    optionalYear: false,
    example: '0 */5 9-17 * * 1-5',
  },
  quartz: {
    id: 'quartz',
    name: 'Quartz (6–7 fields)',
    short: 'Quartz',
    description: 'Quartz Scheduler, Spring @Scheduled-like, Jenkins-free Java schedulers',
    fields: ['second', 'minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek', 'year'],
    optionalYear: true,
    example: '0 0 9 ? * MON-FRI',
  },
  aws: {
    id: 'aws',
    name: 'AWS EventBridge cron()',
    short: 'EventBridge',
    description: 'EventBridge rules & Scheduler: minutes … day-of-week year, no seconds',
    fields: ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek', 'year'],
    optionalYear: false,
    example: 'cron(0 9 ? * MON-FRI *)',
  },
}

export const FIELD_LABELS: Record<CronFieldName, string> = {
  second: 'Second',
  minute: 'Minute',
  hour: 'Hour',
  dayOfMonth: 'Day of month',
  month: 'Month',
  dayOfWeek: 'Day of week',
  year: 'Year',
}

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const DOW_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
export const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export interface FieldSpec {
  name: CronFieldName
  label: string
  /** Range in the dialect's own numbering (e.g. Quartz DOW 1–7). */
  min: number
  max: number
  /** Canonical range used internally (DOW 0–6 with 0 = Sunday). */
  cmin: number
  cmax: number
  names?: string[]
  /** Map raw value → canonical. */
  toCanonical: (v: number) => number
  /** Map canonical → raw (for building expressions). */
  fromCanonical: (v: number) => number
  /** Special characters accepted, for documentation. */
  specials: string[]
  allowedText: string
}

export function fieldSpec(dialect: CronDialect, name: CronFieldName): FieldSpec {
  const id = (v: number) => v
  const quartzLike = dialect === 'quartz' || dialect === 'aws'
  const base = { name, label: FIELD_LABELS[name], toCanonical: id, fromCanonical: id }
  switch (name) {
    case 'second':
      return { ...base, min: 0, max: 59, cmin: 0, cmax: 59, specials: [',', '-', '*', '/'], allowedText: '0–59' }
    case 'minute':
      return { ...base, min: 0, max: 59, cmin: 0, cmax: 59, specials: [',', '-', '*', '/'], allowedText: '0–59' }
    case 'hour':
      return { ...base, min: 0, max: 23, cmin: 0, cmax: 23, specials: [',', '-', '*', '/'], allowedText: '0–23' }
    case 'dayOfMonth':
      return {
        ...base,
        min: 1,
        max: 31,
        cmin: 1,
        cmax: 31,
        specials: quartzLike ? [',', '-', '*', '/', '?', 'L', 'W', ...(dialect === 'quartz' ? ['L-n'] : []), 'LW'] : [',', '-', '*', '/'],
        allowedText: '1–31',
      }
    case 'month':
      return { ...base, min: 1, max: 12, cmin: 1, cmax: 12, names: MONTH_NAMES, toCanonical: id, specials: [',', '-', '*', '/'], allowedText: '1–12 or JAN–DEC' }
    case 'dayOfWeek':
      return quartzLike
        ? {
            ...base,
            min: 1,
            max: 7,
            cmin: 0,
            cmax: 6,
            names: DOW_NAMES,
            toCanonical: (v) => v - 1,
            fromCanonical: (v) => v + 1,
            specials: [',', '-', '*', '/', '?', 'L', '#'],
            allowedText: '1–7 (1 = SUN) or SUN–SAT',
          }
        : {
            ...base,
            min: 0,
            max: 7,
            cmin: 0,
            cmax: 6,
            names: DOW_NAMES,
            toCanonical: (v) => v % 7,
            fromCanonical: id,
            specials: [',', '-', '*', '/'],
            allowedText: '0–7 (0 and 7 = SUN) or SUN–SAT',
          }
    case 'year': {
      const max = dialect === 'aws' ? 2199 : 2099
      return { ...base, min: 1970, max, cmin: 1970, cmax: max, specials: [',', '-', '*', '/'], allowedText: `1970–${max}` }
    }
  }
}

export interface CronField {
  name: CronFieldName
  raw: string
  /** Sorted canonical values (DOW: 0 = Sunday). */
  values: number[]
  /** Raw text begins with '*' (Vixie day rule, wildcard jobs). */
  star: boolean
  /** Matches every value (or '?'). */
  any: boolean
  /** Quartz '?' — no specific value. */
  noSpec: boolean
  /** DOM 'L' (0) or 'L-n' (n days before the last). */
  lastDayOffset?: number
  /** DOM 'LW'. */
  lastWeekday?: boolean
  /** DOM 'nW'. */
  nearestWeekday?: number
  /** DOW 'nL' — last given weekday of the month (canonical DOW). */
  lastDow?: number
  /** DOW 'n#k'. */
  nthDow?: { dow: number; n: number }
}

export interface FieldResult {
  name: CronFieldName
  raw: string
  /** Missing optional field (Quartz year). */
  implicit?: boolean
  field?: CronField
  error?: string
  warnings: string[]
}

export interface CronIssue {
  field: CronFieldName | null
  message: string
}

export interface ParsedCron {
  dialect: CronDialect
  /** Normalized expression (fields joined by single spaces, macro expanded). */
  expression: string
  /** Original input, trimmed. */
  source: string
  fields: Record<CronFieldName, CronField>
  /** Fields actually written by the user, in order. */
  present: CronFieldName[]
  macro?: string
  reboot?: boolean
  dayRule: DayRule | 'quartz'
  warnings: CronIssue[]
}

export type CronParseResult =
  | { ok: true; cron: ParsedCron; fields: FieldResult[]; warnings: CronIssue[] }
  | { ok: false; errors: CronIssue[]; fields: FieldResult[]; warnings: CronIssue[] }

export const UNIX_MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}

function fieldWord(name: CronFieldName) {
  return FIELD_LABELS[name].toLowerCase()
}

/** Parses a single value (number or name) in raw dialect numbering. */
function parseValue(tok: string, spec: FieldSpec): number | string {
  if (/^\d+$/.test(tok)) {
    const v = Number(tok)
    if (v < spec.min || v > spec.max) return `${v} is out of range — ${fieldWord(spec.name)} accepts ${spec.allowedText}.`
    return v
  }
  if (spec.names) {
    const i = spec.names.indexOf(tok.toUpperCase())
    if (i >= 0) return spec.name === 'month' ? i + 1 : spec.min === 1 ? i + 1 : i
    return `“${tok}” isn’t a valid ${fieldWord(spec.name)} — use ${spec.allowedText}.`
  }
  return `“${tok}” isn’t a number — ${fieldWord(spec.name)} accepts ${spec.allowedText}.`
}

const ITEM_RE = /^(\*|[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)(?:\/([^/]*))?$/

function dialectHint(dialect: CronDialect, ch: string): string {
  const meaning: Record<string, string> = {
    L: '“L” (last)',
    W: '“W” (nearest weekday)',
    '#': '“#” (nth weekday)',
    '?': '“?” (no specific value)',
    H: '“H” (hashed value, Jenkins)',
  }
  const what = meaning[ch] ?? `“${ch}”`
  if (ch === 'H') return `${what} is Jenkins syntax and isn’t supported by ${DIALECTS[dialect].short} cron.`
  return `${what} is a Quartz/EventBridge extension — ${DIALECTS[dialect].short} cron doesn’t support it. Switch the dialect to Quartz if your scheduler is Quartz-based.`
}

function parseField(raw: string, spec: FieldSpec, dialect: CronDialect): FieldResult {
  const res: FieldResult = { name: spec.name, raw, warnings: [] }
  const quartzLike = dialect === 'quartz' || dialect === 'aws'
  const up = raw.toUpperCase()
  const fail = (error: string): FieldResult => ({ ...res, error })
  const isDay = spec.name === 'dayOfMonth' || spec.name === 'dayOfWeek'

  if (!raw) return fail('Empty field.')

  // '?' — Quartz/AWS day fields only, alone.
  if (raw.includes('?')) {
    if (!quartzLike) return fail(dialectHint(dialect, '?'))
    if (!isDay) return fail('“?” is only allowed in day-of-month or day-of-week.')
    if (raw !== '?') return fail('“?” must be used on its own.')
    return { ...res, field: { name: spec.name, raw, values: range(spec.cmin, spec.cmax), star: false, any: true, noSpec: true } }
  }

  // Characters that aren't valid in this dialect.
  if (!quartzLike) {
    for (const ch of ['L', 'W', '#']) {
      if (up.includes(ch) && !(spec.names && /^[A-Z,\-*/0-9]+$/.test(up) && namesOnly(up, spec))) return fail(dialectHint(dialect, ch))
    }
  }
  if (/(^|[^A-Z])H([^A-Z]|$)|^H/.test(up) && !(spec.names && namesOnly(up, spec))) return fail(dialectHint(dialect, 'H'))

  // Quartz/AWS day-of-month specials.
  if (quartzLike && spec.name === 'dayOfMonth' && /[LW]/.test(up)) {
    if (up.includes(',')) return fail('“L” and “W” can’t be combined with other values in a list.')
    let m: RegExpExecArray | null
    if (up === 'L') return ok({ lastDayOffset: 0 })
    if (up === 'LW') {
      if (dialect === 'aws') res.warnings.push('“LW” is Quartz syntax; AWS documents L and W separately — verify it in the EventBridge console.')
      return ok({ lastWeekday: true })
    }
    if ((m = /^L-(\d+)$/.exec(up))) {
      if (dialect === 'aws') return fail('“L-n” (offset from the last day) is Quartz-only; EventBridge doesn’t support it.')
      const n = Number(m[1])
      if (n > 30) return fail('Offset from last day must be 30 or less (L-0 … L-30).')
      return ok({ lastDayOffset: n })
    }
    if ((m = /^(\d+)W$/.exec(up))) {
      const n = Number(m[1])
      if (n < 1 || n > 31) return fail(`${n}W: the day must be 1–31.`)
      if (n > 28) res.warnings.push(`${n}W: months shorter than ${n} days have no such day and are skipped here.`)
      return ok({ nearestWeekday: n })
    }
    if (/W/.test(up) && /[-/,*]/.test(up)) return fail('“W” can only follow a single day (e.g. 15W), not a range or list.')
    return fail(`“${raw}” — use L, L-n, LW or nW (e.g. 15W).`)
  }

  // Quartz/AWS day-of-week specials.
  if (quartzLike && spec.name === 'dayOfWeek' && /L|#/.test(up.replace(/SAT|SUN|MON|TUE|WED|THU|FRI/g, (s) => s.toLowerCase()))) {
    const plain = up
    if (plain.includes(',')) return fail('“L” and “#” can’t be combined with other values in a list.')
    let m: RegExpExecArray | null
    if (plain === 'L') {
      res.warnings.push('“L” alone in day-of-week means Saturday (7), not “last day”.')
      return ok({ values: [6] })
    }
    if ((m = /^([A-Z0-9]+)L$/.exec(plain))) {
      const v = parseValue(m[1], spec)
      if (typeof v === 'string') return fail(v)
      return ok({ lastDow: spec.toCanonical(v), values: [spec.toCanonical(v)] })
    }
    if ((m = /^([A-Z0-9]+)#(\d+)$/.exec(plain))) {
      const v = parseValue(m[1], spec)
      if (typeof v === 'string') return fail(v)
      const n = Number(m[2])
      if (n < 1 || n > 5) return fail(`#${n}: the occurrence must be 1–5.`)
      return ok({ nthDow: { dow: spec.toCanonical(v), n }, values: [spec.toCanonical(v)] })
    }
    return fail(`“${raw}” — use nL (last weekday n of the month) or n#k (k-th weekday n), e.g. 6L or MON#2.`)
  }

  // General syntax: list of '*', 'a', 'a-b' with optional '/step'.
  const set = new Set<number>()
  const items = raw.split(',')
  for (const item of items) {
    if (!item) return fail('Empty item in list (check for doubled or trailing commas).')
    const m = ITEM_RE.exec(item)
    if (!m) return fail(`“${item}” isn’t valid ${fieldWord(spec.name)} syntax.`)
    const [, baseTok, stepTok] = m
    let step = 1
    if (stepTok !== undefined) {
      if (!/^\d+$/.test(stepTok)) return fail(`Step “/${stepTok}” must be a positive whole number.`)
      step = Number(stepTok)
      if (step === 0) return fail('Step “/0” is invalid — the step must be at least 1.')
    }
    let lo: number
    let hi: number
    if (baseTok === '*') {
      lo = spec.min
      hi = spec.max
      if (spec.name === 'dayOfWeek' && !quartzLike) hi = 6 // */2 over 0–6, not 0–7
    } else if (baseTok.includes('-')) {
      const [aTok, bTok] = baseTok.split('-')
      const a = parseValue(aTok, spec)
      if (typeof a === 'string') return fail(a)
      const b = parseValue(bTok, spec)
      if (typeof b === 'string') return fail(b)
      lo = a
      hi = b
      if (a > b) {
        if (!quartzLike || spec.name === 'year') return fail(`Range ${aTok}-${bTok} runs backwards — the start must not be after the end${!quartzLike ? ` (write it as two ranges, e.g. ${aTok}-${spec.max},${spec.min}-${bTok})` : ''}.`)
        // Quartz wraps around: 22-2 = 22,23,0,1,2; FRI-MON = FRI,SAT,SUN,MON.
        hi = b + (spec.max - spec.min + 1)
      }
    } else {
      const a = parseValue(baseTok, spec)
      if (typeof a === 'string') return fail(a)
      lo = a
      hi = a
      if (stepTok !== undefined) {
        if (!quartzLike)
          return fail(`“${item}”: ${DIALECTS[dialect].short} cron needs a range or * before a step — write ${baseTok}-${spec.name === 'dayOfWeek' ? 6 : spec.max}/${step} (Quartz’s start/step form isn’t supported).`)
        hi = spec.max // Quartz: a/n = from a to the field maximum
      }
    }
    const span = spec.max - spec.min + 1
    if (stepTok !== undefined && step >= span) {
      if (quartzLike) return fail(`Step /${step} is larger than the ${fieldWord(spec.name)} range (${spec.allowedText}).`)
      res.warnings.push(`Step /${step} ≥ the field’s range, so “${item}” only matches ${lo}.`)
    }
    for (let v = lo; v <= hi; v += step) {
      const raw = v > spec.max ? v - span : v
      set.add(spec.toCanonical(raw))
    }
  }
  if (!quartzLike && spec.names && /[A-Z]/i.test(raw) && /[-,]/.test(raw)) {
    res.warnings.push('Name ranges/lists (e.g. MON-FRI) work in cronie and most libraries, but classic Vixie cron (Debian’s “cron”) accepts only single names — use numbers for portability.')
  }
  const values = [...set].sort((a, b) => a - b)
  return ok({ values })

  function ok(extra: Partial<CronField>): FieldResult {
    const values = extra.values ?? range(spec.cmin, spec.cmax)
    const field: CronField = {
      name: spec.name,
      raw,
      star: raw.startsWith('*'),
      noSpec: false,
      ...extra,
      values,
      any: !extra.lastDayOffset && extra.lastDayOffset !== 0 && !extra.lastWeekday && !extra.nearestWeekday && extra.lastDow === undefined && !extra.nthDow && values.length === spec.cmax - spec.cmin + 1,
    }
    return { ...res, field }
  }
}

function namesOnly(up: string, spec: FieldSpec): boolean {
  // True when every alphabetic run is a valid name (so 'L' in "JUL" or 'W' in "WED" isn't special).
  const words = up.match(/[A-Z]+/g) ?? []
  return words.every((w) => spec.names!.includes(w))
}

function range(a: number, b: number): number[] {
  const out: number[] = []
  for (let i = a; i <= b; i++) out.push(i)
  return out
}

/** Splits an expression into its field tokens for a dialect (strips AWS cron(...)). */
export function splitExpression(expr: string, dialect: CronDialect): { tokens: string[]; error?: string; macro?: string } {
  let s = expr.trim()
  if (dialect === 'aws') {
    if (/^rate\s*\(/i.test(s)) return { tokens: [], error: 'rate() is EventBridge’s fixed-interval syntax, not cron — e.g. rate(5 minutes). Enter a cron(...) expression.' }
    const m = /^cron\s*\(([\s\S]*)\)$/i.exec(s)
    if (m) s = m[1].trim()
    else if (/^cron\s*\(/i.test(s)) return { tokens: [], error: 'Missing closing “)” in cron(...).' }
  }
  if (!s) return { tokens: [], error: 'Enter a cron expression.' }
  if (s.startsWith('@')) return { tokens: [], macro: s.split(/\s+/)[0].toLowerCase() }
  return { tokens: s.split(/\s+/) }
}

function countError(dialect: CronDialect, n: number, tokens: string[]): string {
  switch (dialect) {
    case 'unix':
      if (n === 6) {
        if (/^[/~.]|\w\/\w/.test(tokens[5]) || /^[a-z_]/i.test(tokens[5]) && !/^(\*|\?|[A-Z]{3}(-[A-Z]{3})?)$/i.test(tokens[5]))
          return `Expected 5 fields (minute hour day-of-month month day-of-week), found 6. “${tokens[5]}” looks like a command — paste only the schedule.`
        return 'Expected 5 fields (minute hour day-of-month month day-of-week), found 6. If the first field is seconds, switch to the “6 fields with seconds” dialect.'
      }
      if (n === 7) return 'Expected 5 fields, found 7 — this looks like a Quartz expression (seconds … year). Switch the dialect to Quartz.'
      return `Expected 5 fields (minute hour day-of-month month day-of-week), found ${n}.`
    case 'seconds':
      if (n === 5) return 'Expected 6 fields starting with seconds, found 5. Prepend a seconds value (e.g. “0 ”) or switch to the Unix dialect.'
      return `Expected 6 fields (second minute hour day-of-month month day-of-week), found ${n}.${n === 7 ? ' Seven fields with a year are Quartz syntax.' : ''}`
    case 'quartz':
      if (n === 5) return 'Quartz needs 6–7 fields starting with seconds (second minute hour day-of-month month day-of-week [year]). Found 5 — this looks like Unix cron.'
      return `Quartz needs 6 or 7 fields (second minute hour day-of-month month day-of-week [year]), found ${n}.`
    case 'aws':
      if (n === 5) return 'EventBridge needs 6 fields: minutes hours day-of-month month day-of-week year. Add the year field (e.g. “*”).'
      if (n === 7) return 'EventBridge has no seconds field — use 6 fields: minutes hours day-of-month month day-of-week year.'
      return `EventBridge needs 6 fields (minutes hours day-of-month month day-of-week year), found ${n}.`
  }
}

export function parseCron(expression: string, dialect: CronDialect, opts: { dayRule?: DayRule } = {}): CronParseResult {
  const source = expression.trim()
  const split = splitExpression(source, dialect)
  const info = DIALECTS[dialect]
  if (split.error) return { ok: false, errors: [{ field: null, message: split.error }], fields: [], warnings: [] }

  let tokens = split.tokens
  let macro: string | undefined
  let reboot = false
  if (split.macro) {
    if (dialect !== 'unix') {
      return { ok: false, errors: [{ field: null, message: `Macros like ${split.macro} are Unix crontab syntax; ${info.short} doesn’t support them.` }], fields: [], warnings: [] }
    }
    if (split.macro === '@reboot') {
      reboot = true
      macro = '@reboot'
      tokens = []
    } else if (UNIX_MACROS[split.macro]) {
      macro = split.macro
      tokens = UNIX_MACROS[split.macro].split(' ')
    } else {
      return {
        ok: false,
        errors: [{ field: null, message: `Unknown macro “${split.macro}”. Supported: @yearly, @annually, @monthly, @weekly, @daily, @midnight, @hourly, @reboot.` }],
        fields: [],
        warnings: [],
      }
    }
  }

  const want = info.fields
  const n = tokens.length
  const countOk = reboot || n === want.length || (info.optionalYear && n === want.length - 1)
  if (!countOk) {
    return { ok: false, errors: [{ field: null, message: countError(dialect, n, tokens) }], fields: [], warnings: [] }
  }

  const fields: FieldResult[] = []
  const errors: CronIssue[] = []
  const warnings: CronIssue[] = []
  if (!reboot) {
    want.forEach((name, i) => {
      const tok = tokens[i]
      const spec = fieldSpec(dialect, name)
      if (tok === undefined) {
        // Quartz optional year.
        fields.push({ name, raw: '*', implicit: true, warnings: [], field: { name, raw: '*', values: range(spec.cmin, spec.cmax), star: true, any: true, noSpec: false } })
        return
      }
      const r = parseField(tok, spec, dialect)
      fields.push(r)
      if (r.error) errors.push({ field: name, message: r.error })
      for (const w of r.warnings) warnings.push({ field: name, message: w })
    })
  }

  // Quartz/AWS: exactly one of DOM / DOW must be '?'.
  if (!reboot && (dialect === 'quartz' || dialect === 'aws')) {
    const dom = fields.find((f) => f.name === 'dayOfMonth')
    const dow = fields.find((f) => f.name === 'dayOfWeek')
    if (dom?.field && dow?.field) {
      if (dom.field.noSpec && dow.field.noSpec) errors.push({ field: 'dayOfWeek', message: '“?” can’t be used in both day fields — set one of them (e.g. * in day-of-month).' })
      else if (!dom.field.noSpec && !dow.field.noSpec) {
        const ex = dialect === 'quartz' ? '0 0 12 * * ? or 0 0 12 ? * MON' : 'cron(0 12 * * ? *) or cron(0 12 ? * MON *)'
        errors.push({
          field: dom.raw === '*' ? 'dayOfWeek' : 'dayOfMonth',
          message: `${info.short} requires “?” in day-of-month or day-of-week (both are set) — e.g. ${ex}.`,
        })
      }
    }
  }

  if (errors.length) return { ok: false, errors, fields, warnings }

  const byName = {} as Record<CronFieldName, CronField>
  for (const f of fields) byName[f.name] = f.field!
  // Fill fields this dialect doesn't have.
  if (!byName.second) byName.second = { name: 'second', raw: '0', values: [0], star: false, any: false, noSpec: false }
  if (!byName.year) byName.year = { name: 'year', raw: '*', values: [], star: true, any: true, noSpec: false }
  for (const name of ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'] as CronFieldName[]) {
    if (!byName[name]) {
      const spec = fieldSpec(dialect, name)
      byName[name] = { name, raw: '*', values: range(spec.cmin, spec.cmax), star: true, any: true, noSpec: false }
    }
  }

  const dayRule: ParsedCron['dayRule'] = dialect === 'quartz' || dialect === 'aws' ? 'quartz' : dialect === 'seconds' ? (opts.dayRule ?? 'or') : 'or'
  return {
    ok: true,
    cron: {
      dialect,
      expression: reboot ? '@reboot' : tokens.join(' '),
      source,
      fields: byName,
      present: reboot ? [] : fields.filter((f) => !f.implicit).map((f) => f.name),
      macro,
      reboot,
      dayRule,
      warnings,
    },
    fields,
    warnings,
  }
}

// ── Day matching ──────────────────────────────────────────────────────────

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
export function daysInMonth(y: number, m: number): number {
  return m === 2 && isLeap(y) ? 29 : MDAYS[m - 1]
}

/** Day of week, 0 = Sunday (proleptic Gregorian, any year). */
export function weekday(y: number, m: number, d: number): number {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]
  const yy = m < 3 ? y - 1 : y
  const r = yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + t[m - 1] + d
  return ((r % 7) + 7) % 7
}

function nearestWeekdayOf(y: number, m: number, n: number, last: number): number | null {
  if (n > last) return null
  const wd = weekday(y, m, n)
  if (wd === 6) return n === 1 ? 3 : n - 1 // Saturday → Friday, unless the 1st → Monday 3rd
  if (wd === 0) return n === last ? n - 2 : n + 1 // Sunday → Monday, unless the last day → Friday
  return n
}

function lastWeekdayOf(y: number, m: number, last: number): number {
  const wd = weekday(y, m, last)
  return wd === 6 ? last - 1 : wd === 0 ? last - 2 : last
}

/** Days (1-based) of a month on which the schedule's day fields match. */
export function matchingDays(cron: ParsedCron, y: number, m: number): number[] {
  const last = daysInMonth(y, m)
  const dom = cron.fields.dayOfMonth
  const dow = cron.fields.dayOfWeek
  const domSet = new Set(dom.values)
  const dowSet = new Set(dow.values)
  const nearest = dom.nearestWeekday ? nearestWeekdayOf(y, m, dom.nearestWeekday, last) : null
  const lastWd = dom.lastWeekday ? lastWeekdayOf(y, m, last) : null
  const out: number[] = []
  for (let d = 1; d <= last; d++) {
    const wd = weekday(y, m, d)
    let domOk: boolean
    if (dom.lastDayOffset !== undefined) domOk = d === last - dom.lastDayOffset
    else if (dom.lastWeekday) domOk = d === lastWd
    else if (dom.nearestWeekday) domOk = d === nearest
    else domOk = domSet.has(d)
    let dowOk: boolean
    if (dow.lastDow !== undefined) dowOk = wd === dow.lastDow && d + 7 > last
    else if (dow.nthDow) dowOk = wd === dow.nthDow.dow && Math.ceil(d / 7) === dow.nthDow.n
    else dowOk = dowSet.has(wd)

    let match: boolean
    if (cron.dayRule === 'quartz') match = dom.noSpec ? dowOk : domOk
    else if (cron.dayRule === 'and') match = domOk && dowOk
    else match = dom.star || dow.star ? domOk && dowOk : domOk || dowOk
    if (match) out.push(d)
  }
  return out
}

// ── Field editing helpers (builder UI) ─────────────────────────────────────

export type FieldMode = 'every' | 'step' | 'range' | 'list' | 'nospec' | 'special'

export interface FieldModel {
  mode: FieldMode
  /** step: start + interval; range: from/to (+ optional step) */
  start: number
  interval: number
  from: number
  to: number
  /** list: raw values (dialect numbering) */
  list: number[]
  /** special: raw token (L, LW, 15W, 6L, 2#1…) */
  special: string
}

/** Reads a field token into an editable model (best effort; complex tokens → list/special). */
export function analyzeFieldToken(raw: string, dialect: CronDialect, name: CronFieldName): FieldModel {
  const spec = fieldSpec(dialect, name)
  const base: FieldModel = { mode: 'list', start: spec.min, interval: name === 'minute' || name === 'second' ? 5 : 2, from: spec.min, to: spec.max, list: [], special: '' }
  const up = raw.toUpperCase()
  if (raw === '*') return { ...base, mode: 'every' }
  if (raw === '?') return { ...base, mode: 'nospec' }
  let m = /^(\*|\d+)\/(\d+)$/.exec(up)
  if (m) return { ...base, mode: 'step', start: m[1] === '*' ? spec.min : Number(m[1]), interval: Number(m[2]) }
  m = /^(\w+)-(\w+)(?:\/(\d+))?$/.exec(up)
  if (m) {
    const a = parseValue(m[1], spec)
    const b = parseValue(m[2], spec)
    if (typeof a === 'number' && typeof b === 'number') {
      if (m[3]) return { ...base, mode: 'step', start: a, interval: Number(m[3]), from: a, to: b }
      return { ...base, mode: 'range', from: a, to: b }
    }
  }
  if (/^[\w,]+$/.test(up) && !/[LW#]/.test(up.replace(/[A-Z]{3}/g, (w) => (spec.names?.includes(w) ? '' : w)))) {
    const vals = up.split(',').map((t) => parseValue(t, spec))
    if (vals.every((v) => typeof v === 'number')) return { ...base, mode: 'list', list: [...new Set(vals as number[])].sort((a, b) => a - b) }
  }
  return { ...base, mode: 'special', special: raw }
}

/** Builds a field token from a model. */
export function buildFieldToken(model: FieldModel, dialect: CronDialect, name: CronFieldName): string {
  const spec = fieldSpec(dialect, name)
  const quartzLike = dialect === 'quartz' || dialect === 'aws'
  switch (model.mode) {
    case 'every':
      return '*'
    case 'nospec':
      return '?'
    case 'step': {
      const interval = Math.max(1, Math.floor(model.interval))
      if (model.start === spec.min) return `*/${interval}`
      return quartzLike ? `${model.start}/${interval}` : `${model.start}-${name === 'dayOfWeek' ? 6 : spec.max}/${interval}`
    }
    case 'range':
      return `${model.from}-${model.to}`
    case 'list':
      return model.list.length ? [...model.list].sort((a, b) => a - b).join(',') : '*'
    case 'special':
      return model.special || '*'
  }
}

// ── Presets ────────────────────────────────────────────────────────────────

export interface CronPreset {
  label: string
  expr: Partial<Record<CronDialect, string>>
}

export const CRON_PRESETS: CronPreset[] = [
  { label: 'Every minute', expr: { unix: '* * * * *', seconds: '0 * * * * *', quartz: '0 * * * * ?', aws: 'cron(* * * * ? *)' } },
  { label: 'Every 15 seconds', expr: { seconds: '*/15 * * * * *', quartz: '0/15 * * * * ?' } },
  { label: 'Every 5 minutes', expr: { unix: '*/5 * * * *', seconds: '0 */5 * * * *', quartz: '0 0/5 * * * ?', aws: 'cron(0/5 * * * ? *)' } },
  { label: 'Every 15 minutes', expr: { unix: '*/15 * * * *', seconds: '0 */15 * * * *', quartz: '0 0/15 * * * ?', aws: 'cron(0/15 * * * ? *)' } },
  { label: 'Hourly', expr: { unix: '0 * * * *', seconds: '0 0 * * * *', quartz: '0 0 * * * ?', aws: 'cron(0 * * * ? *)' } },
  { label: 'Every 6 hours', expr: { unix: '0 */6 * * *', seconds: '0 0 */6 * * *', quartz: '0 0 0/6 * * ?', aws: 'cron(0 0/6 * * ? *)' } },
  { label: 'Daily at midnight', expr: { unix: '0 0 * * *', seconds: '0 0 0 * * *', quartz: '0 0 0 * * ?', aws: 'cron(0 0 * * ? *)' } },
  { label: 'Daily at 02:30', expr: { unix: '30 2 * * *', seconds: '0 30 2 * * *', quartz: '0 30 2 * * ?', aws: 'cron(30 2 * * ? *)' } },
  { label: 'Weekdays at 09:00', expr: { unix: '0 9 * * 1-5', seconds: '0 0 9 * * 1-5', quartz: '0 0 9 ? * MON-FRI', aws: 'cron(0 9 ? * MON-FRI *)' } },
  { label: 'Every 30 min, 9–17 on weekdays', expr: { unix: '*/30 9-17 * * 1-5', seconds: '0 */30 9-17 * * 1-5', quartz: '0 0/30 9-17 ? * MON-FRI', aws: 'cron(0/30 9-17 ? * MON-FRI *)' } },
  { label: 'Mondays at 09:00', expr: { unix: '0 9 * * 1', seconds: '0 0 9 * * 1', quartz: '0 0 9 ? * MON', aws: 'cron(0 9 ? * MON *)' } },
  { label: 'First of the month', expr: { unix: '0 0 1 * *', seconds: '0 0 0 1 * *', quartz: '0 0 0 1 * ?', aws: 'cron(0 0 1 * ? *)' } },
  { label: 'Last day of the month', expr: { quartz: '0 0 0 L * ?', aws: 'cron(0 0 L * ? *)' } },
  { label: 'Last weekday of the month', expr: { quartz: '0 0 18 LW * ?' } },
  { label: 'Last Friday of the month', expr: { quartz: '0 0 18 ? * 6L', aws: 'cron(0 18 ? * 6L *)' } },
  { label: 'Second Tuesday of the month', expr: { quartz: '0 0 10 ? * TUE#2', aws: 'cron(0 10 ? * TUE#2 *)' } },
  { label: 'Quarterly (Jan, Apr, Jul, Oct 1st)', expr: { unix: '0 0 1 */3 *', seconds: '0 0 0 1 */3 *', quartz: '0 0 0 1 1/3 ?', aws: 'cron(0 0 1 1/3 ? *)' } },
  { label: 'Yearly (Jan 1st)', expr: { unix: '0 0 1 1 *', seconds: '0 0 0 1 1 *', quartz: '0 0 0 1 1 ?', aws: 'cron(0 0 1 1 ? *)' } },
  { label: '@daily macro', expr: { unix: '@daily' } },
  { label: '@reboot (at startup)', expr: { unix: '@reboot' } },
]

/** Human list of a field's values with names and compressed runs: "Mon–Fri", "0, 15, 30, 45". */
export function describeValues(field: CronField, dialect: CronDialect, max = 12): string {
  const { name } = field
  if (field.noSpec) return 'no specific value (?)'
  if (field.lastDayOffset !== undefined) return field.lastDayOffset === 0 ? 'last day of the month' : `${field.lastDayOffset} day${field.lastDayOffset === 1 ? '' : 's'} before the last day`
  if (field.lastWeekday) return 'last weekday (Mon–Fri) of the month'
  if (field.nearestWeekday) return `weekday nearest the ${ordinal(field.nearestWeekday)}`
  if (field.lastDow !== undefined) return `last ${DOW_LONG[field.lastDow]} of the month`
  if (field.nthDow) return `${ordinal(field.nthDow.n)} ${DOW_LONG[field.nthDow.dow]} of the month`
  if (field.any) return `every ${name === 'dayOfMonth' ? 'day' : name === 'dayOfWeek' ? 'day of the week' : FIELD_LABELS[name].toLowerCase()}`
  const label = (v: number) => (name === 'month' ? MONTH_LONG[v - 1].slice(0, 3) : name === 'dayOfWeek' ? DOW_LONG[v].slice(0, 3) : String(v))
  const vals = field.values
  // Compress consecutive runs of ≥ 3.
  const parts: string[] = []
  let i = 0
  while (i < vals.length) {
    let j = i
    while (j + 1 < vals.length && vals[j + 1] === vals[j] + 1) j++
    if (j - i >= 2) parts.push(`${label(vals[i])}–${label(vals[j])}`)
    else for (let k = i; k <= j; k++) parts.push(label(vals[k]))
    i = j + 1
  }
  void dialect
  if (parts.length > max) return `${parts.slice(0, max).join(', ')} … (${vals.length} values)`
  return parts.join(', ')
}

export function ordinal(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')
}
