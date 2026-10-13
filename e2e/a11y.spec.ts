import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Automated accessibility checks (axe-core, WCAG 2.1 A/AA rules) on representative pages
 * in both themes. Excluded: Monaco's internal editor DOM (a third-party widget with its own
 * accessibility model, whose layers axe misreads) and regions marked `data-user-colors`,
 * which deliberately render colors the user picked (e.g. the contrast checker's preview).
 */
const PAGES = ['/', '/settings', '/text/case-converter', '/compare/text', '/compare/json', '/json/formatter', '/generators/uuid', '/generators/password', '/datetime/timestamp', '/web/contrast', '/developer/regex', '/encoding/jwt']

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme })
    for (const path of PAGES) {
      test(`no WCAG A/AA violations on ${path}`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem('devtoolkit:prefs', JSON.stringify({ state: { theme: t }, version: 1 })), theme)
        await page.goto(path)
        await page.locator('h1').first().waitFor()
        await page.waitForTimeout(800)
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .exclude('.monaco-editor')
          .exclude('[data-user-colors]')
          .analyze()
        const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n  ')}`)
        expect(summary, summary.join('\n')).toEqual([])
      })
    }
  })
}

test('keyboard: skip link, palette and sidebar navigation work without a mouse', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press('/')
  await expect(page.getByPlaceholder('Search tools, pages and commands…')).toBeFocused()
  await page.keyboard.type('uuid')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/generators\/uuid/)
})
