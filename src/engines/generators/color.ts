import { converter, formatHex, formatHsl, formatRgb, parse, toGamut, wcagContrast, type Oklch } from 'culori'
import { cryptoRng, type Rng } from './random'

const toOklch = converter('oklch')
/** formatHex for inputs known to be valid colors. */
const hexOf = (c: Parameters<typeof formatHex>[0]): string => formatHex(c) ?? '#000000'
const mapToRgb = toGamut('rgb', 'oklch')

export interface Lch {
  l: number
  c: number
  h: number
}

export type ParseResult = { ok: true; hex: string; lch: Lch; hadAlpha: boolean } | { ok: false; error: string }

/** Parse any CSS color (hex, rgb(), hsl(), oklch(), lab(), named…) into sRGB hex + OKLCH. */
export function parseColor(input: string): ParseResult {
  const s = input.trim()
  if (!s) return { ok: false, error: 'Enter a color, e.g. #3b82f6, rgb(59 130 246) or oklch(62% 0.19 260).' }
  // Bare hex without '#'.
  const c = parse(/^[0-9a-f]{3,8}$/i.test(s) && [3, 4, 6, 8].includes(s.length) ? `#${s}` : s)
  if (!c) return { ok: false, error: `“${s}” is not a CSS color culori can read.` }
  const hadAlpha = c.alpha != null && c.alpha < 1
  const inGamut = mapToRgb({ ...c, alpha: undefined })
  const hex = formatHex(inGamut)
  return { ok: true, hex, lch: lchOf(hex), hadAlpha }
}

export function lchOf(color: string): Lch {
  const o = toOklch(color) as Oklch
  return { l: o.l, c: o.c ?? 0, h: Number.isFinite(o.h) ? (o.h as number) : 0 }
}

/** OKLCH → in-gamut sRGB hex, reducing chroma (CSS Color 4 gamut mapping) when needed. */
export function lchToHex({ l, c, h }: Lch): string {
  return formatHex(mapToRgb({ mode: 'oklch', l: clamp(l, 0, 1), c: Math.max(0, c), h: ((h % 360) + 360) % 360 }))
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// ── Palettes ────────────────────────────────────────────────────────────────────

export type PaletteType = 'scale' | 'complementary' | 'analogous' | 'triadic' | 'tetradic' | 'split' | 'monochromatic' | 'random'

export const PALETTE_TYPES: { value: PaletteType; label: string; description: string }[] = [
  { value: 'scale', label: 'Tints & shades', description: '50–950 scale in OKLCH' },
  { value: 'complementary', label: 'Complementary', description: 'Base + opposite hue' },
  { value: 'analogous', label: 'Analogous', description: 'Neighbouring hues, ±20° / ±40°' },
  { value: 'triadic', label: 'Triadic', description: 'Three hues 120° apart' },
  { value: 'tetradic', label: 'Tetradic', description: 'Four hues 90° apart' },
  { value: 'split', label: 'Split-complementary', description: 'Base + two hues beside its opposite' },
  { value: 'monochromatic', label: 'Monochromatic', description: 'One hue, varied lightness' },
  { value: 'random', label: 'Random harmonious', description: 'Secure random, lock swatches to keep them' },
]

export interface Swatch {
  /** Export key: "500", "complement", "color-3"… */
  key: string
  label: string
  hex: string
  isBase?: boolean
}

export const SCALE_STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const
/** OKLCH lightness targets per step (close to Tailwind v4's default palettes). */
export const SCALE_LIGHTNESS = [0.971, 0.936, 0.885, 0.808, 0.707, 0.627, 0.552, 0.488, 0.424, 0.379, 0.282]
/** Relative chroma per step: low at the light end, peak mid-scale, tapering in the darks. */
const SCALE_CHROMA = [0.08, 0.17, 0.32, 0.55, 0.82, 1, 0.98, 0.88, 0.74, 0.6, 0.45]

/**
 * Tints & shades scale. The base color is placed exactly at the step whose target
 * lightness is closest; other steps follow the target curve, with the offset needed to
 * hit the base fading out towards both ends so 50 stays light and 950 stays dark.
 */
export function tintsAndShades(base: string): Swatch[] {
  const b = lchOf(base)
  let k = 0
  for (let i = 1; i < SCALE_LIGHTNESS.length; i++) if (Math.abs(SCALE_LIGHTNESS[i] - b.l) < Math.abs(SCALE_LIGHTNESS[k] - b.l)) k = i
  const offset = b.l - SCALE_LIGHTNESS[k]
  const last = SCALE_LIGHTNESS.length - 1
  return SCALE_STEPS.map((step, i) => {
    if (i === k) return { key: step, label: step, hex: hexOf(base), isBase: true }
    const w = i < k ? i / k : (last - i) / (last - k)
    const l = SCALE_LIGHTNESS[i] + offset * w
    const c = (b.c * SCALE_CHROMA[i]) / SCALE_CHROMA[k]
    return { key: step, label: step, hex: lchToHex({ l, c, h: b.h }) }
  })
}

const rot = (b: Lch, deg: number): Lch => ({ ...b, h: b.h + deg })
const lighten = (b: Lch, d: number): Lch => ({ ...b, l: clamp(b.l + d, 0.12, 0.97), c: b.c * (d > 0 ? 0.55 : 0.9) })

export function harmony(base: string, type: Exclude<PaletteType, 'scale' | 'random'>): Swatch[] {
  const b = lchOf(base)
  const hex = hexOf(base)
  const sw = (key: string, label: string, c: Lch): Swatch => ({ key, label, hex: lchToHex(c) })
  const baseSw: Swatch = { key: 'base', label: 'Base', hex, isBase: true }
  switch (type) {
    case 'complementary':
      return [baseSw, sw('base-light', 'Base light', lighten(b, 0.2)), sw('complement', 'Complement', rot(b, 180)), sw('complement-light', 'Complement light', lighten(rot(b, 180), 0.2))]
    case 'analogous':
      return [sw('analogous-1', '−40°', rot(b, -40)), sw('analogous-2', '−20°', rot(b, -20)), baseSw, sw('analogous-3', '+20°', rot(b, 20)), sw('analogous-4', '+40°', rot(b, 40))]
    case 'triadic':
      return [baseSw, sw('triad-1', '+120°', rot(b, 120)), sw('triad-2', '+240°', rot(b, 240))]
    case 'tetradic':
      return [baseSw, sw('tetrad-1', '+90°', rot(b, 90)), sw('tetrad-2', '+180°', rot(b, 180)), sw('tetrad-3', '+270°', rot(b, 270))]
    case 'split':
      return [baseSw, sw('split-1', '+150°', rot(b, 150)), sw('split-2', '+210°', rot(b, 210))]
    case 'monochromatic': {
      const deltas = [-0.3, -0.15, 0, 0.15, 0.3]
      return deltas.map((d, i) => (d === 0 ? baseSw : sw(`mono-${i + 1}`, d < 0 ? `Darker ${Math.abs(d * 100)}%` : `Lighter ${d * 100}%`, lighten(b, d))))
    }
  }
}

export interface RandomSwatch {
  hex: string
  locked: boolean
}

const RANDOM_SCHEMES: number[][] = [
  [0, 30, 60, 90, 120].map((x) => x - 60), // analogous spread
  [0, 120, 240, 0, 120], // triadic
  [0, 180, 0, 180, 30], // complementary
  [0, 150, 210, 0, 150], // split-complementary
  [0, 90, 180, 270, 0], // tetradic
]

/**
 * Random harmonious palette of `size` swatches using secure randomness. Locked swatches
 * are kept; the first locked swatch anchors the hue so new colors harmonise with it.
 */
export function randomPalette(current: RandomSwatch[], size = 5, rng: Rng = cryptoRng): RandomSwatch[] {
  const anchor = current.find((s) => s.locked)
  const baseHue = anchor ? lchOf(anchor.hex).h : rng.next() * 360
  const scheme = RANDOM_SCHEMES[rng.int(RANDOM_SCHEMES.length)]
  // Spread lightness so the palette has a usable light-to-dark range.
  const ls = Array.from({ length: size }, (_, i) => 0.3 + ((i + rng.next() * 0.8) / size) * 0.65)
  for (let i = ls.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    ;[ls[i], ls[j]] = [ls[j], ls[i]]
  }
  return Array.from({ length: size }, (_, i) => {
    const kept = current[i]
    if (kept?.locked) return kept
    const h = baseHue + scheme[i % scheme.length] + (rng.next() - 0.5) * 16
    const c = 0.05 + rng.next() * 0.15
    return { hex: lchToHex({ l: ls[i], c, h }), locked: false }
  })
}

// ── Contrast ─────────────────────────────────────────────────────────────────────

export interface ContrastInfo {
  ratio: number
  /** WCAG 2.x level for normal-size text. */
  level: 'AAA' | 'AA' | 'AA Large' | 'Fail'
}

export function contrast(fg: string, bg: string): ContrastInfo {
  const ratio = wcagContrast(fg, bg)
  const level = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA Large' : 'Fail'
  return { ratio, level }
}

/** Better of black/white text on this background. */
export function bestTextColor(bg: string): '#ffffff' | '#000000' {
  return wcagContrast('#ffffff', bg) >= wcagContrast('#000000', bg) ? '#ffffff' : '#000000'
}

// ── Formatting & export ─────────────────────────────────────────────────────────

export type ValueFormat = 'hex' | 'rgb' | 'hsl' | 'oklch'

export function formatValue(hex: string, f: ValueFormat): string {
  switch (f) {
    case 'hex':
      return hex
    case 'rgb':
      return formatRgb(hex) ?? hex
    case 'hsl':
      return formatHsl(hex) ?? hex
    case 'oklch': {
      const o = lchOf(hex)
      const h = o.c < 0.0005 ? 0 : o.h
      return `oklch(${round(o.l * 100, 1)}% ${round(o.c, 3)} ${round(h, 1)})`
    }
  }
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d

export type ExportFormat = 'css' | 'tailwind4' | 'tailwind3' | 'scss' | 'json' | 'hex'

export const EXPORT_FORMATS: { value: ExportFormat; label: string; ext: string; language: string }[] = [
  { value: 'css', label: 'CSS variables', ext: 'css', language: 'css' },
  { value: 'tailwind4', label: 'Tailwind v4 @theme', ext: 'css', language: 'css' },
  { value: 'tailwind3', label: 'Tailwind v3 config', ext: 'js', language: 'javascript' },
  { value: 'scss', label: 'SCSS', ext: 'scss', language: 'scss' },
  { value: 'json', label: 'JSON', ext: 'json', language: 'json' },
  { value: 'hex', label: 'Hex list', ext: 'txt', language: 'plaintext' },
]

/** Lowercase kebab-case token name; falls back to "color". */
export function tokenName(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return /^[a-z]/.test(s) ? s : s ? `c-${s}` : 'color'
}

export function exportPalette(swatches: Swatch[], format: ExportFormat, name: string, valueFormat: ValueFormat = 'hex'): string {
  const n = tokenName(name)
  const v = (s: Swatch) => formatValue(s.hex, valueFormat)
  switch (format) {
    case 'css':
      return `:root {\n${swatches.map((s) => `  --${n}-${s.key}: ${v(s)};`).join('\n')}\n}\n`
    case 'tailwind4':
      return `@theme {\n${swatches.map((s) => `  --color-${n}-${s.key}: ${v(s)};`).join('\n')}\n}\n`
    case 'tailwind3': {
      const body = swatches.map((s) => `          ${/^\d+$/.test(s.key) ? s.key : `'${s.key}'`}: '${v(s)}',`).join('\n')
      const prop = /^[a-z_$][a-z0-9_$]*$/i.test(n) ? n : `'${n}'`
      return `/** @type {import('tailwindcss').Config} */\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n        ${prop}: {\n${body}\n        },\n      },\n    },\n  },\n}\n`
    }
    case 'scss':
      return `${swatches.map((s) => `$${n}-${s.key}: ${v(s)};`).join('\n')}\n\n$${n}: (\n${swatches.map((s) => `  '${s.key}': $${n}-${s.key},`).join('\n')}\n);\n`
    case 'json':
      return JSON.stringify({ [n]: Object.fromEntries(swatches.map((s) => [s.key, v(s)])) }, null, 2) + '\n'
    case 'hex':
      return swatches.map((s) => s.hex).join('\n') + '\n'
  }
}
