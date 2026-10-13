// Renders the DevToolkit mark to PNG app icons (run: node scripts/icons.mjs).
import { chromium } from '@playwright/test'

const mark = (size, pad) => `<!doctype html><html><body style="margin:0;background:transparent">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="${pad ? 0 : 7}" fill="#141517"/>
  <g transform="translate(16 16) scale(${pad ? 0.72 : 1}) translate(-16 -16)">
    <rect x="7" y="9" width="13" height="3.2" rx="1.6" fill="#ecebe6"/>
    <rect x="11" y="14.4" width="14" height="3.2" rx="1.6" fill="#4fbdb1"/>
    <rect x="7" y="19.8" width="9" height="3.2" rx="1.6" fill="#ecebe6" opacity=".55"/>
  </g>
</svg></body></html>`

const browser = await chromium.launch()
const page = await browser.newPage()
for (const [size, name, pad] of [[192, 'icon-192.png', false], [512, 'icon-512.png', false], [512, 'icon-maskable-512.png', true], [180, 'apple-touch-icon.png', true]]) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(mark(size, pad))
  await page.locator('svg').screenshot({ path: `public/${name}`, omitBackground: true })
}
await browser.close()
console.log('icons written')
