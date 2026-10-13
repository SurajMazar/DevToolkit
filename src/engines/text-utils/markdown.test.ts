import { describe, expect, it } from 'vitest'
import { buildStandaloneHtml, documentTitle, headingSlug, markdownStats, markdownToPlainText, renderMarkdown, Slugger, titleToFilename } from './markdown'

describe('headingSlug / Slugger', () => {
  it('slugs like GitHub', () => {
    expect(headingSlug('Hello, World!')).toBe('hello-world')
    expect(headingSlug('  API v2.0 — Overview ')).toBe('api-v20--overview')
    expect(headingSlug('Ünïcödé Straße')).toBe('ünïcödé-straße')
    expect(headingSlug('foo_bar-baz')).toBe('foo_bar-baz')
    expect(headingSlug('日本語 見出し')).toBe('日本語-見出し')
  })

  it('dedupes repeated headings', () => {
    const s = new Slugger()
    expect(s.slug('Intro')).toBe('intro')
    expect(s.slug('Intro')).toBe('intro-1')
    expect(s.slug('Intro')).toBe('intro-2')
    expect(s.slug('Intro 1')).toBe('intro-1-1')
  })

  it('falls back for headings without slug characters', () => {
    const s = new Slugger()
    expect(s.slug('!!!')).toBe('section')
    expect(s.slug('???')).toBe('section-1')
  })
})

describe('renderMarkdown', () => {
  it('renders GFM: tables, task lists, strikethrough, autolinks, fenced code', () => {
    const md = [
      '# Title',
      '',
      '| a | b |',
      '|---|:-:|',
      '| 1 | 2 |',
      '',
      '- [x] done',
      '- [ ] todo',
      '',
      '~~gone~~ and https://example.com',
      '',
      '```ts',
      'const x = 1 < 2',
      '```',
    ].join('\n')
    const { html, headings } = renderMarkdown(md)
    expect(html).toContain('<h1 id="title">Title</h1>')
    expect(html).toContain('<table>')
    expect(html).toContain('<th align="center">b</th>')
    expect(html).toMatch(/<input [^>]*checked[^>]*type="checkbox"|<input checked="" disabled="" type="checkbox"/)
    expect(html).toContain('<del>gone</del>')
    expect(html).toContain('<a href="https://example.com">https://example.com</a>')
    expect(html).toContain('<pre><code class="language-ts">const x = 1 &lt; 2\n</code></pre>')
    expect(headings).toEqual([{ level: 1, text: 'Title', id: 'title' }])
  })

  it('collects an outline with inline formatting stripped and unique ids', () => {
    const { headings, html } = renderMarkdown('## Using `npm` & **pnpm**\n\n## Using `npm` & **pnpm**\n\nSetext\n---\n')
    expect(headings.map((h) => h.text)).toEqual(['Using npm & pnpm', 'Using npm & pnpm', 'Setext'])
    expect(headings.map((h) => h.id)).toEqual(['using-npm--pnpm', 'using-npm--pnpm-1', 'setext'])
    expect(headings.map((h) => h.level)).toEqual([2, 2, 2])
    expect(html).toContain('<h2 id="using-npm--pnpm">Using <code>npm</code> &amp; <strong>pnpm</strong></h2>')
  })

  it('passes raw HTML through (sanitized later) and handles empty input', () => {
    expect(renderMarkdown('<b onclick="x()">hi</b>').html).toContain('onclick')
    expect(renderMarkdown('')).toEqual({ html: '', headings: [] })
  })

  it('escapes code without language and keeps emoji / CJK text', () => {
    const { html } = renderMarkdown('```\n<script>alert(1)</script>\n```\n\n你好 👋')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('你好 👋')
  })

  it('renders a large document quickly', () => {
    const section = '## Section\n\nSome *text* with a [link](https://x.y) and `code`.\n\n- a\n- b\n\n'
    const md = section.repeat(3000)
    const t0 = performance.now()
    const { headings } = renderMarkdown(md)
    expect(headings).toHaveLength(3000)
    expect(headings[2999].id).toBe('section-2999')
    expect(performance.now() - t0).toBeLessThan(3000)
  })
})

describe('markdownStats', () => {
  it('counts words ignoring markup, URLs and code blocks', () => {
    const md = '# Hello world\n\nSee [the docs](https://example.com/a/b/c) for **more** info.\n\n```\nignored code words here\n```\n'
    expect(markdownToPlainText(md)).not.toContain('ignored')
    const s = markdownStats(md)
    expect(s.words).toBe(8) // Hello world See the docs for more info
    expect(s.headings).toBe(1)
    expect(s.readingMinutes).toBe(1)
  })

  it('reports zero for empty input and scales reading time', () => {
    expect(markdownStats('').readingMinutes).toBe(0)
    expect(markdownStats('word '.repeat(1190)).readingMinutes).toBe(5)
  })
})

describe('standalone export', () => {
  it('builds a complete document with embedded styles and escaped title', () => {
    const doc = buildStandaloneHtml('<p>Hi</p>', 'A <b> & C')
    expect(doc.startsWith('<!doctype html>')).toBe(true)
    expect(doc).toContain('<title>A &lt;b&gt; &amp; C</title>')
    expect(doc).toContain('<style>')
    expect(doc).toContain('<main>\n<p>Hi</p>\n</main>')
    expect(doc).not.toMatch(/<script|<link/)
  })

  it('derives titles and filenames', () => {
    expect(documentTitle([{ level: 2, text: 'Sub', id: 'sub' }, { level: 1, text: 'Main', id: 'main' }])).toBe('Main')
    expect(documentTitle([])).toBe('Document')
    expect(titleToFilename('My Project — README!')).toBe('my-project--readme')
    expect(titleToFilename('???')).toBe('document')
  })
})
