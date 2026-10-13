const nf = new Intl.NumberFormat('en-US')

export function formatNumber(n: number): string {
  return nf.format(n)
}

/** Human-readable byte size using binary units (KiB, MiB…), as editors display. */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = -1
  do {
    v /= 1024
    i++
  } while (v >= 1024 && i < units.length - 1)
  return `${v.toFixed(v >= 100 ? 0 : decimals)} ${units[i]}`
}

export function formatDuration(ms: number): string {
  if (ms < 1) return '<1 ms'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`
}

/** UTF-8 byte length without allocating an encoded copy for small strings. */
export function utf8Length(str: string): number {
  if (str.length > 2_000_000) return new TextEncoder().encode(str).length
  let bytes = 0
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c < 0x80) bytes += 1
    else if (c < 0x800) bytes += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

/** Counts lines the way editors do: an empty string is one (empty) line. */
export function countLines(str: string): number {
  if (!str) return str === '' ? 0 : 1
  let n = 1
  let idx = -1
  while ((idx = str.indexOf('\n', idx + 1)) !== -1) n++
  return n
}
