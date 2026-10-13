import { describe, expect, it } from 'vitest'
import { tailwindArbitrary } from './tailwind'
import { fmtLen, fmtNum } from './numbers'
import { colorAt, colorToHex, GRADIENT_PRESETS, gradientDeclarations, gradientTailwind, gradientToCss, presetToGradient, validateGradient, type Gradient } from './gradient'
import { layerToCss, parseBoxShadow, shadowDeclaration, shadowTailwind, shadowValue, SHADOW_PRESETS, type ShadowLayer } from './shadow'
import { compressFour, convertRadiusUnit, isElliptical, RADIUS_PRESETS, radiusLonghands, radiusTailwind, radiusValue, uniformRadius, type RadiusState } from './radius'

describe('numbers', () => {
  it('formats compactly', () => {
    expect(fmtNum(1.005)).toBe('1')
    expect(fmtNum(12.5)).toBe('12.5')
    expect(fmtNum(-0.0001)).toBe('0')
    expect(fmtNum(NaN)).toBe('0')
    expect(fmtLen(0)).toBe('0')
    expect(fmtLen(-2)).toBe('-2px')
    expect(fmtLen(1.25, 'rem')).toBe('1.25rem')
  })
})

describe('tailwindArbitrary', () => {
  it('replaces spaces with underscores and escapes underscores', () => {
    expect(tailwindArbitrary('shadow', '0 1px 2px rgb(0 0 0 / 0.05), 0 0 0 1px #000')).toBe('shadow-[0_1px_2px_rgb(0_0_0/0.05),0_0_0_1px_#000]')
    expect(tailwindArbitrary('bg', 'url(my_img.png)')).toBe('bg-[url(my\\_img.png)]')
    expect(tailwindArbitrary('rounded', '10px 20px / 5px')).toBe('rounded-[10px_20px/5px]')
  })
})

const g = (o: Partial<Gradient> = {}): Gradient => ({
  type: 'linear',
  repeating: false,
  angle: 90,
  shape: 'ellipse',
  size: 'farthest-corner',
  x: 50,
  y: 50,
  interpolation: 'default',
  hue: 'shorter',
  stops: [
    { id: 'a', color: '#ff0000', position: 0 },
    { id: 'b', color: 'blue', position: 100 },
  ],
  ...o,
})

describe('gradient', () => {
  it('builds linear gradients with sorted stops', () => {
    expect(gradientToCss(g({ stops: [{ id: 'b', color: 'blue', position: 100 }, { id: 'a', color: '#f00', position: 0 }] }))).toBe('linear-gradient(90deg, #f00 0%, blue 100%)')
  })
  it('adds interpolation spaces and hue methods (polar spaces only)', () => {
    expect(gradientToCss(g({ interpolation: 'oklch', hue: 'longer' }))).toBe('linear-gradient(90deg in oklch longer hue, #ff0000 0%, blue 100%)')
    expect(gradientToCss(g({ interpolation: 'oklab', hue: 'longer' }))).toBe('linear-gradient(90deg in oklab, #ff0000 0%, blue 100%)')
    expect(gradientToCss(g({ interpolation: 'oklch', hue: 'shorter' }))).toBe('linear-gradient(90deg in oklch, #ff0000 0%, blue 100%)')
  })
  it('emits an sRGB fallback declaration before the interpolated one', () => {
    expect(gradientDeclarations(g({ interpolation: 'oklab' }))).toBe('background: linear-gradient(90deg, #ff0000 0%, blue 100%);\nbackground: linear-gradient(90deg in oklab, #ff0000 0%, blue 100%);')
    expect(gradientDeclarations(g())).toBe('background: linear-gradient(90deg, #ff0000 0%, blue 100%);')
  })
  it('builds radial gradients (shape, size, position)', () => {
    expect(gradientToCss(g({ type: 'radial', shape: 'circle', size: 'closest-side', x: 30, y: 40.5 }))).toBe('radial-gradient(circle closest-side at 30% 40.5%, #ff0000 0%, blue 100%)')
    expect(gradientToCss(g({ type: 'radial' }))).toBe('radial-gradient(ellipse at 50% 50%, #ff0000 0%, blue 100%)')
  })
  it('builds conic and repeating gradients', () => {
    expect(gradientToCss(g({ type: 'conic', angle: 45, x: 50, y: 50 }))).toBe('conic-gradient(from 45deg at 50% 50%, #ff0000 0%, blue 100%)')
    expect(gradientToCss(g({ type: 'conic', angle: 0 }))).toBe('conic-gradient(at 50% 50%, #ff0000 0%, blue 100%)')
    expect(gradientToCss(g({ repeating: true }))).toMatch(/^repeating-linear-gradient\(/)
  })
  it('produces a Tailwind arbitrary value', () => {
    expect(gradientTailwind(g())).toBe('bg-[linear-gradient(90deg,#ff0000_0%,blue_100%)]')
  })
  it('validates stop colors with culori', () => {
    expect(validateGradient(g())).toEqual([])
    expect(validateGradient(g({ stops: [{ id: 'x', color: 'not-a-color', position: 0 }] }))).toEqual([{ stopId: 'x', message: '“not-a-color” is not a valid CSS color' }])
    expect(colorToHex('oklch(62.8% 0.2577 29.23)')).toBe('#ff0000')
    expect(colorToHex('nope')).toBeNull()
  })
  it('interpolates a color for new stops', () => {
    const stops = g().stops
    expect(colorAt(stops, 0)).toBe('#ff0000')
    expect(colorAt(stops, 100)).toBe('#0000ff')
    expect(colorAt(stops, 50)).toMatch(/^#[0-9a-f]{6}$/)
    expect(colorAt([], 50)).toBe('#808080')
  })
  it('has valid presets', () => {
    for (const p of GRADIENT_PRESETS) {
      const grad = presetToGradient(p, (i) => String(i))
      expect(validateGradient(grad)).toEqual([])
      expect(gradientToCss(grad)).toMatch(/gradient\(/)
    }
  })
})

const layer = (o: Partial<ShadowLayer> = {}): ShadowLayer => ({ id: '1', x: 0, y: 4, blur: 12, spread: 0, color: '#0f172a', alpha: 0.1, inset: false, visible: true, ...o })

describe('box-shadow', () => {
  it('serializes a layer, omitting zero spread', () => {
    expect(layerToCss(layer())).toBe('0 4px 12px rgb(15 23 42 / 0.1)')
    expect(layerToCss(layer({ spread: -2, inset: true, alpha: 1 }))).toBe('inset 0 4px 12px -2px #0f172a')
  })
  it('joins visible layers and handles none', () => {
    expect(shadowValue([layer(), layer({ id: '2', visible: false })])).toBe('0 4px 12px rgb(15 23 42 / 0.1)')
    expect(shadowValue([])).toBe('none')
    expect(shadowDeclaration([layer(), layer({ y: 1, blur: 2 })])).toBe('box-shadow:\n  0 4px 12px rgb(15 23 42 / 0.1),\n  0 1px 2px rgb(15 23 42 / 0.1);')
    expect(shadowTailwind([layer()])).toBe('shadow-[0_4px_12px_rgb(15_23_42/0.1)]')
  })
  it('parses box-shadow values', () => {
    const r = parseBoxShadow('box-shadow: inset 0 1px 2px -1px rgba(0, 0, 0, 0.5), 2px 3px #fff;')
    expect(r).toEqual({
      ok: true,
      layers: [
        { x: 0, y: 1, blur: 2, spread: -1, color: '#000000', alpha: 0.5, inset: true },
        { x: 2, y: 3, blur: 0, spread: 0, color: '#ffffff', alpha: 1, inset: false },
      ],
    })
    expect(parseBoxShadow('none')).toEqual({ ok: true, layers: [] })
    expect(parseBoxShadow('red 0 0 4px')).toMatchObject({ ok: true })
  })
  it('round-trips through parse → serialize', () => {
    for (const p of SHADOW_PRESETS) {
      const r = parseBoxShadow(p.value)
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      const value = shadowValue(r.layers.map((l, i) => ({ ...l, id: String(i), visible: true })))
      expect(parseBoxShadow(value)).toEqual(r)
    }
  })
  it('reports clear errors', () => {
    expect(parseBoxShadow('')).toMatchObject({ ok: false })
    expect(parseBoxShadow('0 1rem 2px red')).toEqual({ ok: false, error: 'Layer 1: only px lengths are supported (found “1rem”)' })
    expect(parseBoxShadow('0 2 red')).toEqual({ ok: false, error: 'Layer 1: “2” needs a unit (px)' })
    expect(parseBoxShadow('0 1px 2px')).toMatchObject({ ok: false, error: expect.stringContaining('add a color') })
    expect(parseBoxShadow('0 1px 2px blurple')).toMatchObject({ ok: false, error: expect.stringContaining('not a valid CSS color') })
    expect(parseBoxShadow('0 1px -2px red')).toMatchObject({ ok: false, error: expect.stringContaining('negative') })
    expect(parseBoxShadow('1px red')).toMatchObject({ ok: false, error: expect.stringContaining('expected 2–4 lengths') })
  })
})

const rs = (h: number[], v: number[] = h, unit: RadiusState['unit'] = 'px'): RadiusState => ({
  unit,
  h: { tl: h[0], tr: h[1], br: h[2], bl: h[3] },
  v: { tl: v[0], tr: v[1], br: v[2], bl: v[3] },
})

describe('border-radius', () => {
  it('compresses four values to the shortest equivalent', () => {
    expect(compressFour(['1', '1', '1', '1'])).toEqual(['1'])
    expect(compressFour(['1', '2', '1', '2'])).toEqual(['1', '2'])
    expect(compressFour(['1', '2', '3', '2'])).toEqual(['1', '2', '3'])
    expect(compressFour(['1', '2', '3', '4'])).toEqual(['1', '2', '3', '4'])
    expect(compressFour(['1', '1', '1', '2'])).toEqual(['1', '1', '1', '2'])
  })
  it('produces optimized shorthands', () => {
    expect(radiusValue(uniformRadius(12))).toBe('12px')
    expect(radiusValue(uniformRadius(0))).toBe('0')
    expect(radiusValue(rs([8, 16, 8, 16]))).toBe('8px 16px')
    expect(radiusValue(rs([10, 0, 10, 0]))).toBe('10px 0')
    expect(radiusValue(rs([10, 20, 30, 20]))).toBe('10px 20px 30px')
    expect(radiusValue(rs([10, 20, 30, 40]))).toBe('10px 20px 30px 40px')
  })
  it('produces elliptical shorthands only when needed', () => {
    expect(radiusValue(rs([50, 50, 50, 50], [30, 30, 30, 30], '%'))).toBe('50% / 30%')
    expect(radiusValue(rs([30, 70, 70, 30], [30, 30, 70, 70], '%'))).toBe('30% 70% 70% 30% / 30% 30% 70% 70%')
    expect(isElliptical(rs([1, 1, 1, 1], [1, 1, 1, 2]))).toBe(true)
    expect(isElliptical(uniformRadius(4))).toBe(false)
  })
  it('emits rem with up to 3 decimals and Tailwind values', () => {
    expect(radiusValue(uniformRadius(0.375, 'rem'))).toBe('0.375rem')
    expect(radiusTailwind(rs([50, 50, 50, 50], [30, 30, 30, 30], '%'))).toBe('rounded-[50%/30%]')
  })
  it('writes longhands', () => {
    expect(radiusLonghands(rs([1, 2, 3, 4], [1, 2, 3, 5]))).toBe(
      'border-top-left-radius: 1px;\nborder-top-right-radius: 2px;\nborder-bottom-right-radius: 3px;\nborder-bottom-left-radius: 4px 5px;',
    )
  })
  it('converts units against the box size', () => {
    const r = convertRadiusUnit(uniformRadius(20), '%', { width: 200, height: 100 })
    expect(r.h.tl).toBe(10)
    expect(r.v.tl).toBe(20)
    expect(convertRadiusUnit(uniformRadius(24), 'rem', { width: 1, height: 1 }).h.br).toBe(1.5)
    expect(convertRadiusUnit(uniformRadius(1.5, 'rem'), 'px', { width: 1, height: 1 }).v.bl).toBe(24)
  })
  it('has sensible presets', () => {
    for (const p of RADIUS_PRESETS) expect(radiusValue(p.state)).toBeTruthy()
  })
})
