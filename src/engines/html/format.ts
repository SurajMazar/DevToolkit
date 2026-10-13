import { prettierError, type FormatResult } from '@/engines/css/format'

export type HtmlWhitespaceSensitivity = 'css' | 'strict' | 'ignore'

export interface HtmlFormatOptions {
  indent: number
  useTabs: boolean
  printWidth: number
  /**
   * css    — respect the default CSS `display` of each element (Prettier default)
   * strict — treat all whitespace as significant (never changes rendering)
   * ignore — treat all whitespace as insignificant (prettiest, may change inline spacing)
   */
  whitespaceSensitivity: HtmlWhitespaceSensitivity
  /** Put the `>` of a multi-line start tag at the end of the last line. */
  bracketSameLine: boolean
}

export const DEFAULT_HTML_FORMAT: HtmlFormatOptions = { indent: 2, useTabs: false, printWidth: 100, whitespaceSensitivity: 'css', bracketSameLine: false }

/**
 * Beautifies HTML with Prettier. The babel/estree/postcss plugins are loaded too, so
 * embedded `<script>` and `<style>` blocks are formatted as JavaScript and CSS.
 */
export async function formatHtml(html: string, options: HtmlFormatOptions = DEFAULT_HTML_FORMAT): Promise<FormatResult> {
  const [prettier, htmlPlugin, babel, estree, postcss] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/html'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree'),
    import('prettier/plugins/postcss'),
  ])
  try {
    const output = await prettier.format(html, {
      parser: 'html',
      plugins: [htmlPlugin, babel, estree, postcss],
      tabWidth: options.indent,
      useTabs: options.useTabs,
      printWidth: options.printWidth,
      htmlWhitespaceSensitivity: options.whitespaceSensitivity,
      bracketSameLine: options.bracketSameLine,
    })
    return { ok: true, output }
  } catch (e) {
    return { ok: false, error: prettierError(e) }
  }
}
