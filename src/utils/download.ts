export function downloadText(content: string | Blob, filename: string, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const mimeForExtension: Record<string, string> = {
  json: 'application/json',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  xml: 'application/xml',
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/typescript',
  md: 'text/markdown',
  sql: 'application/sql',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  diff: 'text/x-diff',
  patch: 'text/x-diff',
  env: 'text/plain',
}

export function downloadWithExtension(content: string, basename: string, ext: string) {
  downloadText(content, `${basename}.${ext}`, `${mimeForExtension[ext] ?? 'text/plain'};charset=utf-8`)
}
