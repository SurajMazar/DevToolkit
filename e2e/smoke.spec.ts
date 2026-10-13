import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CATEGORIES, TOOLS } from '../src/registry/tools.data.ts'
import { trackErrors } from './helpers'

const implemented = TOOLS.filter((t) => existsSync(join(import.meta.dirname, '..', 'src', 'tools', t.module, 'index.tsx')))

test.describe('every tool loads without errors', () => {
  for (const tool of implemented) {
    test(`${tool.name} (${tool.path})`, async ({ page }) => {
      const errors = trackErrors(page)
      await page.goto(tool.path)
      await expect(page.getByRole('heading', { level: 1, name: tool.name })).toBeVisible()
      await expect(page).toHaveTitle(new RegExp(tool.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      // Give lazy chunks and workers a moment to initialise.
      await page.waitForTimeout(600)
      expect(errors, errors.join('\n')).toEqual([])
    })
  }
})

test('category pages list their tools', async ({ page }) => {
  for (const c of CATEGORIES) {
    await page.goto(c.path)
    await expect(page.getByRole('heading', { level: 1, name: c.name })).toBeVisible()
  }
})

test('unknown routes show a helpful 404', async ({ page }) => {
  await page.goto('/no/such/tool')
  await expect(page.getByText("There's no tool at this address")).toBeVisible()
})

test('deep links are served with per-tool metadata before JavaScript runs', async ({ request }) => {
  const res = await request.get('/text/case-converter')
  expect(res.ok()).toBe(true)
  const html = await res.text()
  expect(html).toContain('<title>Case Converter — DevToolkit</title>')
  expect(html).toMatch(/<meta name="description" content="Convert text and identifiers/)
})
