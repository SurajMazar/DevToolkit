/**
 * Intra-line diff: which parts of two paired lines changed, at word or character
 * granularity. Used lazily for visible rows only.
 */
import { diffSequences, OpType } from './myers'
import type { WhitespaceMode } from './text-diff'

export type InlineGranularity = 'word' | 'char'

export interface InlineRange {
  start: number
  end: number
}

export interface InlineDiff {
  a: InlineRange[]
  b: InlineRange[]
  /** Fraction (0–1) of characters unchanged; low values mean the lines are unrelated. */
  similarity: number
}

/** Lines longer than this are not diffed inline (the whole line stays highlighted). */
export const INLINE_MAX_CHARS = 20_000

const RE_WORD_TOKENS = /[\p{L}\p{N}_]+|\s+|[\s\S]/gu

function tokenize(s: string, g: InlineGranularity): { tokens: string[]; offsets: number[] } {
  const tokens: string[] = []
  const offsets: number[] = []
  if (g === 'char') {
    let i = 0
    for (const ch of s) {
      tokens.push(ch)
      offsets.push(i)
      i += ch.length
    }
  } else {
    for (const m of s.matchAll(RE_WORD_TOKENS)) {
      tokens.push(m[0])
      offsets.push(m.index!)
    }
  }
  offsets.push(s.length)
  return { tokens, offsets }
}

export function inlineDiff(a: string, b: string, granularity: InlineGranularity, opts: { ignoreCase?: boolean; whitespace?: WhitespaceMode } = {}): InlineDiff | null {
  if (a.length + b.length > INLINE_MAX_CHARS) return null
  const ta = tokenize(a, granularity)
  const tb = tokenize(b, granularity)
  const ids = new Map<string, number>()
  const ignoreWs = opts.whitespace && opts.whitespace !== 'none'
  const intern = (t: string) => {
    let key = opts.ignoreCase ? t.toLowerCase() : t
    if (ignoreWs && /^\s+$/.test(key)) key = ' '
    let id = ids.get(key)
    if (id === undefined) {
      id = ids.size
      ids.set(key, id)
    }
    return id
  }
  const sa = Int32Array.from(ta.tokens, intern)
  const sb = Int32Array.from(tb.tokens, intern)
  const { ops } = diffSequences(sa, sb, { deadline: (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 50, anchorThreshold: Infinity })
  const ra: InlineRange[] = []
  const rb: InlineRange[] = []
  let same = 0
  const push = (list: InlineRange[], start: number, end: number) => {
    const last = list[list.length - 1]
    if (last && last.end === start) last.end = end
    else if (end > start) list.push({ start, end })
  }
  for (const op of ops) {
    if (op.type === OpType.Equal) {
      same += ta.offsets[op.aStart + op.len] - ta.offsets[op.aStart]
    } else if (op.type === OpType.Delete) {
      push(ra, ta.offsets[op.aStart], ta.offsets[op.aStart + op.len])
    } else {
      push(rb, tb.offsets[op.bStart], tb.offsets[op.bStart + op.len])
    }
  }
  // Pure-whitespace changes are not interesting when whitespace is ignored.
  const visible = (s: string) => (list: InlineRange[]) => (ignoreWs ? list.filter((r) => /\S/.test(s.slice(r.start, r.end))) : list)
  const longer = Math.max(a.length, b.length)
  return { a: visible(a)(ra), b: visible(b)(rb), similarity: longer === 0 ? 1 : same / longer }
}
