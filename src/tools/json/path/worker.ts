import { expose } from '@/workers/rpc'
import { listPaths, runJsonPath } from '@/engines/json-tools/tasks'

export const tasks = { runJsonPath, listPaths }
export type Tasks = typeof tasks
expose(tasks)
