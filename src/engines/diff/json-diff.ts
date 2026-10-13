/**
 * Structural JSON comparison.
 *
 * - Objects are compared by key (key order is irrelevant unless `detectKeyOrder`).
 * - Arrays are aligned by: 'smart' (LCS over deep-equal element fingerprints, then
 *   positional pairing inside change blocks), 'index', or 'key' (match objects by an
 *   identifier field such as "id").
 * - Type-aware: 1 vs "1" is a type change unless `looseTypes`.
 * - Numbers are compared by exact decimal value, including LosslessNumbers.
 * - Paths can be ignored with glob patterns: `$.meta.updatedAt`, `items[*].ts`, `**.etag`.
 *
 * Output: a flat change list plus a pre-order "union tree" table for a virtualized viewer.
 */
import { diffSequences, OpType } from './myers'
import { isLosslessNumber, jsonTypeOf, numberText, type JsonType } from '../json/parse'

export type ArrayMatch = 'smart' | 'index' | 'key'

export interface JsonDiffOptions {
  arrayMatch: ArrayMatch
  /** Identifier field(s) used when arrayMatch = 'key' (first one present wins). */
  arrayKeys: string[]
  ignorePaths: string[]
  /** Treat "1" == 1, "true" == true, "null" == null. */
  looseTypes: boolean
  ignoreStringCase: boolean
  /** Report objects whose (common) keys appear in a different order. */
  detectKeyOrder: boolean
  /** Treat arrays as unordered collections (multiset comparison). */
  ignoreArrayOrder: boolean
}

export const DEFAULT_JSON_DIFF_OPTIONS: JsonDiffOptions = {
  arrayMatch: 'smart',
  arrayKeys: ['id'],
  ignorePaths: [],
  looseTypes: false,
  ignoreStringCase: false,
  detectKeyOrder: false,
  ignoreArrayOrder: false,
}

export type PathSeg = string | number | { key: string; value: string; leftIndex: number; rightIndex: number }

export type ChangeType = 'added' | 'removed' | 'modified' | 'type' | 'order'

export interface JsonChange {
  type: ChangeType
  path: PathSeg[]
  pathText: string
  /** JSON Pointer in the left (original) document; empty for additions. */
  leftPointer: string | null
  rightPointer: string | null
  left?: unknown
  right?: unknown
  leftType?: JsonType
  rightType?: JsonType
}

export const enum NodeStatus {
  Equal = 0,
  Added = 1,
  Removed = 2,
  Modified = 3,
  TypeChanged = 4,
  /** Container whose descendants contain changes. */
  Contains = 5,
  Ignored = 6,
  /** Unchanged (or wholly added/removed) container whose children were not listed to keep the tree bounded. */
  Elided = 7,
}

/** Maximum rows in the tree table; beyond this, large unchanged subtrees are elided. */
export const TREE_ROW_BUDGET = 600_000

export interface TreeTable {
  depth: Uint16Array
  status: Uint8Array
  parent: Int32Array
  /** Index one past the last descendant (pre-order), for collapsing. */
  end: Int32Array
  /** Number of changes inside the subtree (including itself). */
  changes: Int32Array
  /** Display key: property name, "[3]", or "[id=42]". */
  keys: string[]
  /** Container type or primitive JSON type per side ('' when absent on that side). */
  leftKind: string[]
  rightKind: string[]
  leftPreview: string[]
  rightPreview: string[]
  /** Index into `changes` list for nodes that are a change themselves, else -1. */
  changeIndex: Int32Array
}

export interface JsonDiffResult {
  changes: JsonChange[]
  tree: TreeTable
  stats: { added: number; removed: number; modified: number; typeChanged: number; reordered: number; ignored: number; nodesLeft: number; nodesRight: number }
  identical: boolean
  elapsedMs: number
}

// ── Paths ───────────────────────────────────────────────────────────────────────

const IDENT = /^[A-Za-z_$][\w$]*$/

export function pathToText(path: PathSeg[]): string {
  let s = '$'
  for (const seg of path) {
    if (typeof seg === 'number') s += `[${seg}]`
    else if (typeof seg === 'string') s += IDENT.test(seg) ? `.${seg}` : `[${JSON.stringify(seg)}]`
    else if (seg.key === '#') s += `[${seg.leftIndex}]`
    else s += `[${seg.key}=${seg.value}]`
  }
  return s
}

const escPtr = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1')

function pointer(path: PathSeg[], side: 'left' | 'right'): string {
  let s = ''
  for (const seg of path) {
    if (typeof seg === 'number') s += `/${seg}`
    else if (typeof seg === 'string') s += `/${escPtr(seg)}`
    else s += `/${side === 'left' ? seg.leftIndex : seg.rightIndex}`
  }
  return s
}

type Matcher = { kind: 'name'; name: string } | { kind: 'index'; index: number } | { kind: 'any' } | { kind: 'deep' }

/** Parses `$.a.b[*].c`, `a.b`, `**.etag`, `items[0]`, `["weird key"]`. */
export function parsePathPattern(pattern: string): Matcher[] {
  let p = pattern.trim()
  if (p.startsWith('$')) p = p.slice(1)
  if (p.startsWith('/')) {
    // JSON Pointer form.
    return p
      .split('/')
      .slice(1)
      .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'))
      .map((t): Matcher => (t === '*' ? { kind: 'any' } : t === '**' ? { kind: 'deep' } : /^\d+$/.test(t) ? { kind: 'index', index: Number(t) } : { kind: 'name', name: t }))
  }
  const out: Matcher[] = []
  const re = /\.?(\*\*|\*|[A-Za-z_$][\w$-]*)|\[(\*|\d+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\]/g
  let m: RegExpExecArray | null
  let last = 0
  while ((m = re.exec(p))) {
    if (m.index !== last) throw new Error(`Cannot parse path pattern "${pattern}" near "${p.slice(last)}"`)
    last = re.lastIndex
    const tok = m[1] ?? m[2]
    if (tok === '**') out.push({ kind: 'deep' })
    else if (tok === '*') out.push({ kind: 'any' })
    else if (m[2] !== undefined && /^\d+$/.test(tok)) out.push({ kind: 'index', index: Number(tok) })
    else if (m[2] !== undefined && /^["']/.test(tok)) out.push({ kind: 'name', name: tok[0] === '"' ? JSON.parse(tok) : tok.slice(1, -1).replace(/\\'/g, "'") })
    else out.push({ kind: 'name', name: tok })
  }
  if (last !== p.length) throw new Error(`Cannot parse path pattern "${pattern}" near "${p.slice(last)}"`)
  return out
}

function segMatches(m: Matcher, seg: PathSeg): boolean {
  if (m.kind === 'any') return true
  if (m.kind === 'name') return typeof seg === 'string' && seg === m.name
  if (m.kind === 'index') return typeof seg === 'number' ? seg === m.index : typeof seg === 'object' && (seg.leftIndex === m.index || seg.rightIndex === m.index)
  return false
}

export function pathMatches(pattern: Matcher[], path: PathSeg[], pi = 0, si = 0): boolean {
  if (pi === pattern.length) return si === path.length
  const m = pattern[pi]
  if (m.kind === 'deep') {
    for (let k = si; k <= path.length; k++) if (pathMatches(pattern, path, pi + 1, k)) return true
    return false
  }
  if (si >= path.length) return false
  return segMatches(m, path[si]) && pathMatches(pattern, path, pi + 1, si + 1)
}

// ── Value helpers ───────────────────────────────────────────────────────────────

/** Canonical decimal text so 1, 1.0, 1e0 and 10E-1 compare equal. */
export function canonicalNumber(text: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text.trim())
  if (!m) return text
  const [, sign, int, frac = '', exp = '0'] = m
  let digits = (int + frac).replace(/^0+/, '')
  let e = Number(exp) - frac.length
  if (!digits) return '0'
  const trailing = digits.match(/0*$/)![0].length
  digits = digits.slice(0, digits.length - trailing)
  e += trailing
  return `${sign}${digits}e${e}`
}

function numEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b || (Number.isNaN(a) && Number.isNaN(b))
  return canonicalNumber(numberText(a)) === canonicalNumber(numberText(b))
}

function looseEqual(a: unknown, b: unknown): boolean {
  const ta = jsonTypeOf(a)
  const tb = jsonTypeOf(b)
  const str = ta === 'string' ? (a as string) : tb === 'string' ? (b as string) : null
  const other = ta === 'string' ? b : a
  const otherType = ta === 'string' ? tb : ta
  if (str === null) return false
  if (otherType === 'number') return /^\s*-?\d/.test(str) && canonicalNumber(str.trim()) === canonicalNumber(numberText(other))
  if (otherType === 'boolean') return str === String(other)
  if (otherType === 'null') return str === 'null'
  return false
}

/** Stable fingerprint for deep equality (key order independent). */
export function fingerprint(v: unknown, o: Pick<JsonDiffOptions, 'ignoreStringCase'>): string {
  const t = jsonTypeOf(v)
  switch (t) {
    case 'null':
      return 'n'
    case 'boolean':
      return v ? 'T' : 'F'
    case 'number':
      return '#' + canonicalNumber(numberText(v))
    case 'string':
      return 's' + JSON.stringify(o.ignoreStringCase ? (v as string).toLowerCase() : v)
    case 'array':
      return '[' + (v as unknown[]).map((x) => fingerprint(x, o)).join(',') + ']'
    default: {
      const obj = v as Record<string, unknown>
      return (
        '{' +
        Object.keys(obj)
          .sort()
          .map((k) => JSON.stringify(k) + ':' + fingerprint(obj[k], o))
          .join(',') +
        '}'
      )
    }
  }
}

/**
 * Structural hash (64 bits as two 32-bit FNV-1a lanes), key-order independent, cached per
 * object. Linear time and constant memory per node — unlike building fingerprint strings,
 * which is quadratic in depth. Used for array alignment and to skip equal subtrees.
 */
export function createHasher(o: Pick<JsonDiffOptions, 'ignoreStringCase'>) {
  const cache = new WeakMap<object, string>()
  const mixStr = (h1: number, h2: number, s: string): [number, number] => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i)
      h1 = Math.imul(h1 ^ c, 16777619)
      h2 = Math.imul(h2 ^ c, 2246822519)
    }
    return [h1, h2]
  }
  const hash = (v: unknown): string => {
    const t = jsonTypeOf(v)
    if (t !== 'object' && t !== 'array') {
      let s: string
      if (t === 'string') s = 's' + (o.ignoreStringCase ? (v as string).toLowerCase() : (v as string))
      else if (t === 'number') s = '#' + canonicalNumber(numberText(v))
      else s = t === 'null' ? 'n' : v ? 'T' : 'F'
      // Short primitives are their own key (no collisions possible).
      if (s.length <= 24) return s
      const [a, b] = mixStr(0x811c9dc5, 0x9747b28c, s)
      return `~${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}`
    }
    const obj = v as object
    const hit = cache.get(obj)
    if (hit !== undefined) return hit
    let h1 = t === 'array' ? 0x01000193 : 0x050c5d1f
    let h2 = t === 'array' ? 0x2c1b3c6d : 0x297a2d39
    if (t === 'array') {
      for (const x of v as unknown[]) [h1, h2] = mixStr(h1, h2, hash(x) + ',')
    } else {
      const rec = v as Record<string, unknown>
      for (const k of Object.keys(rec).sort()) [h1, h2] = mixStr(h1, h2, JSON.stringify(k) + ':' + hash(rec[k]) + ',')
    }
    const out = `${t === 'array' ? 'A' : 'O'}${(h1 >>> 0).toString(36)}.${(h2 >>> 0).toString(36)}`
    cache.set(obj, out)
    return out
  }
  return hash
}

const PREVIEW_MAX = 160

export function previewValue(v: unknown): string {
  const t = jsonTypeOf(v)
  if (t === 'object') {
    const n = Object.keys(v as object).length
    return n === 0 ? '{}' : `{${n}}`
  }
  if (t === 'array') {
    const n = (v as unknown[]).length
    return n === 0 ? '[]' : `[${n}]`
  }
  if (t === 'number') return numberText(v)
  const s = JSON.stringify(v)
  return s.length > PREVIEW_MAX ? s.slice(0, PREVIEW_MAX - 1) + '…"' : s
}

function countNodes(v: unknown): number {
  let n = 0
  const stack = [v]
  while (stack.length) {
    const x = stack.pop()
    n++
    const t = jsonTypeOf(x)
    if (t === 'array') for (const c of x as unknown[]) stack.push(c)
    else if (t === 'object') for (const c of Object.values(x as object)) stack.push(c)
  }
  return n
}

// ── Diff ────────────────────────────────────────────────────────────────────────

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

const ABSENT = Symbol('absent')
type Val = unknown | typeof ABSENT

class Builder {
  depth: number[] = []
  status: number[] = []
  parent: number[] = []
  end: number[] = []
  changesIn: number[] = []
  keys: string[] = []
  leftKind: string[] = []
  rightKind: string[] = []
  leftPreview: string[] = []
  rightPreview: string[] = []
  changeIndex: number[] = []

  add(depth: number, parent: number, key: string, left: Val, right: Val, status: NodeStatus): number {
    const i = this.depth.length
    this.depth.push(depth)
    this.status.push(status)
    this.parent.push(parent)
    this.end.push(i + 1)
    this.changesIn.push(0)
    this.keys.push(key)
    this.leftKind.push(left === ABSENT ? '' : jsonTypeOf(left))
    this.rightKind.push(right === ABSENT ? '' : jsonTypeOf(right))
    this.leftPreview.push(left === ABSENT ? '' : previewValue(left))
    this.rightPreview.push(right === ABSENT ? '' : previewValue(right))
    this.changeIndex.push(-1)
    return i
  }

  table(): TreeTable {
    return {
      depth: Uint16Array.from(this.depth),
      status: Uint8Array.from(this.status),
      parent: Int32Array.from(this.parent),
      end: Int32Array.from(this.end),
      changes: Int32Array.from(this.changesIn),
      keys: this.keys,
      leftKind: this.leftKind,
      rightKind: this.rightKind,
      leftPreview: this.leftPreview,
      rightPreview: this.rightPreview,
      changeIndex: Int32Array.from(this.changeIndex),
    }
  }
}

export function diffJson(left: unknown, right: unknown, options: Partial<JsonDiffOptions> = {}): JsonDiffResult {
  const t0 = now()
  const o: JsonDiffOptions = { ...DEFAULT_JSON_DIFF_OPTIONS, ...options }
  const ignore = o.ignorePaths.map((p) => p.trim()).filter(Boolean).map(parsePathPattern)
  const changes: JsonChange[] = []
  const b = new Builder()
  const stats = { added: 0, removed: 0, modified: 0, typeChanged: 0, reordered: 0, ignored: 0, nodesLeft: 0, nodesRight: 0 }

  const isIgnored = (path: PathSeg[]) => ignore.length > 0 && ignore.some((m) => pathMatches(m, path))

  const record = (node: number, type: ChangeType, path: PathSeg[], l: Val, r: Val) => {
    const ch: JsonChange = {
      type,
      path: path.slice(),
      pathText: pathToText(path),
      leftPointer: l === ABSENT ? null : pointer(path, 'left'),
      rightPointer: r === ABSENT ? null : pointer(path, 'right'),
    }
    if (l !== ABSENT) {
      ch.left = l
      ch.leftType = jsonTypeOf(l)
    }
    if (r !== ABSENT) {
      ch.right = r
      ch.rightType = jsonTypeOf(r)
    }
    changes.push(ch)
    if (node >= 0) b.changeIndex[node] = changes.length - 1
    if (type === 'added') stats.added++
    else if (type === 'removed') stats.removed++
    else if (type === 'modified') stats.modified++
    else if (type === 'type') stats.typeChanged++
    else stats.reordered++
  }

  const hash = createHasher(o)
  const canSkipEqual = !o.detectKeyOrder

  /**
   * Adds a subtree that needs no comparison (one-sided, or known-equal) as tree rows.
   * Children are listed only while the row budget allows.
   */
  const addSubtree = (v: unknown, depth: number, parent: number, key: string, side: 'left' | 'right' | 'both') => {
    const status = side === 'left' ? NodeStatus.Removed : side === 'right' ? NodeStatus.Added : NodeStatus.Equal
    const node = b.add(depth, parent, key, side === 'right' ? ABSENT : v, side === 'left' ? ABSENT : v, status)
    const t = jsonTypeOf(v)
    if (t === 'array' || t === 'object') {
      if (b.depth.length >= TREE_ROW_BUDGET) {
        if (status === NodeStatus.Equal) b.status[node] = NodeStatus.Elided
      } else if (t === 'array') (v as unknown[]).forEach((x, i) => addSubtree(x, depth + 1, node, `[${i}]`, side))
      else for (const [k, x] of Object.entries(v as object)) addSubtree(x, depth + 1, node, k, side)
    }
    b.end[node] = b.depth.length
    return node
  }

  // Subtree change counts are aggregated bottom-up after the walk.
  const finish = (node: number, own: number) => {
    b.end[node] = b.depth.length
    b.changesIn[node] += own
  }

  const walk = (l: Val, r: Val, path: PathSeg[], depth: number, parent: number, key: string) => {
    if (isIgnored(path)) {
      const node = b.add(depth, parent, key, l, r, NodeStatus.Ignored)
      b.end[node] = b.depth.length
      stats.ignored++
      return
    }
    if (l === ABSENT) {
      const node = addSubtree(r, depth, parent, key, 'right')
      record(node, 'added', path, ABSENT, r)
      b.changesIn[node] = 1
      return
    }
    if (r === ABSENT) {
      const node = addSubtree(l, depth, parent, key, 'left')
      record(node, 'removed', path, l, ABSENT)
      b.changesIn[node] = 1
      return
    }
    const tl = jsonTypeOf(l)
    const tr = jsonTypeOf(r)
    if (tl !== tr) {
      if (o.looseTypes && tl !== 'object' && tl !== 'array' && tr !== 'object' && tr !== 'array' && looseEqual(l, r)) {
        const node = b.add(depth, parent, key, l, r, NodeStatus.Equal)
        b.end[node] = b.depth.length
        return
      }
      const node = b.add(depth, parent, key, l, r, NodeStatus.TypeChanged)
      b.end[node] = b.depth.length
      b.changesIn[node] = 1
      record(node, 'type', path, l, r)
      return
    }
    if ((tl === 'object' || tl === 'array') && canSkipEqual && hash(l) === hash(r)) {
      // Structurally identical subtree: no need to compare node by node.
      addSubtree(l, depth, parent, key, 'both')
      return
    }
    if (tl === 'object') {
      const node = b.add(depth, parent, key, l, r, NodeStatus.Equal)
      const lo = l as Record<string, unknown>
      const ro = r as Record<string, unknown>
      const lk = Object.keys(lo)
      const rk = Object.keys(ro)
      const rset = new Set(rk)
      const lset = new Set(lk)
      // Left order first, then keys only in right (in their order).
      for (const k of lk) {
        path.push(k)
        walk(lo[k], rset.has(k) ? ro[k] : ABSENT, path, depth + 1, node, k)
        path.pop()
      }
      for (const k of rk) {
        if (lset.has(k)) continue
        path.push(k)
        walk(ABSENT, ro[k], path, depth + 1, node, k)
        path.pop()
      }
      let own = 0
      if (o.detectKeyOrder) {
        const commonL = lk.filter((k) => rset.has(k))
        const commonR = rk.filter((k) => lset.has(k))
        if (commonL.some((k, i) => k !== commonR[i])) {
          record(node, 'order', path, l, r)
          own = 1
        }
      }
      finish(node, own)
      return
    }
    if (tl === 'array') {
      const node = b.add(depth, parent, key, l, r, NodeStatus.Equal)
      diffArray(l as unknown[], r as unknown[], path, depth + 1, node)
      finish(node, 0)
      return
    }
    // Primitives.
    let equal: boolean
    if (tl === 'number') equal = numEqual(l, r)
    else if (tl === 'string' && o.ignoreStringCase) equal = (l as string).toLowerCase() === (r as string).toLowerCase()
    else equal = l === r || (isLosslessNumber(l) && isLosslessNumber(r) && numEqual(l, r))
    const node = b.add(depth, parent, key, l, r, equal ? NodeStatus.Equal : NodeStatus.Modified)
    b.end[node] = b.depth.length
    if (!equal) {
      b.changesIn[node] = 1
      record(node, 'modified', path, l, r)
    }
  }

  const diffArray = (la: unknown[], ra: unknown[], path: PathSeg[], depth: number, parent: number) => {
    const pairIdx = (li: number, ri: number) => {
      // Elements that moved keep accurate per-side indices for JSON Pointers.
      path.push(li === ri ? li : { key: '#', value: String(li), leftIndex: li, rightIndex: ri })
      walk(la[li], ra[ri], path, depth, parent, li === ri ? `[${li}]` : `[${li}→${ri}]`)
      path.pop()
    }
    const leftOnly = (li: number) => {
      path.push(li)
      walk(la[li], ABSENT, path, depth, parent, `[${li}]`)
      path.pop()
    }
    const rightOnly = (ri: number) => {
      path.push(ri)
      walk(ABSENT, ra[ri], path, depth, parent, `[${ri}]`)
      path.pop()
    }

    if (o.arrayMatch === 'key') {
      const keyOf = (v: unknown): string | null => {
        if (jsonTypeOf(v) !== 'object') return null
        for (const k of o.arrayKeys) {
          const x = (v as Record<string, unknown>)[k]
          if (x !== undefined && x !== null && jsonTypeOf(x) !== 'object' && jsonTypeOf(x) !== 'array') return `${k}=${jsonTypeOf(x) === 'string' ? x : numberText(x)}`
        }
        return null
      }
      const rightByKey = new Map<string, number>()
      ra.forEach((v, i) => {
        const k = keyOf(v)
        if (k !== null && !rightByKey.has(k)) rightByKey.set(k, i)
      })
      const usedRight = new Set<number>()
      const usableKeys = la.some((v) => keyOf(v) !== null)
      if (usableKeys) {
        la.forEach((v, li) => {
          const k = keyOf(v)
          const ri = k !== null ? rightByKey.get(k) : undefined
          if (ri !== undefined && !usedRight.has(ri)) {
            usedRight.add(ri)
            const eq = k!.indexOf('=')
            const seg: PathSeg = { key: k!.slice(0, eq), value: k!.slice(eq + 1), leftIndex: li, rightIndex: ri }
            path.push(seg)
            walk(v, ra[ri], path, depth, parent, `[${k}]`)
            path.pop()
          } else if (k === null && li < ra.length && !usedRight.has(li) && keyOf(ra[li]) === null) {
            usedRight.add(li)
            pairIdx(li, li)
          } else leftOnly(li)
        })
        ra.forEach((_, ri) => {
          if (!usedRight.has(ri)) rightOnly(ri)
        })
        return
      }
      // No identifier present — fall back to smart matching.
    }

    if (o.ignoreArrayOrder) {
      const fpR = ra.map((v) => hash(v))
      const pool = new Map<string, number[]>()
      fpR.forEach((f, i) => (pool.get(f) ?? pool.set(f, []).get(f)!).push(i))
      const unmatchedL: number[] = []
      const matchedR = new Set<number>()
      la.forEach((v, li) => {
        const list = pool.get(hash(v))
        const ri = list?.shift()
        if (ri !== undefined) {
          matchedR.add(ri)
          pairIdx(li, ri)
        } else unmatchedL.push(li)
      })
      const unmatchedR = ra.map((_, i) => i).filter((i) => !matchedR.has(i))
      const pairs = Math.min(unmatchedL.length, unmatchedR.length)
      for (let k = 0; k < pairs; k++) pairIdx(unmatchedL[k], unmatchedR[k])
      for (let k = pairs; k < unmatchedL.length; k++) leftOnly(unmatchedL[k])
      for (let k = pairs; k < unmatchedR.length; k++) rightOnly(unmatchedR[k])
      return
    }

    if (o.arrayMatch === 'index') {
      const n = Math.max(la.length, ra.length)
      for (let i = 0; i < n; i++) {
        if (i < la.length && i < ra.length) pairIdx(i, i)
        else if (i < la.length) leftOnly(i)
        else rightOnly(i)
      }
      return
    }

    // Smart: align deep-equal elements with an LCS, pair the rest positionally.
    const ids = new Map<string, number>()
    const intern = (v: unknown) => {
      const f = hash(v)
      let id = ids.get(f)
      if (id === undefined) {
        id = ids.size
        ids.set(f, id)
      }
      return id
    }
    const sa = Int32Array.from(la, intern)
    const sb = Int32Array.from(ra, intern)
    const { ops } = diffSequences(sa, sb, { deadline: now() + 2000 })
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]
      if (op.type === OpType.Equal) {
        for (let k = 0; k < op.len; k++) pairIdx(op.aStart + k, op.bStart + k)
      } else if (op.type === OpType.Delete) {
        const next = ops[i + 1]
        const ins = next?.type === OpType.Insert ? next : null
        if (ins) i++
        const pairs = alignBlock(la, op.aStart, op.len, ra, ins?.bStart ?? 0, ins?.len ?? 0, hash)
        // Emit in order: walk both sides, pairing where aligned.
        let li = op.aStart
        let ri = ins?.bStart ?? 0
        const aEnd = op.aStart + op.len
        const bEnd = (ins?.bStart ?? 0) + (ins?.len ?? 0)
        for (const [pa, pb] of pairs) {
          while (li < pa) leftOnly(li++)
          while (ri < pb) rightOnly(ri++)
          pairIdx(li++, ri++)
        }
        while (li < aEnd) leftOnly(li++)
        while (ri < bEnd) rightOnly(ri++)
      } else {
        for (let k = 0; k < op.len; k++) rightOnly(op.bStart + k)
      }
    }
  }

  walk(left, right, [], 0, -1, '$')
  for (let i = b.depth.length - 1; i >= 0; i--) {
    if (b.changesIn[i] > 0 && b.status[i] === NodeStatus.Equal) b.status[i] = NodeStatus.Contains
    const p = b.parent[i]
    if (p >= 0) b.changesIn[p] += b.changesIn[i]
  }
  stats.nodesLeft = countNodes(left)
  stats.nodesRight = countNodes(right)
  return { changes, tree: b.table(), stats, identical: changes.length === 0, elapsedMs: now() - t0 }
}

/**
 * Similarity (0–1) of two values for pairing inside a change block: objects by the share
 * of top-level keys with equal values (plus shared keys), arrays by length/overlap,
 * primitives only when equal-ish types.
 */
function similarity(a: unknown, b: unknown, hash: (v: unknown) => string): number {
  const ta = jsonTypeOf(a)
  const tb = jsonTypeOf(b)
  if (ta !== tb) return 0
  if (ta === 'object') {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)])
    if (keys.size === 0) return 1
    let score = 0
    for (const k of keys) {
      if (!(k in ao) || !(k in bo)) continue
      score += hash(ao[k]) === hash(bo[k]) ? 1 : 0.25
    }
    return score / keys.size
  }
  if (ta === 'array') {
    const aa = a as unknown[]
    const ba = b as unknown[]
    if (!aa.length && !ba.length) return 1
    const fb = new Set(ba.map(hash))
    const common = aa.filter((x) => fb.has(hash(x))).length
    return common / Math.max(aa.length, ba.length)
  }
  // Different primitive values of the same type: a weak pairing signal.
  return 0.3
}

/**
 * Order-preserving alignment of deleted vs inserted elements in a change block, maximizing
 * total similarity (DP). Returns paired [leftIndex, rightIndex] in increasing order.
 */
function alignBlock(la: unknown[], aStart: number, aLen: number, ra: unknown[], bStart: number, bLen: number, hash: (v: unknown) => string): [number, number][] {
  if (!aLen || !bLen) return []
  // Large blocks: fall back to positional pairing.
  if (aLen * bLen > 40_000) {
    const n = Math.min(aLen, bLen)
    return Array.from({ length: n }, (_, k) => [aStart + k, bStart + k] as [number, number])
  }
  const MIN = 0.3
  const sim = new Float64Array(aLen * bLen)
  for (let i = 0; i < aLen; i++) for (let j = 0; j < bLen; j++) sim[i * bLen + j] = similarity(la[aStart + i], ra[bStart + j], hash)
  // dp[i][j] = best score aligning first i of A with first j of B.
  const W = bLen + 1
  const dp = new Float64Array((aLen + 1) * W)
  for (let i = 1; i <= aLen; i++) {
    for (let j = 1; j <= bLen; j++) {
      const s = sim[(i - 1) * bLen + (j - 1)]
      const take = s >= MIN ? dp[(i - 1) * W + (j - 1)] + s : -1
      dp[i * W + j] = Math.max(dp[(i - 1) * W + j], dp[i * W + (j - 1)], take)
    }
  }
  const pairs: [number, number][] = []
  let i = aLen
  let j = bLen
  while (i > 0 && j > 0) {
    const s = sim[(i - 1) * bLen + (j - 1)]
    if (s >= MIN && dp[i * W + j] === dp[(i - 1) * W + (j - 1)] + s) {
      pairs.push([aStart + i - 1, bStart + j - 1])
      i--
      j--
    } else if (dp[i * W + j] === dp[(i - 1) * W + j]) i--
    else j--
  }
  return pairs.reverse()
}

// ── JSON Patch (RFC 6902) ───────────────────────────────────────────────────────

export interface JsonPatchOp {
  op: 'add' | 'remove' | 'replace'
  path: string
  value?: unknown
}

/**
 * Generates an RFC 6902 patch that transforms left into right. Computed independently of
 * display options (always exact: index-based arrays via LCS, no ignored paths), so the
 * patch is guaranteed to apply.
 */
export function jsonPatch(left: unknown, right: unknown): JsonPatchOp[] {
  const ops: JsonPatchOp[] = []
  const hash = createHasher({ ignoreStringCase: false })
  const rec = (l: unknown, r: unknown, ptr: string) => {
    const tl = jsonTypeOf(l)
    const tr = jsonTypeOf(r)
    if (tl !== tr) {
      ops.push({ op: 'replace', path: ptr, value: r })
      return
    }
    if (tl === 'object') {
      const lo = l as Record<string, unknown>
      const ro = r as Record<string, unknown>
      for (const k of Object.keys(lo)) {
        if (!(k in ro)) ops.push({ op: 'remove', path: `${ptr}/${escPtr(k)}` })
        else rec(lo[k], ro[k], `${ptr}/${escPtr(k)}`)
      }
      for (const k of Object.keys(ro)) if (!(k in lo)) ops.push({ op: 'add', path: `${ptr}/${escPtr(k)}`, value: ro[k] })
      return
    }
    if (tl === 'array') {
      const la = l as unknown[]
      const ra = r as unknown[]
      const ids = new Map<string, number>()
      const intern = (v: unknown) => {
        const f = hash(v)
        let id = ids.get(f)
        if (id === undefined) ids.set(f, (id = ids.size))
        return id
      }
      const { ops: seq } = diffSequences(Int32Array.from(la, intern), Int32Array.from(ra, intern))
      // Walk with a cursor into the evolving array.
      let cur = 0
      for (let i = 0; i < seq.length; i++) {
        const op = seq[i]
        if (op.type === OpType.Equal) cur += op.len
        else if (op.type === OpType.Delete) {
          const next = seq[i + 1]
          const ins = next?.type === OpType.Insert ? next : null
          const pairs = Math.min(op.len, ins?.len ?? 0)
          for (let k = 0; k < pairs; k++) rec(la[op.aStart + k], ra[ins!.bStart + k], `${ptr}/${cur++}`)
          for (let k = pairs; k < op.len; k++) ops.push({ op: 'remove', path: `${ptr}/${cur}` })
          if (ins) {
            for (let k = pairs; k < ins.len; k++) ops.push({ op: 'add', path: `${ptr}/${cur++}`, value: ra[ins.bStart + k] })
            i++
          }
        } else {
          for (let k = 0; k < op.len; k++) ops.push({ op: 'add', path: `${ptr}/${cur++}`, value: ra[op.bStart + k] })
        }
      }
      return
    }
    const equal = tl === 'number' ? numEqual(l, r) : l === r
    if (!equal) ops.push({ op: 'replace', path: ptr, value: r })
  }
  rec(left, right, '')
  return ops
}

/** Minimal RFC 6902 applier (add/remove/replace) — used to verify generated patches. */
export function applyJsonPatch(doc: unknown, patch: JsonPatchOp[]): unknown {
  let root = structuredClone(doc)
  for (const p of patch) {
    if (p.path === '') {
      if (p.op === 'remove') root = undefined
      else root = structuredClone(p.value)
      continue
    }
    const segs = p.path
      .split('/')
      .slice(1)
      .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    let parent = root as Record<string, unknown> | unknown[]
    for (let i = 0; i < segs.length - 1; i++) parent = (parent as Record<string, unknown>)[segs[i]] as Record<string, unknown>
    const last = segs[segs.length - 1]
    if (Array.isArray(parent)) {
      const idx = last === '-' ? parent.length : Number(last)
      if (p.op === 'add') parent.splice(idx, 0, structuredClone(p.value))
      else if (p.op === 'remove') parent.splice(idx, 1)
      else parent[idx] = structuredClone(p.value)
    } else {
      if (p.op === 'remove') delete parent[last]
      else parent[last] = structuredClone(p.value)
    }
  }
  return root
}
