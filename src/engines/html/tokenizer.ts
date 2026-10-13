/**
 * A small, forgiving HTML/XML tokenizer. It never builds a tree and never executes
 * anything: it only splits markup into tokens while keeping every byte of the source
 * addressable (each token knows its `start`/`end` offsets), so callers can re-serialize
 * the parts they don't want to change verbatim.
 *
 * It follows the HTML tokenizer closely enough for minification and inspection:
 * raw-text elements (`<script>`, `<style>`, `<textarea>`, `<title>` …) are consumed up
 * to their matching end tag, quoted attribute values may contain `>` and newlines, and
 * a `<` that cannot start a tag is plain text.
 */

export interface HtmlAttr {
  /** Attribute name as written (original case). */
  name: string
  /** Value without quotes; `null` for value-less attributes such as `disabled`. */
  value: string | null
  quote: '"' | "'" | ''
  start: number
  end: number
}

interface Span {
  start: number
  end: number
}

export type HtmlToken =
  | ({ type: 'text'; value: string } & Span)
  | ({ type: 'comment'; value: string; raw: string } & Span)
  | ({ type: 'doctype'; raw: string } & Span)
  | ({ type: 'cdata'; raw: string; value: string } & Span)
  | ({ type: 'pi'; raw: string } & Span)
  | ({ type: 'startTag'; name: string; lname: string; attrs: HtmlAttr[]; selfClosing: boolean; raw: string } & Span)
  | ({ type: 'endTag'; name: string; lname: string; raw: string } & Span)
  | ({ type: 'rawText'; value: string; parent: string } & Span)

export interface TokenizeIssue {
  message: string
  offset: number
  line: number
  column: number
}

export interface TokenizeResult {
  tokens: HtmlToken[]
  errors: TokenizeIssue[]
}

export interface TokenizeOptions {
  /** Lower-case names of elements whose content is raw text. Defaults to HTML's set. */
  rawTextElements?: ReadonlySet<string>
}

export const HTML_RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext'])

/** In XML/SVG only `<script>` and `<style>` typically hold unescaped text. */
export const XML_RAW_TEXT = new Set(['script', 'style'])

export function offsetToLineColumn(src: string, offset: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  const end = Math.min(offset, src.length)
  for (let i = 0; i < end; i++) {
    if (src.charCodeAt(i) === 10) {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: end - lineStart + 1 }
}

const isWs = (c: number) => c === 32 || c === 9 || c === 10 || c === 12 || c === 13
const isAlpha = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122)

/** Finds `</name` (case-insensitive) followed by whitespace, `/` or `>`. */
function findEndTag(src: string, from: number, lname: string): number {
  let i = from
  for (;;) {
    const lt = src.indexOf('</', i)
    if (lt === -1) return -1
    const candidate = src.slice(lt + 2, lt + 2 + lname.length).toLowerCase()
    if (candidate === lname) {
      const after = src.charCodeAt(lt + 2 + lname.length)
      if (Number.isNaN(after) || isWs(after) || after === 47 /* / */ || after === 62 /* > */) return lt
    }
    i = lt + 2
  }
}

export function tokenizeHtml(src: string, options: TokenizeOptions = {}): TokenizeResult {
  const rawText = options.rawTextElements ?? HTML_RAW_TEXT
  const tokens: HtmlToken[] = []
  const errors: TokenizeIssue[] = []
  const n = src.length
  let i = 0
  let textStart = 0

  const issue = (message: string, offset: number) => {
    errors.push({ message, offset, ...offsetToLineColumn(src, offset) })
  }
  const flushText = (upto: number) => {
    if (upto > textStart) tokens.push({ type: 'text', value: src.slice(textStart, upto), start: textStart, end: upto })
  }

  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt === -1) break
    const c1 = src.charCodeAt(lt + 1)

    // Comment / CDATA / doctype & other declarations.
    if (c1 === 33 /* ! */) {
      if (src.startsWith('<!--', lt)) {
        flushText(lt)
        // `<!-->` and `<!--->` are (abruptly closed) empty comments.
        let close: number
        let bodyEnd: number
        if (src.startsWith('<!-->', lt)) {
          close = lt + 5
          bodyEnd = lt + 4
        } else if (src.startsWith('<!--->', lt)) {
          close = lt + 6
          bodyEnd = lt + 4
        } else {
          const e = src.indexOf('-->', lt + 4)
          if (e === -1) {
            issue('Unterminated comment: “<!--” has no closing “-->”', lt)
            close = n
            bodyEnd = n
          } else {
            close = e + 3
            bodyEnd = e
          }
        }
        tokens.push({ type: 'comment', value: src.slice(lt + 4, bodyEnd), raw: src.slice(lt, close), start: lt, end: close })
        i = textStart = close
        continue
      }
      if (src.startsWith('<![CDATA[', lt)) {
        flushText(lt)
        const e = src.indexOf(']]>', lt + 9)
        const close = e === -1 ? n : e + 3
        if (e === -1) issue('Unterminated CDATA section', lt)
        tokens.push({ type: 'cdata', raw: src.slice(lt, close), value: src.slice(lt + 9, e === -1 ? n : e), start: lt, end: close })
        i = textStart = close
        continue
      }
      flushText(lt)
      const e = src.indexOf('>', lt + 2)
      const close = e === -1 ? n : e + 1
      if (e === -1) issue('Unterminated declaration: “<!” has no closing “>”', lt)
      tokens.push({ type: 'doctype', raw: src.slice(lt, close), start: lt, end: close })
      i = textStart = close
      continue
    }

    // Processing instruction (<?xml … ?>) — HTML treats it as a bogus comment up to `>`.
    if (c1 === 63 /* ? */) {
      flushText(lt)
      const e = src.indexOf('>', lt + 2)
      const close = e === -1 ? n : e + 1
      if (e === -1) issue('Unterminated processing instruction', lt)
      tokens.push({ type: 'pi', raw: src.slice(lt, close), start: lt, end: close })
      i = textStart = close
      continue
    }

    // End tag.
    if (c1 === 47 /* / */ && isAlpha(src.charCodeAt(lt + 2))) {
      flushText(lt)
      let j = lt + 2
      while (j < n && !isWs(src.charCodeAt(j)) && src.charCodeAt(j) !== 62 && src.charCodeAt(j) !== 47) j++
      const name = src.slice(lt + 2, j)
      const e = src.indexOf('>', j)
      const close = e === -1 ? n : e + 1
      if (e === -1) issue(`Unterminated end tag </${name}`, lt)
      tokens.push({ type: 'endTag', name, lname: name.toLowerCase(), raw: src.slice(lt, close), start: lt, end: close })
      i = textStart = close
      continue
    }

    // Start tag.
    if (isAlpha(c1)) {
      flushText(lt)
      let j = lt + 1
      while (j < n) {
        const c = src.charCodeAt(j)
        if (isWs(c) || c === 47 || c === 62) break
        j++
      }
      const name = src.slice(lt + 1, j)
      const attrs: HtmlAttr[] = []
      let selfClosing = false
      let closed = false
      while (j < n) {
        let c = src.charCodeAt(j)
        if (isWs(c)) {
          j++
          continue
        }
        if (c === 62) {
          closed = true
          j++
          break
        }
        if (c === 47) {
          if (src.charCodeAt(j + 1) === 62) {
            selfClosing = true
            closed = true
            j += 2
            break
          }
          j++
          continue
        }
        // Attribute name (a leading `=` is part of the name, per spec).
        const aStart = j
        j++
        while (j < n) {
          c = src.charCodeAt(j)
          if (isWs(c) || c === 47 || c === 62 || c === 61) break
          j++
        }
        const aName = src.slice(aStart, j)
        let k = j
        while (k < n && isWs(src.charCodeAt(k))) k++
        if (src.charCodeAt(k) !== 61 /* = */) {
          attrs.push({ name: aName, value: null, quote: '', start: aStart, end: j })
          continue
        }
        k++
        while (k < n && isWs(src.charCodeAt(k))) k++
        const q = src.charCodeAt(k)
        if (q === 34 || q === 39) {
          const qe = src.indexOf(q === 34 ? '"' : "'", k + 1)
          if (qe === -1) {
            issue(`Unterminated attribute value for “${aName}” in <${name}>`, k)
            attrs.push({ name: aName, value: src.slice(k + 1), quote: q === 34 ? '"' : "'", start: aStart, end: n })
            j = n
            break
          }
          attrs.push({ name: aName, value: src.slice(k + 1, qe), quote: q === 34 ? '"' : "'", start: aStart, end: qe + 1 })
          j = qe + 1
        } else {
          let ve = k
          while (ve < n && !isWs(src.charCodeAt(ve)) && src.charCodeAt(ve) !== 62) ve++
          attrs.push({ name: aName, value: src.slice(k, ve), quote: '', start: aStart, end: ve })
          j = ve
        }
      }
      if (!closed) issue(`Unterminated tag <${name}: missing “>”`, lt)
      const lname = name.toLowerCase()
      tokens.push({ type: 'startTag', name, lname, attrs, selfClosing, raw: src.slice(lt, j), start: lt, end: j })
      i = textStart = j
      if (closed && !selfClosing && rawText.has(lname)) {
        if (lname === 'plaintext') {
          if (j < n) tokens.push({ type: 'rawText', value: src.slice(j), parent: lname, start: j, end: n })
          i = textStart = n
          continue
        }
        const endAt = findEndTag(src, j, lname)
        if (endAt === -1) {
          issue(`Unclosed <${name}>: no matching </${name}> was found`, lt)
          if (j < n) tokens.push({ type: 'rawText', value: src.slice(j), parent: lname, start: j, end: n })
          i = textStart = n
        } else {
          if (endAt > j) tokens.push({ type: 'rawText', value: src.slice(j, endAt), parent: lname, start: j, end: endAt })
          i = textStart = endAt
        }
      }
      continue
    }

    // A `<` that cannot start markup is text.
    i = lt + 1
  }
  flushText(n)
  return { tokens, errors }
}
