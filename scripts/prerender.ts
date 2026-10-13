/**
 * Post-build: writes a static HTML entry for every route (home, categories, tools) with
 * its own <title>, description, canonical URL, Open Graph tags and crawlable content, plus
 * sitemap.xml. The client app replaces the static content when it boots.
 *
 * Canonical URLs and the sitemap need the public origin: set SITE_URL (e.g.
 * SITE_URL=https://devtoolkit.example.com npm run build). Without it, canonical tags and
 * the sitemap are omitted rather than guessed.
 *
 * Run with Node ≥ 23.6 (native TypeScript type stripping).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CATEGORIES, TOOLS, type ToolMeta } from '../src/registry/tools.data.ts'

const dist = join(import.meta.dirname, '..', 'dist')
const site = (process.env.SITE_URL ?? '').replace(/\/$/, '')
const template = readFileSync(join(dist, 'index.html'), 'utf8')

// Only tools that are actually implemented get pages.
const implemented = TOOLS.filter((t) => existsSync(join(import.meta.dirname, '..', 'src', 'tools', t.module, 'index.tsx')))

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function page(path: string, title: string, description: string, body: string): string {
  const fullTitle = path === '/' ? title : `${title} — DevToolkit`
  const head = [
    `<title>${esc(fullTitle)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    site && `<link rel="canonical" href="${esc(site + path)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(fullTitle)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    site && `<meta property="og:url" content="${esc(site + path)}" />`,
    `<meta property="og:site_name" content="DevToolkit" />`,
    `<meta name="twitter:card" content="summary" />`,
  ]
    .filter(Boolean)
    .join('\n    ')
  return template
    .replace(/<!--seo:start-->[\s\S]*<!--seo:end-->/, head)
    .replace('<div id="root"></div>', `<div id="root"><div class="seo-static" style="max-width:760px;margin:40px auto;padding:0 16px;font:14px/1.6 system-ui,sans-serif">${body}</div></div>`)
}

const toolList = (tools: ToolMeta[]) => `<ul>${tools.map((t) => `<li><a href="${t.path}">${esc(t.name)}</a> — ${esc(t.description)}</li>`).join('')}</ul>`

/** Writes /a/b as a/b.html (served at /a/b via clean URLs on Vercel and by `vite preview`). */
function write(path: string, html: string) {
  const file = path === '/' ? join(dist, 'index.html') : join(dist, `${path.slice(1)}.html`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, html)
}

const pages: string[] = ['/']

write(
  '/',
  page(
    '/',
    'DevToolkit — Every developer utility. One workspace.',
    `Case converter, text and JSON diff, JSON formatter, encoders, generators and ${implemented.length} developer utilities. Runs entirely in your browser — nothing you paste leaves your device.`,
    `<main><h1>DevToolkit</h1><p>Every developer utility. One workspace. All processing happens locally in your browser.</p>${CATEGORIES.map(
      (c) => `<section><h2><a href="${c.path}">${esc(c.name)}</a></h2><p>${esc(c.description)}</p>${toolList(implemented.filter((t) => t.category === c.id))}</section>`,
    ).join('')}</main>`,
  ),
)

for (const c of CATEGORIES) {
  const list = implemented.filter((t) => t.category === c.id || t.alsoIn?.includes(c.id))
  write(c.path, page(c.path, c.name, c.description, `<main><h1>${esc(c.name)}</h1><p>${esc(c.description)}</p>${toolList(list)}</main>`))
  pages.push(c.path)
}

for (const t of implemented) {
  const cat = CATEGORIES.find((c) => c.id === t.category)!
  const related = implemented.filter((x) => x.category === t.category && x.id !== t.id).slice(0, 8)
  const body = `<main><p><a href="${cat.path}">${esc(cat.name)}</a></p><h1>${esc(t.name)}</h1><p>${esc(t.description)}</p><p>Runs entirely in your browser: nothing you paste or upload is sent to a server.</p><p>Related: ${esc(t.keywords.slice(0, 10).join(', '))}</p><h2>More ${esc(cat.name.toLowerCase())}</h2>${toolList(related)}</main>`
  write(t.path, page(t.path, t.name, t.description, body))
  pages.push(t.path)
}

if (site) {
  const today = new Date().toISOString().slice(0, 10)
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${esc(site + p)}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`
  writeFileSync(join(dist, 'sitemap.xml'), xml)
  writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${site}/sitemap.xml\n`)
}

console.log(`prerendered ${pages.length} pages${site ? ` + sitemap for ${site}` : ' (set SITE_URL to emit canonical URLs and a sitemap)'}`)
