/**
 * .env parsing, validation, normalisation, export and comparison.
 *
 * Follows the common dotenv rules (motdotla/dotenv, docker compose, python-dotenv):
 * `#` comments, optional `export ` prefix, single quotes (literal), double quotes (escapes,
 * interpolation), backticks (literal), multi-line quoted values, inline comments after
 * unquoted values (`#` preceded by whitespace). Never logs values.
 */
import { stringify as yamlStringify } from 'yaml'

export type QuoteStyle = 'none' | 'single' | 'double' | 'backtick'

export interface EnvEntry {
  key: string
  value: string
  /** 1-based first and last line of the definition. */
  line: number
  endLine: number
  quote: QuoteStyle
  exported: boolean
  /** Comment lines directly above the entry (no blank line in between). */
  comments: string[]
  inlineComment?: string
  /** Variables referenced via ${VAR} / $VAR (unquoted or double-quoted values only). */
  references: string[]
  /** Index among entries with the same key (0 = first). */
  occurrence: number
}

export type EnvIssueCode =
  | 'invalid-key'
  | 'non-portable-key'
  | 'duplicate'
  | 'missing-equals'
  | 'unbalanced-quote'
  | 'unquoted-spaces'
  | 'trailing-whitespace'
  | 'empty-value'
  | 'trailing-content'
  | 'undefined-reference'
  | 'spaces-around-equals'

export interface EnvIssue {
  line: number
  severity: 'error' | 'warning' | 'info'
  code: EnvIssueCode
  message: string
  key?: string
}

export interface ParsedEnv {
  entries: EnvEntry[]
  issues: EnvIssue[]
  /** Comment lines at the top of the file separated from the first entry by a blank line. */
  header: string[]
  /** Final value per key (last definition wins, as in dotenv.parse and docker compose). */
  values: Map<string, string>
  lineCount: number
}

const KEY_STRICT = /^[A-Za-z_][A-Za-z0-9_]*$/
const KEY_LOOSE = /^[A-Za-z_][A-Za-z0-9_.-]*$/
const REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?+=])[^}]*)?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g

function unescapeDouble(s: string): string {
  return s.replace(/\\([\\nrt"$`'])/g, (_, c: string) => ({ n: '\n', r: '\r', t: '\t' })[c as 'n'] ?? c)
}

function findRefs(s: string): string[] {
  const out = new Set<string>()
  for (const m of s.matchAll(REF)) {
    // An escaped \$ is not a reference.
    if (m.index! > 0 && s[m.index! - 1] === '\\') continue
    out.add(m[1] ?? m[3])
  }
  return [...out]
}

export function parseEnv(text: string): ParsedEnv {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const entries: EnvEntry[] = []
  const issues: EnvIssue[] = []
  const header: string[] = []
  let pendingComments: string[] = []
  let sawEntry = false
  const seen = new Map<string, EnvEntry[]>()

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const raw = lines[i]
    const trimmed = raw.trim()
    if (!trimmed) {
      if (!sawEntry && pendingComments.length) {
        header.push(...pendingComments, '')
        pendingComments = []
      } else pendingComments = []
      continue
    }
    if (trimmed.startsWith('#')) {
      pendingComments.push(trimmed)
      continue
    }
    let rest = raw.replace(/^\s+/, '')
    let exported = false
    const exp = /^export\s+/.exec(rest)
    if (exp) {
      exported = true
      rest = rest.slice(exp[0].length)
    }
    const eq = rest.indexOf('=')
    if (eq === -1) {
      issues.push({ line: lineNo, severity: 'error', code: 'missing-equals', message: `Missing “=” — “${trimmed.length > 40 ? trimmed.slice(0, 40) + '…' : trimmed}” is not a KEY=value line.` })
      pendingComments = []
      continue
    }
    const rawKey = rest.slice(0, eq)
    const key = rawKey.trim()
    if (/\s$/.test(rawKey)) issues.push({ line: lineNo, severity: 'warning', code: 'spaces-around-equals', message: `Space before “=” in “${key}” — dotenv trims it, but shells and Docker --env-file do not.`, key })
    if (!KEY_LOOSE.test(key)) issues.push({ line: lineNo, severity: 'error', code: 'invalid-key', message: key ? `Invalid key “${key}” — use letters, digits and underscores, not starting with a digit.` : 'Empty key before “=”.', key })
    else if (!KEY_STRICT.test(key)) issues.push({ line: lineNo, severity: 'warning', code: 'non-portable-key', message: `Key “${key}” contains “.” or “-” — not usable as a shell variable.`, key })

    let after = rest.slice(eq + 1)
    const leading = /^[ \t]*/.exec(after)![0]
    after = after.slice(leading.length)
    let value: string
    let quote: QuoteStyle = 'none'
    let endLine = lineNo
    let inlineComment: string | undefined
    let rawInner = ''
    const q = after[0]
    if (q === '"' || q === "'" || q === '`') {
      quote = q === '"' ? 'double' : q === "'" ? 'single' : 'backtick'
      // Find the closing quote, possibly on a later line.
      let body = after.slice(1)
      let j = i
      let close = findClose(body, q)
      while (close === -1 && j + 1 < lines.length) {
        j++
        body += '\n' + lines[j]
        close = findClose(body, q)
      }
      if (close === -1) {
        issues.push({ line: lineNo, severity: 'error', code: 'unbalanced-quote', message: `Unbalanced ${q} quote in “${key}” — the value is never closed.`, key })
        // Recover: take the rest of this line only, unquoted.
        value = after.slice(1).replace(/\s+$/, '')
        quote = 'none'
      } else {
        const inner = body.slice(0, close)
        rawInner = inner
        value = quote === 'double' ? unescapeDouble(inner) : inner
        const tail = body.slice(close + 1)
        const tailTrim = tail.trim()
        if (tailTrim.startsWith('#')) inlineComment = tailTrim.slice(1).trim()
        else if (tailTrim && j > i) issues.push({ line: lineNo, severity: 'error', code: 'unbalanced-quote', message: `The ${q} quote opened for “${key}” on line ${lineNo} only closes on line ${j + 1}, followed by unexpected text — probably a missing closing quote.`, key })
        else if (tailTrim) issues.push({ line: j + 1, severity: 'warning', code: 'trailing-content', message: `Unexpected text after the closing quote of “${key}”: “${tailTrim.slice(0, 30)}” (ignored by dotenv).`, key })
        i = j
        endLine = j + 1
      }
    } else {
      const hash = /(^|\s)#/.exec(after)
      let v = hash ? after.slice(0, hash.index) : after
      if (hash) inlineComment = after.slice(hash.index + hash[0].length).trim()
      if (!hash && /[ \t]+$/.test(v) && v.trim()) issues.push({ line: lineNo, severity: 'warning', code: 'trailing-whitespace', message: `Trailing whitespace after the value of “${key}” — dotenv trims it, other tools may keep it.`, key })
      v = v.trim()
      value = v
      if (/\s/.test(v)) issues.push({ line: lineNo, severity: 'warning', code: 'unquoted-spaces', message: `Value of “${key}” contains spaces but is not quoted — quote it for shells and Docker.`, key })
    }
    if (value === '' && quote === 'none') issues.push({ line: lineNo, severity: 'info', code: 'empty-value', message: `“${key}” is empty.`, key })
    const references = quote === 'single' || quote === 'backtick' ? [] : findRefs(quote === 'double' ? rawInner : value)
    const prior = seen.get(key) ?? []
    const entry: EnvEntry = { key, value, line: lineNo, endLine, quote, exported, comments: pendingComments, inlineComment, references, occurrence: prior.length }
    pendingComments = []
    sawEntry = true
    entries.push(entry)
    prior.push(entry)
    seen.set(key, prior)
  }

  // Duplicates: last definition wins.
  for (const [key, list] of seen) {
    if (list.length < 2 || !key) continue
    const lines = list.map((e) => e.line)
    for (const e of list.slice(0, -1)) {
      issues.push({ line: e.line, severity: 'warning', code: 'duplicate', message: `“${key}” is defined ${list.length} times (lines ${lines.join(', ')}). The last one (line ${lines[lines.length - 1]}) wins in dotenv and Docker Compose; loaders that never override keep the first.`, key })
    }
  }
  const defined = new Set(entries.map((e) => e.key))
  for (const e of entries) {
    for (const r of e.references) {
      if (!defined.has(r)) issues.push({ line: e.line, severity: 'info', code: 'undefined-reference', message: `“${e.key}” references \${${r}}, which is not defined in this file (it may come from the environment).`, key: e.key })
    }
  }
  issues.sort((a, b) => a.line - b.line)
  const values = new Map<string, string>()
  for (const e of entries) values.set(e.key, e.value)
  if (header.length && header[header.length - 1] === '') header.pop()
  return { entries, issues, header, values, lineCount: lines.length }
}

function findClose(s: string, q: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && q === '"') {
      i++
      continue
    }
    if (s[i] === q) return i
  }
  return -1
}

// ---------------------------------------------------------------------------
// Sensitivity
// ---------------------------------------------------------------------------

const SENSITIVE_KEY = /(SECRET|TOKEN|PASSW(OR)?D|PASSPHRASE|(^|_)PASS($|_)|PWD|(^|_)KEY($|_)|APIKEY|PRIVATE|CREDENTIAL|AUTH|DSN|SALT|SIGNATURE|SIGNING|CERT|COOKIE|SESSION|WEBHOOK|ENCRYPTION|ACCESS_?KEY|CONNECTION_?STRING|DATABASE_URL|REDIS_URL|MONGO(DB)?_URI|AMQP_URL)/i
const CREDENTIAL_URL = /^[a-z][a-z0-9+.-]*:\/\/[^\s/:@]*:[^\s/@]+@/i
const SENSITIVE_VALUE = /^(-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[\w-]+\.eyJ[\w-]+\.|sk_(live|test)_|xox[abpr]-|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35})/

export function isSensitive(key: string, value = ''): boolean {
  return SENSITIVE_KEY.test(key) || CREDENTIAL_URL.test(value) || SENSITIVE_VALUE.test(value) || /(Password|Pwd)=[^;]+/i.test(value)
}

/** Fixed-length mask so the value length does not leak. */
export const MASK = '••••••••'

export function maskValue(v: string): string {
  return v === '' ? '' : MASK
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/** Quotes a value for .env when needed (double quotes with escapes). */
export function quoteEnvValue(v: string): string {
  if (v === '') return ''
  if (/^[A-Za-z0-9_./:@%+,=-]+$/.test(v) && !v.includes('#')) return v
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/\$/g, '\\$')}"`
}

/** POSIX shell single-quoting. */
export function shellQuote(v: string): string {
  if (v !== '' && /^[A-Za-z0-9_./:@%+,=-]+$/.test(v)) return v
  return `'${v.replace(/'/g, `'\\''`)}'`
}

export interface NormalizeOptions {
  sort?: boolean
  dedupe?: boolean
  keepComments?: boolean
  exportPrefix?: boolean
}

/** Entries to output: optionally deduped (keeping the winning, last occurrence) and sorted. */
export function selectEntries(parsed: ParsedEnv, opts: { sort?: boolean; dedupe?: boolean }): EnvEntry[] {
  let list = parsed.entries
  if (opts.dedupe) {
    const lastIndex = new Map<string, number>()
    list.forEach((e, i) => lastIndex.set(e.key, i))
    list = list.filter((e, i) => lastIndex.get(e.key) === i)
  }
  if (opts.sort) list = [...list].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.line - b.line))
  return list
}

export function toDotenv(parsed: ParsedEnv, opts: NormalizeOptions = {}): string {
  const keep = opts.keepComments ?? true
  const out: string[] = []
  if (keep && parsed.header.length) out.push(...parsed.header, '')
  for (const e of selectEntries(parsed, opts)) {
    if (keep && e.comments.length) {
      if (out.length && out[out.length - 1] !== '') out.push('')
      out.push(...e.comments)
    }
    const line = `${opts.exportPrefix ? 'export ' : ''}${e.key}=${e.quote === 'single' && !e.value.includes("'") ? `'${e.value}'` : quoteEnvValue(e.value)}`
    out.push(keep && e.inlineComment ? `${line} # ${e.inlineComment}` : line)
  }
  return out.join('\n') + (out.length ? '\n' : '')
}

export type ExportFormat = 'dotenv' | 'json' | 'yaml' | 'shell' | 'docker' | 'k8s'

export const EXPORT_FORMATS: { value: ExportFormat; label: string; ext: string; language: string }[] = [
  { value: 'dotenv', label: '.env', ext: 'env', language: 'ini' },
  { value: 'json', label: 'JSON', ext: 'json', language: 'json' },
  { value: 'yaml', label: 'YAML', ext: 'yaml', language: 'yaml' },
  { value: 'shell', label: 'Shell export', ext: 'sh', language: 'shell' },
  { value: 'docker', label: 'Docker -e', ext: 'sh', language: 'shell' },
  { value: 'k8s', label: 'Kubernetes env', ext: 'yaml', language: 'yaml' },
]

/** Exports the effective variables (last definition wins). `transform` lets the UI mask values. */
export function exportEnv(parsed: ParsedEnv, format: ExportFormat, opts: { sort?: boolean; transform?: (key: string, value: string) => string } = {}): string {
  const t = opts.transform ?? ((_k: string, v: string) => v)
  if (format === 'dotenv') {
    const masked: ParsedEnv = { ...parsed, entries: parsed.entries.map((e) => ({ ...e, value: t(e.key, e.value) })) }
    return toDotenv(masked, { sort: opts.sort, dedupe: true, keepComments: true })
  }
  const list = selectEntries(parsed, { sort: opts.sort, dedupe: true }).filter((e) => e.key)
  const pairs = list.map((e) => [e.key, t(e.key, e.value)] as const)
  switch (format) {
    case 'json':
      return JSON.stringify(Object.fromEntries(pairs), null, 2) + '\n'
    case 'yaml':
      return pairs.length ? yamlStringify(Object.fromEntries(pairs), { defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN' }) : '{}\n'
    case 'shell':
      return pairs.map(([k, v]) => `export ${k}=${shellQuote(v)}`).join('\n') + (pairs.length ? '\n' : '')
    case 'docker':
      return pairs.length ? `docker run \\\n${pairs.map(([k, v]) => `  -e ${shellQuote(`${k}=${v}`)}`).join(' \\\n')} \\\n  IMAGE\n` : ''
    case 'k8s':
      return pairs.length ? `env:\n${pairs.map(([name, value]) => `  - name: ${/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name) ? name : JSON.stringify(name)}\n    value: ${JSON.stringify(value)}`).join('\n')}\n` : 'env: []\n'
  }
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

export type CompareStatus = 'only-a' | 'only-b' | 'different' | 'same'

export interface EnvCompareRow {
  key: string
  status: CompareStatus
  a?: string
  b?: string
  lineA?: number
  lineB?: number
}

export function compareEnv(a: ParsedEnv, b: ParsedEnv): { rows: EnvCompareRow[]; counts: Record<CompareStatus, number> } {
  const lineOf = (p: ParsedEnv) => {
    const m = new Map<string, number>()
    for (const e of p.entries) m.set(e.key, e.line)
    return m
  }
  const la = lineOf(a)
  const lb = lineOf(b)
  const keys = [...new Set([...a.values.keys(), ...b.values.keys()])].filter(Boolean).sort()
  const rows: EnvCompareRow[] = keys.map((key) => {
    const inA = a.values.has(key)
    const inB = b.values.has(key)
    const va = a.values.get(key)
    const vb = b.values.get(key)
    const status: CompareStatus = !inB ? 'only-a' : !inA ? 'only-b' : va === vb ? 'same' : 'different'
    return { key, status, a: va, b: vb, lineA: la.get(key), lineB: lb.get(key) }
  })
  const counts: Record<CompareStatus, number> = { 'only-a': 0, 'only-b': 0, different: 0, same: 0 }
  for (const r of rows) counts[r.status]++
  return { rows, counts }
}

export const SAMPLE_ENV = `# Application settings
# Copy to .env.local and fill in real values.

NODE_ENV=production
PORT=3000
APP_URL=https://app.example.com
API_BASE=\${APP_URL}/api   # derived

# Database
DATABASE_URL=postgres://app_user:s3cr3t-pa55@db.internal:5432/app?sslmode=require
DB_POOL_MAX=20

# Third-party keys
STRIPE_SECRET_KEY=sk_test_51Hx8kLmNoPqRsTuVwXyZ0123456789
export SENTRY_DSN="https://abc123@o1.ingest.sentry.io/42"
JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASC
-----END PRIVATE KEY-----"

GREETING='Hello, $USER — single quotes are literal'
FEATURE_FLAGS=search,billing beta
LOG_LEVEL=debug
LOG_LEVEL=info
EMPTY_VALUE=
1INVALID=nope
`

export const SAMPLE_ENV_B = `NODE_ENV=staging
PORT=3000
APP_URL=https://staging.example.com
API_BASE=\${APP_URL}/api
DATABASE_URL=postgres://app_user:staging-pass@db.staging:5432/app
DB_POOL_MAX=10
STRIPE_SECRET_KEY=sk_test_51Hx8kLmNoPqRsTuVwXyZ0123456789
SENTRY_DSN="https://abc123@o1.ingest.sentry.io/42"
LOG_LEVEL=info
REDIS_URL=redis://cache.staging:6379
`
