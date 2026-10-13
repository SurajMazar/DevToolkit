/** Formats a number for CSS: at most `digits` decimals, no trailing zeros, no `-0`. */
export function fmtNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '0'
  const f = Number(n.toFixed(digits))
  return Object.is(f, -0) ? '0' : String(f)
}

/** A length: `0` stays unitless, everything else gets its unit. */
export function fmtLen(n: number, unit = 'px', digits = 2): string {
  const s = fmtNum(n, digits)
  return s === '0' ? '0' : `${s}${unit}`
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}
