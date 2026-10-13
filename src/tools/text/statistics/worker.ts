import { expose } from '@/workers/rpc'
import { computeStats, type StatsOptions } from '@/engines/text/stats'

export const tasks = {
  stats: (p: { text: string; options: StatsOptions }) => computeStats(p.text, p.options),
}
export type Tasks = typeof tasks
expose(tasks)
