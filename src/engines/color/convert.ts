import {
  colorsNamed,
  converter,
  differenceCiede2000,
  formatHex,
  formatHex8,
  parse,
  toGamut,
  type Color,
  type Rgb,
} from 'culori'

export type ParseColorResult = { ok: true; color: Color } | { ok: false; error: string }

const toRgb = converter('rgb')
const toHsl = converter('hsl')
const toHsv = converter('hsv')
const toHwb = converter('hwb')
const toLab = converter('lab')
const toLch = converter('lch')
const toOklab = converter('oklab')
const toOklch = converter('oklch')
const toP3 = converter('p3')
const EPS = 1e-4
const within = (c: { r: number; g: number; b: number }) => [c.r, c.g, c.b].every((v) => v >= -EPS && v <= 1 + EPS)
/** In the sRGB gamut, with a small tolerance for round-trip error (e.g. a rounded oklch() of #f00). */
export const inSrgb = (c: Color) => within(toRgb(c))
export const inP3 = (c: Color) => within(toP3(c))
const mapToSrgb = toGamut('rgb', 'oklch')
const deltaE2000 = differenceCiede2000()

/** Parses any CSS color string (hex, rgb, hsl, hwb, lab, lch, oklab, oklch, color(), named). */
export function parseColor(input: string): ParseColorResult {
  const s = input.trim()
  if (!s) return { ok: false, error: 'Enter a color' }
  const c = parse(s)
  if (!c) {
    if (/^#?[0-9a-f]+$/i.test(s) && !s.startsWith('#') && [3, 4, 6, 8].includes(s.length)) {
      const withHash = parse('#' + s)
      if (withHash) return { ok: true, color: withHash }
    }
    if (/^#/.test(s)) return { ok: false, error: 'Hex colors have 3, 4, 6 or 8 digits (0–9, a–f)' }
    if (/^currentcolor$/i.test(s)) return { ok: false, error: 'currentColor depends on context and has no fixed value' }
    return { ok: false, error: `“${s.length > 60 ? s.slice(0, 60) + '…' : s}” is not a CSS color` }
  }
  return { ok: true, color: c }
}

const r = (n: number | undefined, d: number) => {
  const v = Number((n ?? 0).toFixed(d))
  return Object.is(v, -0) ? 0 : v
}
const pct = (n: number | undefined, d = 1) => `${r((n ?? 0) * 100, d)}%`
const hue = (h: number | undefined, d = 1) => r(h === undefined || Number.isNaN(h) ? 0 : ((h % 360) + 360) % 360, d)
const alphaOf = (c: Color) => (c.alpha === undefined ? 1 : c.alpha)
const slashAlpha = (a: number) => (a < 1 ? ` / ${r(a, 3)}` : '')

export interface ColorFormat {
  id: string
  label: string
  value: string
  /** Not valid CSS syntax (HSV, CMYK). */
  nonCss?: boolean
  /** Value computed from the sRGB gamut-mapped color. */
  mapped?: boolean
  note?: string
}

export interface ColorAnalysis {
  /** The input in sRGB, gamut-mapped (what an sRGB screen shows). */
  srgb: Rgb
  alpha: number
  inSrgb: boolean
  inP3: boolean
  formats: ColorFormat[]
  nearestNamed: { name: string; deltaE: number; hex: string }
  /** Relative luminance (WCAG) of the opaque sRGB color. */
  luminance: number
}

export function cmyk(rgb: Rgb): { c: number; m: number; y: number; k: number } {
  const k = 1 - Math.max(rgb.r, rgb.g, rgb.b)
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 1 }
  return { c: (1 - rgb.r - k) / (1 - k), m: (1 - rgb.g - k) / (1 - k), y: (1 - rgb.b - k) / (1 - k), k }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

export function srgbOf(c: Color): Rgb {
  const rgb = toRgb(c)
  const mapped = inSrgb(rgb) ? rgb : toRgb(mapToSrgb(c))
  return { mode: 'rgb', r: clamp01(mapped.r), g: clamp01(mapped.g), b: clamp01(mapped.b), alpha: c.alpha }
}

const NAMED = Object.entries(colorsNamed as Record<string, number>).map(([name, n]) => {
  const hex = '#' + n.toString(16).padStart(6, '0')
  return { name, hex, color: parse(hex)! }
})

export function nearestNamedColor(c: Color): { name: string; deltaE: number; hex: string } {
  const opaque = { ...toLab(c), alpha: undefined }
  let best = NAMED[0]
  let bestD = Infinity
  for (const n of NAMED) {
    const d = deltaE2000(opaque, n.color)
    if (d < bestD) {
      bestD = d
      best = n
    }
  }
  return { name: best.name, deltaE: bestD, hex: best.hex }
}

export function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b)
}

export function analyzeColor(c: Color): ColorAnalysis {
  const alpha = alphaOf(c)
  const exactRgb = toRgb(c)
  const isIn = inSrgb(exactRgb)
  const srgb = srgbOf(c)
  const mapped = !isIn
  const R = Math.round(srgb.r * 255)
  const G = Math.round(srgb.g * 255)
  const B = Math.round(srgb.b * 255)
  const hsl = toHsl(srgb)
  const hsv = toHsv(srgb)
  const hwb = toHwb(srgb)
  const lab = toLab(c)
  const lch = toLch(c)
  const oklab = toOklab(c)
  const oklch = toOklch(c)
  const k = cmyk(srgb)
  const hex = formatHex(srgb)
  const formats: ColorFormat[] = [
    { id: 'hex', label: 'HEX', value: hex, mapped, note: alpha < 1 ? 'Alpha dropped' : undefined },
    { id: 'hex8', label: 'HEX8', value: formatHex8({ ...srgb, alpha }) },
    { id: 'rgb', label: 'RGB', value: `rgb(${R} ${G} ${B}${slashAlpha(alpha)})`, mapped },
    { id: 'rgba', label: 'RGBA', value: `rgba(${R}, ${G}, ${B}, ${r(alpha, 3)})`, mapped, note: 'Legacy comma syntax' },
    { id: 'hsl', label: 'HSL', value: `hsl(${hue(hsl.h)} ${pct(hsl.s)} ${pct(hsl.l)}${slashAlpha(alpha)})`, mapped },
    { id: 'hsv', label: 'HSV / HSB', value: `hsv(${hue(hsv.h)}, ${pct(hsv.s)}, ${pct(hsv.v)})`, mapped, nonCss: true, note: 'Design-tool notation, not CSS' },
    { id: 'hwb', label: 'HWB', value: `hwb(${hue(hwb.h)} ${pct(hwb.w)} ${pct(hwb.b)}${slashAlpha(alpha)})`, mapped },
    { id: 'lab', label: 'LAB', value: `lab(${r(lab.l, 2)}% ${r(lab.a, 2)} ${r(lab.b, 2)}${slashAlpha(alpha)})` },
    { id: 'lch', label: 'LCH', value: `lch(${r(lch.l, 2)}% ${r(lch.c, 2)} ${hue(lch.h, 2)}${slashAlpha(alpha)})` },
    { id: 'oklab', label: 'OKLAB', value: `oklab(${r(oklab.l * 100, 2)}% ${r(oklab.a, 4)} ${r(oklab.b, 4)}${slashAlpha(alpha)})` },
    { id: 'oklch', label: 'OKLCH', value: `oklch(${r(oklch.l * 100, 2)}% ${r(oklch.c, 4)} ${hue(oklch.h, 2)}${slashAlpha(alpha)})` },
    {
      id: 'cmyk',
      label: 'CMYK',
      value: `cmyk(${pct(k.c, 0)}, ${pct(k.m, 0)}, ${pct(k.y, 0)}, ${pct(k.k, 0)})`,
      mapped,
      nonCss: true,
      note: 'Naive device-independent approximation — not a print profile',
    },
  ]
  return {
    srgb,
    alpha,
    inSrgb: isIn,
    inP3: inP3(c),
    formats,
    nearestNamed: nearestNamedColor(srgb),
    luminance: relativeLuminance(srgb),
  }
}

/** sRGB hex for the native `<input type=color>` (gamut-mapped, alpha dropped). */
export function toPickerHex(c: Color): string {
  return formatHex(srgbOf(c))
}

/** Keeps the alpha of `prev` when the native picker (which has no alpha) returns a hex. */
export function withAlpha(hex: string, alpha: number): string {
  if (alpha >= 1) return hex
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')
  return hex + a
}
