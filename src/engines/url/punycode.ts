/**
 * Punycode (RFC 3492) decoding/encoding for IDN display. The WHATWG `URL` API always
 * returns hostnames in their ASCII (punycode) form; this converts them back for display.
 */
const BASE = 36
const TMIN = 1
const TMAX = 26
const SKEW = 38
const DAMP = 700
const INITIAL_BIAS = 72
const INITIAL_N = 128

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / DAMP) : delta >> 1
  d += Math.floor(d / numPoints)
  let k = 0
  while (d > ((BASE - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASE - TMIN))
    k += BASE
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW))
}

function digitOf(cp: number): number {
  if (cp >= 48 && cp <= 57) return cp - 22 // 0-9 → 26-35
  if (cp >= 65 && cp <= 90) return cp - 65 // A-Z
  if (cp >= 97 && cp <= 122) return cp - 97 // a-z
  return BASE
}

const digitChar = (d: number) => String.fromCharCode(d + 22 + 75 * (d < 26 ? 1 : 0))

/** Decodes a punycode label body (without `xn--`). Throws on invalid input. */
export function punycodeDecode(input: string): string {
  const output: number[] = []
  const basicEnd = input.lastIndexOf('-')
  for (let j = 0; j < Math.max(0, basicEnd); j++) {
    const cp = input.charCodeAt(j)
    if (cp >= 0x80) throw new Error('Invalid punycode: non-basic code point')
    output.push(cp)
  }
  let n = INITIAL_N
  let bias = INITIAL_BIAS
  let i = 0
  for (let idx = basicEnd > 0 ? basicEnd + 1 : 0; idx < input.length; ) {
    const oldi = i
    let w = 1
    for (let k = BASE; ; k += BASE) {
      if (idx >= input.length) throw new Error('Invalid punycode: truncated input')
      const digit = digitOf(input.charCodeAt(idx++))
      if (digit >= BASE) throw new Error('Invalid punycode digit')
      i += digit * w
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias
      if (digit < t) break
      w *= BASE - t
    }
    const len = output.length + 1
    bias = adapt(i - oldi, len, oldi === 0)
    n += Math.floor(i / len)
    i %= len
    output.splice(i++, 0, n)
  }
  return String.fromCodePoint(...output)
}

/** Encodes a Unicode label to its punycode body (without `xn--`). */
export function punycodeEncode(input: string): string {
  const cps = Array.from(input, (ch) => ch.codePointAt(0)!)
  let n = INITIAL_N
  let delta = 0
  let bias = INITIAL_BIAS
  let output = cps.filter((c) => c < 0x80).map((c) => String.fromCharCode(c)).join('')
  const basic = output.length
  let h = basic
  if (basic) output += '-'
  while (h < cps.length) {
    const m = Math.min(...cps.filter((c) => c >= n))
    delta += (m - n) * (h + 1)
    n = m
    for (const c of cps) {
      if (c < n) delta++
      if (c === n) {
        let q = delta
        for (let k = BASE; ; k += BASE) {
          const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias
          if (q < t) break
          output += digitChar(t + ((q - t) % (BASE - t)))
          q = Math.floor((q - t) / (BASE - t))
        }
        output += digitChar(q)
        bias = adapt(delta, h + 1, h === basic)
        delta = 0
        h++
      }
    }
    delta++
    n++
  }
  return output
}

/** `xn--mnchen-3ya.de` → `münchen.de`. Labels that fail to decode are left as-is. */
export function hostnameToUnicode(hostname: string): string {
  return hostname
    .split('.')
    .map((label) => {
      if (!/^xn--/i.test(label)) return label
      try {
        return punycodeDecode(label.slice(4).toLowerCase())
      } catch {
        return label
      }
    })
    .join('.')
}
