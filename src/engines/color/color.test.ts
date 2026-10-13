import { describe, expect, it } from 'vitest'
import { converter, parse, type Color } from 'culori'
import { analyzeColor, cmyk, inSrgb, nearestNamedColor, parseColor, relativeLuminance, toPickerHex, withAlpha } from './convert'
import { apcaContrast, composite, contrast, formatRatio, suggestForeground, WCAG_LEVELS } from './contrast'

const c = (s: string): Color => {
  const r = parseColor(s)
  if (!r.ok) throw new Error(r.error)
  return r.color
}
const fmt = (s: string) => Object.fromEntries(analyzeColor(c(s)).formats.map((f) => [f.id, f.value]))

describe('parseColor', () => {
  it('accepts every CSS color syntax', () => {
    for (const s of ['#f00', '#f008', '#ff0000', '#ff000080', 'rgb(255 0 0)', 'rgba(255, 0, 0, 0.5)', 'hsl(0 100% 50%)', 'hsla(0, 100%, 50%, .5)', 'hwb(0 0% 0%)', 'lab(54.29% 80.8 69.89)', 'lch(54.29% 106.84 40.85)', 'oklab(62.8% 0.2249 0.1258)', 'oklch(62.8% 0.2577 29.23)', 'rebeccapurple', 'transparent', 'color(display-p3 1 0 0)', 'color(srgb 1 0 0)']) {
      expect(parseColor(s).ok, s).toBe(true)
    }
  })
  it('accepts bare hex digits as a convenience', () => {
    expect(fmt('ff8800').hex).toBe('#ff8800')
  })
  it('gives helpful errors', () => {
    expect(parseColor('')).toEqual({ ok: false, error: 'Enter a color' })
    expect(parseColor('#12345')).toEqual({ ok: false, error: 'Hex colors have 3, 4, 6 or 8 digits (0–9, a–f)' })
    expect(parseColor('currentColor')).toMatchObject({ ok: false, error: expect.stringContaining('context') })
    expect(parseColor('blurple')).toMatchObject({ ok: false })
  })
})

describe('analyzeColor', () => {
  it('converts pure red to every format', () => {
    const f = fmt('#ff0000')
    expect(f.hex).toBe('#ff0000')
    expect(f.hex8).toBe('#ff0000ff')
    expect(f.rgb).toBe('rgb(255 0 0)')
    expect(f.rgba).toBe('rgba(255, 0, 0, 1)')
    expect(f.hsl).toBe('hsl(0 100% 50%)')
    expect(f.hsv).toBe('hsv(0, 100%, 100%)')
    expect(f.hwb).toBe('hwb(0 0% 0%)')
    expect(f.lab).toBe('lab(54.29% 80.8 69.89)')
    expect(f.lch).toBe('lch(54.29% 106.84 40.86)')
    expect(f.oklab).toBe('oklab(62.8% 0.2249 0.1258)')
    expect(f.oklch).toBe('oklch(62.8% 0.2577 29.23)')
    expect(f.cmyk).toBe('cmyk(0%, 100%, 100%, 0%)')
  })
  it('keeps alpha in every alpha-capable format', () => {
    const f = fmt('rgba(0, 128, 255, 0.5)')
    expect(f.hex8).toBe('#0080ff80')
    expect(f.rgb).toBe('rgb(0 128 255 / 0.5)')
    expect(f.rgba).toBe('rgba(0, 128, 255, 0.5)')
    expect(f.hsl).toMatch(/ \/ 0\.5\)$/)
    expect(f.oklch).toMatch(/ \/ 0\.5\)$/)
  })
  it('round-trips each output back to the same sRGB color', () => {
    const toRgb = converter('rgb')
    for (const input of ['#3b82f6', '#0f766e', '#777777', '#f5f4f1', 'rebeccapurple']) {
      const a = analyzeColor(c(input))
      for (const f of a.formats) {
        if (f.nonCss) continue
        const back = toRgb(parse(f.value)!)
        expect(Math.round(back.r * 255), `${input} ${f.id}`).toBe(Math.round(a.srgb.r * 255))
        expect(Math.round(back.g * 255), `${input} ${f.id}`).toBe(Math.round(a.srgb.g * 255))
        expect(Math.round(back.b * 255), `${input} ${f.id}`).toBe(Math.round(a.srgb.b * 255))
      }
    }
  })
  it('reports achromatic hues as 0, not NaN', () => {
    expect(fmt('#ffffff').hsl).toBe('hsl(0 0% 100%)')
    expect(fmt('#000').oklch).toBe('oklch(0% 0 0)')
  })
  it('flags wide-gamut colors and gamut-maps sRGB formats', () => {
    const a = analyzeColor(c('color(display-p3 0 1 0)'))
    expect(a.inSrgb).toBe(false)
    expect(a.inP3).toBe(true)
    expect(a.formats.find((f) => f.id === 'hex')!.mapped).toBe(true)
    expect(a.formats.find((f) => f.id === 'hex')!.value).toMatch(/^#[0-9a-f]{6}$/)
    expect(analyzeColor(c('oklch(62.8% 0.2577 29.23)')).inSrgb).toBe(true)
    expect(inSrgb(c('oklch(70% 0.4 150)'))).toBe(false)
    expect(analyzeColor(c('oklch(70% 0.4 150)')).inP3).toBe(false)
  })
  it('finds the nearest named color with ΔE2000', () => {
    expect(nearestNamedColor(c('#ff0000')).name).toBe('red')
    expect(nearestNamedColor(c('#ff0000')).deltaE).toBeLessThan(1e-3)
    const n = nearestNamedColor(c('#663398'))
    expect(n.name).toBe('rebeccapurple')
    expect(n.deltaE).toBeGreaterThan(0)
    expect(n.deltaE).toBeLessThan(1)
  })
  it('computes naive CMYK', () => {
    expect(cmyk({ mode: 'rgb', r: 0, g: 0, b: 0 })).toEqual({ c: 0, m: 0, y: 0, k: 1 })
    const k = cmyk({ mode: 'rgb', r: 1, g: 0.5, b: 0 })
    expect(k.c).toBe(0)
    expect(k.m).toBeCloseTo(0.5)
    expect(k.y).toBe(1)
    expect(k.k).toBe(0)
  })
  it('converts for the native picker and back with alpha', () => {
    expect(toPickerHex(c('rgb(255 0 0 / 0.5)'))).toBe('#ff0000')
    expect(withAlpha('#ff0000', 0.5)).toBe('#ff000080')
    expect(withAlpha('#ff0000', 1)).toBe('#ff0000')
  })
})

describe('WCAG contrast', () => {
  it('computes relative luminance correctly', () => {
    expect(relativeLuminance({ r: 1, g: 1, b: 1 })).toBeCloseTo(1, 10)
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0)
    expect(relativeLuminance({ r: 0.5, g: 0.5, b: 0.5 })).toBeCloseTo(0.214, 3)
  })
  it('matches known pairs', () => {
    expect(formatRatio(contrast(c('#777'), c('#fff')).ratio)).toBe('4.48')
    expect(formatRatio(contrast(c('#000'), c('#fff')).ratio)).toBe('21.00')
    expect(formatRatio(contrast(c('#fff'), c('#fff')).ratio)).toBe('1.00')
    expect(formatRatio(contrast(c('#767676'), c('#fff')).ratio)).toBe('4.54')
    expect(formatRatio(contrast(c('#0000ff'), c('#ffffff')).ratio)).toBe('8.59')
    // Symmetric.
    expect(contrast(c('#fff'), c('#777')).ratio).toBeCloseTo(contrast(c('#777'), c('#fff')).ratio, 10)
  })
  it('never rounds a failing ratio up to a threshold', () => {
    expect(formatRatio(4.4996)).toBe('4.499')
    expect(formatRatio(4.5)).toBe('4.50')
    expect(formatRatio(6.999)).toBe('6.999')
    expect(formatRatio(2.996)).toBe('2.996')
  })
  it('composites a translucent foreground over the background', () => {
    const r = contrast(c('rgb(0 0 0 / 0.5)'), c('#fff'))
    expect(r.usedAlpha).toBe(true)
    expect(r.fg.r).toBeCloseTo(0.5, 5)
    expect(formatRatio(r.ratio)).toBe(formatRatio(contrast(c('rgb(127.5 127.5 127.5)'), c('#fff')).ratio))
    expect(composite({ mode: 'rgb', r: 1, g: 0, b: 0, alpha: 0 }, { mode: 'rgb', r: 0, g: 0, b: 1 })).toMatchObject({ r: 0, b: 1 })
  })
  it('composites a translucent background over white', () => {
    const r = contrast(c('#000'), c('rgb(0 0 0 / 0)'))
    expect(r.ratio).toBeCloseTo(21, 5)
  })
  it('defines the WCAG thresholds', () => {
    expect(WCAG_LEVELS.map((l) => l.min)).toEqual([4.5, 3, 7, 4.5, 3])
  })
})

describe('suggestForeground', () => {
  const toOklch = converter('oklch')
  it('finds a passing color that keeps the hue', () => {
    const fg = c('#5b8def')
    const bg = c('#ffffff')
    const s = suggestForeground(fg, bg, 4.5)
    expect(s.best).not.toBeNull()
    expect(s.best!.direction).toBe('darker')
    expect(contrast(c(s.best!.color), bg).ratio).toBeGreaterThanOrEqual(4.5)
    // Close to the threshold: it is the nearest, not just any passing color.
    expect(contrast(c(s.best!.color), bg).ratio).toBeLessThan(4.7)
    expect(Math.abs(toOklch(c(s.best!.color)).h! - toOklch(fg).h!)).toBeLessThan(3)
    expect(s.lighter).toBeNull() // nothing lighter than this blue reaches 4.5 on white
  })
  it('suggests lighter colors on dark backgrounds', () => {
    const s = suggestForeground(c('#3a5a40'), c('#111111'), 7)
    expect(s.best?.direction).toBe('lighter')
    expect(contrast(c(s.best!.color), c('#111111')).ratio).toBeGreaterThanOrEqual(7)
  })
  it('returns nothing when the pair already passes', () => {
    expect(suggestForeground(c('#000'), c('#fff'), 4.5).best).toBeNull()
  })
  it('handles impossible targets', () => {
    const s = suggestForeground(c('#888'), c('#808080'), 21)
    expect(s.best).toBeNull()
  })
})

describe('APCA (informational)', () => {
  const rgb = (s: string) => converter('rgb')(c(s))
  it('matches reference Lc values', () => {
    expect(apcaContrast(rgb('#000'), rgb('#fff'))).toBeCloseTo(106.04, 1)
    expect(apcaContrast(rgb('#fff'), rgb('#000'))).toBeCloseTo(-107.88, 1)
    expect(apcaContrast(rgb('#888'), rgb('#fff'))).toBeCloseTo(63.06, 1)
    expect(apcaContrast(rgb('#fff'), rgb('#fff'))).toBe(0)
  })
})
