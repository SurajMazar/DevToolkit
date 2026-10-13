import { expose } from '@/workers/rpc'
import { formatCss, type CssFormatOptions } from '@/engines/css/format'
import { minifyCss, type CssMinifyOptions } from '@/engines/css/minify'

export const tasks = {
  format: ({ css, options }: { css: string; options: CssFormatOptions }) => formatCss(css, options),
  minify: ({ css, options }: { css: string; options: CssMinifyOptions }) => minifyCss(css, options),
}
export type Tasks = typeof tasks
expose(tasks)
