import { expect, type Page } from '@playwright/test'

/** Collects uncaught page errors and console errors during a test. */
export function trackErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    // Browser-level noise unrelated to the app.
    if (/favicon|Failed to load resource: net::ERR_INTERNET_DISCONNECTED/.test(t)) return
    errors.push(`console: ${t}`)
  })
  return errors
}

/**
 * Replaces the content of the n-th editor by dropping a file onto it — the same path a
 * user takes with drag-and-drop. Deterministic, unlike simulated typing (Monaco
 * auto-closes brackets and auto-indents typed input).
 */
export async function setEditor(page: Page, index: number, text: string) {
  await page.evaluate(
    ({ index, text }) => {
      const target = document.querySelectorAll('.monaco-editor')[index]
      const dt = new DataTransfer()
      dt.items.add(new File([text], 'input.txt', { type: 'text/plain' }))
      for (const ev of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(ev, { bubbles: true, cancelable: true, dataTransfer: dt }))
    },
    { index, text },
  )
  await expect.poll(async () => (await editorText(page, index)).replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''))
}

/** Drops a file onto a drop zone (the element under `selector`). */
export async function dropFile(page: Page, selector: string, name: string, content: string, type = 'text/plain') {
  await page.evaluate(
    ({ selector, name, content, type }) => {
      const target = document.querySelector(selector)!
      const dt = new DataTransfer()
      dt.items.add(new File([content], name, { type }))
      for (const ev of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(ev, { bubbles: true, cancelable: true, dataTransfer: dt }))
    },
    { selector, name, content, type },
  )
}

export async function editorText(page: Page, index: number): Promise<string> {
  const t = await page.locator('.monaco-editor').nth(index).locator('.view-lines').innerText()
  return t.replace(/\u00a0/g, ' ')
}

export async function waitForEditors(page: Page, count = 1) {
  await expect(page.locator('.monaco-editor')).toHaveCount(count, { timeout: 20_000 })
}
