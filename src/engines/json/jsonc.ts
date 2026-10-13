/**
 * Converts JSONC (JSON with comments and trailing commas — as used by tsconfig, VS Code
 * settings…) into strict JSON. Strings are never modified. Comments are replaced by
 * whitespace of equal length so line/column positions in errors stay accurate.
 */
export function stripJsonc(text: string): { json: string; comments: number; trailingCommas: number } {
  let out = ''
  let comments = 0
  let trailingCommas = 0
  let i = 0
  const n = text.length
  // Position in `out` of the most recent comma outside strings, if only whitespace follows it.
  let pendingComma = -1
  while (i < n) {
    const ch = text[i]
    if (ch === '"') {
      let j = i + 1
      while (j < n && text[j] !== '"') {
        if (text[j] === '\\') j++
        j++
      }
      out += text.slice(i, j + 1)
      i = j + 1
      pendingComma = -1
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      let j = i
      while (j < n && text[j] !== '\n') j++
      out += ' '.repeat(j - i)
      i = j
      comments++
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const j = end === -1 ? n : end + 2
      out += text.slice(i, j).replace(/[^\n]/g, ' ')
      i = j
      comments++
      continue
    }
    if (ch === ',') {
      pendingComma = out.length
      out += ch
      i++
      continue
    }
    if ((ch === '}' || ch === ']') && pendingComma !== -1) {
      out = out.slice(0, pendingComma) + ' ' + out.slice(pendingComma + 1)
      trailingCommas++
    }
    if (!/\s/.test(ch)) pendingComma = -1
    out += ch
    i++
  }
  return { json: out, comments, trailingCommas }
}
