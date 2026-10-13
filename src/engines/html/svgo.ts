import { optimize, type Config, type PluginConfig } from 'svgo/browser'

export interface SvgoOptions {
  /** Run SVGO's default plugin preset. */
  presetDefault: boolean
  multipass: boolean
  /** Decimal places for numbers (coordinates, path data). */
  precision: number
  pretty: boolean
  indent: number
  /** Keep `id`s (cleanupIds off) — needed when CSS/JS references them. */
  keepIds: boolean
  /** Keep `<desc>` (removeDesc off). */
  keepDesc: boolean
  removeViewBox: boolean
  removeDimensions: boolean
  removeTitle: boolean
  removeScripts: boolean
}

export const DEFAULT_SVGO: SvgoOptions = {
  presetDefault: true,
  multipass: true,
  precision: 3,
  pretty: false,
  indent: 2,
  keepIds: false,
  keepDesc: false,
  removeViewBox: false,
  removeDimensions: false,
  removeTitle: false,
  removeScripts: false,
}

export type SvgoResult = { ok: true; data: string } | { ok: false; error: { message: string; line?: number; column?: number } }

export function svgoConfig(o: SvgoOptions): Config {
  const plugins: PluginConfig[] = []
  if (o.presetDefault) {
    plugins.push({
      name: 'preset-default',
      params: {
        floatPrecision: o.precision,
        overrides: {
          ...(o.keepIds ? { cleanupIds: false } : {}),
          ...(o.keepDesc ? { removeDesc: false } : {}),
        },
      },
    })
  }
  if (o.removeViewBox) plugins.push('removeViewBox')
  if (o.removeDimensions) plugins.push('removeDimensions')
  if (o.removeTitle) plugins.push('removeTitle')
  if (o.removeScripts) plugins.push('removeScripts')
  return {
    multipass: o.multipass,
    floatPrecision: o.precision,
    plugins,
    js2svg: { pretty: o.pretty, indent: o.indent, eol: 'lf', finalNewline: o.pretty },
  }
}

interface SvgoErrorLike {
  name?: string
  reason?: string
  message?: string
  line?: number
  column?: number
}

export function optimizeSvg(svg: string, options: SvgoOptions = DEFAULT_SVGO): SvgoResult {
  try {
    return { ok: true, data: optimize(svg, svgoConfig(options)).data }
  } catch (e) {
    const err = e as SvgoErrorLike
    if (err?.name === 'SvgoParserError') return { ok: false, error: { message: err.reason ?? 'Invalid SVG', line: err.line, column: err.column } }
    return { ok: false, error: { message: err?.message ?? String(e) } }
  }
}

/** Pretty-prints without optimizing (no plugins). */
export function prettifySvg(svg: string, indent = 2): SvgoResult {
  try {
    return { ok: true, data: optimize(svg, { plugins: [], js2svg: { pretty: true, indent, eol: 'lf', finalNewline: true } }).data }
  } catch (e) {
    const err = e as SvgoErrorLike
    if (err?.name === 'SvgoParserError') return { ok: false, error: { message: err.reason ?? 'Invalid SVG', line: err.line, column: err.column } }
    return { ok: false, error: { message: err?.message ?? String(e) } }
  }
}
