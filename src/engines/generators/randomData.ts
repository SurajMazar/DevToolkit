import { createSeededRng, intBetween, pick, randomSeed, type Rng } from './random'
import { LOREM_WORDS } from './lorem'
import {
  COMPANY_PARTS,
  companyName,
  DEFAULT_POSTCODE,
  FIRST_NAMES,
  JOB_TITLES,
  LAST_NAMES,
  PLACES,
  POSTCODE_PATTERNS,
  PRODUCT_ADJECTIVES,
  PRODUCT_NOUNS,
  STREET_NAMES,
  STREET_TYPES,
  URL_PATHS,
  type Place,
} from './datasets'

// ── Schema ────────────────────────────────────────────────────────────────────

export type FieldType =
  | 'uuid'
  | 'autoIncrement'
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'email'
  | 'username'
  | 'phone'
  | 'company'
  | 'jobTitle'
  | 'product'
  | 'street'
  | 'city'
  | 'country'
  | 'countryCode'
  | 'postcode'
  | 'date'
  | 'datetime'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'enum'
  | 'loremWords'
  | 'loremSentence'
  | 'url'
  | 'ipv4'
  | 'ipv6'
  | 'hexColor'
  | 'object'

export interface FieldOptions {
  min?: number
  max?: number
  decimals?: number
  /** boolean: probability of true (0–1). */
  probability?: number
  /** enum: allowed values. */
  values?: string[]
  /** date/datetime: inclusive ISO date bounds (YYYY-MM-DD). */
  from?: string
  to?: string
  /** autoIncrement */
  start?: number
  step?: number
}

export interface Field {
  id: string
  name: string
  type: FieldType
  options: FieldOptions
  /** Probability (0–1) that the value is null. */
  nullProbability: number
  /** object: child fields (one level; children cannot be objects). */
  children?: Field[]
}

export interface FieldTypeMeta {
  type: FieldType
  label: string
  group: 'Identity' | 'Person' | 'Business' | 'Location' | 'Date & time' | 'Number & logic' | 'Text' | 'Internet' | 'Structure'
  example: string
  defaults?: FieldOptions
}

export const FIELD_TYPES: FieldTypeMeta[] = [
  { type: 'uuid', label: 'UUID v4', group: 'Identity', example: '9b2f…-4c1e' },
  { type: 'autoIncrement', label: 'Auto-increment ID', group: 'Identity', example: '1, 2, 3…', defaults: { start: 1, step: 1 } },
  { type: 'firstName', label: 'First name', group: 'Person', example: 'Amara' },
  { type: 'lastName', label: 'Last name', group: 'Person', example: 'Okafor' },
  { type: 'fullName', label: 'Full name', group: 'Person', example: 'Amara Okafor' },
  { type: 'email', label: 'Email', group: 'Person', example: 'amara.okafor@example.com' },
  { type: 'username', label: 'Username', group: 'Person', example: 'amara_okafor42' },
  { type: 'phone', label: 'Phone (fictional 555-01xx)', group: 'Person', example: '+1-415-555-0142' },
  { type: 'company', label: 'Company', group: 'Business', example: 'Cedar Labs' },
  { type: 'jobTitle', label: 'Job title', group: 'Business', example: 'Data Engineer' },
  { type: 'product', label: 'Product name', group: 'Business', example: 'Compact Kettle' },
  { type: 'street', label: 'Street address', group: 'Location', example: '42 Maple Street' },
  { type: 'city', label: 'City', group: 'Location', example: 'Lisbon' },
  { type: 'country', label: 'Country', group: 'Location', example: 'Portugal' },
  { type: 'countryCode', label: 'Country code', group: 'Location', example: 'PT' },
  { type: 'postcode', label: 'Postcode', group: 'Location', example: '1234-567' },
  { type: 'date', label: 'Date', group: 'Date & time', example: '2024-03-18', defaults: { from: '2020-01-01', to: '2025-12-31' } },
  { type: 'datetime', label: 'Datetime (ISO 8601)', group: 'Date & time', example: '2024-03-18T09:41:07Z', defaults: { from: '2024-01-01', to: '2025-12-31' } },
  { type: 'integer', label: 'Integer', group: 'Number & logic', example: '42', defaults: { min: 0, max: 1000 } },
  { type: 'float', label: 'Decimal', group: 'Number & logic', example: '19.99', defaults: { min: 0, max: 100, decimals: 2 } },
  { type: 'boolean', label: 'Boolean', group: 'Number & logic', example: 'true', defaults: { probability: 0.5 } },
  { type: 'enum', label: 'One of (enum)', group: 'Number & logic', example: 'active', defaults: { values: ['active', 'pending', 'disabled'] } },
  { type: 'loremWords', label: 'Lorem words', group: 'Text', example: 'dolor sit amet', defaults: { min: 2, max: 5 } },
  { type: 'loremSentence', label: 'Lorem sentence', group: 'Text', example: 'Lorem ipsum dolor sit.', defaults: { min: 6, max: 14 } },
  { type: 'url', label: 'URL (example.com)', group: 'Internet', example: 'https://example.com/blog/x7k2' },
  { type: 'ipv4', label: 'IPv4 (documentation range)', group: 'Internet', example: '192.0.2.17' },
  { type: 'ipv6', label: 'IPv6 (2001:db8::/32)', group: 'Internet', example: '2001:db8:4f::1a' },
  { type: 'hexColor', label: 'Hex color', group: 'Internet', example: '#3b82f6' },
  { type: 'object', label: 'Nested object', group: 'Structure', example: '{ … }' },
]

export const FIELD_TYPE_MAP = new Map(FIELD_TYPES.map((t) => [t.type, t]))

export const MAX_ROWS = 100_000
export const EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net']

export function makeField(name: string, type: FieldType, options: FieldOptions = {}, extra: Partial<Field> = {}): Field {
  return { id: `f_${randomSeed(10)}`, name, type, options: { ...FIELD_TYPE_MAP.get(type)?.defaults, ...options }, nullProbability: 0, ...extra }
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface SchemaIssue {
  fieldId: string
  message: string
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const parseDay = (s: string | undefined) => (s && ISO_DATE.test(s) ? Date.parse(`${s}T00:00:00Z`) : NaN)

export function validateSchema(fields: Field[], nested = false): SchemaIssue[] {
  const issues: SchemaIssue[] = []
  const names = new Set<string>()
  if (!nested && fields.length === 0) issues.push({ fieldId: '', message: 'Add at least one field.' })
  for (const f of fields) {
    const label = f.name || '(unnamed)'
    if (!f.name.trim()) issues.push({ fieldId: f.id, message: 'Field name is empty.' })
    else if (names.has(f.name)) issues.push({ fieldId: f.id, message: `Duplicate field name “${f.name}”.` })
    names.add(f.name)
    const o = f.options
    if (!(f.nullProbability >= 0 && f.nullProbability <= 1)) issues.push({ fieldId: f.id, message: `${label}: null probability must be 0–100%.` })
    switch (f.type) {
      case 'integer':
      case 'float':
        if (!Number.isFinite(o.min) || !Number.isFinite(o.max)) issues.push({ fieldId: f.id, message: `${label}: min and max must be numbers.` })
        else if (o.min! > o.max!) issues.push({ fieldId: f.id, message: `${label}: min is greater than max.` })
        else if (f.type === 'integer' && (!Number.isSafeInteger(Math.ceil(o.min!)) || !Number.isSafeInteger(Math.floor(o.max!)))) issues.push({ fieldId: f.id, message: `${label}: bounds must be safe integers (±9,007,199,254,740,991).` })
        else if (f.type === 'integer' && Math.ceil(o.min!) > Math.floor(o.max!)) issues.push({ fieldId: f.id, message: `${label}: no whole number lies between min and max.` })
        if (f.type === 'float' && !(Number.isInteger(o.decimals) && o.decimals! >= 0 && o.decimals! <= 10)) issues.push({ fieldId: f.id, message: `${label}: decimals must be 0–10.` })
        break
      case 'loremWords':
      case 'loremSentence':
        if (!(Number.isInteger(o.min) && Number.isInteger(o.max) && o.min! >= 1 && o.max! <= 100 && o.min! <= o.max!)) issues.push({ fieldId: f.id, message: `${label}: word count range must be within 1–100.` })
        break
      case 'boolean':
        if (!(o.probability! >= 0 && o.probability! <= 1)) issues.push({ fieldId: f.id, message: `${label}: probability must be 0–100%.` })
        break
      case 'enum':
        if (!o.values?.length) issues.push({ fieldId: f.id, message: `${label}: list at least one value.` })
        break
      case 'date':
      case 'datetime': {
        const a = parseDay(o.from)
        const b = parseDay(o.to)
        if (Number.isNaN(a) || Number.isNaN(b)) issues.push({ fieldId: f.id, message: `${label}: dates must be YYYY-MM-DD.` })
        else if (a > b) issues.push({ fieldId: f.id, message: `${label}: “from” is after “to”.` })
        break
      }
      case 'autoIncrement':
        if (!Number.isFinite(o.start) || !Number.isFinite(o.step)) issues.push({ fieldId: f.id, message: `${label}: start and step must be numbers.` })
        break
      case 'object':
        if (nested) issues.push({ fieldId: f.id, message: `${label}: objects can only be nested one level deep.` })
        else if (!f.children?.length) issues.push({ fieldId: f.id, message: `${label}: add at least one child field.` })
        else issues.push(...validateSchema(f.children, true))
        break
    }
  }
  return issues
}

// ── Generation ────────────────────────────────────────────────────────────────

export type Value = string | number | boolean | null | { [k: string]: Value }
export type Row = Record<string, Value>

interface RowContext {
  rng: Rng
  index: number
  person?: { first: string; last: string; tag: number }
  place?: Place
}

const ascii = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ø/g, 'o')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')

function person(ctx: RowContext) {
  return (ctx.person ??= { first: pick(ctx.rng, FIRST_NAMES), last: pick(ctx.rng, LAST_NAMES), tag: ctx.rng.int(100) })
}
function place(ctx: RowContext) {
  return (ctx.place ??= pick(ctx.rng, PLACES))
}

const HEX = '0123456789abcdef'
const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ'

function uuidV4(rng: Rng): string {
  let s = ''
  for (let i = 0; i < 32; i++) {
    let n = rng.int(16)
    if (i === 12) n = 4
    else if (i === 16) n = 8 | (n & 3)
    s += HEX[n]
    if (i === 7 || i === 11 || i === 15 || i === 19) s += '-'
  }
  return s
}

function postcode(rng: Rng, code: string): string {
  const pattern = POSTCODE_PATTERNS[code] ?? DEFAULT_POSTCODE
  let s = ''
  for (const ch of pattern) s += ch === '9' ? String(rng.int(10)) : ch === 'A' ? LETTERS[rng.int(LETTERS.length)] : ch
  return s
}

const DOC_V4 = ['192.0.2', '198.51.100', '203.0.113']

function value(f: Field, ctx: RowContext): Value {
  const { rng } = ctx
  const o = f.options
  switch (f.type) {
    case 'uuid':
      return uuidV4(rng)
    case 'autoIncrement':
      return (o.start ?? 1) + ctx.index * (o.step ?? 1)
    case 'firstName':
      return person(ctx).first
    case 'lastName':
      return person(ctx).last
    case 'fullName': {
      const p = person(ctx)
      return `${p.first} ${p.last}`
    }
    case 'email': {
      const p = person(ctx)
      const local = [`${ascii(p.first)}.${ascii(p.last)}`, `${ascii(p.first)}${ascii(p.last)}${p.tag}`, `${ascii(p.first)[0]}${ascii(p.last)}`, `${ascii(p.first)}_${p.tag}`][p.tag % 4]
      return `${local}@${EMAIL_DOMAINS[p.tag % EMAIL_DOMAINS.length]}`
    }
    case 'username': {
      const p = person(ctx)
      return [`${ascii(p.first)}_${ascii(p.last)}`, `${ascii(p.first)}${p.tag}`, `${ascii(p.first)[0]}${ascii(p.last)}${p.tag}`, `${ascii(p.last)}.${ascii(p.first)}`][(p.tag >> 2) % 4]
    }
    case 'phone': {
      // 555-0100…0199 are reserved for fictional use in every NANP area code.
      const area = 200 + rng.int(800)
      return `+1-${area}-555-01${String(rng.int(100)).padStart(2, '0')}`
    }
    case 'company':
      return companyName(rng.int(COMPANY_PARTS[0]), rng.int(COMPANY_PARTS[1]))
    case 'jobTitle':
      return pick(rng, JOB_TITLES)
    case 'product':
      return `${pick(rng, PRODUCT_ADJECTIVES)} ${pick(rng, PRODUCT_NOUNS)}`
    case 'street':
      return `${1 + rng.int(240)} ${pick(rng, STREET_NAMES)} ${pick(rng, STREET_TYPES)}`
    case 'city':
      return place(ctx).city
    case 'country':
      return place(ctx).country
    case 'countryCode':
      return place(ctx).code
    case 'postcode':
      return postcode(rng, place(ctx).code)
    case 'date': {
      const a = parseDay(o.from) / 86400000
      const b = parseDay(o.to) / 86400000
      return new Date(intBetween(rng, a, b) * 86400000).toISOString().slice(0, 10)
    }
    case 'datetime': {
      const a = parseDay(o.from) / 1000
      const b = parseDay(o.to) / 1000 + 86399
      return new Date(intBetween(rng, a, b) * 1000).toISOString().replace('.000Z', 'Z')
    }
    case 'integer':
      return intBetween(rng, Math.ceil(o.min!), Math.floor(o.max!))
    case 'float': {
      const d = o.decimals ?? 2
      const scale = 10 ** d
      const lo = Math.ceil(o.min! * scale)
      const hi = Math.floor(o.max! * scale)
      if (lo > hi) return Number(o.min!.toFixed(d))
      return intBetween(rng, lo, hi) / scale
    }
    case 'boolean':
      return rng.next() < (o.probability ?? 0.5)
    case 'enum':
      return pick(rng, o.values!)
    case 'loremWords': {
      const n = intBetween(rng, o.min ?? 2, o.max ?? 5)
      return Array.from({ length: n }, () => pick(rng, LOREM_WORDS)).join(' ')
    }
    case 'loremSentence': {
      const n = intBetween(rng, o.min ?? 6, o.max ?? 14)
      const s = Array.from({ length: n }, () => pick(rng, LOREM_WORDS)).join(' ')
      return s[0].toUpperCase() + s.slice(1) + '.'
    }
    case 'url': {
      let slug = ''
      for (let i = 0; i < 6; i++) slug += '0123456789abcdefghijklmnopqrstuvwxyz'[rng.int(36)]
      return `https://${EMAIL_DOMAINS[rng.int(3)]}/${pick(rng, URL_PATHS)}/${slug}`
    }
    case 'ipv4':
      return `${pick(rng, DOC_V4)}.${1 + rng.int(254)}`
    case 'ipv6': {
      const groups = Array.from({ length: 6 }, () => rng.int(0x10000).toString(16))
      return compressIpv6(['2001', 'db8', ...groups])
    }
    case 'hexColor': {
      let s = '#'
      for (let i = 0; i < 6; i++) s += HEX[rng.int(16)]
      return s
    }
    case 'object': {
      const obj: Row = {}
      for (const c of f.children ?? []) obj[c.name] = fieldValue(c, ctx)
      return obj
    }
  }
}

/** RFC 5952 compression of the longest run (≥2) of zero groups. */
export function compressIpv6(groups: string[]): string {
  const g = groups.map((x) => x.replace(/^0+(?=.)/, ''))
  let bestStart = -1
  let bestLen = 0
  for (let i = 0; i < g.length; ) {
    if (g[i] !== '0') {
      i++
      continue
    }
    let j = i
    while (j < g.length && g[j] === '0') j++
    if (j - i > bestLen && j - i >= 2) {
      bestStart = i
      bestLen = j - i
    }
    i = j
  }
  if (bestStart < 0) return g.join(':')
  return `${g.slice(0, bestStart).join(':')}::${g.slice(bestStart + bestLen).join(':')}`
}

function fieldValue(f: Field, ctx: RowContext): Value {
  // Always draw the value so the stream stays aligned whether or not it ends up null.
  const v = value(f, ctx)
  if (f.nullProbability > 0 && ctx.rng.next() < f.nullProbability) return null
  return v
}

export function generateRows(fields: Field[], count: number, seed: string, startIndex = 0): Row[] {
  const rng = createSeededRng(seed)
  const rows = new Array<Row>(count)
  for (let i = 0; i < count; i++) {
    const ctx: RowContext = { rng, index: startIndex + i }
    const row: Row = {}
    for (const f of fields) row[f.name] = fieldValue(f, ctx)
    rows[i] = row
  }
  return rows
}

// ── Output formats ────────────────────────────────────────────────────────────

export type OutputFormat = 'json' | 'ndjson' | 'csv' | 'sql' | 'typescript'
export type SqlDialect = 'postgres' | 'mysql' | 'sqlite' | 'sqlserver'

export interface FormatOptions {
  format: OutputFormat
  tableName: string
  dialect: SqlDialect
  /** Rows per INSERT statement. */
  batchSize: number
}

export const OUTPUT_FORMATS: { value: OutputFormat; label: string; ext: string; language: string; mime: string }[] = [
  { value: 'json', label: 'JSON', ext: 'json', language: 'json', mime: 'application/json' },
  { value: 'ndjson', label: 'NDJSON', ext: 'ndjson', language: 'plaintext', mime: 'application/x-ndjson' },
  { value: 'csv', label: 'CSV', ext: 'csv', language: 'plaintext', mime: 'text/csv' },
  { value: 'sql', label: 'SQL', ext: 'sql', language: 'sql', mime: 'application/sql' },
  { value: 'typescript', label: 'TypeScript', ext: 'ts', language: 'typescript', mime: 'text/typescript' },
]

/** Column paths: nested objects are flattened to "parent.child". */
export function columns(fields: Field[]): { path: string[]; key: string }[] {
  const out: { path: string[]; key: string }[] = []
  for (const f of fields) {
    if (f.type === 'object') for (const c of f.children ?? []) out.push({ path: [f.name, c.name], key: `${f.name}.${c.name}` })
    else out.push({ path: [f.name], key: f.name })
  }
  return out
}

function at(row: Row, path: string[]): Value {
  let v: Value = row[path[0]]
  if (path.length > 1) v = v && typeof v === 'object' ? v[path[1]] : null
  return v
}

/** RFC 4180 field: quoted when it contains a comma, quote, CR/LF, or leading/trailing space. */
export function csvCell(v: Value): string {
  if (v == null) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Row[], fields: Field[], header = true): string {
  const cols = columns(fields)
  const lines: string[] = []
  if (header) lines.push(cols.map((c) => csvCell(c.key)).join(','))
  for (const r of rows) lines.push(cols.map((c) => csvCell(at(r, c.path))).join(','))
  return lines.join('\r\n') + (lines.length ? '\r\n' : '')
}

export function sqlIdent(name: string, dialect: SqlDialect): string {
  if (dialect === 'mysql') return '`' + name.replace(/`/g, '``') + '`'
  if (dialect === 'sqlserver') return '[' + name.replace(/]/g, ']]') + ']'
  return '"' + name.replace(/"/g, '""') + '"'
}

export function sqlLiteral(v: Value, dialect: SqlDialect): string {
  if (v == null) return 'NULL'
  if (typeof v === 'boolean') return dialect === 'sqlite' || dialect === 'sqlserver' ? (v ? '1' : '0') : v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  let s = typeof v === 'object' ? JSON.stringify(v) : v
  s = s.replace(/'/g, "''")
  // MySQL treats backslash as an escape character in string literals by default.
  if (dialect === 'mysql') s = s.replace(/\\/g, '\\\\')
  return dialect === 'sqlserver' ? `N'${s}'` : `'${s}'`
}

export function toSql(rows: Row[], fields: Field[], o: Pick<FormatOptions, 'tableName' | 'dialect' | 'batchSize'>): string {
  // Nested objects become one column holding JSON in SQL output.
  const cols = fields.map((f) => f.name)
  const head = `INSERT INTO ${sqlIdent(o.tableName || 'data', o.dialect)} (${cols.map((c) => sqlIdent(c, o.dialect)).join(', ')}) VALUES`
  const out: string[] = []
  const batch = Math.max(1, Math.floor(o.batchSize) || 1)
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch).map((r) => `  (${cols.map((c) => sqlLiteral(r[c], o.dialect)).join(', ')})`)
    out.push(`${head}\n${chunk.join(',\n')};`)
  }
  return out.join('\n\n') + (out.length ? '\n' : '')
}

function tsType(f: Field): string {
  let t: string
  switch (f.type) {
    case 'autoIncrement':
    case 'integer':
    case 'float':
      t = 'number'
      break
    case 'boolean':
      t = 'boolean'
      break
    case 'enum':
      t = (f.options.values ?? []).map((v) => JSON.stringify(v)).join(' | ') || 'string'
      break
    case 'object':
      t = `{ ${(f.children ?? []).map((c) => `${tsKey(c.name)}: ${tsType(c)}`).join('; ')} }`
      break
    default:
      t = 'string'
  }
  return f.nullProbability > 0 ? `${t} | null` : t
}

const tsKey = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k))

export function typeName(table: string): string {
  const base = table
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('')
    .replace(/s$/, '')
  return /^[A-Za-z]/.test(base) ? base : `Row${base}`
}

export function toTypeScript(rows: Row[], fields: Field[], tableName: string): string {
  const name = typeName(tableName || 'data')
  const iface = `export interface ${name} {\n${fields.map((f) => `  ${tsKey(f.name)}: ${tsType(f)}`).join('\n')}\n}`
  const varName = name[0].toLowerCase() + name.slice(1) + 's'
  return `${iface}\n\nexport const ${varName}: ${name}[] = ${JSON.stringify(rows, null, 2)}\n`
}

export function formatRows(rows: Row[], fields: Field[], o: FormatOptions): string {
  switch (o.format) {
    case 'json':
      return JSON.stringify(rows, null, 2) + '\n'
    case 'ndjson':
      return rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')
    case 'csv':
      return toCsv(rows, fields)
    case 'sql':
      return toSql(rows, fields, o)
    case 'typescript':
      return toTypeScript(rows, fields, o.tableName)
  }
}

export interface DatasetRequest {
  fields: Field[]
  count: number
  seed: string
  options: FormatOptions
  /** Rows included in the preview string. */
  previewRows: number
}

export interface DatasetResult {
  output: string
  /** Same as output when everything fits in the preview. */
  preview: string
  previewRows: number
  rows: number
}

/** Generate and format a dataset. Pure — safe to run in a worker. */
export function generateDataset(req: DatasetRequest): DatasetResult {
  if (!Number.isInteger(req.count) || req.count < 1 || req.count > MAX_ROWS) throw new RangeError(`Row count must be 1–${MAX_ROWS.toLocaleString('en-US')}.`)
  const issues = validateSchema(req.fields)
  if (issues.length) throw new Error(issues[0].message)
  const rows = generateRows(req.fields, req.count, req.seed)
  const output = formatRows(rows, req.fields, req.options)
  if (rows.length <= req.previewRows) return { output, preview: output, previewRows: rows.length, rows: rows.length }
  return { output, preview: formatRows(rows.slice(0, req.previewRows), req.fields, req.options), previewRows: req.previewRows, rows: rows.length }
}

// ── Presets ───────────────────────────────────────────────────────────────────

export type PresetId = 'users' | 'orders' | 'products' | 'events'

export const PRESETS: { id: PresetId; label: string; table: string; build: () => Field[] }[] = [
  {
    id: 'users',
    label: 'Users',
    table: 'users',
    build: () => [
      makeField('id', 'autoIncrement'),
      makeField('first_name', 'firstName'),
      makeField('last_name', 'lastName'),
      makeField('email', 'email'),
      makeField('username', 'username'),
      makeField('phone', 'phone', {}, { nullProbability: 0.2 }),
      makeField('job_title', 'jobTitle'),
      makeField('company', 'company'),
      makeField('is_active', 'boolean', { probability: 0.85 }),
      makeField('created_at', 'datetime', { from: '2023-01-01', to: '2025-12-31' }),
      makeField('address', 'object', {}, { children: [makeField('street', 'street'), makeField('city', 'city'), makeField('postcode', 'postcode'), makeField('country', 'country')] }),
    ],
  },
  {
    id: 'orders',
    label: 'Orders',
    table: 'orders',
    build: () => [
      makeField('order_id', 'uuid'),
      makeField('customer_email', 'email'),
      makeField('status', 'enum', { values: ['pending', 'paid', 'shipped', 'delivered', 'refunded'] }),
      makeField('items', 'integer', { min: 1, max: 8 }),
      makeField('total', 'float', { min: 5, max: 900, decimals: 2 }),
      makeField('currency', 'enum', { values: ['USD', 'EUR', 'GBP', 'JPY'] }),
      makeField('placed_at', 'datetime', { from: '2025-01-01', to: '2025-12-31' }),
      makeField('shipping', 'object', {}, { children: [makeField('city', 'city'), makeField('country_code', 'countryCode'), makeField('postcode', 'postcode')] }),
      makeField('gift_note', 'loremSentence', { min: 4, max: 10 }, { nullProbability: 0.7 }),
    ],
  },
  {
    id: 'products',
    label: 'Products',
    table: 'products',
    build: () => [
      makeField('id', 'autoIncrement', { start: 1000, step: 1 }),
      makeField('sku', 'uuid'),
      makeField('name', 'product'),
      makeField('description', 'loremSentence', { min: 8, max: 16 }),
      makeField('category', 'enum', { values: ['home', 'kitchen', 'outdoor', 'office', 'apparel', 'audio'] }),
      makeField('price', 'float', { min: 2, max: 499, decimals: 2 }),
      makeField('stock', 'integer', { min: 0, max: 500 }),
      makeField('color', 'hexColor'),
      makeField('in_stock', 'boolean', { probability: 0.9 }),
      makeField('released_on', 'date', { from: '2019-01-01', to: '2025-12-31' }),
    ],
  },
  {
    id: 'events',
    label: 'Events',
    table: 'events',
    build: () => [
      makeField('event_id', 'uuid'),
      makeField('type', 'enum', { values: ['page_view', 'click', 'sign_up', 'purchase', 'logout'] }),
      makeField('user_id', 'integer', { min: 1, max: 5000 }),
      makeField('timestamp', 'datetime', { from: '2025-06-01', to: '2025-06-30' }),
      makeField('url', 'url'),
      makeField('ip', 'ipv4'),
      makeField('ipv6', 'ipv6', {}, { nullProbability: 0.5 }),
      makeField('context', 'object', {}, { children: [makeField('browser', 'enum', { values: ['Firefox', 'Chrome', 'Safari', 'Edge'] }), makeField('mobile', 'boolean', { probability: 0.4 }), makeField('country', 'countryCode')] }),
    ],
  },
]
