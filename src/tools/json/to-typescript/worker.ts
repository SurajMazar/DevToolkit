import { expose } from '@/workers/rpc'
import { generateTypes } from '@/engines/json-tools/tasks'

export const tasks = { generateTypes }
export type Tasks = typeof tasks
expose(tasks)
