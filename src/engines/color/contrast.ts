import { clampChroma, converter, formatHex, formatHex8, parse, type Color, type Rgb } from 'culori'
import { relativeLuminance, srgbOf } from './convert'

const toOklch = converter('oklch')

export interface WcagLevel {
  id: 'aa-normal' | 'aa-large' | 'aaa-normal' | 'aaa-large' | 'ui'
  label: string
  detail: string
  min: number
  criterion: string
}

export const WCAG_LEVELS: WcagLevel[] = [
  { id: 'aa-normal', label: 'AA', detail: 'Normal text', min: 4.5, criterion: '1.4.3' },
  { id: 'aa-large', label: 'AA', detail: 'Large text', min: 3, criterion: '1.4.3' },
  { id: 'aaa-normal', label: 'AAA', detail: 'Normal text', min: 7, criterion: '1.4.6' },
  { id: 'aaa-large', label: 'AAA', detail: 'Large text', min: 4.5, criterion: '1.4.6' },
  { id: 'ui', label: 'UI', detail: 'Components & graphics', min: 3, criterion: '1.4.11' },
]

/** Source-over compositing of `top` onto an opaque `bottom` (sRGB, gamma-encoded like browsers). */
export function composite(top: Rgb, bottom: Rgb): Rgb {
  const a = top.alpha ?? 1
  return {
    mode: 'rgb',
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
  }
}

const WHITE: Rgb = { mode: 'rgb', r: 1, g: 1, b: 1 }

export interface ContrastResult {
  ratio: number
  /** Foreground as actually seen (composited over the background). */
  fg: Rgb
  /** Opaque background (a translucent background is composited over white). */
  bg: Rgb
  fgLuminance: number
  bgLuminance: number
  /** True when either color had transparency. */
  usedAlpha: boolean
}

export function ratioFromLuminance(l1: number, l2: number): number {
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

/** WCAG 2.x contrast ratio, with alpha handled by compositing over the background. */
export function contrast(fgColor: Color, bgColor: Color): ContrastResult {
  const fgRaw = srgbOf(fgColor)
  const bgRaw = srgbOf(bgColor)
  const bg = (bgRaw.alpha ?? 1) < 1 ? composite(bgRaw, WHITE) : { ...bgRaw, alpha: undefined }
  const fg = (fgRaw.alpha ?? 1) < 1 ? composite(fgRaw, bg) : { ...fgRaw, alpha: undefined }
  const fgL = relativeLuminance(fg)
  const bgL = relativeLuminance(bg)
  return { ratio: ratioFromLuminance(fgL, bgL), fg, bg, fgLuminance: fgL, bgLuminance: bgL, usedAlpha: (fgRaw.alpha ?? 1) < 1 || (bgRaw.alpha ?? 1) < 1 }
}

export const passes = (ratio: number, min: number) => ratio >= min

/**
 * Ratio for display. WCAG thresholds are not rounded (4.499 fails AA), so when two-decimal
 * rounding would reach a threshold the value fails, show three decimals instead.
 */
export function formatRatio(ratio: number): string {
  const two = Math.round(ratio * 100) / 100
  for (const t of [3, 4.5, 7]) if (ratio < t && two >= t) return (Math.floor(ratio * 1000) / 1000).toFixed(3)
  return two.toFixed(2)
}

export interface Suggestion {
  color: string
  ratio: number
  /** OKLCH lightness change (−1…1). */
  deltaL: number
  direction: 'lighter' | 'darker'
}

/**
 * Nearest foreground that reaches `target` against `bg`, found by moving OKLCH lightness
 * while keeping hue (and chroma, reduced only where needed to stay inside sRGB).
 */
export function suggestForeground(fgColor: Color, bgColor: Color, target: number): { lighter: Suggestion | null; darker: Suggestion | null; best: Suggestion | null } {
  const base = toOklch(fgColor)
  const alpha = fgColor.alpha ?? 1
  const make = (l: number): Color => clampChroma({ mode: 'oklch', l, c: base.c ?? 0, h: base.h, alpha: alpha < 1 ? alpha : undefined }, 'oklch')
  const ratioAt = (l: number) => contrast(make(l), bgColor).ratio

  const search = (direction: 'lighter' | 'darker'): Suggestion | null => {
    const end = direction === 'lighter' ? 1 : 0
    if (ratioAt(end) < target) return null
    // Coarse walk to the first passing lightness, then bisect for the closest one.
    const step = direction === 'lighter' ? 0.01 : -0.01
    let fail = base.l
    let pass = end
    for (let l = base.l + step; direction === 'lighter' ? l < 1 : l > 0; l += step) {
      if (ratioAt(l) >= target) {
        pass = l
        break
      }
      fail = l
    }
    for (let i = 0; i < 24; i++) {
      const mid = (fail + pass) / 2
      if (ratioAt(mid) >= target) pass = mid
      else fail = mid
    }
    // Hex rounding can push the ratio back under the threshold: nudge until the hex passes.
    for (let i = 0; i < 200; i++) {
      const rgb = srgbOf(make(pass))
      const hex = alpha < 1 ? formatHex8(rgb) : formatHex(rgb)
      const ratio = contrast(parse(hex)!, bgColor).ratio
      if (ratio >= target) return { color: hex, ratio, deltaL: pass - base.l, direction }
      if (pass === end) break
      pass = direction === 'lighter' ? Math.min(1, pass + 0.001) : Math.max(0, pass - 0.001)
    }
    return null
  }

  if (contrast(fgColor, bgColor).ratio >= target) return { lighter: null, darker: null, best: null }
  const lighter = search('lighter')
  const darker = search('darker')
  const best = [lighter, darker].filter((s): s is Suggestion => !!s).sort((a, b) => Math.abs(a.deltaL) - Math.abs(b.deltaL))[0] ?? null
  return { lighter, darker, best }
}

/**
 * APCA (Accessible Perceptual Contrast Algorithm) Lc value, version 0.0.98G-4g.
 * Informational only: APCA is a draft for WCAG 3 and is not a conformance requirement.
 * Positive = dark text on light background, negative = light text on dark background.
 */
export function apcaContrast(text: Rgb, background: Rgb): number {
  const Y = (c: Rgb) => 0.2126729 * c.r ** 2.4 + 0.7151522 * c.g ** 2.4 + 0.072175 * c.b ** 2.4
  const blkThrs = 0.022
  const blkClmp = 1.414
  const clampBlack = (y: number) => (y > blkThrs ? y : y + (blkThrs - y) ** blkClmp)
  const txtY = clampBlack(Y(text))
  const bgY = clampBlack(Y(background))
  if (Math.abs(bgY - txtY) < 0.0005) return 0
  let out: number
  if (bgY > txtY) {
    const sapc = (bgY ** 0.56 - txtY ** 0.57) * 1.14
    out = sapc < 0.1 ? 0 : sapc - 0.027
  } else {
    const sapc = (bgY ** 0.65 - txtY ** 0.62) * 1.14
    out = sapc > -0.1 ? 0 : sapc + 0.027
  }
  return out * 100
}
