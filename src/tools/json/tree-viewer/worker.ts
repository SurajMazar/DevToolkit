import { expose } from '@/workers/rpc'
import { parseToTree } from '@/engines/json-tools/tasks'

export const tasks = { parseToTree }
export type Tasks = typeof tasks
expose(tasks)
