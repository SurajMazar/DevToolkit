import { afterAll, describe, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { diffText } from '@/engines/diff/text-diff'
import { diffJson } from '@/engines/diff/json-diff'
import { parseJson } from '@/engines/json/parse'
import { stringifyJson } from '@/engines/json/stringify'
import { convertCase } from '@/engines/case'
import Papa from 'papaparse'

/**
 * Engine benchmarks on synthetic but realistic inputs. Each measurement is the median of
 * several runs, on the machine running the suite (Node, single thread — equivalent to
 * one Web Worker).
 */

const results: { name: string; input: string; ms: number; note?: string }[] = []

function measure(name: string, input: string, fn: () => unknown, runs = 3, note?: string) {
  fn() // warm-up
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    fn()
    times.push(performance.now() - t)
  }
  times.sort((a, b) => a - b)
  const ms = times[Math.floor(times.length / 2)]
  results.push({ name, input, ms: Math.round(ms * 10) / 10, note })
  console.log(`${name.padEnd(46)} ${input.padEnd(26)} ${ms.toFixed(1).padStart(9)} ms ${note ?? ''}`)
}

const mb = (s: string) => `${(s.length / 1024 / 1024).toFixed(1)} MB`

function logLines(n: number, seed = 1) {
  let s = seed
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32)
  const levels = ['INFO', 'WARN', 'DEBUG', 'ERROR']
  const out: string[] = new Array(n)
  for (let i = 0; i < n; i++) out[i] = `2024-05-02T09:${String(i % 60).padStart(2, '0')}:00Z ${levels[Math.floor(r() * 4)]} worker-${i % 16} request ${i} handled in ${Math.floor(r() * 900)}ms path=/api/v1/items/${i % 5000}`
  return out
}

function edited(lines: string[], every: number) {
  const b = lines.slice()
  for (let i = 0; i < b.length; i += every) b[i] = b[i] + ' [edited]'
  for (let i = Math.floor(b.length / 3); i < b.length; i += every * 7) b.splice(i, 0, 'inserted line ' + i)
  return b
}

describe('text diff', () => {
  for (const n of [10_000, 100_000, 1_000_000]) {
    it(`${n} lines`, () => {
      const a = logLines(n)
      const b = edited(a, 997)
      const ta = a.join('\n')
      const tb = b.join('\n')
      measure('Text diff (scattered edits)', `${n.toLocaleString()} lines · ${mb(ta)}`, () => diffText(ta, tb), n >= 1_000_000 ? 2 : 3)
    })
  }
  it('completely different 100k lines (worst case)', () => {
    const a = logLines(100_000, 1).join('\n')
    const b = logLines(100_000, 99).join('\n')
    measure('Text diff (unrelated inputs)', `100,000 lines · ${mb(a)}`, () => diffText(a, b), 1, 'time budget / anchoring applies')
  })
})

function bigJson(items: number) {
  return {
    meta: { generated: '2024-05-02T09:14:00Z', count: items, id: 9007199254740993n.toString() },
    items: Array.from({ length: items }, (_, i) => ({
      id: i,
      sku: `SKU-${i}`,
      name: `Product ${i}`,
      price: Math.round(i * 137.31) / 100,
      tags: ['alpha', 'beta', i % 2 ? 'odd' : 'even'],
      stock: { warehouse: `WH-${i % 7}`, qty: i % 300, reserved: i % 13 },
      active: i % 5 !== 0,
    })),
  }
}

describe('json', () => {
  for (const n of [10_000, 100_000, 300_000]) {
    it(`${n} items`, () => {
      const doc = bigJson(n)
      const text = JSON.stringify(doc)
      measure('JSON parse (precision-safe)', `${n.toLocaleString()} items · ${mb(text)}`, () => parseJson(text))
      const parsed = parseJson(text)
      if (!parsed.ok) throw new Error('parse failed')
      measure('JSON format (2-space)', `${n.toLocaleString()} items · ${mb(text)}`, () => stringifyJson(parsed.value, { indent: 2 }))
      measure('JSON format (sorted keys)', `${n.toLocaleString()} items · ${mb(text)}`, () => stringifyJson(parsed.value, { indent: 2, sortKeys: true }))
      const right = structuredClone(doc)
      for (let i = 0; i < right.items.length; i += 500) right.items[i].price += 1
      right.items.splice(Math.floor(n / 2), 0, { ...right.items[0], id: -1 })
      measure('JSON structural diff (smart arrays)', `${n.toLocaleString()} items · ${mb(text)}`, () => diffJson(doc, right), n >= 300_000 ? 1 : 3)
    })
  }
})

describe('case conversion', () => {
  for (const n of [100_000, 1_000_000]) {
    it(`${n} lines`, () => {
      const text = Array.from({ length: n }, (_, i) => `user account field number ${i}`).join('\n')
      measure('Case convert → camelCase (per line)', `${n.toLocaleString()} lines · ${mb(text)}`, () => convertCase(text, 'camel'), n >= 1_000_000 ? 1 : 3)
      measure('Case convert → Title Case', `${n.toLocaleString()} lines · ${mb(text)}`, () => convertCase(text, 'title'), n >= 1_000_000 ? 1 : 3)
    })
  }
})

describe('csv', () => {
  it('long csv export', () => {
    const rows = Array.from({ length: 200_000 }, (_, i) => `${i},"Name ${i}, Jr.",${(i * 1.37).toFixed(2)},2024-05-${String((i % 28) + 1).padStart(2, '0')},"multi ""quoted"" text"`)
    const csv = 'id,name,amount,date,notes\n' + rows.join('\n')
    measure('CSV parse (papaparse, header)', `200,000 rows · ${mb(csv)}`, () => Papa.parse(csv, { header: true, skipEmptyLines: true }))
  })
})

afterAll(() => {
  writeFileSync('docs/perf-results.json', JSON.stringify({ node: process.version, date: new Date().toISOString(), results }, null, 2))
})
