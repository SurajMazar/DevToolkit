import { isLosslessNumber } from './parse'

export interface StringifyOptions {
  /** Spaces (number) or a string such as '\t'. 0 / '' = minified. */
  indent?: number | string
  sortKeys?: boolean | 'asc' | 'desc'
  /** Escape every non-ASCII character as \uXXXX. */
  asciiOnly?: boolean
}

function quote(s: string, ascii: boolean): string {
  // Fast path: JSON.stringify handles escaping correctly and quickly.
  const q = JSON.stringify(s)
  if (!ascii) return q
  return q.replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
}

function keysOf(obj: Record<string, unknown>, sort: StringifyOptions['sortKeys']): string[] {
  const keys = Object.keys(obj)
  if (!sort) return keys
  keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  if (sort === 'desc') keys.reverse()
  return keys
}

type RawJSON = (text: string) => unknown
const rawJSON: RawJSON | undefined = (JSON as unknown as { rawJSON?: RawJSON }).rawJSON

function sortedCopy(obj: Record<string, unknown>, desc: boolean): Record<string, unknown> {
  const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  if (desc) keys.reverse()
  const out: Record<string, unknown> = {}
  for (const k of keys) out[k] = obj[k]
  return out
}

/**
 * Native fast path: JSON.stringify with a replacer that emits LosslessNumbers verbatim via
 * JSON.rawJSON (ES2025). Several times faster than a JS serializer on large documents.
 */
function nativeStringify(value: unknown, opts: StringifyOptions): string | undefined {
  if (!rawJSON) return undefined
  const sort = opts.sortKeys === true ? 'asc' : opts.sortKeys
  const replacer = (_k: string, v: unknown) => {
    if (v === null || typeof v !== 'object') return v
    if (isLosslessNumber(v)) return rawJSON((v as { value: string }).value)
    if (sort && !Array.isArray(v) && typeof (v as { toJSON?: unknown }).toJSON !== 'function') return sortedCopy(v as Record<string, unknown>, sort === 'desc')
    return v
  }
  let out = JSON.stringify(value, replacer, opts.indent || undefined)
  if (out === undefined) return 'undefined'
  // Non-ASCII characters can only occur inside strings, so escaping them textually is safe.
  if (opts.asciiOnly) out = out.replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
  return out
}

/**
 * JSON serializer that understands LosslessNumber (prints original digits), supports deep
 * key sorting and ASCII-only output. Mirrors JSON.stringify semantics otherwise
 * (undefined/functions dropped in objects, null in arrays; non-finite numbers → null).
 */
export function stringifyJson(value: unknown, opts: StringifyOptions = {}): string {
  const fast = nativeStringify(value, opts)
  if (fast !== undefined) return fast
  return stringifyJsonJs(value, opts)
}

/** Pure-JS serializer (fallback for engines without JSON.rawJSON). */
export function stringifyJsonJs(value: unknown, opts: StringifyOptions = {}): string {
  const indentUnit = typeof opts.indent === 'number' ? ' '.repeat(Math.max(0, Math.min(10, opts.indent))) : (opts.indent ?? '')
  const ascii = !!opts.asciiOnly
  const sort = opts.sortKeys === true ? 'asc' : opts.sortKeys
  const out: string[] = []
  const seen = new Set<unknown>()

  const write = (v: unknown, indent: string): boolean => {
    if (v === null) {
      out.push('null')
      return true
    }
    switch (typeof v) {
      case 'string':
        out.push(quote(v, ascii))
        return true
      case 'number':
        out.push(Number.isFinite(v) ? String(v) : 'null')
        return true
      case 'boolean':
        out.push(v ? 'true' : 'false')
        return true
      case 'bigint':
        out.push(v.toString())
        return true
      case 'undefined':
      case 'function':
      case 'symbol':
        return false
    }
    if (isLosslessNumber(v)) {
      out.push((v as { value: string }).value)
      return true
    }
    if (seen.has(v)) throw new TypeError('Cannot serialize a circular structure')
    seen.add(v)
    const inner = indent + indentUnit
    const nl = indentUnit ? '\n' : ''
    const sep = indentUnit ? ': ' : ':'
    if (Array.isArray(v)) {
      if (v.length === 0) out.push('[]')
      else {
        out.push('[')
        for (let i = 0; i < v.length; i++) {
          out.push(i ? ',' + nl + inner : nl + inner)
          if (!write(v[i], inner)) out.push('null')
        }
        out.push(nl + indent + ']')
      }
    } else {
      const obj = (typeof (v as { toJSON?: unknown }).toJSON === 'function' ? (v as { toJSON: () => unknown }).toJSON() : v) as Record<string, unknown>
      if (obj !== v) {
        seen.delete(v)
        return write(obj, indent)
      }
      const keys = keysOf(obj, sort)
      let first = true
      out.push('{')
      for (const k of keys) {
        const val = obj[k]
        if (val === undefined || typeof val === 'function' || typeof val === 'symbol') continue
        out.push(first ? nl + inner : ',' + nl + inner)
        first = false
        out.push(quote(k, ascii), sep)
        write(val, inner)
      }
      out.push(first ? '}' : nl + indent + '}')
    }
    seen.delete(v)
    return true
  }

  if (!write(value, '')) return 'undefined'
  return out.join('')
}
