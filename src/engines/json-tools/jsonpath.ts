/**
 * JSONPath querying on top of jsonpath-plus, configured to NEVER use native eval:
 * filter expressions (`?(@.price < 10)`) run in jsonpath-plus's "safe" interpreter, which
 * evaluates a JS-expression subset without `eval`/`new Function`.
 */
import { JSONPath } from 'jsonpath-plus'
import { isLosslessNumber, jsonTypeOf, type JsonType } from '@/engines/json/parse'
import { stringifyJson } from '@/engines/json/stringify'
import { parsePointer, resolveSegments, toJsonPath, toJsonPointer, type PathSegment } from './paths'
import { setKey } from './util'

export interface PathMatch {
  /** Normalized JSONPath, e.g. `$.store.book[0]`. */
  path: string
  /** JSON Pointer of the match ("" for the root). Empty for synthetic results (e.g. `~` key names). */
  pointer: string
  value: unknown
  type: JsonType
}

export interface QueryResult {
  matches: PathMatch[]
  /** Total matches before capping. */
  total: number
  capped: boolean
}

export class JsonPathSyntaxError extends Error {
  /** 1-based column in the expression. */
  column: number
  constructor(message: string, column: number) {
    super(message)
    this.name = 'JsonPathSyntaxError'
    this.column = column
  }
}

/**
 * jsonpath-plus silently ignores some malformed queries (`$.a[` returns `$.a`). This pre-check
 * catches unbalanced brackets/parentheses/quotes and dangling operators so the user gets an
 * explicit error instead of a misleading result.
 */
export function checkJsonPathSyntax(expr: string): void {
  const s = expr.trim()
  if (!s) throw new JsonPathSyntaxError('Enter a JSONPath expression, e.g. $.store.book[*].title', 1)
  if (s[0] !== '$') throw new JsonPathSyntaxError('A JSONPath query starts with $ (the document root), e.g. $.items[0]', 1)
  const stack: { ch: string; at: number }[] = []
  let quote: string | null = null
  let regex = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (regex) {
      if (c === '\\') i++
      else if (c === '/') regex = false
      continue
    }
    if (c === "'" || c === '"') quote = c
    else if (c === '/' && stack.some((x) => x.ch === '(') && /[(,]\s*$|\.match\(\s*$|\.test\(\s*$/.test(s.slice(0, i))) regex = true
    else if (c === '[' || c === '(') stack.push({ ch: c, at: i })
    else if (c === ']' || c === ')') {
      const open = stack.pop()
      const want = c === ']' ? '[' : '('
      if (!open || open.ch !== want) throw new JsonPathSyntaxError(`Unexpected "${c}"`, i + 1)
      if (c === ']' && s.slice(open.at + 1, i).trim() === '') throw new JsonPathSyntaxError('Empty brackets — use [*] for all items or [0] for an index', open.at + 1)
    }
  }
  if (quote) throw new JsonPathSyntaxError(`Unterminated string (missing closing ${quote})`, s.length)
  if (stack.length) {
    const open = stack[stack.length - 1]
    throw new JsonPathSyntaxError(`Unclosed "${open.ch}"`, open.at + 1)
  }
  if (/(^|[^.])\.$/.test(s)) throw new JsonPathSyntaxError('Expression ends with "." — add a property name or *', s.length)
  if (/\.{3,}/.test(s)) throw new JsonPathSyntaxError('Too many dots — use .. for recursive descent', s.search(/\.{3,}/) + 1)
}

/** LosslessNumbers become plain numbers so filters can compare them. */
function toQueryable(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v
  if (isLosslessNumber(v)) return Number((v as { value: string }).value)
  if (Array.isArray(v)) return v.map(toQueryable)
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(v)) setKey(out, k, toQueryable((v as Record<string, unknown>)[k]))
  return out
}

interface RawResult {
  pointer?: string
  value: unknown
}

export function queryJsonPath(root: unknown, expr: string, opts: { limit?: number; hasBigNumbers?: boolean } = {}): QueryResult {
  checkJsonPathSyntax(expr)
  const limit = opts.limit ?? 50_000
  const json = opts.hasBigNumbers === false ? root : toQueryable(root)
  let raw: RawResult[]
  try {
    raw = JSONPath({ path: expr.trim(), json: json as object, eval: 'safe', resultType: 'all', wrap: true, ignoreEvalErrors: false }) as RawResult[]
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new JsonPathSyntaxError(msg.replace(/^jsonPath:\s*/, ''), 1)
  }
  if (!Array.isArray(raw)) raw = []
  const matches: PathMatch[] = []
  for (const r of raw) {
    if (matches.length >= limit) break
    let segs: PathSegment[] | null = null
    let value = r.value
    let synth = false
    if (typeof r.pointer === 'string') {
      try {
        const res = resolveSegments(root, parsePointer(r.pointer))
        if (res.found) {
          segs = res.path
          // `~` (property name) results point at the property but return its name.
          const synthetic = typeof r.value === 'string' && res.value !== r.value
          if (!synthetic) value = res.value
          else synth = true
        }
      } catch {
        /* synthetic result */
      }
    }
    matches.push({
      path: segs ? toJsonPath(segs) + (synth ? '~' : '') : expr.trim(),
      pointer: segs && !synth ? toJsonPointer(segs) : '',
      value,
      type: jsonTypeOf(value),
    })
  }
  return { matches, total: raw.length, capped: raw.length > matches.length }
}

export interface DocumentPath {
  path: string
  type: JsonType
  /** Short preview of the value (primitives) or child count (containers). */
  preview: string
  depth: number
}

/** Every location in the document, in document order (root excluded). */
export function listAllPaths(root: unknown, limit = 1_000_000): { paths: DocumentPath[]; total: number; capped: boolean } {
  const paths: DocumentPath[] = []
  let total = 0
  const walk = (v: unknown, segs: PathSegment[]) => {
    if (v === null || typeof v !== 'object' || isLosslessNumber(v)) return
    const entries: [PathSegment, unknown][] = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.keys(v).map((k) => [k, (v as Record<string, unknown>)[k]])
    for (const [k, child] of entries) {
      total++
      segs.push(k)
      if (paths.length < limit) paths.push({ path: toJsonPath(segs), type: jsonTypeOf(child), preview: previewValue(child, 60), depth: segs.length })
      walk(child, segs)
      segs.pop()
    }
  }
  walk(root, [])
  return { paths, total, capped: total > paths.length }
}

export function previewValue(v: unknown, max = 80): string {
  const t = jsonTypeOf(v)
  if (t === 'array') return `[${(v as unknown[]).length}]`
  if (t === 'object') return `{${Object.keys(v as object).length}}`
  const s = t === 'string' ? JSON.stringify(v) : stringifyJson(v)
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

export interface JsonPathExample {
  expr: string
  description: string
}

/** Cheat sheet; examples are written against the tool's sample document. */
export const JSONPATH_SYNTAX: { token: string; description: string }[] = [
  { token: '$', description: 'Document root' },
  { token: '.key  ["key"]', description: 'Child property (bracket form for any key)' },
  { token: '..key', description: 'Recursive descent — key at any depth' },
  { token: '*', description: 'Wildcard — all properties or items' },
  { token: '[0]  [-1]', description: 'Array index (negative counts from the end)' },
  { token: '[0,2]  ["a","b"]', description: 'Union of indices or keys' },
  { token: '[1:4]  [::2]', description: 'Slice [start:end:step]' },
  { token: '[?(@.age > 30)]', description: 'Filter — @ is the current item (safe evaluator)' },
  { token: '&&  ||  ==  !=  <  >=', description: 'Operators inside filters' },
  { token: '@root  @parent', description: 'Document root / parent inside a filter' },
  { token: '@.length', description: 'Array or string length' },
  { token: '~', description: 'Property names instead of values' },
]
