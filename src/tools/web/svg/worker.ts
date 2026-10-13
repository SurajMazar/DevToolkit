import { expose } from '@/workers/rpc'
import { optimizeSvg, prettifySvg, type SvgoOptions } from '@/engines/html/svgo'

export const tasks = {
  optimize: ({ svg, options }: { svg: string; options: SvgoOptions }) => optimizeSvg(svg, options),
  prettify: ({ svg, indent }: { svg: string; indent: number }) => prettifySvg(svg, indent),
}
export type Tasks = typeof tasks
expose(tasks)
