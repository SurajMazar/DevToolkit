import { expose } from '@/workers/rpc'
import { wordFrequency, type FrequencyOptions } from '@/engines/text/frequency'

export const tasks = {
  frequency: (p: { text: string; options: FrequencyOptions }) => wordFrequency(p.text, p.options),
}
export type Tasks = typeof tasks
expose(tasks)
