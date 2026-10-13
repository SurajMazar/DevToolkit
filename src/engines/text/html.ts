/**
 * Text-only HTML stripping. This is a small tokenizer — it never builds a DOM and
 * never executes anything, so it is safe for untrusted markup and runs in workers/Node.
 */
import { decode as decodeEntity } from 'he'

/** Elements whose contents are not text and are dropped entirely. */
const RAW_DROP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'math', 'iframe', 'object', 'head', 'title'])

/** Block-level elements: a line break is inserted around them when `blockNewlines` is on. */
const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'dd', 'details', 'dialog', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer',
  'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'html', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary',
  'table', 'tbody', 'thead', 'tfoot', 'tr', 'ul', 'caption', 'option',
])

export interface StripHtmlOptions {
  /** Decode entities such as &amp; &lt; &#8212; into characters. */
  decodeEntities?: boolean
  /** Put block elements (p, div, li, br, tr…) on their own lines. */
  blockNewlines?: boolean
}

export interface StripHtmlResult {
  text: string
  tags: number
  entities: number
}

const RE_TAG_NAME = /^<\/?\s*([a-zA-Z][a-zA-Z0-9:-]*)/

export function stripHtml(input: string, opts: StripHtmlOptions = {}): StripHtmlResult {
  const decode = opts.decodeEntities ?? true
  const blocks = opts.blockNewlines ?? true
  let out = ''
  let tags = 0
  let i = 0
  const n = input.length
  const newline = () => {
    if (!blocks) return
    if (out !== '' && !out.endsWith('\n')) out += '\n'
  }

  while (i < n) {
    const lt = input.indexOf('<', i)
    if (lt === -1) {
      out += input.slice(i)
      break
    }
    out += input.slice(i, lt)
    const next = input[lt + 1]
    // Comments, doctype, CDATA, processing instructions.
    if (input.startsWith('<!--', lt)) {
      const end = input.indexOf('-->', lt + 4)
      i = end === -1 ? n : end + 3
      tags++
      continue
    }
    if (input.startsWith('<![CDATA[', lt)) {
      const end = input.indexOf(']]>', lt + 9)
      out += input.slice(lt + 9, end === -1 ? n : end)
      i = end === -1 ? n : end + 3
      tags++
      continue
    }
    if (next === '!' || next === '?') {
      const end = input.indexOf('>', lt + 2)
      i = end === -1 ? n : end + 1
      tags++
      continue
    }
    const nameMatch = RE_TAG_NAME.exec(input.slice(lt, lt + 64))
    if (!nameMatch) {
      // A bare "<" (e.g. "a < b") is text, not a tag.
      out += '<'
      i = lt + 1
      continue
    }
    const end = findTagEnd(input, lt + nameMatch[0].length)
    const closing = input[lt + 1] === '/' || /^<\s*\//.test(nameMatch[0])
    const name = nameMatch[1].toLowerCase()
    tags++
    i = end
    if (!closing && RAW_DROP.has(name)) {
      // Skip everything up to the matching close tag.
      const re = new RegExp(`</\\s*${name}\\s*>`, 'ig')
      re.lastIndex = i
      const close = re.exec(input)
      i = close ? close.index + close[0].length : n
      if (close) tags++
      continue
    }
    if (name === 'br') {
      out += blocks ? '\n' : ' '
      continue
    }
    if (name === 'td' || name === 'th') {
      if (closing && blocks) out += '\t'
      continue
    }
    if (BLOCK.has(name)) newline()
  }

  let entities = 0
  if (decode) {
    out = out.replace(/&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);?/g, (m) => {
      const d = decodeEntity(m)
      if (d !== m) entities++
      return d
    })
  }
  if (blocks) out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, /\n\s*$/.test(input) ? '\n' : '')
  return { text: out, tags, entities }
}

/** Finds the end of a tag starting after its name, honouring quoted attribute values. */
function findTagEnd(s: string, from: number): number {
  let quote = ''
  for (let i = from; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '>') return i + 1
  }
  return s.length
}
