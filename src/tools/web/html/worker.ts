import { expose } from '@/workers/rpc'
import { formatHtml, type HtmlFormatOptions } from '@/engines/html/format'
import { minifyHtml, type HtmlMinifyOptions } from '@/engines/html/minify'

export const tasks = {
  format: ({ html, options }: { html: string; options: HtmlFormatOptions }) => formatHtml(html, options),
  minify: ({ html, options }: { html: string; options: HtmlMinifyOptions }) => minifyHtml(html, options),
}
export type Tasks = typeof tasks
expose(tasks)
