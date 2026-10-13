/**
 * Flat, pre-order tree index of a JSON value for virtualized tree rendering.
 *
 * Stored as parallel arrays (struct-of-arrays) so that a 500k-node document is a handful of
 * typed arrays plus two string arrays — cheap to build, cheap to send from a worker
 * (structured clone) and O(visible) to render. Node 0 is the root.
 */
import { isLosslessNumber } from '@/engines/json/parse'
import type { PathSegment } from './paths'

export const NodeType = {
  Object: 0,
  Array: 1,
  String: 2,
  Number: 3,
  Boolean: 4,
  Null: 5,
} as const

export const NODE_TYPE_NAMES = ['object', 'array', 'string', 'number', 'boolean', 'null'] as const

export interface TreeIndex {
  size: number
  /** Parent index (-1 for root). */
  parent: Int32Array
  depth: Int32Array
  type: Uint8Array
  /** Number of direct children (objects / arrays). */
  childCount: Int32Array
  /** Pre-order index just past this node's last descendant. */
  end: Int32Array
  /** Object key, or the decimal index for array items ("" for root). */
  keys: string[]
  /** 1 when the key is an array index. */
  isIndex: Uint8Array
  /** Primitive text: raw string value, number digits, "true"/"false"/"null"; "" for containers. */
  values: string[]
  maxDepth: number
}

export class TreeTooLargeError extends Error {
  constructor(limit: number) {
    super(`The document has more than ${limit.toLocaleString('en-US')} nodes, which is beyond what the tree view can hold in memory.`)
    this.name = 'TreeTooLargeError'
  }
}

/** Default node cap: ~5M nodes keeps memory below a few hundred MB. */
export const MAX_TREE_NODES = 5_000_000

function countNodes(v: unknown, limit: number): number {
  // Iterative to survive very deep documents.
  let n = 0
  const stack: unknown[] = [v]
  while (stack.length) {
    const cur = stack.pop()
    n++
    if (n > limit) throw new TreeTooLargeError(limit)
    if (cur !== null && typeof cur === 'object' && !isLosslessNumber(cur)) {
      if (Array.isArray(cur)) for (let i = 0; i < cur.length; i++) stack.push(cur[i])
      else for (const k in cur as object) if (Object.prototype.hasOwnProperty.call(cur, k)) stack.push((cur as Record<string, unknown>)[k])
    }
  }
  return n
}

export function buildTree(root: unknown, limit = MAX_TREE_NODES): TreeIndex {
  const size = countNodes(root, limit)
  const parent = new Int32Array(size)
  const depth = new Int32Array(size)
  const type = new Uint8Array(size)
  const childCount = new Int32Array(size)
  const end = new Int32Array(size)
  const isIndex = new Uint8Array(size)
  const keys: string[] = new Array(size)
  const values: string[] = new Array(size)
  let maxDepth = 0
  let next = 0

  // Explicit stack of frames: [value, parent, depth, key, isIndex]; children pushed in reverse
  // so pre-order matches document order. `end` is fixed up after the walk.
  type Frame = { v: unknown; p: number; d: number; k: string; ix: number }
  const stack: Frame[] = [{ v: root, p: -1, d: 0, k: '', ix: 0 }]
  while (stack.length) {
    const f = stack.pop()!
    const i = next++
    parent[i] = f.p
    depth[i] = f.d
    keys[i] = f.k
    isIndex[i] = f.ix
    if (f.d > maxDepth) maxDepth = f.d
    const v = f.v
    if (v === null) {
      type[i] = NodeType.Null
      values[i] = 'null'
    } else if (typeof v === 'string') {
      type[i] = NodeType.String
      values[i] = v
    } else if (typeof v === 'number') {
      type[i] = NodeType.Number
      values[i] = Number.isFinite(v) ? String(v) : 'null'
    } else if (typeof v === 'boolean') {
      type[i] = NodeType.Boolean
      values[i] = v ? 'true' : 'false'
    } else if (isLosslessNumber(v)) {
      type[i] = NodeType.Number
      values[i] = (v as { value: string }).value
    } else if (Array.isArray(v)) {
      type[i] = NodeType.Array
      values[i] = ''
      childCount[i] = v.length
      for (let c = v.length - 1; c >= 0; c--) stack.push({ v: v[c], p: i, d: f.d + 1, k: String(c), ix: 1 })
    } else if (typeof v === 'object') {
      type[i] = NodeType.Object
      values[i] = ''
      const ks = Object.keys(v as object)
      childCount[i] = ks.length
      for (let c = ks.length - 1; c >= 0; c--) stack.push({ v: (v as Record<string, unknown>)[ks[c]], p: i, d: f.d + 1, k: ks[c], ix: 0 })
    } else {
      type[i] = NodeType.Null
      values[i] = 'null'
    }
  }
  // end[i] = i + 1 + descendants. Walk backwards: a node's end is the max end of its children.
  for (let i = size - 1; i >= 0; i--) {
    if (end[i] < i + 1) end[i] = i + 1
    const p = parent[i]
    if (p >= 0 && end[i] > end[p]) end[p] = end[i]
  }
  return { size, parent, depth, type, childCount, end, keys, isIndex, values, maxDepth }
}

export const isContainer = (t: TreeIndex, i: number) => t.type[i] <= NodeType.Array

/** Indices of the visible rows given a per-node expanded flag (root's children shown when root is expanded). */
export function visibleRows(t: TreeIndex, expanded: Uint8Array): Int32Array {
  const out = new Int32Array(t.size)
  let n = 0
  let i = 0
  while (i < t.size) {
    out[n++] = i
    if (t.type[i] <= NodeType.Array && !expanded[i]) i = t.end[i]
    else i++
  }
  return out.subarray(0, n)
}

/** Expanded flags for "expand to depth N" (N = 0 → only the root row, collapsed). */
export function expandToDepth(t: TreeIndex, depth: number): Uint8Array {
  const e = new Uint8Array(t.size)
  for (let i = 0; i < t.size; i++) if (t.type[i] <= NodeType.Array && t.depth[i] < depth) e[i] = 1
  return e
}

export function expandAll(t: TreeIndex): Uint8Array {
  return expandToDepth(t, Number.MAX_SAFE_INTEGER)
}

/** Marks every ancestor of `i` expanded (mutates). Returns true if anything changed. */
export function expandAncestors(t: TreeIndex, expanded: Uint8Array, i: number): boolean {
  let changed = false
  let p = t.parent[i]
  while (p >= 0) {
    if (!expanded[p]) {
      expanded[p] = 1
      changed = true
    }
    p = t.parent[p]
  }
  return changed
}

export function pathOf(t: TreeIndex, i: number): PathSegment[] {
  const segs: PathSegment[] = []
  let n = i
  while (n > 0) {
    segs.push(t.isIndex[n] ? Number(t.keys[n]) : t.keys[n])
    n = t.parent[n]
  }
  return segs.reverse()
}

export interface SearchOptions {
  keys: boolean
  values: boolean
  caseSensitive?: boolean
  /** Stop after this many matches (the count is reported as capped). */
  limit?: number
}

export interface SearchResult {
  matches: Int32Array
  capped: boolean
}

/** Substring search over keys and/or primitive values, in document order. */
export function searchTree(t: TreeIndex, query: string, opts: SearchOptions): SearchResult {
  const limit = opts.limit ?? 100_000
  if (!query) return { matches: new Int32Array(0), capped: false }
  const q = opts.caseSensitive ? query : query.toLowerCase()
  const buf: number[] = []
  for (let i = 0; i < t.size; i++) {
    let hit = false
    if (opts.keys && i > 0 && !t.isIndex[i]) {
      const k = t.keys[i]
      hit = (opts.caseSensitive ? k : k.toLowerCase()).includes(q)
    }
    if (!hit && opts.values && t.type[i] > NodeType.Array) {
      const v = t.values[i]
      hit = (opts.caseSensitive ? v : v.toLowerCase()).includes(q)
    }
    if (hit) {
      buf.push(i)
      if (buf.length >= limit) return { matches: Int32Array.from(buf), capped: true }
    }
  }
  return { matches: Int32Array.from(buf), capped: false }
}

/**
 * Serializes the subtree at `i` back to JSON text (numbers keep their original digits).
 * `indent` = 0 for minified.
 */
export function subtreeToJson(t: TreeIndex, i: number, indent = 2): string {
  const unit = ' '.repeat(indent)
  const nl = indent ? '\n' : ''
  const sep = indent ? ': ' : ':'
  const out: string[] = []
  const write = (n: number, pad: string) => {
    const ty = t.type[n]
    if (ty === NodeType.String) out.push(JSON.stringify(t.values[n]))
    else if (ty > NodeType.Array) out.push(t.values[n])
    else {
      const open = ty === NodeType.Array ? '[' : '{'
      const close = ty === NodeType.Array ? ']' : '}'
      if (t.childCount[n] === 0) {
        out.push(open + close)
        return
      }
      out.push(open)
      const inner = pad + unit
      let c = n + 1
      let first = true
      while (c < t.end[n]) {
        out.push((first ? '' : ',') + nl + inner)
        first = false
        if (ty === NodeType.Object) out.push(JSON.stringify(t.keys[c]) + sep)
        write(c, inner)
        c = t.end[c]
      }
      out.push(nl + pad + close)
    }
  }
  // Deep documents: recursion depth equals nesting depth, bounded by the parser's own limits.
  write(i, '')
  return out.join('')
}

/** Short single-line preview of a container, e.g. `{ id, name, … }` or `[3 items]`. */
export function containerPreview(t: TreeIndex, i: number, maxKeys = 4): string {
  if (t.type[i] === NodeType.Array) return ''
  const ks: string[] = []
  let c = i + 1
  while (c < t.end[i] && ks.length < maxKeys) {
    ks.push(t.keys[c])
    c = t.end[c]
  }
  if (!ks.length) return ''
  return ks.join(', ') + (t.childCount[i] > ks.length ? ', …' : '')
}

/** Counts per type, for status bars. */
export function typeCounts(t: TreeIndex): Record<(typeof NODE_TYPE_NAMES)[number], number> {
  const c = [0, 0, 0, 0, 0, 0]
  for (let i = 0; i < t.size; i++) c[t.type[i]]++
  return { object: c[0], array: c[1], string: c[2], number: c[3], boolean: c[4], null: c[5] }
}

/** JSON Pointer of every node, computed in one pre-order pass (O(n)). */
export function pointersOf(t: TreeIndex): string[] {
  const out: string[] = new Array(t.size)
  out[0] = ''
  for (let i = 1; i < t.size; i++) out[i] = out[t.parent[i]] + '/' + t.keys[i].replace(/~/g, '~0').replace(/\//g, '~1')
  return out
}

/**
 * Carries expansion state over to a re-parsed tree by matching pointers, so editing the source
 * keeps the branches the user opened. Returns null when the trees are too large to map cheaply.
 */
export function carryExpansion(prev: TreeIndex, prevExpanded: Uint8Array, next: TreeIndex, limit = 300_000): Uint8Array | null {
  if (prev.size > limit || next.size > limit) return null
  const prevPtr = pointersOf(prev)
  const open = new Set<string>()
  for (let i = 0; i < prev.size; i++) if (prevExpanded[i]) open.add(prevPtr[i])
  const nextPtr = pointersOf(next)
  const e = new Uint8Array(next.size)
  for (let i = 0; i < next.size; i++) if (next.type[i] <= NodeType.Array && open.has(nextPtr[i])) e[i] = 1
  return e
}

/** Node index for a pointer (linear; used to keep the selection across re-parses). */
export function nodeForPointer(t: TreeIndex, pointer: string): number {
  if (pointer === '') return 0
  const ptrs = pointersOf(t)
  return ptrs.indexOf(pointer)
}

/** Expands (or collapses) a node and its whole subtree. */
export function setSubtreeExpanded(t: TreeIndex, expanded: Uint8Array, node: number, open: boolean) {
  for (let i = node; i < t.end[node]; i++) if (t.type[i] <= NodeType.Array) expanded[i] = open ? 1 : 0
}
