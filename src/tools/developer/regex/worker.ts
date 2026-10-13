import { expose } from '@/workers/rpc'
import { generateSamples } from '@/engines/dev/regex-samples'

export const tasks = {
  samples: (p: { pattern: string; flags: string; count: number; maxRepeat: number }) => generateSamples(p.pattern, p.flags, { count: p.count, maxRepeat: p.maxRepeat }),
}
export type Tasks = typeof tasks
expose(tasks)
