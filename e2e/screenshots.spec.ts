import { test, type Page } from '@playwright/test'

/**
 * Captures key pages at desktop, tablet and mobile sizes in dark and light themes into
 * screenshots/ (run: npx playwright test e2e/screenshots.spec.ts). These are review
 * artifacts, not pixel assertions.
 */

const SIZES = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
} as const

type Setup = (page: Page) => Promise<void>
const clickName = (name: string | RegExp) => async (page: Page) => {
  await page.getByRole('button', { name }).first().click({ timeout: 3000 })
  await page.waitForTimeout(700)
}
const radio = (name: string) => async (page: Page) => {
  await page.getByRole('radio', { name }).first().click({ timeout: 3000 })
  await page.waitForTimeout(600)
}

const PAGES: { name: string; path: string; setup?: Setup[] }[] = [
  { name: 'home', path: '/' },
  { name: 'case-converter', path: '/text/case-converter', setup: [clickName('Load sample')] },
  { name: 'text-diff', path: '/compare/text', setup: [clickName('Load example'), radio('Diff')] },
  { name: 'json-diff-tree', path: '/compare/json', setup: [clickName('Load example'), radio('Tree')] },
  { name: 'json-formatter', path: '/json/formatter', setup: [clickName('Load sample')] },
  { name: 'regex-tester', path: '/developer/regex', setup: [clickName(/Load sample/)] },
  { name: 'uuid', path: '/generators/uuid' },
  { name: 'timestamp', path: '/datetime/timestamp' },
  { name: 'jwt', path: '/encoding/jwt', setup: [clickName(/Load sample/)] },
  { name: 'settings', path: '/settings' },
]

for (const theme of ['dark', 'light'] as const) {
  for (const [size, viewport] of Object.entries(SIZES)) {
    test.describe(`${theme} ${size}`, () => {
      test.use({ viewport, colorScheme: theme })
      for (const p of PAGES) {
        test(p.name, async ({ page }) => {
          await page.addInitScript((t) => localStorage.setItem('devtoolkit:prefs', JSON.stringify({ state: { theme: t }, version: 1 })), theme)
          await page.goto(p.path)
          await page.locator('h1').first().waitFor()
          await page.waitForTimeout(900)
          for (const step of p.setup ?? []) {
            try {
              await step(page)
            } catch {
              /* a control may be hidden at this size (e.g. behind mobile tabs) */
            }
          }
          await page.waitForTimeout(400)
          await page.screenshot({ path: `screenshots/${size}/${theme}/${p.name}.png` })
        })
      }
    })
  }
}
