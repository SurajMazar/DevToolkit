/**
 * SQL formatting (via sql-formatter) and a purpose-built minifier.
 *
 * The minifier is a small lexer that understands string literals, quoted identifiers,
 * dollar-quoted bodies and comments for the supported dialects. It only ever changes
 * whitespace and comments *between* tokens — literal and identifier contents are copied
 * byte-for-byte. Nothing here executes SQL.
 */
import { format, type FormatOptionsWithLanguage, type SqlLanguage } from 'sql-formatter'

export const SQL_DIALECTS: { value: SqlLanguage; label: string }[] = [
  { value: 'sql', label: 'Standard SQL' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'mariadb', label: 'MariaDB' },
  { value: 'sqlite', label: 'SQLite' },
  { value: 'bigquery', label: 'BigQuery' },
  { value: 'snowflake', label: 'Snowflake' },
  { value: 'redshift', label: 'Amazon Redshift' },
  { value: 'spark', label: 'Spark SQL' },
  { value: 'hive', label: 'Hive' },
  { value: 'trino', label: 'Trino / Presto' },
  { value: 'duckdb', label: 'DuckDB' },
  { value: 'clickhouse', label: 'ClickHouse' },
  { value: 'transactsql', label: 'SQL Server (T-SQL)' },
  { value: 'plsql', label: 'Oracle PL/SQL' },
  { value: 'db2', label: 'IBM Db2' },
  { value: 'db2i', label: 'IBM Db2 for i' },
  { value: 'n1ql', label: 'Couchbase N1QL' },
  { value: 'singlestoredb', label: 'SingleStoreDB' },
  { value: 'tidb', label: 'TiDB' },
]

export interface SqlFormatOptions {
  language: SqlLanguage
  keywordCase: 'preserve' | 'upper' | 'lower'
  identifierCase: 'preserve' | 'upper' | 'lower'
  functionCase: 'preserve' | 'upper' | 'lower'
  dataTypeCase: 'preserve' | 'upper' | 'lower'
  indent: '2' | '4' | 'tab'
  linesBetweenQueries: number
  denseOperators: boolean
  expressionWidth: number
  logicalOperatorNewline: 'before' | 'after'
  newlineBeforeSemicolon: boolean
}

export const DEFAULT_SQL_FORMAT: SqlFormatOptions = {
  language: 'postgresql',
  keywordCase: 'upper',
  identifierCase: 'preserve',
  functionCase: 'preserve',
  dataTypeCase: 'preserve',
  indent: '2',
  linesBetweenQueries: 1,
  denseOperators: false,
  expressionWidth: 50,
  logicalOperatorNewline: 'before',
  newlineBeforeSemicolon: false,
}

export interface SqlError {
  message: string
  line?: number
  column?: number
}

export type SqlFormatResult = { ok: true; output: string } | { ok: false; error: SqlError }

export function formatSql(sql: string, opts: SqlFormatOptions): SqlFormatResult {
  const cfg: FormatOptionsWithLanguage = {
    language: opts.language,
    keywordCase: opts.keywordCase,
    identifierCase: opts.identifierCase,
    functionCase: opts.functionCase,
    dataTypeCase: opts.dataTypeCase,
    useTabs: opts.indent === 'tab',
    tabWidth: opts.indent === '4' ? 4 : 2,
    linesBetweenQueries: Math.max(0, Math.min(5, Math.round(opts.linesBetweenQueries))),
    denseOperators: opts.denseOperators,
    expressionWidth: Math.max(10, Math.min(500, Math.round(opts.expressionWidth))),
    logicalOperatorNewline: opts.logicalOperatorNewline,
    newlineBeforeSemicolon: opts.newlineBeforeSemicolon,
  }
  try {
    return { ok: true, output: format(sql, cfg) }
  } catch (e) {
    return { ok: false, error: describeSqlError(e) }
  }
}

/** sql-formatter errors look like "Parse error at token: x at line 3 column 7\n…grammar dump…". */
export function describeSqlError(e: unknown): SqlError {
  const raw = e instanceof Error ? e.message : String(e)
  const loc = /at line (\d+) column (\d+)/.exec(raw)
  const firstLine = raw.split('\n')[0].trim().replace(/\s*at line \d+ column \d+\.?/, '')
  let message: string
  const tok = /^Parse error at token:\s*(.*)$/.exec(firstLine)
  if (tok) message = tok[1] === '«EOF»' ? 'Unexpected end of query — something is not closed or a clause is incomplete' : `Unexpected “${tok[1]}”`
  else message = firstLine.replace(/^Parse error:\s*/, '') || 'The SQL could not be parsed'
  message += ' (the formatter may also not support this syntax in the selected dialect)'
  return loc ? { message, line: Number(loc[1]), column: Number(loc[2]) } : { message }
}

// ---------------------------------------------------------------------------
// Minifier
// ---------------------------------------------------------------------------

export interface SqlLexOptions {
  /** Backslash escapes inside '…' (MySQL/MariaDB/BigQuery/Spark/Hive…). */
  backslashEscapes: boolean
  /** `#` starts a line comment (MySQL/MariaDB). */
  hashComments: boolean
  /** Nested block comments (PostgreSQL, SQL Server, SQLite does not). */
  nestedComments: boolean
  /** $$…$$ / $tag$…$tag$ dollar quoting (PostgreSQL family). */
  dollarQuotes: boolean
  /** [identifier] quoting (SQL Server, SQLite). */
  bracketIdentifiers: boolean
  /** Triple-quoted strings '''…''' / """…""" (BigQuery). */
  tripleQuotes: boolean
  /** Line-based batch separators that must stay on their own line (T-SQL GO, client DELIMITER). */
  batchSeparator?: 'go' | 'delimiter'
}

export function lexOptionsFor(language: SqlLanguage | string): SqlLexOptions {
  const l = language
  const mysqlish = l === 'mysql' || l === 'mariadb' || l === 'singlestoredb' || l === 'tidb'
  return {
    backslashEscapes: mysqlish || l === 'bigquery' || l === 'spark' || l === 'hive' || l === 'clickhouse' || l === 'n1ql',
    hashComments: mysqlish || l === 'bigquery' || l === 'clickhouse',
    nestedComments: l === 'postgresql' || l === 'redshift' || l === 'transactsql' || l === 'snowflake' || l === 'duckdb',
    dollarQuotes: l === 'postgresql' || l === 'redshift' || l === 'snowflake' || l === 'duckdb' || l === 'sql',
    bracketIdentifiers: l === 'transactsql' || l === 'sqlite' || l === 'sql',
    tripleQuotes: l === 'bigquery',
    batchSeparator: l === 'transactsql' ? 'go' : mysqlish ? 'delimiter' : undefined,
  }
}

export type SqlTokenKind = 'ws' | 'line-comment' | 'block-comment' | 'string' | 'quoted-ident' | 'dollar' | 'word' | 'punct' | 'other'

export interface SqlToken {
  kind: SqlTokenKind
  text: string
  start: number
}

export class SqlLexError extends Error {
  constructor(
    message: string,
    public offset: number,
  ) {
    super(message)
    this.name = 'SqlLexError'
  }
}

const DOLLAR_TAG = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/

/** Splits SQL into tokens, keeping every byte. Throws SqlLexError on unterminated quotes. */
export function lexSql(sql: string, o: SqlLexOptions): SqlToken[] {
  const out: SqlToken[] = []
  const n = sql.length
  let i = 0
  const push = (kind: SqlTokenKind, end: number) => {
    out.push({ kind, text: sql.slice(i, end), start: i })
    i = end
  }
  const quoted = (q: string, kind: SqlTokenKind, allowBackslash: boolean, what: string) => {
    let j = i + 1
    for (;;) {
      if (j >= n) throw new SqlLexError(`Unterminated ${what} starting here`, i)
      const ch = sql[j]
      if (allowBackslash && ch === '\\') {
        j += 2
        continue
      }
      if (ch === q) {
        if (sql[j + 1] === q) {
          j += 2
          continue
        }
        return push(kind, j + 1)
      }
      j++
    }
  }
  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') {
      let j = i + 1
      while (j < n && /[ \t\n\r\f\v]/.test(sql[j])) j++
      push('ws', j)
    } else if (c === '-' && next === '-' && !(o.hashComments && o.backslashEscapes && sql[i + 2] !== undefined && !/[ \t\n\r\f\v]/.test(sql[i + 2]))) {
      // MySQL only treats "--" as a comment when followed by whitespace ("a--1" is a minus minus).
      const j = sql.indexOf('\n', i)
      push('line-comment', j === -1 ? n : j)
    } else if (c === '#' && o.hashComments) {
      const j = sql.indexOf('\n', i)
      push('line-comment', j === -1 ? n : j)
    } else if (c === '/' && next === '*') {
      let depth = 1
      let j = i + 2
      while (j < n && depth > 0) {
        if (sql[j] === '*' && sql[j + 1] === '/') {
          depth--
          j += 2
        } else if (o.nestedComments && sql[j] === '/' && sql[j + 1] === '*') {
          depth++
          j += 2
        } else j++
      }
      if (depth > 0) throw new SqlLexError('Unterminated block comment starting here', i)
      push('block-comment', j)
    } else if ((c === "'" || c === '"') && o.tripleQuotes && sql.startsWith(c.repeat(3), i)) {
      const end = sql.indexOf(c.repeat(3), i + 3)
      if (end === -1) throw new SqlLexError('Unterminated triple-quoted string starting here', i)
      push('string', end + 3)
    } else if (c === "'") {
      // E'…' (PostgreSQL escape string) allows backslash escapes regardless of dialect.
      const prev = sql[i - 1]
      const eString = (prev === 'E' || prev === 'e') && !/[A-Za-z0-9_]/.test(sql[i - 2] ?? '')
      quoted("'", 'string', o.backslashEscapes || eString, 'string literal')
    } else if (c === '"') {
      quoted('"', o.backslashEscapes && o.hashComments ? 'string' : 'quoted-ident', o.backslashEscapes && o.hashComments, 'quoted identifier')
    } else if (c === '`') {
      quoted('`', 'quoted-ident', false, 'backtick identifier')
    } else if (c === '[' && o.bracketIdentifiers) {
      const end = sql.indexOf(']', i + 1)
      let j = end
      while (j !== -1 && sql[j + 1] === ']') j = sql.indexOf(']', j + 2)
      if (j === -1) throw new SqlLexError('Unterminated [bracketed identifier] starting here', i)
      push('quoted-ident', j + 1)
    } else if (c === '$' && o.dollarQuotes && DOLLAR_TAG.test(sql.slice(i, i + 64)) && !/[A-Za-z0-9_]/.test(sql[i - 1] ?? '')) {
      const tag = DOLLAR_TAG.exec(sql.slice(i, i + 64))![0]
      const end = sql.indexOf(tag, i + tag.length)
      if (end === -1) throw new SqlLexError(`Unterminated dollar-quoted string ${tag}`, i)
      push('dollar', end + tag.length)
    } else if (/[A-Za-z0-9_\u0080-￿@$:]/.test(c)) {
      let j = i + 1
      while (j < n && /[A-Za-z0-9_\u0080-￿$@#.]/.test(sql[j]) && !(sql[j] === '.' && sql[j + 1] === '.')) {
        // A dot followed by a quote starts a qualified quoted identifier; stop before it.
        if (sql[j] === '.' && /["'`[]/.test(sql[j + 1] ?? '')) break
        j++
      }
      push('word', j)
    } else if ('(),;'.includes(c)) {
      push('punct', i + 1)
    } else {
      push('other', i + 1)
    }
  }
  return out
}

export interface MinifyOptions extends SqlLexOptions {
  /** Keep optimizer hints /*+ … *\/ and MySQL executable comments /*! … *\/ (default true). */
  keepHints?: boolean
  /** Put each statement on its own line. */
  statementPerLine?: boolean
}

export interface MinifyResult {
  output: string
  removedComments: number
  keptHints: number
}

const NO_SPACE_AFTER = new Set(['(', ','])
const NO_SPACE_BEFORE = new Set([')', ',', ';', '('])

/** True when gluing a and b without a space would change the token stream. */
function needsSpace(prev: string, next: string): boolean {
  const a = prev[prev.length - 1]
  const b = next[0]
  if (a === undefined || b === undefined) return false
  if (NO_SPACE_AFTER.has(a) || NO_SPACE_BEFORE.has(b)) {
    // "(" before a word must keep the space when it follows a word: "IN (" → "IN(" is fine,
    // but "x -(" etc. are fine too. Only comment openers can be created by gluing.
    return (a === '-' && b === '-') || (a === '/' && b === '*')
  }
  return true
}

export function minifySql(sql: string, opts: MinifyOptions): MinifyResult {
  const tokens = lexSql(sql, opts)
  const keepHints = opts.keepHints ?? true
  let out = ''
  let pendingSpace = false
  let pendingNewline = false
  let removed = 0
  let hints = 0
  const lineStartIdx = new Set<number>()
  // Identify batch-separator lines (GO / DELIMITER) that must stay on their own line.
  if (opts.batchSeparator) {
    const re = opts.batchSeparator === 'go' ? /^[ \t]*GO(?:[ \t]+\d+)?[ \t]*$/gim : /^[ \t]*DELIMITER[ \t]+\S+[ \t]*$/gim
    let m: RegExpExecArray | null
    while ((m = re.exec(sql))) lineStartIdx.add(m.index + (m[0].length - m[0].trimStart().length))
  }
  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t]
    if (tok.kind === 'ws') {
      pendingSpace = true
      continue
    }
    if (tok.kind === 'line-comment' || tok.kind === 'block-comment') {
      const isHint = tok.kind === 'block-comment' && (tok.text.startsWith('/*+') || tok.text.startsWith('/*!'))
      if (!(isHint && keepHints)) {
        removed++
        pendingSpace = true
        continue
      }
      hints++
    }
    if (lineStartIdx.has(tok.start)) {
      // Copy the whole separator line verbatim on its own line.
      const lineEnd = sql.indexOf('\n', tok.start)
      const line = sql.slice(tok.start, lineEnd === -1 ? sql.length : lineEnd).trimEnd()
      out = out.trimEnd()
      out += (out ? '\n' : '') + line + '\n'
      while (t + 1 < tokens.length && tokens[t + 1].start < (lineEnd === -1 ? sql.length : lineEnd)) t++
      pendingSpace = false
      pendingNewline = false
      continue
    }
    if (out && !out.endsWith('\n')) {
      if (pendingNewline) out += '\n'
      else if (pendingSpace && needsSpace(out, tok.text)) out += ' '
    }
    pendingSpace = false
    pendingNewline = false
    out += tok.text
    if (tok.kind === 'punct' && tok.text === ';' && opts.statementPerLine) pendingNewline = true
  }
  return { output: out.trimEnd(), removedComments: removed, keptHints: hints }
}

/** The ordered string literals / quoted identifiers / dollar bodies — used to prove nothing changed. */
export function protectedSegments(sql: string, opts: SqlLexOptions): string[] {
  return lexSql(sql, opts)
    .filter((t) => t.kind === 'string' || t.kind === 'quoted-ident' || t.kind === 'dollar')
    .map((t) => t.text)
}
