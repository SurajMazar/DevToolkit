// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isDataImageSrc, sanitizeRenderedHtml } from './markdown-sanitize'
import { renderMarkdown } from './markdown'

const preview = (html: string) => sanitizeRenderedHtml(html, { blockRemoteImages: true })
const exportHtml = (html: string) => sanitizeRenderedHtml(html, { blockRemoteImages: false })

describe('sanitizeRenderedHtml', () => {
  it('strips scripts, event handlers and javascript: URLs', () => {
    const { html } = preview('<p onclick="alert(1)">a</p><script>alert(2)</script><a href="javascript:alert(3)">x</a><img src=x onerror=alert(4)>')
    expect(html).not.toMatch(/onclick|onerror|<script|javascript:/i)
    expect(html).toContain('<p>a</p>')
  })

  it('removes styles, forms, iframes, media and SVG', () => {
    const { html } = preview(
      '<style>body{background:url(https://evil/x)}</style><p style="background:url(https://evil/y)">s</p><form action="https://evil"><input name="q"></form><iframe src="https://evil"></iframe><video src="https://evil/v.mp4" poster="https://evil/p.png"></video><svg><image href="https://evil/i.png"/></svg>',
    )
    expect(html).not.toMatch(/style|form|iframe|video|svg|evil/i)
    expect(html).toContain('<p>s</p>')
  })

  it('replaces remote images with a placeholder showing the URL', () => {
    const { html, blockedImages } = preview('<p><img src="https://example.com/logo.png" alt="Logo"> <img src="/relative.png"></p>')
    expect(blockedImages).toEqual(['https://example.com/logo.png', '/relative.png'])
    expect(html).not.toContain('<img')
    expect(html).toContain('md-remote-image')
    expect(html).toContain('Image: Logo')
    expect(html).toContain('https://example.com/logo.png')
  })

  it('keeps data: images, and keeps remote images when exporting', () => {
    const data = 'data:image/png;base64,iVBORw0KGgo='
    expect(preview(`<img src="${data}" alt="dot">`).html).toContain(`<img src="${data}" alt="dot">`)
    const exp = exportHtml('<img src="https://example.com/a.png" alt="a">')
    expect(exp.html).toContain('<img src="https://example.com/a.png" alt="a">')
    expect(exp.blockedImages).toEqual([])
  })

  it('removes srcset so remote candidates never load', () => {
    const { html } = preview(`<img src="data:image/gif;base64,R0lGOD" srcset="https://evil/2x.png 2x">`)
    expect(html).not.toContain('srcset')
  })

  it('opens external links in a new tab with noopener noreferrer; keeps in-page anchors', () => {
    const { html } = preview('<a href="https://example.com">e</a> <a href="#intro">i</a> <a href="mailto:a@b.c">m</a>')
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">e</a>')
    expect(html).toContain('<a href="#intro">i</a>')
    expect(html).toContain('<a href="mailto:a@b.c" target="_blank" rel="noopener noreferrer">m</a>')
  })

  it('keeps task list checkboxes (disabled) and drops other inputs', () => {
    const md = renderMarkdown('- [x] done\n- [ ] todo').html
    const { html } = preview(md + '<input type="text" value="x"><input type="image" src="https://evil/i.png">')
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(2)
    expect(html).not.toContain('type="text"')
    expect(html).not.toContain('evil')
    expect(html).toMatch(/disabled/)
    expect((html.match(/class="task-list-item/g) ?? []).length).toBe(2)
  })

  it('keeps heading ids from the renderer', () => {
    const { html } = preview(renderMarkdown('# Getting started').html)
    expect(html).toContain('id="getting-started"')
  })

  it('isDataImageSrc only accepts image data URIs', () => {
    expect(isDataImageSrc('data:image/png;base64,AAA')).toBe(true)
    expect(isDataImageSrc('data:image/svg+xml,<svg/>')).toBe(true)
    expect(isDataImageSrc('data:text/html;base64,AAA')).toBe(false)
    expect(isDataImageSrc('https://x/y.png')).toBe(false)
  })
})
