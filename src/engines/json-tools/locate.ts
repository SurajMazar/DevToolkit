/**
 * Maps a JSON Pointer to its position in JSON source text, without building a tree.
 *
 * Walks the text segment by segment, skipping over sibling values with a minimal scanner.
 * Intended for syntactically valid JSON (as produced by a successful parse); on malformed
 * text it returns the deepest location it could reach.
 */
import { offsetToLineColumn } from '@/engines/json/parse'
import { parsePointer } from './paths'

export interface SourceLocation {
  /** Offset of the value's first character. */
  offset: number
  /** Offset just past the value. */
  end: number
  line: number
  column: number
  endLine: number
  endColumn: number
  /** Offset of the property key (including its opening quote) when the value is an object member. */
  keyOffset?: number
  /** True when every segment was found; false = the location of the deepest existing ancestor. */
  exact: boolean
  /** How many pointer segments were resolved. */
  depth: number
}

const WS = new Set([0x20, 0x0a, 0x0d, 0x09])

function skipWs(t: string, i: number): number {
  while (i < t.length && WS.has(t.charCodeAt(i))) i++
  // Tolerate a UTF-8 BOM at the very start.
  if (i === 0 && t.charCodeAt(0) === 0xfeff) return skipWs(t, 1)
  return i
}

/** i points at the opening quote; returns the index after the closing quote. */
function skipString(t: string, i: number): number {
  i++
  while (i < t.length) {
    const c = t.charCodeAt(i)
    if (c === 0x5c) i += 2
    else if (c === 0x22) return i + 1
    else i++
  }
  return i
}

/** Returns the index just past the value starting at i (i must point at its first char). */
export function skipValue(t: string, i: number): number {
  const c = t[i]
  if (c === '"') return skipString(t, i)
  if (c === '{' || c === '[') {
    let depth = 0
    while (i < t.length) {
      const ch = t[i]
      if (ch === '"') {
        i = skipString(t, i)
        continue
      }
      if (ch === '{' || ch === '[') depth++
      else if (ch === '}' || ch === ']') {
        depth--
        if (depth === 0) return i + 1
      }
      i++
    }
    return i
  }
  // number / true / false / null
  while (i < t.length && !/[\s,\]}]/.test(t[i])) i++
  return i
}

function readKey(t: string, i: number): { key: string; end: number } {
  const end = skipString(t, i)
  let key: string
  try {
    key = JSON.parse(t.slice(i, end)) as string
  } catch {
    key = t.slice(i + 1, end - 1)
  }
  return { key, end }
}

function build(t: string, start: number, end: number, exact: boolean, depth: number, keyOffset?: number): SourceLocation {
  const a = offsetToLineColumn(t, start)
  const b = offsetToLineColumn(t, end)
  return { offset: start, end, line: a.line, column: a.column, endLine: b.line, endColumn: b.column, keyOffset, exact, depth }
}

/**
 * Locates the value addressed by `pointer` ("" or "#" = root, "/a/0", "#/a%20b") in `text`.
 * Returns null only when the text has no value at all.
 */
export function locatePointer(text: string, pointer: string | readonly (string | number)[]): SourceLocation | null {
  const segments = typeof pointer === 'string' ? parsePointer(pointer) : pointer.map(String)
  let i = skipWs(text, 0)
  if (i >= text.length) return null
  let keyOffset: number | undefined
  for (let d = 0; d < segments.length; d++) {
    const seg = segments[d]
    const c = text[i]
    let found = -1
    let foundKey: number | undefined
    if (c === '{') {
      let j = skipWs(text, i + 1)
      while (j < text.length && text[j] !== '}') {
        if (text[j] !== '"') break
        const k = readKey(text, j)
        let v = skipWs(text, k.end)
        if (text[v] === ':') v = skipWs(text, v + 1)
        // Duplicate keys: JSON.parse keeps the last one, so keep scanning.
        if (k.key === seg) {
          found = v
          foundKey = j
        }
        j = skipWs(text, skipValue(text, v))
        if (text[j] === ',') j = skipWs(text, j + 1)
      }
    } else if (c === '[' && /^(0|[1-9]\d*)$/.test(seg)) {
      const target = Number(seg)
      let j = skipWs(text, i + 1)
      let idx = 0
      while (j < text.length && text[j] !== ']') {
        if (idx === target) {
          found = j
          break
        }
        j = skipWs(text, skipValue(text, j))
        if (text[j] === ',') j = skipWs(text, j + 1)
        else break
        idx++
      }
    }
    if (found < 0) return build(text, i, skipValue(text, i), false, d, keyOffset)
    i = found
    keyOffset = foundKey
  }
  return build(text, i, skipValue(text, i), true, segments.length, keyOffset)
}
