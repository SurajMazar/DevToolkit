import { tokenizeHtml, type HtmlAttr, type HtmlToken, type TokenizeIssue } from './tokenizer'
import { minifyCss, minifyDeclarations } from '@/engines/css/minify'

export type WhitespaceMode = 'keep' | 'conservative' | 'smart'

export interface HtmlMinifyOptions {
  removeComments: boolean
  /** Keep IE conditional comments (`<!--[if IE]>…<![endif]-->`). */
  keepConditionalComments: boolean
  /** Keep comments starting with `<!--!`. */
  keepBangComments: boolean
  /**
   * keep         — leave all text whitespace untouched
   * conservative — collapse whitespace runs to a single space, never remove it
   * smart        — also drop whitespace next to block-level tags and inside <head>
   */
  whitespace: WhitespaceMode
  /** Minify `<style>` contents and `style=""` attributes with csso. */
  minifyCss: boolean
}

export const DEFAULT_HTML_MINIFY: HtmlMinifyOptions = {
  removeComments: true,
  keepConditionalComments: true,
  keepBangComments: true,
  whitespace: 'smart',
  minifyCss: false,
}

export interface HtmlMinifyStats {
  commentsRemoved: number
  whitespaceRemoved: number
  stylesMinified: number
}

export interface HtmlMinifyResult {
  output: string
  error?: TokenizeIssue
  warnings: string[]
  stats: HtmlMinifyStats
}

/** Elements whose content (including nested markup) keeps its whitespace exactly. */
const PRESERVE = new Set(['pre', 'textarea', 'listing', 'plaintext', 'xmp'])

/**
 * Elements rendered as blocks (or not rendered at all) by default — whitespace next to
 * their tags is never significant in normal flow.
 */
export const BLOCK_ELEMENTS = new Set([
  'address', 'article', 'aside', 'base', 'blockquote', 'body', 'caption', 'col', 'colgroup', 'dd', 'details', 'dialog', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'legend',
  'li', 'link', 'main', 'menu', 'meta', 'nav', 'ol', 'optgroup', 'option', 'p', 'param', 'pre', 'search', 'section', 'source', 'summary', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul',
])

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

const WS_RUN = /[ \t\n\f\r]+/g
const ONLY_WS = /^[ \t\n\f\r]*$/

export function isConditionalComment(value: string): boolean {
  const v = value.trim()
  return /^\[if\b[^\]]*\]/i.test(v) || /^<!\[endif\]/i.test(v) || /<!\[endif\]$/i.test(v)
}

/** Minified `style` attribute value — or the original when minifying could break quoting. */
function minifyStyleAttr(a: HtmlAttr): string | null {
  if (a.value === null || a.name.toLowerCase() !== 'style') return a.value
  const m = minifyDeclarations(a.value)
  const unsafe = a.quote ? m.includes(a.quote) : m === '' || /[\s"'=<>`]/.test(m)
  return unsafe ? a.value : m
}

function serializeStartTag(t: Extract<HtmlToken, { type: 'startTag' }>, mapAttr?: (a: HtmlAttr) => string | null): string {
  let s = '<' + t.name
  for (const a of t.attrs) {
    s += ' ' + a.name
    const v = mapAttr ? mapAttr(a) : a.value
    if (v !== null) s += '=' + a.quote + v + a.quote
  }
  if (t.selfClosing) {
    const lastAttr = t.attrs[t.attrs.length - 1]
    // `<img src=a.png />` must not become `src=a.png/` (the slash would join the value).
    s += lastAttr && lastAttr.value !== null && lastAttr.quote === '' ? ' /' : '/'
  }
  return s + '>'
}

type Item =
  | { kind: 'text'; value: string; preserve: boolean }
  | { kind: 'tag'; html: string; block: boolean; inHead: boolean }
  | { kind: 'other'; html: string }

/**
 * Tokenizer-based HTML minifier. It removes comments and insignificant whitespace and
 * normalizes whitespace inside tags, but leaves attribute values, `<pre>`, `<textarea>`,
 * `<script>` and `<style>` content byte-for-byte intact (style optionally minified).
 */
export function minifyHtml(src: string, options: HtmlMinifyOptions = DEFAULT_HTML_MINIFY): HtmlMinifyResult {
  const stats: HtmlMinifyStats = { commentsRemoved: 0, whitespaceRemoved: 0, stylesMinified: 0 }
  const warnings: string[] = []
  const { tokens, errors } = tokenizeHtml(src)
  if (errors.length) return { output: '', error: errors[0], warnings, stats }

  const items: Item[] = []
  let preserveDepth = 0
  let headDepth = 0
  let styleFailures = 0

  const pushText = (value: string, preserve: boolean) => {
    const prev = items[items.length - 1]
    if (prev && prev.kind === 'text' && prev.preserve === preserve) prev.value += value
    else items.push({ kind: 'text', value, preserve })
  }

  for (const t of tokens) {
    switch (t.type) {
      case 'text':
        pushText(t.value, preserveDepth > 0 || options.whitespace === 'keep')
        break
      case 'comment': {
        const keep =
          !options.removeComments ||
          (options.keepConditionalComments && isConditionalComment(t.value)) ||
          (options.keepBangComments && t.value.startsWith('!'))
        if (keep) items.push({ kind: 'other', html: t.raw })
        else stats.commentsRemoved++
        break
      }
      case 'doctype':
      case 'pi':
      case 'cdata':
        items.push({ kind: 'other', html: t.raw })
        break
      case 'startTag': {
        const html = serializeStartTag(t, options.minifyCss ? minifyStyleAttr : undefined)
        items.push({ kind: 'tag', html, block: BLOCK_ELEMENTS.has(t.lname), inHead: headDepth > 0 })
        if (!t.selfClosing && !VOID.has(t.lname)) {
          if (PRESERVE.has(t.lname)) preserveDepth++
          if (t.lname === 'head') headDepth++
        }
        if (t.lname === 'body') headDepth = 0
        break
      }
      case 'endTag':
        items.push({ kind: 'tag', html: `</${t.name}>`, block: BLOCK_ELEMENTS.has(t.lname), inHead: headDepth > 0 })
        if (PRESERVE.has(t.lname)) preserveDepth = Math.max(0, preserveDepth - 1)
        if (t.lname === 'head') headDepth = Math.max(0, headDepth - 1)
        break
      case 'rawText': {
        if (t.parent === 'style' && options.minifyCss) {
          const r = minifyCss(t.value, { restructure: false, comments: 'all' })
          if (r.error) {
            styleFailures++
            items.push({ kind: 'other', html: t.value })
          } else {
            stats.stylesMinified++
            items.push({ kind: 'other', html: r.output })
          }
        } else items.push({ kind: 'other', html: t.value })
        break
      }
    }
  }
  if (styleFailures) warnings.push(`${styleFailures} <style> block${styleFailures > 1 ? 's' : ''} could not be parsed as CSS and ${styleFailures > 1 ? 'were' : 'was'} left unchanged.`)

  // Whitespace pass.
  const out: string[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind !== 'text') {
      out.push(it.html)
      continue
    }
    if (it.preserve) {
      out.push(it.value)
      continue
    }
    let v = it.value.replace(WS_RUN, ' ')
    if (options.whitespace === 'smart') {
      const prev = items[i - 1]
      const next = items[i + 1]
      const prevBoundary = !prev || (prev.kind === 'tag' && prev.block) || (prev.kind === 'other' && /^<!doctype/i.test(prev.html))
      const nextBoundary = !next || (next.kind === 'tag' && next.block)
      const inHead = (prev?.kind === 'tag' && prev.inHead) || (next?.kind === 'tag' && next.inHead)
      if (ONLY_WS.test(it.value) && inHead) v = ''
      if (prevBoundary) v = v.replace(/^ /, '')
      if (nextBoundary) v = v.replace(/ $/, '')
    }
    stats.whitespaceRemoved += it.value.length - v.length
    out.push(v)
  }
  return { output: out.join(''), warnings, stats }
}
