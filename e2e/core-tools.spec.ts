import { test, expect } from '@playwright/test'
import { editorText, setEditor, trackErrors, waitForEditors } from './helpers'

test('case converter converts and switches formats', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/text/case-converter')
  await waitForEditors(page, 2)
  await setEditor(page, 0, 'user profile settings\nXMLHttpRequest')
  await expect.poll(() => editorText(page, 1)).toContain('userProfileSettings')
  await page.getByRole('option', { name: /snake_case/ }).click()
  await expect.poll(() => editorText(page, 1)).toContain('user_profile_settings')
  await expect.poll(() => editorText(page, 1)).toContain('xml_http_request')
  expect(errors).toEqual([])
})

test('JSON formatter formats, minifies and reports errors with location', async ({ page }) => {
  await page.goto('/json/formatter')
  await waitForEditors(page, 2)
  await setEditor(page, 0, '{"a":1,"big":12345678901234567890}')
  await expect.poll(() => editorText(page, 1)).toContain('"big": 12345678901234567890')
  await page.getByRole('radio', { name: 'Minify' }).click()
  await expect.poll(() => editorText(page, 1)).toContain('{"a":1,"big":12345678901234567890}')
  await setEditor(page, 0, '{\n  "a": 1,\n  "b": tru\n}')
  await expect(page.getByRole('alert').filter({ hasText: 'Invalid JSON' })).toContainText('line 3')
})

test('text diff computes statistics and navigates changes', async ({ page }) => {
  await page.goto('/compare/text')
  await waitForEditors(page, 2)
  await page.getByRole('button', { name: 'Load example' }).click()
  await expect(page.getByRole('status')).toContainText('+7')
  await page.getByRole('radio', { name: 'Diff' }).click()
  await expect(page.getByRole('table', { name: 'Differences' })).toBeVisible()
  await expect(page.getByText('1 / 5')).toBeVisible()
  await page.getByRole('button', { name: 'Next change' }).click()
  await expect(page.getByText('2 / 5')).toBeVisible()
  await page.getByRole('radio', { name: 'Unified' }).click()
  await expect(page.getByRole('table', { name: 'Differences' })).toContainText('logger.info')
})

test('json diff finds structural changes and honours ignore paths', async ({ page }) => {
  await page.goto('/compare/json')
  await waitForEditors(page, 2)
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('radio', { name: 'Changes' }).click()
  await expect(page.getByRole('list', { name: 'Changes' })).toContainText('$.order.status')
  const status = page.getByRole('status')
  await expect(status).toContainText('modified')
  await page.getByRole('button', { name: /Ignore/ }).click()
  await page.getByRole('textbox').filter({ hasText: '' }).last().fill('$.order.updatedAt')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('list', { name: 'Changes' })).not.toContainText('$.order.updatedAt')
  await expect(status).toContainText('Ignored')
})
