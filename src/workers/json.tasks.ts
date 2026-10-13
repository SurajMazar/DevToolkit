import { parseJson, type JsonErrorInfo } from '@/engines/json/parse'
import { stringifyJson, type StringifyOptions } from '@/engines/json/stringify'
import { stripJsonc } from '@/engines/json/jsonc'
import { analyzeJson, type JsonShapeStats } from '@/engines/json/analyze'

export interface FormatPayload {
  text: string
  mode: 'beautify' | 'minify'
  indent: number | string
  sortKeys: false | 'asc' | 'desc'
  asciiOnly: boolean
  jsonc: boolean
}

export type FormatResult =
  | { ok: true; output: string; stats: JsonShapeStats; hasBigNumbers: boolean; jsonc: { comments: number; trailingCommas: number } | null }
  | { ok: false; error: JsonErrorInfo }

export function formatJson(p: FormatPayload): FormatResult {
  let src = p.text
  let jsonc: { comments: number; trailingCommas: number } | null = null
  if (p.jsonc) {
    const r = stripJsonc(src)
    src = r.json
    jsonc = { comments: r.comments, trailingCommas: r.trailingCommas }
  }
  const parsed = parseJson(src)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const opts: StringifyOptions = { indent: p.mode === 'minify' ? 0 : p.indent, sortKeys: p.sortKeys, asciiOnly: p.asciiOnly }
  try {
    const output = stringifyJson(parsed.value, opts)
    return { ok: true, output, stats: analyzeJson(parsed.value), hasBigNumbers: parsed.hasBigNumbers, jsonc }
  } catch (e) {
    const msg = e instanceof RangeError ? 'The document is nested too deeply to format in the browser.' : (e as Error).message
    return { ok: false, error: { message: msg, line: 1, column: 1, offset: 0 } }
  }
}

export const jsonTasks = { formatJson }
export type JsonTasks = typeof jsonTasks
