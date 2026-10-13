export interface LoadedFile {
  name: string
  size: number
  type: string
  text: string
}

/** Reads a file as UTF-8 text, byte-exact (a leading BOM is kept, unlike Blob.text()). */
export async function readFileAsText(file: File): Promise<LoadedFile> {
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await file.arrayBuffer())
  return { name: file.name, size: file.size, type: file.type, text }
}

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}

export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer()
}

export function pickFile(accept?: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (accept) input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}
