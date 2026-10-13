/**
 * JSON parsing for converters whose output is text (YAML, XML): every number is kept as a
 * LosslessNumber holding the exact source digits, so `89.00` stays `89.00` and `1E5`
 * stays `1E5`. Errors come from the shared parser (line/column).
 */
import { LosslessNumber, parse as losslessParse } from 'lossless-json'
import { parseJson, type JsonErrorInfo } from '@/engines/json/parse'

export function parseJsonKeepNumbers(text: string): { ok: true; value: unknown } | { ok: false; error: JsonErrorInfo } {
  const checked = parseJson(text)
  if (!checked.ok) return checked
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return { ok: true, value: losslessParse(body, null, (s: string) => new LosslessNumber(s)) }
}
