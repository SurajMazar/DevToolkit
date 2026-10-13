import { fmtLen } from './numbers'
import { tailwindArbitrary } from './tailwind'

export type RadiusUnit = 'px' | '%' | 'rem'
export type Corner = 'tl' | 'tr' | 'br' | 'bl'
export const CORNERS: Corner[] = ['tl', 'tr', 'br', 'bl']
export const CORNER_LABELS: Record<Corner, string> = { tl: 'Top left', tr: 'Top right', br: 'Bottom right', bl: 'Bottom left' }

/** Horizontal and vertical radius of each corner, in `unit`. */
export interface RadiusState {
  unit: RadiusUnit
  h: Record<Corner, number>
  v: Record<Corner, number>
}

/**
 * Shortest equivalent of a 4-value box shorthand (top-left, top-right, bottom-right,
 * bottom-left): `a a a a` → `a`, `a b a b` → `a b`, `a b c b` → `a b c`.
 */
export function compressFour(values: [string, string, string, string]): string[] {
  const [a, b, c, d] = values
  if (b === d) {
    if (a === c) return a === b ? [a] : [a, b]
    return [a, b, c]
  }
  return [a, b, c, d]
}

function sideValues(r: RadiusState, axis: 'h' | 'v'): [string, string, string, string] {
  return CORNERS.map((k) => fmtLen(r[axis][k], r.unit, r.unit === 'rem' ? 3 : 2)) as [string, string, string, string]
}

export function isElliptical(r: RadiusState): boolean {
  return CORNERS.some((k) => r.h[k] !== r.v[k])
}

/** Optimized `border-radius` value: `12px`, `8px 16px`, `50% / 30%`, `10px 20px 30px 40px / 5px` … */
export function radiusValue(r: RadiusState): string {
  const hv = sideValues(r, 'h')
  const vv = sideValues(r, 'v')
  const h = compressFour(hv).join(' ')
  if (hv.join() === vv.join()) return h
  return `${h} / ${compressFour(vv).join(' ')}`
}

export function radiusDeclaration(r: RadiusState): string {
  return `border-radius: ${radiusValue(r)};`
}

/** Longhand declarations, e.g. for tools that need per-corner properties. */
export function radiusLonghands(r: RadiusState): string {
  const names: Record<Corner, string> = { tl: 'top-left', tr: 'top-right', br: 'bottom-right', bl: 'bottom-left' }
  const hv = sideValues(r, 'h')
  const vv = sideValues(r, 'v')
  return CORNERS.map((k, i) => `border-${names[k]}-radius: ${hv[i] === vv[i] ? hv[i] : `${hv[i]} ${vv[i]}`};`).join('\n')
}

export function radiusTailwind(r: RadiusState): string {
  return tailwindArbitrary('rounded', radiusValue(r))
}

export function uniformRadius(value: number, unit: RadiusUnit = 'px'): RadiusState {
  const all = { tl: value, tr: value, br: value, bl: value }
  return { unit, h: { ...all }, v: { ...all } }
}

/**
 * Converts all values to another unit. `%` is relative to the box: horizontal radii to its
 * width and vertical radii to its height. `rem` assumes a 16px root font size.
 */
export function convertRadiusUnit(r: RadiusState, unit: RadiusUnit, box: { width: number; height: number }, remPx = 16): RadiusState {
  if (unit === r.unit) return r
  const toPx = (n: number, axis: 'h' | 'v') => (r.unit === 'px' ? n : r.unit === 'rem' ? n * remPx : (n / 100) * (axis === 'h' ? box.width : box.height))
  const fromPx = (px: number, axis: 'h' | 'v') => {
    const v = unit === 'px' ? px : unit === 'rem' ? px / remPx : (px / (axis === 'h' ? box.width : box.height)) * 100
    return Math.round(v * (unit === 'rem' ? 1000 : 100)) / (unit === 'rem' ? 1000 : 100)
  }
  const map = (axis: 'h' | 'v') => Object.fromEntries(CORNERS.map((k) => [k, fromPx(toPx(r[axis][k], axis), axis)])) as Record<Corner, number>
  return { unit, h: map('h'), v: map('v') }
}

export interface RadiusPreset {
  name: string
  state: RadiusState
}

const ell = (h: [number, number, number, number], v: [number, number, number, number]): RadiusState => ({
  unit: '%',
  h: { tl: h[0], tr: h[1], br: h[2], bl: h[3] },
  v: { tl: v[0], tr: v[1], br: v[2], bl: v[3] },
})

export const RADIUS_PRESETS: RadiusPreset[] = [
  { name: 'Card', state: uniformRadius(12) },
  { name: 'Pill', state: uniformRadius(9999) },
  { name: 'Circle', state: uniformRadius(50, '%') },
  { name: 'Tab', state: { unit: 'px', h: { tl: 10, tr: 10, br: 0, bl: 0 }, v: { tl: 10, tr: 10, br: 0, bl: 0 } } },
  { name: 'Leaf', state: { unit: '%', h: { tl: 0, tr: 70, br: 0, bl: 70 }, v: { tl: 0, tr: 70, br: 0, bl: 70 } } },
  { name: 'Blob', state: ell([30, 70, 70, 30], [30, 30, 70, 70]) },
  { name: 'Pebble', state: ell([63, 37, 54, 46], [55, 48, 52, 45]) },
  { name: 'Egg', state: ell([50, 50, 50, 50], [60, 60, 40, 40]) },
]
