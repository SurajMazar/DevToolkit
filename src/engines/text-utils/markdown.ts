/**
 * GitHub-flavored Markdown rendering (marked) with heading anchors, an outline and
 * document statistics. Output is UNSANITIZED HTML — always pass it through
 * `sanitizeRenderedHtml` (./markdown-sanitize) before inserting it into a page.
 */
import { Marked, type Token, type Tokens } from 'marked'
import { countWords } from '@/engines/text/stats'

export interface MarkdownHeading {
  level: number
  text: string
  id: string
}

export interface RenderedMarkdown {
  html: string
  headings: MarkdownHeading[]
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }

function decodeBasicEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) => ENTITY[e])
}

/** Plain text of inline tokens (for outline labels and slugs). */
export function inlineTokensToText(tokens: Token[] | undefined): string {
  if (!tokens) return ''
  let out = ''
  for (const t of tokens) {
    if ('tokens' in t && Array.isArray(t.tokens) && t.type !== 'codespan') out += inlineTokensToText(t.tokens)
    else if (t.type === 'html' || t.type === 'tag') continue
    else if (t.type === 'br') out += ' '
    else if ('text' in t && typeof t.text === 'string') out += t.text
  }
  return decodeBasicEntities(out)
}

/**
 * GitHub-style heading slug: lowercase, drop punctuation (keeping letters, numbers,
 * spaces, hyphens and underscores from any script), spaces → hyphens.
 */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-')
}

/** Assigns unique ids the way GitHub does: foo, foo-1, foo-2… */
export class Slugger {
  private seen = new Map<string, number>()
  slug(text: string): string {
    const base = headingSlug(text) || 'section'
    let id = base
    while (this.seen.has(id)) {
      const n = (this.seen.get(base) ?? 0) + 1
      this.seen.set(base, n)
      id = `${base}-${n}`
    }
    this.seen.set(id, 0)
    return id
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Render GFM Markdown (tables, task lists, strikethrough, autolinks, fenced code). */
export function renderMarkdown(src: string): RenderedMarkdown {
  const headings: MarkdownHeading[] = []
  const slugger = new Slugger()
  const md = new Marked({ gfm: true, breaks: false, async: false })
  md.use({
    renderer: {
      heading(this: { parser: { parseInline: (t: Token[]) => string } }, token: Tokens.Heading) {
        const text = inlineTokensToText(token.tokens).trim()
        const id = slugger.slug(text)
        headings.push({ level: token.depth, text: text || '(empty heading)', id })
        return `<h${token.depth} id="${escapeAttr(id)}">${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`
      },
      code(token: Tokens.Code) {
        const lang = (token.lang ?? '').match(/^\S*/)?.[0] ?? ''
        const body = token.escaped ? token.text : escapeHtml(token.text)
        const cls = lang ? ` class="language-${escapeAttr(lang)}"` : ''
        return `<pre><code${cls}>${body}\n</code></pre>\n`
      },
    },
  })
  const html = md.parse(src) as string
  return { html, headings }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export interface MarkdownStats {
  words: number
  /** Estimated reading time in whole minutes (at least 1 for any non-empty text). */
  readingMinutes: number
  headings: number
  characters: number
}

/** Strip Markdown syntax that would inflate a word count (code fences, URLs, markup). */
export function markdownToPlainText(src: string): string {
  return src
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, ' ') // fenced code blocks
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images → alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text
    .replace(/<[^>]+>/g, ' ') // inline HTML tags
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '') // block markers
    .replace(/^\s*\[[ xX]\]\s+/gm, '')
    .replace(/[*_~`|]/g, ' ')
}

export function markdownStats(src: string, wordsPerMinute = 238): MarkdownStats {
  const words = countWords(markdownToPlainText(src))
  const headings = (src.match(/^ {0,3}#{1,6}(\s|$)/gm) ?? []).length
  return {
    words,
    readingMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / wordsPerMinute)),
    headings,
    characters: src.length,
  }
}

/** Minimal, self-contained stylesheet for exported HTML (light + dark via media query). */
export const EXPORT_CSS = `:root{color-scheme:light dark;--fg:#1c1d20;--muted:#5c5d63;--bg:#fff;--surface:#f3f2ef;--border:#e2e0da;--accent:#0f6f68}
@media (prefers-color-scheme:dark){:root{--fg:#ecebe6;--muted:#a1a1a6;--bg:#18191c;--surface:#202226;--border:#2f3136;--accent:#6dcdc2}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:760px;margin:0 auto;padding:40px 24px 64px}
main>*+*{margin-top:.9em}
h1,h2,h3,h4,h5,h6{line-height:1.3;font-weight:600;margin:1.5em 0 .5em}
h1{font-size:2em;margin-top:0}h2{font-size:1.5em;padding-bottom:.3em;border-bottom:1px solid var(--border)}h3{font-size:1.2em}
a{color:var(--accent)}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em}
code{background:var(--surface);padding:.15em .35em;border-radius:4px}
pre{background:var(--surface);padding:14px 16px;border-radius:6px;overflow:auto;line-height:1.5}
pre code{background:none;padding:0}
blockquote{margin-left:0;padding-left:1em;border-left:3px solid var(--border);color:var(--muted)}
table{border-collapse:collapse;display:block;overflow:auto}
th,td{border:1px solid var(--border);padding:6px 12px}th{background:var(--surface);text-align:left}
img{max-width:100%}hr{border:0;border-top:1px solid var(--border)}
li>input[type=checkbox]{margin-right:.4em}
.task-list-item{list-style:none;margin-left:-1.3em}`

/** Wrap sanitized body HTML in a standalone document. */
export function buildStandaloneHtml(bodyHtml: string, title: string): string {
  const safeTitle = escapeHtml(title.trim() || 'Document')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="DevToolkit Markdown Preview">
<title>${safeTitle}</title>
<style>
${EXPORT_CSS}
</style>
</head>
<body>
<main>
${bodyHtml.trim()}
</main>
</body>
</html>
`
}

/** Title for exports: first heading, else a generic name. */
export function documentTitle(headings: MarkdownHeading[]): string {
  return headings.find((h) => h.level === 1)?.text ?? headings[0]?.text ?? 'Document'
}

/** File-name friendly version of a title. */
export function titleToFilename(title: string): string {
  const base = headingSlug(title).replace(/[^\w-]/g, '').slice(0, 60)
  return base || 'document'
}
