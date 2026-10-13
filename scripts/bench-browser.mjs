// In-browser end-to-end timings against the production preview (npm run build && npm run preview).
// Drops generated files into the real UI and measures wall-clock time until results render.
// node scripts/bench-browser.mjs  → prints a table and writes docs/perf-browser.json
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:4173'
const results = []

function logLines(n, seed = 1) {
  let s = seed
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32)
  const lv = ['INFO', 'WARN', 'DEBUG', 'ERROR']
  const out = new Array(n)
  for (let i = 0; i < n; i++) out[i] = `2024-05-02T09:${String(i % 60).padStart(2, '0')}:00Z ${lv[Math.floor(r() * 4)]} worker-${i % 16} request ${i} handled in ${Math.floor(r() * 900)}ms path=/api/v1/items/${i % 5000}`
  return out
}
function edited(lines, every) {
  const b = lines.slice()
  for (let i = 0; i < b.length; i += every) b[i] += ' [edited]'
  return b
}

async function drop(page, index, name, content) {
  await page.evaluate(
    async ({ index, name, content }) => {
      const target = document.querySelectorAll('.monaco-editor')[index]
      const dt = new DataTransfer()
      dt.items.add(new File([content], name, { type: 'text/plain' }))
      for (const ev of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(ev, { bubbles: true, cancelable: true, dataTransfer: dt }))
    },
    { index, name, content },
  )
}

const browser = await chromium.launch()
let page
// Fresh context per measurement: empty storage, so no restored inputs can leak in.
async function freshPage() {
  if (page) await page.context().close()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  page = await ctx.newPage()
  page.setDefaultTimeout(180_000)
  return page
}

for (const n of (process.env.ONLY_JSON ? [] : [10_000, 100_000, 1_000_000])) {
  const a = logLines(n).join('\n')
  const b = edited(logLines(n), 997).join('\n')
  await freshPage()
  await page.goto(BASE + '/compare/text')
  await page.getByRole('radio', { name: 'Edit' }).click()
  await page.locator('.monaco-editor').nth(1).waitFor()
  await page.waitForTimeout(500)
  const t0 = Date.now()
  await drop(page, 0, 'a.log', a)
  await page.getByText('Loaded a.log').waitFor()
  await drop(page, 1, 'b.log', b)
  await page.getByText('Loaded b.log').waitFor()
  if (a.length + b.length > 4_000_000) {
    await page.getByRole('status').getByRole('button', { name: 'Compare' }).click()
  }
  await page.getByRole('status').getByText(`${n.toLocaleString('en-US')} → `).waitFor()
  const ms = Date.now() - t0
  const status = (await page.getByRole('status').last().innerText()).replace(/\s+/g, ' ')
  results.push({ name: 'Text Diff: load both files + diff (worker) + render', input: `${n.toLocaleString()} lines × 2 (${(a.length / 1048576).toFixed(1)} MB each)`, ms, status })
  console.log(n, ms, status)
  // Scroll smoothness proxy: time to jump to the last change and render.
  await page.getByRole('radio', { name: 'Diff' }).click()
  await page.getByRole('table', { name: 'Differences' }).waitFor()
  const t1 = Date.now()
  await page.getByRole('button', { name: 'Previous change' }).click()
  await page.waitForTimeout(50)
  results.push({ name: 'Text Diff: jump to last change (virtualized view)', input: `${n.toLocaleString()} lines`, ms: Date.now() - t1 - 50 })
}

for (const items of (process.env.ONLY_JSON ? [10_000] : [10_000, 100_000])) {
  const doc = { items: Array.from({ length: items }, (_, i) => ({ id: i, sku: `SKU-${i}`, name: `Product ${i}`, price: i * 1.37, tags: ['a', 'b'], stock: { qty: i % 300 } })) }
  const text = JSON.stringify(doc)
  await freshPage()
  await page.goto(BASE + '/json/formatter')
  await page.locator('.monaco-editor').nth(1).waitFor()
  const t0 = Date.now()
  await drop(page, 0, 'big.json', text)
  await page.getByText('Valid JSON').waitFor()
  results.push({ name: 'JSON Formatter: load file + validate + format', input: `${items.toLocaleString()} items (${(text.length / 1048576).toFixed(1)} MB)`, ms: Date.now() - t0 })

  const right = structuredClone(doc)
  for (let i = 0; i < items; i += 500) right.items[i].price += 1
  await freshPage()
  await page.goto(BASE + '/compare/json')
  await page.getByRole('radio', { name: 'Edit' }).click()
  await page.locator('.monaco-editor').nth(1).waitFor()
  await page.waitForTimeout(500)
  const t1 = Date.now()
  await drop(page, 0, 'a.json', text)
  await page.getByText('Loaded a.json').waitFor()
  await drop(page, 1, 'b.json', JSON.stringify(right))
  await page.getByText('Loaded b.json').waitFor()
  if (text.length * 2 > 8_000_000) await page.getByRole('status').getByRole('button', { name: 'Compare' }).click({ force: true })
  await page.getByRole('status').getByText(/~\d[\d,]* modified/).waitFor()
  results.push({ name: 'JSON Diff: load both + structural diff', input: `${items.toLocaleString()} items (${(text.length / 1048576).toFixed(1)} MB each)`, ms: Date.now() - t1 })
}

await browser.close()
for (const r of results) console.log(`${r.name.padEnd(55)} ${r.input.padEnd(36)} ${String(r.ms).padStart(7)} ms`)
writeFileSync('docs/perf-browser.json', JSON.stringify({ date: new Date().toISOString(), browser: 'Chromium (Playwright, headless)', results }, null, 2))
