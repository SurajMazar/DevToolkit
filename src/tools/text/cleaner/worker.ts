import { expose } from '@/workers/rpc'
import { runPipeline, type PipelineStep } from '@/engines/text/cleaner'

export const tasks = {
  pipeline: (p: { text: string; steps: PipelineStep[] }) => runPipeline(p.text, p.steps),
}
export type Tasks = typeof tasks
expose(tasks)
