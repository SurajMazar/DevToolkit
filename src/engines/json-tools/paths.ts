/**
 * Path notations for locations inside a JSON document.
 *
 * A location is an array of segments: strings for object keys, numbers for array indices.
 *   JSONPath      $.users[0]["first name"]
 *   JavaScript    data.users[0]["first name"]
 *   JSON Pointer  /users/0/first name        (RFC 6901: "~" → "~0", "/" → "~1")
 */

export type PathSegment = string | number

// ECMAScript IdentifierName (reserved words are fine after a dot in JS and JSONPath).
const RE_IDENT = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u

export function isIdentifier(key: string): boolean {
  return RE_IDENT.test(key)
}

/** Strict ASCII identifier — safe in every JSONPath dialect after a dot. */
const RE_ASCII_IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function quoteKey(key: string, quote: '"' | "'"): string {
  const json = JSON.stringify(key)
  if (quote === '"') return json
  // Re-quote with single quotes: unescape \" and escape '.
  return "'" + json.slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'") + "'"
}

export interface PathFormatOptions {
  /** Quote style for bracketed keys. Default: double quotes. */
  quote?: '"' | "'"
}

/** `$.a[0]["b c"]` */
export function toJsonPath(segments: readonly PathSegment[], opts: PathFormatOptions = {}): string {
  const q = opts.quote ?? '"'
  let out = '$'
  for (const s of segments) {
    if (typeof s === 'number') out += `[${s}]`
    else if (RE_ASCII_IDENT.test(s)) out += `.${s}`
    else out += `[${quoteKey(s, q)}]`
  }
  return out
}

/** `data.a[0]["b c"]` — a valid JavaScript property access expression. */
export function toJsPath(segments: readonly PathSegment[], root = 'data'): string {
  let out = root
  for (const s of segments) {
    if (typeof s === 'number') out += `[${s}]`
    else if (isIdentifier(s)) out += `.${s}`
    else out += `[${JSON.stringify(s)}]`
  }
  return out
}

export function escapePointerSegment(s: string): string {
  return s.replace(/~/g, '~0').replace(/\//g, '~1')
}

export function unescapePointerSegment(s: string): string {
  return s.replace(/~1/g, '/').replace(/~0/g, '~')
}

/** `/a/0/b c` (root is the empty string). */
export function toJsonPointer(segments: readonly PathSegment[]): string {
  let out = ''
  for (const s of segments) out += '/' + escapePointerSegment(String(s))
  return out
}

/**
 * Splits a JSON Pointer into raw string segments. Accepts a leading "#" (URI fragment form,
 * percent-decoded). Throws on malformed pointers.
 */
export function parsePointer(pointer: string): string[] {
  let p = pointer
  if (p.startsWith('#')) {
    p = p.slice(1)
    try {
      p = decodeURIComponent(p)
    } catch {
      /* keep undecoded — a literal "%" in a key */
    }
  }
  if (p === '') return []
  if (!p.startsWith('/')) throw new Error(`Invalid JSON Pointer "${pointer}": must start with "/"`)
  return p
    .slice(1)
    .split('/')
    .map((s) => {
      if (/~[^01]|~$/.test(s)) throw new Error(`Invalid JSON Pointer "${pointer}": bad escape in "${s}"`)
      return unescapePointerSegment(s)
    })
}

/**
 * Resolves pointer segments against a value, turning numeric segments into indices for arrays.
 * Returns undefined when the location does not exist.
 */
export function resolveSegments(root: unknown, segments: readonly string[]): { found: boolean; value: unknown; path: PathSegment[] } {
  let cur: unknown = root
  const path: PathSegment[] = []
  for (const s of segments) {
    if (Array.isArray(cur)) {
      if (!/^(0|[1-9]\d*)$/.test(s)) return { found: false, value: undefined, path }
      const i = Number(s)
      if (i >= cur.length) return { found: false, value: undefined, path }
      cur = cur[i]
      path.push(i)
    } else if (cur !== null && typeof cur === 'object' && !(cur as { isLosslessNumber?: boolean }).isLosslessNumber) {
      if (!Object.prototype.hasOwnProperty.call(cur, s)) return { found: false, value: undefined, path }
      cur = (cur as Record<string, unknown>)[s]
      path.push(s)
    } else return { found: false, value: undefined, path }
  }
  return { found: true, value: cur, path }
}

/** Dot-path used by flatten/extract-keys style tools: `a.b[0].c` or `a.b.0.c`. */
export function toDotPath(segments: readonly PathSegment[], opts: { delimiter?: string; arrays?: 'bracket' | 'dot' | 'wildcard' } = {}): string {
  const d = opts.delimiter ?? '.'
  const arrays = opts.arrays ?? 'bracket'
  let out = ''
  for (const s of segments) {
    if (typeof s === 'number' || s === '[]') {
      if (arrays === 'wildcard') out += '[]'
      else if (arrays === 'bracket') out += `[${s}]`
      else out += (out ? d : '') + String(s)
    } else out += (out ? d : '') + s
  }
  return out
}
