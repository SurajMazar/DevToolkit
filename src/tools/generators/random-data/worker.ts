import { expose } from '@/workers/rpc'
import { generateDataset } from '@/engines/generators/randomData'

export const tasks = { generateDataset }
export type Tasks = typeof tasks
expose(tasks)
