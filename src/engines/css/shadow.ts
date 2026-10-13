import { formatHex, parse } from 'culori'
import { fmtLen, fmtNum } from './numbers'
import { tailwindArbitrary } from './tailwind'

export interface ShadowLayer {
  id: string
  x: number
  y: number
  blur: number
  spread: number
  /** `#rrggbb` */
  color: string
  /** 0–1 */
  alpha: number
  inset: boolean
  /** Hidden layers are kept in the editor but left out of the CSS. */
  visible: boolean
}

export type ShadowLayerInput = Omit<ShadowLayer, 'id' | 'visible'>

/** `#0f172a` at alpha 1, `rgb(15 23 42 / 0.08)` otherwise. */
export function shadowColor(hex: string, alpha: number): string {
  const c = parse(hex)
  if (!c) return hex
  const h = formatHex(c) ?? hex
  if (alpha >= 1) return h
  const r = parseInt(h.slice(1, 3), 16)
  const g = parseInt(h.slice(3, 5), 16)
  const b = parseInt(h.slice(5, 7), 16)
  return `rgb(${r} ${g} ${b} / ${fmtNum(Math.max(0, alpha), 3)})`
}

export function layerToCss(l: Pick<ShadowLayer, 'x' | 'y' | 'blur' | 'spread' | 'color' | 'alpha' | 'inset'>): string {
  const parts = [fmtLen(l.x), fmtLen(l.y), fmtLen(Math.max(0, l.blur)), fmtLen(l.spread)]
  // Spread defaults to 0 — omit it when it (and nothing after it) needs saying.
  if (l.spread === 0) parts.pop()
  return `${l.inset ? 'inset ' : ''}${parts.join(' ')} ${shadowColor(l.color, l.alpha)}`
}

export function shadowValue(layers: ShadowLayer[]): string {
  const visible = layers.filter((l) => l.visible)
  return visible.length ? visible.map(layerToCss).join(', ') : 'none'
}

/** `box-shadow: …;` — one layer per line when there are several. */
export function shadowDeclaration(layers: ShadowLayer[], property = 'box-shadow'): string {
  const visible = layers.filter((l) => l.visible)
  if (visible.length <= 1) return `${property}: ${shadowValue(layers)};`
  return `${property}:\n${visible.map((l) => `  ${layerToCss(l)}`).join(',\n')};`
}

export function shadowTailwind(layers: ShadowLayer[]): string {
  return tailwindArbitrary('shadow', shadowValue(layers))
}

/** Splits on commas that are not inside parentheses. */
export function splitTopLevel(value: string, sep: ',' | ' '): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of value) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    const isSep = sep === ' ' ? /\s/.test(ch) : ch === sep
    if (isSep && depth === 0) {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

export type ParseShadowResult = { ok: true; layers: ShadowLayerInput[] } | { ok: false; error: string }

const LENGTH = /^(-?(?:\d+\.?\d*|\.\d+))(px)?$/i

/**
 * Parses a `box-shadow` value (with or without the `box-shadow:` prefix). Lengths must be
 * px (or unitless 0); colors may be any CSS color.
 */
export function parseBoxShadow(input: string): ParseShadowResult {
  let v = input.trim().replace(/;\s*$/, '')
  v = v.replace(/^box-shadow\s*:\s*/i, '').trim()
  if (!v) return { ok: false, error: 'Enter a box-shadow value, e.g. 0 4px 12px rgb(0 0 0 / 0.1)' }
  if (/^none$/i.test(v)) return { ok: true, layers: [] }
  const layers: ShadowLayerInput[] = []
  const raw = splitTopLevel(v, ',')
  for (let i = 0; i < raw.length; i++) {
    const tokens = splitTopLevel(raw[i], ' ')
    const lengths: number[] = []
    let inset = false
    let color: string | null = null
    for (const t of tokens) {
      if (/^inset$/i.test(t)) {
        inset = true
        continue
      }
      const m = LENGTH.exec(t)
      if (m) {
        if (!m[2] && Number(m[1]) !== 0) return { ok: false, error: `Layer ${i + 1}: “${t}” needs a unit (px)` }
        lengths.push(Number(m[1]))
        continue
      }
      if (/^-?[\d.]+[a-z%]+$/i.test(t)) return { ok: false, error: `Layer ${i + 1}: only px lengths are supported (found “${t}”)` }
      if (color !== null) return { ok: false, error: `Layer ${i + 1}: unexpected “${t}”` }
      color = t
    }
    if (lengths.length < 2 || lengths.length > 4) return { ok: false, error: `Layer ${i + 1}: expected 2–4 lengths (x y [blur] [spread]), found ${lengths.length}` }
    if ((lengths[2] ?? 0) < 0) return { ok: false, error: `Layer ${i + 1}: blur radius cannot be negative` }
    if (color === null) return { ok: false, error: `Layer ${i + 1}: add a color (currentColor is not supported here)` }
    const c = parse(color)
    if (!c) return { ok: false, error: `Layer ${i + 1}: “${color}” is not a valid CSS color` }
    layers.push({ x: lengths[0], y: lengths[1], blur: lengths[2] ?? 0, spread: lengths[3] ?? 0, color: formatHex(c) ?? '#000000', alpha: c.alpha ?? 1, inset })
  }
  return { ok: true, layers }
}

export interface ShadowPreset {
  name: string
  value: string
}

export const SHADOW_PRESETS: ShadowPreset[] = [
  { name: 'Hairline', value: '0 0 0 1px rgb(15 23 42 / 0.08), 0 1px 2px rgb(15 23 42 / 0.06)' },
  { name: 'Subtle', value: '0 1px 2px rgb(0 0 0 / 0.06)' },
  { name: 'Small', value: '0 1px 3px rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)' },
  { name: 'Medium', value: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' },
  { name: 'Large elevation', value: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)' },
  { name: 'Layered soft', value: '0 1px 1px rgb(17 24 39 / 0.04), 0 2px 2px rgb(17 24 39 / 0.04), 0 4px 4px rgb(17 24 39 / 0.04), 0 8px 8px rgb(17 24 39 / 0.04), 0 16px 16px rgb(17 24 39 / 0.04)' },
  { name: 'Floating', value: '0 24px 48px -12px rgb(16 24 40 / 0.18)' },
  { name: 'Inner', value: 'inset 0 2px 4px rgb(0 0 0 / 0.06)' },
  { name: 'Pressed', value: 'inset 0 1px 2px rgb(0 0 0 / 0.12), inset 0 0 0 1px rgb(0 0 0 / 0.06)' },
]
