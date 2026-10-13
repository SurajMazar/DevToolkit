import { describe, expect, it } from 'vitest'
import { CODE_LANGUAGES, DEFAULT_CODE_FORMAT, describePrettierError, detectLanguageFromFilename, formatCode, sniffLanguage } from './code-format'

describe('formatCode', () => {
  for (const lang of CODE_LANGUAGES) {
    it(`formats the ${lang.label} sample`, async () => {
      const r = await formatCode(lang.sample, lang.id, DEFAULT_CODE_FORMAT)
      if (!r.ok) throw new Error(`${lang.id}: ${r.error.message}`)
      expect(r.output.length).toBeGreaterThan(0)
      // Idempotent: formatting the output again changes nothing.
      const again = await formatCode(r.output, lang.id, DEFAULT_CODE_FORMAT)
      expect(again.ok && again.output).toBe(r.output)
    }, 20_000)
  }

  it('applies options', async () => {
    const src = 'const a = {b: "x", c: [1,2,3]}\nconst f = (x) => x'
    const r = await formatCode(src, 'javascript', { ...DEFAULT_CODE_FORMAT, semi: false, singleQuote: true, bracketSpacing: false, arrowParens: 'avoid', useTabs: true })
    expect(r.ok && r.output).toBe("const a = {b: 'x', c: [1, 2, 3]}\nconst f = x => x\n")
  })

  it('respects printWidth and trailingComma', async () => {
    const src = 'call(argumentNumberOne, argumentNumberTwo, argumentNumberThree)'
    const r = await formatCode(src, 'javascript', { ...DEFAULT_CODE_FORMAT, printWidth: 30, trailingComma: 'none' })
    expect(r.ok && r.output).toBe('call(\n  argumentNumberOne,\n  argumentNumberTwo,\n  argumentNumberThree\n);\n')
  })

  it('reports syntax errors with 1-based line and column', async () => {
    const r = await formatCode('const a = {\n  b: 1,,\n}', 'javascript', DEFAULT_CODE_FORMAT)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatchObject({ line: 2, column: 8 })
      expect(r.error.message).toBe('Unexpected token')
      expect(r.error.frame).toContain('^')
    }
    const css = await formatCode('a { color: red', 'css', DEFAULT_CODE_FORMAT)
    expect(!css.ok && css.error.message).toMatch(/Unclosed block/)
  })

  it('never executes code', async () => {
    const g = globalThis as { __pwned?: boolean }
    const r = await formatCode('globalThis.__pwned = true; (function(){ globalThis.__pwned = true })()', 'javascript', DEFAULT_CODE_FORMAT)
    expect(r.ok).toBe(true)
    expect(g.__pwned).toBeUndefined()
  })

  it('handles empty input and unicode', async () => {
    const r = await formatCode('', 'javascript', DEFAULT_CODE_FORMAT)
    expect(r.ok && r.output).toBe('')
    const u = await formatCode("const s='café ☕'", 'typescript', DEFAULT_CODE_FORMAT)
    expect(u.ok && u.output).toBe('const s = "café ☕";\n')
  })

  it('formats a larger file', async () => {
    const src = Array.from({ length: 400 }, (_, i) => `function f${i}(a,b){return a+b*${i}}`).join('\n')
    const r = await formatCode(src, 'javascript', DEFAULT_CODE_FORMAT)
    expect(r.ok && r.output.split('\n').length).toBeGreaterThan(1000)
  }, 20_000)
})

describe('language detection', () => {
  it('detects from file extensions', () => {
    expect(detectLanguageFromFilename('Button.tsx')).toBe('tsx')
    expect(detectLanguageFromFilename('docker-compose.YML')).toBe('yaml')
    expect(detectLanguageFromFilename('app.component.html')).toBe('angular')
    expect(detectLanguageFromFilename('index.html')).toBe('html')
    expect(detectLanguageFromFilename('schema.gql')).toBe('graphql')
    expect(detectLanguageFromFilename('README.md')).toBe('markdown')
    expect(detectLanguageFromFilename('App.vue')).toBe('vue')
    expect(detectLanguageFromFilename('notes.txt')).toBeNull()
  })

  it('sniffs content', () => {
    expect(sniffLanguage('{"a":1}')).toBe('json')
    expect(sniffLanguage('<!doctype html><html></html>')).toBe('html')
    expect(sniffLanguage('interface A { b: string }')).toBe('typescript')
    expect(sniffLanguage('const a = 1')).toBe('javascript')
    expect(sniffLanguage('# Title\n\nSome text')).toBe('markdown')
    expect(sniffLanguage('services:\n  web:\n    image: nginx')).toBe('yaml')
    expect(sniffLanguage('.btn { color: red; }')).toBe('css')
    expect(sniffLanguage('query Q { user { id } }')).toBe('graphql')
    expect(sniffLanguage('')).toBeNull()
  })

  it('describes errors without location', () => {
    expect(describePrettierError(new Error('boom'))).toEqual({ message: 'boom', line: undefined, column: undefined, frame: undefined })
  })
})
