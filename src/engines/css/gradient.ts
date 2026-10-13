import { formatHex, interpolate, parse } from 'culori'
import { fmtNum } from './numbers'
import { tailwindArbitrary } from './tailwind'

export type GradientType = 'linear' | 'radial' | 'conic'
export type RadialShape = 'ellipse' | 'circle'
export type RadialSize = 'farthest-corner' | 'farthest-side' | 'closest-corner' | 'closest-side'
export type InterpolationSpace = 'default' | 'srgb' | 'srgb-linear' | 'display-p3' | 'oklab' | 'oklch' | 'lab' | 'lch' | 'hsl' | 'hwb' | 'xyz'
export type HueMethod = 'shorter' | 'longer' | 'increasing' | 'decreasing'

export interface GradientStop {
  id: string
  /** Any CSS color string. */
  color: string
  /** Percent (0–100; may exceed for repeating gradients). */
  position: number
}

export interface Gradient {
  type: GradientType
  repeating: boolean
  /** Linear: direction angle. Conic: `from` angle. */
  angle: number
  shape: RadialShape
  size: RadialSize
  /** Center for radial/conic, in percent. */
  x: number
  y: number
  interpolation: InterpolationSpace
  hue: HueMethod
  stops: GradientStop[]
}

export const POLAR_SPACES: ReadonlySet<InterpolationSpace> = new Set(['oklch', 'lch', 'hsl', 'hwb'])

export const INTERPOLATION_SPACES: { value: InterpolationSpace; label: string; description: string }[] = [
  { value: 'default', label: 'Default', description: 'Browser default (sRGB / Oklab for modern colors)' },
  { value: 'oklab', label: 'Oklab', description: 'Perceptually even, no grey dead zone' },
  { value: 'oklch', label: 'OKLCH', description: 'Keeps chroma; travels around the hue wheel' },
  { value: 'srgb', label: 'sRGB', description: 'Classic gradients' },
  { value: 'srgb-linear', label: 'Linear sRGB', description: 'Physically linear light mixing' },
  { value: 'display-p3', label: 'Display P3', description: 'Wide-gamut RGB' },
  { value: 'lab', label: 'CIELAB', description: 'Perceptual (older model)' },
  { value: 'lch', label: 'CIELCH', description: 'Polar CIELAB' },
  { value: 'hsl', label: 'HSL', description: 'Rainbow-like hue sweeps' },
  { value: 'hwb', label: 'HWB', description: 'Polar, like HSL' },
  { value: 'xyz', label: 'XYZ', description: 'Linear light (D65)' },
]

export function isValidColor(s: string): boolean {
  return parse(s.trim()) !== undefined
}

/** `#rrggbb` for the native color input; null when the string isn't a color. */
export function colorToHex(s: string): string | null {
  const c = parse(s.trim())
  return c ? (formatHex(c) ?? null) : null
}

export function sortStops(stops: GradientStop[]): GradientStop[] {
  return stops.map((s, i) => ({ s, i })).sort((a, b) => a.s.position - b.s.position || a.i - b.i).map((x) => x.s)
}

function interpolationClause(g: Gradient): string {
  if (g.interpolation === 'default') return ''
  const hue = POLAR_SPACES.has(g.interpolation) && g.hue !== 'shorter' ? ` ${g.hue} hue` : ''
  return `in ${g.interpolation}${hue}`
}

function prelude(g: Gradient, withInterpolation: boolean): string {
  const parts: string[] = []
  if (g.type === 'linear') parts.push(`${fmtNum(g.angle)}deg`)
  else if (g.type === 'radial') {
    parts.push(g.size === 'farthest-corner' ? g.shape : `${g.shape} ${g.size}`)
    parts.push(`at ${fmtNum(g.x)}% ${fmtNum(g.y)}%`)
  } else {
    if (g.angle !== 0) parts.push(`from ${fmtNum(g.angle)}deg`)
    parts.push(`at ${fmtNum(g.x)}% ${fmtNum(g.y)}%`)
  }
  const interp = withInterpolation ? interpolationClause(g) : ''
  if (interp) parts.push(interp)
  return parts.join(' ')
}

/** The gradient function, e.g. `linear-gradient(90deg in oklch, #fff 0%, #000 100%)`. */
export function gradientToCss(g: Gradient, options: { withInterpolation?: boolean } = {}): string {
  const fn = `${g.repeating ? 'repeating-' : ''}${g.type}-gradient`
  const stops = sortStops(g.stops).map((s) => `${s.color.trim()} ${fmtNum(s.position)}%`)
  const pre = prelude(g, options.withInterpolation ?? true)
  return `${fn}(${[pre, ...stops].filter(Boolean).join(', ')})`
}

/** CSS declarations, with an sRGB fallback line when an interpolation space is used. */
export function gradientDeclarations(g: Gradient, property = 'background'): string {
  const modern = `${property}: ${gradientToCss(g)};`
  if (g.interpolation === 'default') return modern
  return `${property}: ${gradientToCss(g, { withInterpolation: false })};\n${modern}`
}

export function gradientTailwind(g: Gradient): string {
  return tailwindArbitrary('bg', gradientToCss(g))
}

export type GradientIssue = { stopId: string; message: string }

export function validateGradient(g: Gradient): GradientIssue[] {
  const issues: GradientIssue[] = []
  for (const s of g.stops) if (!isValidColor(s.color)) issues.push({ stopId: s.id, message: `“${s.color}” is not a valid CSS color` })
  return issues
}

/** Color of the gradient at `position` (approximated in Oklab) — used when adding a stop. */
export function colorAt(stops: GradientStop[], position: number): string {
  const sorted = sortStops(stops).filter((s) => isValidColor(s.color))
  if (!sorted.length) return '#808080'
  if (position <= sorted[0].position) return colorToHex(sorted[0].color)!
  const last = sorted[sorted.length - 1]
  if (position >= last.position) return colorToHex(last.color)!
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (position >= a.position && position <= b.position) {
      const t = b.position === a.position ? 0 : (position - a.position) / (b.position - a.position)
      return formatHex(interpolate([a.color, b.color], 'oklab')(t)) ?? '#808080'
    }
  }
  return colorToHex(last.color)!
}

type PresetStop = [color: string, position: number]
export interface GradientPreset {
  name: string
  gradient: Omit<Gradient, 'stops'> & { stops: PresetStop[] }
}

const base: Omit<Gradient, 'stops'> = { type: 'linear', repeating: false, angle: 180, shape: 'ellipse', size: 'farthest-corner', x: 50, y: 50, interpolation: 'default', hue: 'shorter' }

export const GRADIENT_PRESETS: GradientPreset[] = [
  { name: 'Morning mist', gradient: { ...base, angle: 160, stops: [['#e8edf3', 0], ['#c9d6e3', 100]] } },
  { name: 'Peach', gradient: { ...base, angle: 135, interpolation: 'oklab', stops: [['#ffecd2', 0], ['#fcb69f', 100]] } },
  { name: 'Dusk', gradient: { ...base, angle: 180, interpolation: 'oklab', stops: [['#2b3a55', 0], ['#7c6a8e', 55], ['#e2a07a', 100]] } },
  { name: 'Deep sea', gradient: { ...base, angle: 150, stops: [['#0f172a', 0], ['#1e3a5f', 60], ['#2c5364', 100]] } },
  { name: 'Sage', gradient: { ...base, angle: 120, interpolation: 'oklch', stops: [['#dfe7d8', 0], ['#8fa98a', 100]] } },
  { name: 'Graphite', gradient: { ...base, angle: 135, stops: [['#3a3d42', 0], ['#16181b', 100]] } },
  { name: 'Spotlight', gradient: { ...base, type: 'radial', shape: 'ellipse', x: 50, y: 0, stops: [['#3d4a5f', 0], ['#14171c', 70]] } },
  { name: 'Paper', gradient: { ...base, type: 'radial', shape: 'circle', size: 'farthest-corner', x: 25, y: 20, stops: [['#fdfcfa', 0], ['#e6dccf', 100]] } },
  { name: 'Hue wheel', gradient: { ...base, type: 'conic', angle: 0, interpolation: 'oklch', hue: 'longer', stops: [['oklch(72% 0.12 30)', 0], ['oklch(72% 0.12 30)', 100]] } },
  { name: 'Pinstripe', gradient: { ...base, repeating: true, angle: 45, stops: [['#e6e8eb', 0], ['#e6e8eb', 4], ['#d3d7dc', 4], ['#d3d7dc', 8]] } },
]

export function presetToGradient(p: GradientPreset, makeId: (i: number) => string): Gradient {
  return { ...p.gradient, stops: p.gradient.stops.map(([color, position], i) => ({ id: makeId(i), color, position })) }
}
