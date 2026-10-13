import { expose } from '@/workers/rpc'
import { analyzeResponse, compareJson, listPaths, parseResponse, searchJson } from '@/engines/dev/api-inspect'

// Parsed documents are cached by their source text so search/paths don't re-parse on every keystroke.
const cache = new Map<string, unknown>()

function valueOf(text: string): unknown {
  if (cache.has(text)) return cache.get(text)
  const r = parseResponse(text)
  if (!r.ok) throw new Error(`Invalid JSON (line ${r.error.line}, column ${r.error.column}): ${r.error.message}`)
  if (cache.size >= 2) cache.delete(cache.keys().next().value as string)
  cache.set(text, r.value)
  return r.value
}

export const tasks = {
  analyze: (text: string) => analyzeResponse(text),
  search: (p: { text: string; query: string; keys: boolean; values: boolean; caseSensitive: boolean; exact: boolean }) =>
    searchJson(valueOf(p.text), p.query, { keys: p.keys, values: p.values, caseSensitive: p.caseSensitive, exact: p.exact, limit: 5000 }),
  paths: (p: { text: string; leafOnly: boolean; normalized: boolean }) => listPaths(valueOf(p.text), { leafOnly: p.leafOnly, normalized: p.normalized, limit: 200_000 }),
  compare: (p: { a: string; b: string; mode: 'paths' | 'schema' }) => {
    const ra = parseResponse(p.a)
    if (!ra.ok) return { ok: false as const, side: 'A' as const, error: ra.error }
    const rb = parseResponse(p.b)
    if (!rb.ok) return { ok: false as const, side: 'B' as const, error: rb.error }
    return { ok: true as const, result: compareJson(ra.value, rb.value, p.mode) }
  },
}
export type Tasks = typeof tasks
expose(tasks)
