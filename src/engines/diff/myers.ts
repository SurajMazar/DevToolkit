/**
 * Sequence diff over integer arrays (lines/tokens already interned to ids).
 *
 * Algorithm: Myers' O((N+M)·D) diff using the linear-space "middle snake" bisection,
 * with common prefix/suffix stripping. For large inputs, unique-line anchors
 * (patience diff) split the problem into small independent pieces first.
 *
 * A deadline bounds total work. When it passes, remaining unresolved regions are
 * emitted as delete+insert blocks and the result is flagged `approximate` — the diff is
 * still a valid edit script (applying it to A yields B), just not minimal.
 */

export const enum OpType {
  Equal = 0,
  Delete = 1,
  Insert = 2,
}

export interface Op {
  type: OpType
  /** Start index in A (for Equal/Delete) — for Insert, the position in A where it applies. */
  aStart: number
  /** Start index in B (for Equal/Insert) — for Delete, the position in B where it applies. */
  bStart: number
  len: number
}

export interface DiffOptions {
  /** Absolute time (ms, performance.now based) after which to stop refining. */
  deadline?: number
  /** Use unique-line anchoring when a region exceeds this many elements. */
  anchorThreshold?: number
}

export interface SeqDiff {
  ops: Op[]
  approximate: boolean
}

class Emitter {
  ops: Op[] = []
  approximate = false
  push(type: OpType, aStart: number, bStart: number, len: number) {
    if (len <= 0) return
    const last = this.ops[this.ops.length - 1]
    if (last && last.type === type) {
      // Merge contiguous ops of the same type.
      if (type === OpType.Equal && last.aStart + last.len === aStart && last.bStart + last.len === bStart) {
        last.len += len
        return
      }
      if (type === OpType.Delete && last.aStart + last.len === aStart) {
        last.len += len
        return
      }
      if (type === OpType.Insert && last.bStart + last.len === bStart) {
        last.len += len
        return
      }
    }
    this.ops.push({ type, aStart, bStart, len })
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export function diffSequences(a: ArrayLike<number>, b: ArrayLike<number>, opts: DiffOptions = {}): SeqDiff {
  const out = new Emitter()
  const deadline = opts.deadline ?? Infinity
  const anchorThreshold = opts.anchorThreshold ?? 4000
  diffRegion(a, 0, a.length, b, 0, b.length, out, deadline, anchorThreshold, true)
  return { ops: normalizeOrder(out.ops), approximate: out.approximate }
}

/**
 * Within a change region, emit all deletions before insertions so consumers can pair
 * them up (Myers may interleave them).
 */
function normalizeOrder(ops: Op[]): Op[] {
  const res: Op[] = []
  let i = 0
  while (i < ops.length) {
    if (ops[i].type === OpType.Equal) {
      res.push(ops[i++])
      continue
    }
    let j = i
    const dels: Op[] = []
    const ins: Op[] = []
    while (j < ops.length && ops[j].type !== OpType.Equal) {
      ;(ops[j].type === OpType.Delete ? dels : ins).push(ops[j])
      j++
    }
    if (dels.length) {
      const first = dels[0]
      res.push({ type: OpType.Delete, aStart: first.aStart, bStart: (ins[0] ?? first).bStart, len: dels.reduce((n, o) => n + o.len, 0) })
    }
    if (ins.length) {
      const first = ins[0]
      const aAfter = dels.length ? dels[dels.length - 1].aStart + dels[dels.length - 1].len : first.aStart
      res.push({ type: OpType.Insert, aStart: aAfter, bStart: first.bStart, len: ins.reduce((n, o) => n + o.len, 0) })
    }
    i = j
  }
  return res
}

function diffRegion(
  a: ArrayLike<number>,
  aLo: number,
  aHi: number,
  b: ArrayLike<number>,
  bLo: number,
  bHi: number,
  out: Emitter,
  deadline: number,
  anchorThreshold: number,
  allowAnchors: boolean,
) {
  // Common prefix.
  let pre = 0
  while (aLo + pre < aHi && bLo + pre < bHi && a[aLo + pre] === b[bLo + pre]) pre++
  out.push(OpType.Equal, aLo, bLo, pre)
  aLo += pre
  bLo += pre
  // Common suffix.
  let suf = 0
  while (aHi - suf > aLo && bHi - suf > bLo && a[aHi - suf - 1] === b[bHi - suf - 1]) suf++
  const aEnd = aHi - suf
  const bEnd = bHi - suf

  if (aLo === aEnd) out.push(OpType.Insert, aLo, bLo, bEnd - bLo)
  else if (bLo === bEnd) out.push(OpType.Delete, aLo, bLo, aEnd - aLo)
  else if (allowAnchors && aEnd - aLo + (bEnd - bLo) > anchorThreshold) {
    anchoredDiff(a, aLo, aEnd, b, bLo, bEnd, out, deadline, anchorThreshold)
  } else if (aEnd - aLo + (bEnd - bLo) > 2000 && mostlyDisjoint(a, aLo, aEnd, b, bLo, bEnd)) {
    replaceBlock(aLo, aEnd, bLo, bEnd, out)
  } else {
    bisectDiff(a, aLo, aEnd, b, bLo, bEnd, out, deadline)
  }

  out.push(OpType.Equal, aEnd, bEnd, suf)
}

/**
 * True when two large regions share (almost) no elements. Their diff is then a plain
 * replacement; running Myers would cost O(N·D) only to find a handful of matches.
 * Exactly disjoint regions yield the minimal diff; near-disjoint ones are a close
 * approximation (≤ 1% of elements could have been kept).
 */
function mostlyDisjoint(a: ArrayLike<number>, aLo: number, aHi: number, b: ArrayLike<number>, bLo: number, bHi: number): boolean {
  const set = new Set<number>()
  for (let i = aLo; i < aHi; i++) set.add(a[i])
  let shared = 0
  const limit = Math.min(aHi - aLo, bHi - bLo) * 0.01
  for (let j = bLo; j < bHi; j++) if (set.has(b[j]) && ++shared > limit) return false
  return true
}

function replaceBlock(aLo: number, aHi: number, bLo: number, bHi: number, out: Emitter) {
  out.push(OpType.Delete, aLo, bLo, aHi - aLo)
  out.push(OpType.Insert, aHi, bLo, bHi - bLo)
}

function bisectDiff(a: ArrayLike<number>, aLo: number, aHi: number, b: ArrayLike<number>, bLo: number, bHi: number, out: Emitter, deadline: number) {
  // Iterative stack to avoid deep recursion on huge inputs.
  const stack: [number, number, number, number][] = [[aLo, aHi, bLo, bHi]]
  // Regions must be emitted in order, so process as a DFS that emits left before right.
  while (stack.length) {
    const [al, ah, bl, bh] = stack.pop()!
    // Strip prefix/suffix inside sub-regions.
    let pre = 0
    while (al + pre < ah && bl + pre < bh && a[al + pre] === b[bl + pre]) pre++
    let suf = 0
    while (ah - suf > al + pre && bh - suf > bl + pre && a[ah - suf - 1] === b[bh - suf - 1]) suf++
    const a0 = al + pre
    const b0 = bl + pre
    const a1 = ah - suf
    const b1 = bh - suf
    out.push(OpType.Equal, al, bl, pre)
    if (a0 === a1) out.push(OpType.Insert, a0, b0, b1 - b0)
    else if (b0 === b1) out.push(OpType.Delete, a0, b0, a1 - a0)
    else {
      const split = now() > deadline ? null : bisect(a, a0, a1 - a0, b, b0, b1 - b0, deadline)
      if (!split) {
        if (now() > deadline) out.approximate = true
        replaceBlock(a0, a1, b0, b1, out)
      } else {
        const [x, y] = split
        // Emit suffix after both halves: push right half, then left half (LIFO), with the
        // suffix equal emitted via a sentinel region of zero size.
        stack.push([a1, a1 + suf, b1, b1 + suf].map((v) => v) as [number, number, number, number])
        stack.push([a0 + x, a1, b0 + y, b1])
        stack.push([a0, a0 + x, b0, b0 + y])
        continue
      }
    }
    out.push(OpType.Equal, a1, b1, suf)
  }
}

/**
 * Finds the middle snake. Returns [x, y] split point relative to (aOff, bOff), or null
 * if the deadline passed / no split was found.
 */
function bisect(a: ArrayLike<number>, aOff: number, N: number, b: ArrayLike<number>, bOff: number, M: number, deadline: number): [number, number] | null {
  const maxD = Math.ceil((N + M) / 2)
  const vOffset = maxD
  const vLength = 2 * maxD + 2
  const v1 = new Int32Array(vLength).fill(-1)
  const v2 = new Int32Array(vLength).fill(-1)
  v1[vOffset + 1] = 0
  v2[vOffset + 1] = 0
  const delta = N - M
  const front = (delta & 1) !== 0
  let k1start = 0
  let k1end = 0
  let k2start = 0
  let k2end = 0
  for (let d = 0; d < maxD; d++) {
    if ((d & 31) === 0 && now() > deadline) return null
    for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      const k1Offset = vOffset + k1
      let x1: number
      if (k1 === -d || (k1 !== d && v1[k1Offset - 1] < v1[k1Offset + 1])) x1 = v1[k1Offset + 1]
      else x1 = v1[k1Offset - 1] + 1
      let y1 = x1 - k1
      while (x1 < N && y1 < M && a[aOff + x1] === b[bOff + y1]) {
        x1++
        y1++
      }
      v1[k1Offset] = x1
      if (x1 > N) k1end += 2
      else if (y1 > M) k1start += 2
      else if (front) {
        const k2Offset = vOffset + delta - k1
        if (k2Offset >= 0 && k2Offset < vLength && v2[k2Offset] !== -1) {
          const x2 = N - v2[k2Offset]
          if (x1 >= x2) return [x1, y1]
        }
      }
    }
    for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      const k2Offset = vOffset + k2
      let x2: number
      if (k2 === -d || (k2 !== d && v2[k2Offset - 1] < v2[k2Offset + 1])) x2 = v2[k2Offset + 1]
      else x2 = v2[k2Offset - 1] + 1
      let y2 = x2 - k2
      while (x2 < N && y2 < M && a[aOff + N - x2 - 1] === b[bOff + M - y2 - 1]) {
        x2++
        y2++
      }
      v2[k2Offset] = x2
      if (x2 > N) k2end += 2
      else if (y2 > M) k2start += 2
      else if (!front) {
        const k1Offset = vOffset + delta - k2
        if (k1Offset >= 0 && k1Offset < vLength && v1[k1Offset] !== -1) {
          const x1 = v1[k1Offset]
          const y1 = vOffset + x1 - k1Offset
          if (x1 >= N - x2) return [x1, y1]
        }
      }
    }
  }
  return null
}

/**
 * Patience-style anchoring: elements that occur exactly once in both ranges are matched,
 * the longest increasing subsequence of those matches becomes a set of anchors, and the
 * gaps between anchors are diffed independently.
 */
function anchoredDiff(a: ArrayLike<number>, aLo: number, aHi: number, b: ArrayLike<number>, bLo: number, bHi: number, out: Emitter, deadline: number, anchorThreshold: number) {
  const countA = new Map<number, number>()
  const posA = new Map<number, number>()
  for (let i = aLo; i < aHi; i++) {
    const v = a[i]
    countA.set(v, (countA.get(v) ?? 0) + 1)
    posA.set(v, i)
  }
  const countB = new Map<number, number>()
  const posB = new Map<number, number>()
  for (let j = bLo; j < bHi; j++) {
    const v = b[j]
    countB.set(v, (countB.get(v) ?? 0) + 1)
    posB.set(v, j)
  }
  // Candidate pairs ordered by position in B.
  const pairsA: number[] = []
  const pairsB: number[] = []
  for (let j = bLo; j < bHi; j++) {
    const v = b[j]
    if (countB.get(v) === 1 && countA.get(v) === 1) {
      pairsA.push(posA.get(v)!)
      pairsB.push(j)
    }
  }
  if (pairsA.length === 0) {
    // No unique anchors. If the regions share almost nothing, the minimal diff is (nearly)
    // a full replacement — emit it directly instead of an O(N·D) search that would only
    // hit the time budget.
    let shared = 0
    for (let j = bLo; j < bHi; j++) if (countA.has(b[j])) shared++
    const smaller = Math.min(aHi - aLo, bHi - bLo)
    if (shared <= smaller * 0.02) {
      if (shared > 0) out.approximate = true
      replaceBlock(aLo, aHi, bLo, bHi, out)
      return
    }
    bisectDiff(a, aLo, aHi, b, bLo, bHi, out, deadline)
    return
  }
  const lis = longestIncreasing(pairsA)
  let pa = aLo
  let pb = bLo
  for (const idx of lis) {
    const ai = pairsA[idx]
    const bj = pairsB[idx]
    diffRegion(a, pa, ai, b, pb, bj, out, deadline, anchorThreshold, false)
    out.push(OpType.Equal, ai, bj, 1)
    pa = ai + 1
    pb = bj + 1
  }
  diffRegion(a, pa, aHi, b, pb, bHi, out, deadline, anchorThreshold, false)
}

/** Indices of a longest strictly increasing subsequence (patience sorting, O(n log n)). */
export function longestIncreasing(values: number[]): number[] {
  const n = values.length
  const tails: number[] = []
  const prev = new Int32Array(n).fill(-1)
  for (let i = 0; i < n; i++) {
    const v = values[i]
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (values[tails[mid]] < v) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[i] = tails[lo - 1]
    tails[lo] = i
  }
  const res: number[] = new Array(tails.length)
  let k = tails[tails.length - 1]
  for (let i = tails.length - 1; i >= 0; i--) {
    res[i] = k
    k = prev[k]
  }
  return res
}

/** Applies an edit script to A, producing B (used to validate scripts in tests). */
export function applyOps<T>(a: ArrayLike<T>, b: ArrayLike<T>, ops: Op[]): T[] {
  const res: T[] = []
  for (const op of ops) {
    if (op.type === OpType.Equal) for (let i = 0; i < op.len; i++) res.push(a[op.aStart + i])
    else if (op.type === OpType.Insert) for (let i = 0; i < op.len; i++) res.push(b[op.bStart + i])
  }
  return res
}
