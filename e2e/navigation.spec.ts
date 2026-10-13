import { test, expect } from '@playwright/test'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('command palette finds tools by keyword', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press(`${mod}+k`)
  const input = page.getByPlaceholder('Search tools, pages and commands…')
  await expect(input).toBeVisible()
  await input.fill('camel')
  await expect(page.getByRole('option').first()).toContainText('Case Converter')
  await input.fill('JWT')
  await expect(page.getByRole('option').first()).toContainText('JWT Decoder')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/encoding\/jwt$/)
})

test('home search filters tools inline', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('textbox', { name: 'Search tools' }).fill('yaml')
  await expect(page.getByRole('region', { name: 'Search results' }).getByRole('link', { name: /JSON ⇄ YAML/ })).toBeVisible()
})

test('favorites pin to sidebar and home, and survive reload', async ({ page }) => {
  await page.goto('/json/formatter')
  await page.getByRole('button', { name: 'Pin to favorites' }).click()
  await expect(page.getByRole('button', { name: 'Unpin from favorites' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'Tools' }).getByText('Pinned')).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Pinned tools' })).toContainText('JSON Formatter')
})

test('recently used tools are tracked', async ({ page }) => {
  await page.goto('/generators/uuid')
  await page.goto('/text/case-converter')
  await page.goto('/recent')
  const rows = page.locator('main a[href^="/"]')
  await expect(rows.first()).toContainText('Case Converter')
})

test('theme can be switched and persists', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('radio', { name: 'Light' }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.reload()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.getByRole('radio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
})

test('sidebar collapses with keyboard shortcut', async ({ page }) => {
  await page.goto('/')
  const aside = page.locator('aside').first()
  const before = (await aside.boundingBox())!.width
  await page.keyboard.press(`${mod}+Backslash`)
  await expect.poll(async () => (await aside.boundingBox())!.width).toBeLessThan(before)
})
