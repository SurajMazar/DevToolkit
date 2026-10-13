/**
 * Line-based text diff producing compact, transferable row tables for a virtualized
 * side-by-side / unified viewer.
 */
import { diffSequences, OpType, type Op } from './myers'

export type WhitespaceMode = 'none' | 'trailing' | 'leading-trailing' | 'collapse' | 'all'

export interface TextDiffOptions {
  whitespace: WhitespaceMode
  ignoreCase: boolean
  ignoreBlankLines: boolean
  /** Compute budget in ms before falling back to a coarser (still valid) diff. */
  timeoutMs: number
}

export const DEFAULT_TEXT_DIFF_OPTIONS: TextDiffOptions = {
  whitespace: 'none',
  ignoreCase: false,
  ignoreBlankLines: false,
  timeoutMs: 8000,
}

/** Row kinds in the side-by-side table. */
export const enum RowKind {
  Equal = 0,
  /** Line only in A. */
  Removed = 1,
  /** Line only in B. */
  Added = 2,
  /** A line paired with a B line inside a change block. */
  Modified = 3,
  /** Line only in A that differs only by an ignored property (e.g. blank line). */
  IgnoredA = 4,
  IgnoredB = 5,
}

export interface Hunk {
  /** Row range in the side-by-side table. */
  rowStart: number
  rowEnd: number
  /** Row range in the unified table. */
  uRowStart: number
  uRowEnd: number
  aStart: number
  aCount: number
  bStart: number
  bCount: number
  added: number
  removed: number
  modified: number
}

export interface TextDiffResult {
  /** Side-by-side rows. */
  kinds: Uint8Array
  aIdx: Int32Array
  bIdx: Int32Array
  /** Unified rows: kind (0 equal, 1 removed, 2 added, 4/5 ignored), line index on its side, and for paired lines the unified row of its partner (-1 if none). */
  uKinds: Uint8Array
  uLine: Int32Array
  uPartner: Int32Array
  hunks: Hunk[]
  stats: {
    linesA: number
    linesB: number
    added: number
    removed: number
    modified: number
    unchanged: number
    /** Share of lines (0–1) that are unchanged, relative to the larger side. */
    similarity: number
  }
  identical: boolean
  approximate: boolean
  elapsedMs: number
}

/** Splits text into lines, removing the line terminator (\n, \r\n or \r). */
export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split(/\r\n|\n|\r/)
  // A trailing newline does not start a new (empty) line.
  if (lines.length > 1 && lines[lines.length - 1] === '' && /(\r\n|\n|\r)$/.test(text)) lines.pop()
  return lines
}

export function normalizeLine(line: string, o: Pick<TextDiffOptions, 'whitespace' | 'ignoreCase'>): string {
  let s = line
  switch (o.whitespace) {
    case 'trailing':
      s = s.replace(/\s+$/, '')
      break
    case 'leading-trailing':
      s = s.trim()
      break
    case 'collapse':
      s = s.trim().replace(/\s+/g, ' ')
      break
    case 'all':
      s = s.replace(/\s+/g, '')
      break
  }
  return o.ignoreCase ? s.toLowerCase() : s
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export function diffText(textA: string, textB: string, options: Partial<TextDiffOptions> = {}): TextDiffResult {
  const o = { ...DEFAULT_TEXT_DIFF_OPTIONS, ...options }
  const t0 = now()
  const linesA = splitLines(textA)
  const linesB = splitLines(textB)
  return diffLines(linesA, linesB, o, t0)
}

export function diffLines(linesA: string[], linesB: string[], o: TextDiffOptions, t0 = now()): TextDiffResult {
  // Intern normalized lines to integer ids.
  const ids = new Map<string, number>()
  const toIds = (lines: string[]) => {
    const out = new Int32Array(lines.length)
    for (let i = 0; i < lines.length; i++) {
      const key = normalizeLine(lines[i], o)
      let id = ids.get(key)
      if (id === undefined) {
        id = ids.size
        ids.set(key, id)
      }
      out[i] = id
    }
    return out
  }
  const idsA = toIds(linesA)
  const idsB = toIds(linesB)

  // Optionally drop blank lines from the comparison and map results back.
  let seqA: Int32Array = idsA
  let seqB: Int32Array = idsB
  let mapA: Int32Array | null = null
  let mapB: Int32Array | null = null
  if (o.ignoreBlankLines) {
    const keep = (lines: string[]) => {
      const idx: number[] = []
      for (let i = 0; i < lines.length; i++) if (lines[i].trim() !== '') idx.push(i)
      return Int32Array.from(idx)
    }
    mapA = keep(linesA)
    mapB = keep(linesB)
    seqA = mapA.map((i) => idsA[i])
    seqB = mapB.map((i) => idsB[i])
  }

  const { ops, approximate } = diffSequences(seqA, seqB, { deadline: t0 + o.timeoutMs })
  const fullOps = mapA && mapB ? expandBlankLineOps(ops, mapA, mapB, linesA.length, linesB.length) : (ops as ExtOp[])

  const built = buildRows(fullOps, linesA.length, linesB.length)
  const unchanged = built.stats.unchanged
  const larger = Math.max(linesA.length, linesB.length)
  return {
    ...built,
    stats: { ...built.stats, linesA: linesA.length, linesB: linesB.length, similarity: larger === 0 ? 1 : unchanged / larger },
    identical: built.hunks.length === 0,
    approximate,
    elapsedMs: now() - t0,
  }
}

/** Extended op: Ignored ops mark lines excluded from comparison (blank lines). */
type ExtOp = Op | { type: 'ignoredA' | 'ignoredB'; aStart: number; bStart: number; len: number }

function expandBlankLineOps(ops: Op[], mapA: Int32Array, mapB: Int32Array, lenA: number, lenB: number): ExtOp[] {
  const res: ExtOp[] = []
  let ai = 0 // next unconsumed line in full A
  let bi = 0
  const flushIgnored = (aUntil: number, bUntil: number) => {
    if (aUntil > ai) res.push({ type: 'ignoredA', aStart: ai, bStart: bi, len: aUntil - ai })
    if (bUntil > bi) res.push({ type: 'ignoredB', aStart: aUntil, bStart: bi, len: bUntil - bi })
    ai = Math.max(ai, aUntil)
    bi = Math.max(bi, bUntil)
  }
  for (const op of ops) {
    for (let k = 0; k < op.len; k++) {
      if (op.type === OpType.Equal) {
        const fa = mapA[op.aStart + k]
        const fb = mapB[op.bStart + k]
        flushIgnored(fa, fb)
        res.push({ type: OpType.Equal, aStart: fa, bStart: fb, len: 1 })
        ai = fa + 1
        bi = fb + 1
      } else if (op.type === OpType.Delete) {
        const fa = mapA[op.aStart + k]
        flushIgnored(fa, bi)
        res.push({ type: OpType.Delete, aStart: fa, bStart: bi, len: 1 })
        ai = fa + 1
      } else {
        const fb = mapB[op.bStart + k]
        flushIgnored(ai, fb)
        res.push({ type: OpType.Insert, aStart: ai, bStart: fb, len: 1 })
        bi = fb + 1
      }
    }
  }
  flushIgnored(lenA, lenB)
  // Merge consecutive same-type single-line ops.
  const merged: ExtOp[] = []
  for (const op of res) {
    const last = merged[merged.length - 1]
    if (last && last.type === op.type) {
      const contiguous =
        (op.type === OpType.Equal && last.aStart + last.len === op.aStart && last.bStart + last.len === op.bStart) ||
        ((op.type === OpType.Delete || op.type === 'ignoredA') && last.aStart + last.len === op.aStart) ||
        ((op.type === OpType.Insert || op.type === 'ignoredB') && last.bStart + last.len === op.bStart)
      if (contiguous) {
        last.len += op.len
        continue
      }
    }
    merged.push({ ...op })
  }
  return merged
}

function buildRows(ops: ExtOp[], lenA: number, lenB: number) {
  const cap = lenA + lenB
  const kinds = new Uint8Array(cap)
  const aIdx = new Int32Array(cap)
  const bIdx = new Int32Array(cap)
  const uKinds = new Uint8Array(cap)
  const uLine = new Int32Array(cap)
  const uPartner = new Int32Array(cap).fill(-1)
  let r = 0
  let u = 0
  const hunks: Hunk[] = []
  let added = 0
  let removed = 0
  let modified = 0
  let unchanged = 0
  let cur: Hunk | null = null

  const openHunk = (aStart: number, bStart: number) => {
    if (!cur) cur = { rowStart: r, rowEnd: r, uRowStart: u, uRowEnd: u, aStart, aCount: 0, bStart, bCount: 0, added: 0, removed: 0, modified: 0 }
    return cur
  }
  const closeHunk = () => {
    if (cur) {
      cur.rowEnd = r
      cur.uRowEnd = u
      hunks.push(cur)
      cur = null
    }
  }

  let i = 0
  while (i < ops.length) {
    const op = ops[i]
    if (op.type === OpType.Equal) {
      closeHunk()
      for (let k = 0; k < op.len; k++) {
        kinds[r] = RowKind.Equal
        aIdx[r] = op.aStart + k
        bIdx[r] = op.bStart + k
        r++
        uKinds[u] = RowKind.Equal
        uLine[u] = op.aStart + k
        u++
      }
      unchanged += op.len
      i++
      continue
    }
    if (op.type === 'ignoredA' || op.type === 'ignoredB') {
      for (let k = 0; k < op.len; k++) {
        const isA = op.type === 'ignoredA'
        kinds[r] = isA ? RowKind.IgnoredA : RowKind.IgnoredB
        aIdx[r] = isA ? op.aStart + k : -1
        bIdx[r] = isA ? -1 : op.bStart + k
        r++
        uKinds[u] = isA ? RowKind.IgnoredA : RowKind.IgnoredB
        uLine[u] = isA ? op.aStart + k : op.bStart + k
        u++
      }
      i++
      continue
    }
    // A change block: deletions (if any) followed by insertions (if any).
    let del: ExtOp | null = null
    let ins: ExtOp | null = null
    if (op.type === OpType.Delete) {
      del = op
      if (ops[i + 1]?.type === OpType.Insert) ins = ops[i + 1]
    } else ins = op
    i += (del ? 1 : 0) + (ins ? 1 : 0)
    const h = openHunk(del ? del.aStart : ins!.aStart, ins ? ins.bStart : del!.bStart)
    const dLen = del?.len ?? 0
    const iLen = ins?.len ?? 0
    const pairs = Math.min(dLen, iLen)
    // Side-by-side rows.
    for (let k = 0; k < Math.max(dLen, iLen); k++) {
      if (k < pairs) {
        kinds[r] = RowKind.Modified
        aIdx[r] = del!.aStart + k
        bIdx[r] = ins!.bStart + k
      } else if (k < dLen) {
        kinds[r] = RowKind.Removed
        aIdx[r] = del!.aStart + k
        bIdx[r] = -1
      } else {
        kinds[r] = RowKind.Added
        aIdx[r] = -1
        bIdx[r] = ins!.bStart + k
      }
      r++
    }
    // Unified rows: all removed lines, then all added lines; pair partners.
    const uDelStart = u
    for (let k = 0; k < dLen; k++) {
      uKinds[u] = RowKind.Removed
      uLine[u] = del!.aStart + k
      u++
    }
    const uInsStart = u
    for (let k = 0; k < iLen; k++) {
      uKinds[u] = RowKind.Added
      uLine[u] = ins!.bStart + k
      u++
    }
    for (let k = 0; k < pairs; k++) {
      uPartner[uDelStart + k] = uInsStart + k
      uPartner[uInsStart + k] = uDelStart + k
    }
    h.aCount += dLen
    h.bCount += iLen
    h.removed += dLen - pairs
    h.added += iLen - pairs
    h.modified += pairs
    removed += dLen
    added += iLen
    modified += pairs
  }
  closeHunk()

  return {
    kinds: kinds.slice(0, r),
    aIdx: aIdx.slice(0, r),
    bIdx: bIdx.slice(0, r),
    uKinds: uKinds.slice(0, u),
    uLine: uLine.slice(0, u),
    uPartner: uPartner.slice(0, u),
    hunks,
    stats: { added, removed, modified, unchanged },
  }
}

/** Builds a standard unified diff (git-style) with `context` lines around each hunk. */
export function toUnifiedPatch(linesA: string[], linesB: string[], result: Pick<TextDiffResult, 'uKinds' | 'uLine'>, opts: { context?: number; nameA?: string; nameB?: string } = {}): string {
  const context = opts.context ?? 3
  const { uKinds, uLine } = result
  const n = uKinds.length
  if (!n) return ''
  // Track the A/B line number at each unified row.
  const aAt = new Int32Array(n + 1)
  const bAt = new Int32Array(n + 1)
  let a = 0
  let b = 0
  for (let i = 0; i < n; i++) {
    aAt[i] = a
    bAt[i] = b
    const k = uKinds[i]
    if (k === RowKind.Equal) {
      a++
      b++
    } else if (k === RowKind.Removed || k === RowKind.IgnoredA) a++
    else b++
  }
  aAt[n] = a
  bAt[n] = b
  const isChange = (i: number) => uKinds[i] === RowKind.Removed || uKinds[i] === RowKind.Added
  const out: string[] = [`--- ${opts.nameA ?? 'original'}`, `+++ ${opts.nameB ?? 'modified'}`]
  let i = 0
  while (i < n) {
    while (i < n && !isChange(i)) i++
    if (i >= n) break
    let start = Math.max(0, i - context)
    let end = i
    // Extend the hunk while changes are within 2*context of each other.
    let j = i
    while (j < n) {
      if (isChange(j)) end = j + 1
      else if (j - end >= context * 2) break
      j++
    }
    end = Math.min(n, end + context)
    start = Math.max(0, start)
    const lines: string[] = []
    for (let k = start; k < end; k++) {
      const kind = uKinds[k]
      // Ignored lines (e.g. blank lines) are emitted as real edits so the patch still applies.
      if (kind === RowKind.Equal) lines.push(' ' + linesA[uLine[k]])
      else if (kind === RowKind.Removed || kind === RowKind.IgnoredA) lines.push('-' + linesA[uLine[k]])
      else lines.push('+' + linesB[uLine[k]])
    }
    const aCount = aAt[end] - aAt[start]
    const bCount = bAt[end] - bAt[start]
    const aStart = aCount === 0 ? aAt[start] : aAt[start] + 1
    const bStart = bCount === 0 ? bAt[start] : bAt[start] + 1
    out.push(`@@ -${aStart}${aCount === 1 ? '' : ',' + aCount} +${bStart}${bCount === 1 ? '' : ',' + bCount} @@`)
    out.push(...lines)
    i = end
  }
  return out.length > 2 ? out.join('\n') + '\n' : ''
}
