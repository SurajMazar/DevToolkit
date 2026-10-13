import { expose } from '@/workers/rpc'
import { buildDuplicateOutput, findDuplicates, type DuplicateOptions, type DuplicateOutput } from '@/engines/text/duplicates'

export const tasks = {
  analyze: (p: { text: string; options: DuplicateOptions; output: DuplicateOutput }) => ({
    report: findDuplicates(p.text, p.options),
    output: buildDuplicateOutput(p.text, p.output, p.options),
  }),
}
export type Tasks = typeof tasks
expose(tasks)
