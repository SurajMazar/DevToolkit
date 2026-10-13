import { diffText, type TextDiffOptions, type TextDiffResult } from '@/engines/diff/text-diff'
import { diffJson, jsonPatch, type JsonDiffOptions, type JsonDiffResult } from '@/engines/diff/json-diff'
import { parseJson, type JsonErrorInfo } from '@/engines/json/parse'
import { stringifyJson } from '@/engines/json/stringify'

export type JsonDiffTaskResult =
  | { ok: true; result: JsonDiffResult; leftText: string; rightText: string; text: TextDiffResult | null; hasBigNumbers: boolean }
  | { ok: false; side: 'left' | 'right'; error: JsonErrorInfo }

export const diffTasks = {
  textDiff: (p: { a: string; b: string; options: Partial<TextDiffOptions> }): TextDiffResult => diffText(p.a, p.b, p.options),
  jsonDiff: (p: { a: string; b: string; options: Partial<JsonDiffOptions>; sortKeys: boolean; withText: boolean; textOptions?: Partial<TextDiffOptions> }): JsonDiffTaskResult => {
    const l = parseJson(p.a)
    if (!l.ok) return { ok: false, side: 'left', error: l.error }
    const r = parseJson(p.b)
    if (!r.ok) return { ok: false, side: 'right', error: r.error }
    const result = diffJson(l.value, r.value, p.options)
    // Normalized pretty text for the line-based view.
    const leftText = stringifyJson(l.value, { indent: 2, sortKeys: p.sortKeys })
    const rightText = stringifyJson(r.value, { indent: 2, sortKeys: p.sortKeys })
    const text = p.withText ? diffText(leftText, rightText, p.textOptions ?? {}) : null
    return { ok: true, result, leftText, rightText, text, hasBigNumbers: l.hasBigNumbers || r.hasBigNumbers }
  },
  jsonPatch: (p: { a: string; b: string }) => {
    const l = parseJson(p.a)
    const r = parseJson(p.b)
    if (!l.ok || !r.ok) throw new Error('Both documents must be valid JSON')
    return stringifyJson(jsonPatch(l.value, r.value), { indent: 2 })
  },
}

export type DiffTasks = typeof diffTasks
