import { describe, expect, it } from 'vitest'
import { bestTextColor, contrast, exportPalette, formatValue, harmony, lchOf, parseColor, randomPalette, SCALE_STEPS, tintsAndShades, tokenName, type Swatch } from './color'
import { createSeededRng } from './random'

const hueDiff = (a: number, b: number) => {
  const d = Math.abs(((a - b) % 360) + 360) % 360
  return Math.min(d, 360 - d)
}

describe('parseColor', () => {
  it('accepts any CSS color form', () => {
    for (const [input, hex] of [
      ['#3b82f6', '#3b82f6'],
      ['3b82f6', '#3b82f6'],
      ['#FFF', '#ffffff'],
      ['rgb(59 130 246)', '#3b82f6'],
      ['rgb(59, 130, 246)', '#3b82f6'],
      ['hsl(0 100% 50%)', '#ff0000'],
      ['rebeccapurple', '#663399'],
      ['oklch(62.8% 0.2577 29.23)', '#ff0000'],
    ]) {
      const r = parseColor(input)
      expect(r.ok, input).toBe(true)
      if (r.ok) expect(r.hex).toBe(hex)
    }
  })
  it('flags alpha and gamut-maps out-of-sRGB colors', () => {
    const a = parseColor('rgb(0 0 0 / 50%)')
    expect(a.ok && a.hadAlpha).toBe(true)
    const wide = parseColor('oklch(70% 0.4 150)')
    expect(wide.ok && wide.hex).toMatch(/^#[0-9a-f]{6}$/)
  })
  it('explains invalid input', () => {
    const r = parseColor('not-a-color')
    expect(!r.ok && r.error).toMatch(/not a CSS color/)
    expect(parseColor('').ok).toBe(false)
  })
})

describe('tintsAndShades', () => {
  const blue = tintsAndShades('#3b82f6')
  it('produces 11 steps 50–950 with monotonically decreasing lightness', () => {
    expect(blue.map((s) => s.key)).toEqual([...SCALE_STEPS])
    const ls = blue.map((s) => lchOf(s.hex).l)
    for (let i = 1; i < ls.length; i++) expect(ls[i]).toBeLessThan(ls[i - 1])
    expect(ls[0]).toBeGreaterThan(0.93)
    expect(ls[10]).toBeLessThan(0.35)
  })
  it('keeps the base color exactly at its nearest step and the hue roughly constant', () => {
    const base = blue.find((s) => s.isBase)!
    expect(base.hex).toBe('#3b82f6')
    expect(base.key).toBe('500')
    const h = lchOf('#3b82f6').h
    for (const s of blue.slice(2, 10)) expect(hueDiff(lchOf(s.hex).h, h)).toBeLessThan(8)
  })
  it('places light and dark bases at the ends of the scale', () => {
    expect(tintsAndShades('#eff6ff').find((s) => s.isBase)!.key).toBe('50')
    expect(tintsAndShades('#0b1020').find((s) => s.isBase)!.key).toBe('950')
  })
  it('handles greys (no hue) and stays in sRGB', () => {
    const grey = tintsAndShades('#808080')
    for (const s of grey) {
      expect(s.hex).toMatch(/^#[0-9a-f]{6}$/)
      expect(lchOf(s.hex).c).toBeLessThan(0.01)
    }
    for (const s of tintsAndShades('#ff00ff')) expect(s.hex).toMatch(/^#[0-9a-f]{6}$/)
  })
  it('lightness steps are perceptually even-ish (no step jumps more than 2.5× the mean)', () => {
    const ls = blue.map((s) => lchOf(s.hex).l)
    const steps = ls.slice(1).map((l, i) => ls[i] - l)
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length
    for (const d of steps) expect(d).toBeLessThan(mean * 2.5)
  })
})

describe('harmonies', () => {
  const base = '#e11d48'
  const h = lchOf(base).h
  it('rotates hue in OKLCH', () => {
    const comp = harmony(base, 'complementary').find((s) => s.key === 'complement')!
    expect(hueDiff(lchOf(comp.hex).h, h + 180)).toBeLessThan(6)
    const tri = harmony(base, 'triadic')
    expect(tri).toHaveLength(3)
    expect(hueDiff(lchOf(tri[1].hex).h, h + 120)).toBeLessThan(6)
    expect(hueDiff(lchOf(tri[2].hex).h, h + 240)).toBeLessThan(6)
    const tet = harmony(base, 'tetradic')
    expect(tet).toHaveLength(4)
    const split = harmony(base, 'split')
    expect(hueDiff(lchOf(split[1].hex).h, h + 150)).toBeLessThan(6)
    const ana = harmony(base, 'analogous')
    expect(ana).toHaveLength(5)
    expect(ana[2].isBase).toBe(true)
  })
  it('monochromatic keeps the hue and spreads lightness', () => {
    const m = harmony(base, 'monochromatic')
    const ls = m.map((s) => lchOf(s.hex).l)
    for (let i = 1; i < ls.length; i++) expect(ls[i]).toBeGreaterThan(ls[i - 1])
    for (const s of m) expect(hueDiff(lchOf(s.hex).h, h)).toBeLessThan(10)
  })
  it('includes the base color verbatim', () => {
    for (const t of ['complementary', 'analogous', 'triadic', 'tetradic', 'split', 'monochromatic'] as const) expect(harmony(base, t).some((s) => s.isBase && s.hex === base)).toBe(true)
  })
})

describe('randomPalette', () => {
  it('returns 5 valid colors and keeps locked swatches', () => {
    const rng = createSeededRng('p')
    const first = randomPalette([], 5, rng)
    expect(first).toHaveLength(5)
    for (const s of first) expect(s.hex).toMatch(/^#[0-9a-f]{6}$/)
    const locked = first.map((s, i) => ({ ...s, locked: i === 1 || i === 3 }))
    const next = randomPalette(locked, 5, rng)
    expect(next[1]).toEqual(locked[1])
    expect(next[3]).toEqual(locked[3])
    expect(next[0].hex).not.toBe(first[0].hex)
  })
  it('uses secure randomness by default', () => {
    expect(randomPalette([]).map((s) => s.hex)).not.toEqual(randomPalette([]).map((s) => s.hex))
  })
})

describe('contrast', () => {
  it('computes WCAG ratios and levels', () => {
    expect(contrast('#000000', '#ffffff').ratio).toBeCloseTo(21, 5)
    expect(contrast('#ffffff', '#ffffff').level).toBe('Fail')
    expect(contrast('#767676', '#ffffff').level).toBe('AA') // 4.54
    expect(contrast('#949494', '#ffffff').level).toBe('AA Large') // ~3.03
    expect(bestTextColor('#111827')).toBe('#ffffff')
    expect(bestTextColor('#fef3c7')).toBe('#000000')
  })
})

describe('export', () => {
  const sw: Swatch[] = [
    { key: '50', label: '50', hex: '#eff6ff' },
    { key: '500', label: '500', hex: '#3b82f6' },
  ]
  it('CSS variables / Tailwind / SCSS / JSON / hex', () => {
    expect(exportPalette(sw, 'css', 'Brand Blue')).toBe(':root {\n  --brand-blue-50: #eff6ff;\n  --brand-blue-500: #3b82f6;\n}\n')
    expect(exportPalette(sw, 'tailwind4', 'brand')).toContain('  --color-brand-500: #3b82f6;')
    const tw3 = exportPalette(sw, 'tailwind3', 'brand-blue')
    expect(tw3).toContain("'brand-blue': {")
    expect(tw3).toContain("500: '#3b82f6',")
    expect(exportPalette(sw, 'scss', 'brand')).toContain('$brand-500: #3b82f6;')
    expect(exportPalette(sw, 'scss', 'brand')).toContain("'500': $brand-500,")
    expect(JSON.parse(exportPalette(sw, 'json', 'brand'))).toEqual({ brand: { '50': '#eff6ff', '500': '#3b82f6' } })
    expect(exportPalette(sw, 'hex', 'x')).toBe('#eff6ff\n#3b82f6\n')
  })
  it('formats values in other color spaces', () => {
    expect(formatValue('#ff0000', 'rgb')).toBe('rgb(255, 0, 0)')
    expect(formatValue('#ff0000', 'hsl')).toBe('hsl(0, 100%, 50%)')
    expect(formatValue('#ff0000', 'oklch')).toMatch(/^oklch\(62\.8% 0\.258 29\.2\)$/)
    expect(formatValue('#808080', 'oklch')).toMatch(/ 0 0\)$/)
    expect(exportPalette(sw, 'css', 'b', 'oklch')).toContain('--b-500: oklch(')
  })
  it('normalises token names', () => {
    expect(tokenName('  Brand Blue!! ')).toBe('brand-blue')
    expect(tokenName('123')).toBe('c-123')
    expect(tokenName('')).toBe('color')
  })
})
