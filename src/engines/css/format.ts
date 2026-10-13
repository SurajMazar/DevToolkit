/**
 * Prettier-backed formatting for CSS (and HTML, via the html engine). Plugins are loaded
 * lazily with dynamic imports so the ~300 KB parsers are only fetched when first used.
 */
export interface FormatIssue {
  message: string
  line?: number
  column?: number
}

export type FormatResult = { ok: true; output: string } | { ok: false; error: FormatIssue }

export interface CssFormatOptions {
  indent: number
  useTabs: boolean
  printWidth: number
  /** Prettier parser: plain CSS, SCSS or Less. */
  parser?: 'css' | 'scss' | 'less'
  singleQuote?: boolean
}

export const DEFAULT_CSS_FORMAT: CssFormatOptions = { indent: 2, useTabs: false, printWidth: 80, parser: 'css', singleQuote: false }

interface PrettierErrorLike {
  message?: string
  loc?: { start?: { line?: number; column?: number } }
}

/** Turns Prettier's error (message + code frame) into a one-line message with a location. */
export function prettierError(e: unknown): FormatIssue {
  const err = e as PrettierErrorLike
  const raw = String(err?.message ?? e)
  // First line holds the reason, e.g. "CssSyntaxError: Unclosed block (2:2)".
  let message = raw.split('\n')[0].replace(/\s*\(\d+:\d+\)\s*$/, '').replace(/^CssSyntaxError:\s*/, '')
  if (!message) message = 'Could not parse the input'
  const line = err?.loc?.start?.line
  const column = err?.loc?.start?.column
  return { message, line, column }
}

export async function formatCss(css: string, options: CssFormatOptions = DEFAULT_CSS_FORMAT): Promise<FormatResult> {
  const [prettier, postcss] = await Promise.all([import('prettier/standalone'), import('prettier/plugins/postcss')])
  try {
    const output = await prettier.format(css, {
      parser: options.parser ?? 'css',
      plugins: [postcss],
      tabWidth: options.indent,
      useTabs: options.useTabs,
      printWidth: options.printWidth,
      singleQuote: options.singleQuote ?? false,
    })
    return { ok: true, output }
  } catch (e) {
    return { ok: false, error: prettierError(e) }
  }
}
