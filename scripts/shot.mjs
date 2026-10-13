// Dev helper: capture a screenshot of a route.
// node scripts/shot.mjs <route> <out.png> [width] [height] [dark|light] [action...]
// actions: click:<accessible name>  clicktext:<exact text>  wait:<ms>  type:<text>  key:<key>  focus:<editorIndex>
//   `click:` tries buttons, then radios/tabs/options/comboboxes/links with that accessible name.
import { chromium } from '@playwright/test'

const [route = '/', out = 'shot.png', w = '1440', h = '900', theme = 'dark', ...actions] = process.argv.slice(2)
const base = process.env.BASE_URL ?? 'http://localhost:5173'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, colorScheme: theme })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.addInitScript((t) => localStorage.setItem('devtoolkit:prefs', JSON.stringify({ state: { theme: t }, version: 1 })), theme)

// The dev server may be mid-reload while other files change: retry navigation.
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    await page.goto(base + route, { waitUntil: 'networkidle', timeout: 30_000 })
    await page.locator('h1').first().waitFor({ timeout: 15_000 })
    break
  } catch (e) {
    if (attempt === 2) throw e
    await page.waitForTimeout(1500)
  }
}
await page.waitForTimeout(800)

async function clickByName(name) {
  for (const role of ['button', 'radio', 'tab', 'option', 'combobox', 'link', 'menuitem', 'checkbox', 'switch']) {
    const loc = page.getByRole(role, { name })
    if (await loc.count()) return loc.first().click()
  }
  return page.getByText(name, { exact: true }).first().click()
}

for (const a of actions) {
  const [kind, ...rest] = a.split(':')
  const arg = rest.join(':')
  if (kind === 'click') await clickByName(arg)
  else if (kind === 'clicktext') await page.getByText(arg, { exact: true }).first().click()
  else if (kind === 'wait') await page.waitForTimeout(+arg)
  else if (kind === 'type') await page.keyboard.type(arg)
  else if (kind === 'key') await page.keyboard.press(arg)
  else if (kind === 'focus') await page.locator('.monaco-editor textarea').nth(+arg || 0).focus()
}
await page.waitForTimeout(500)
await page.screenshot({ path: out })
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'))
await browser.close()
