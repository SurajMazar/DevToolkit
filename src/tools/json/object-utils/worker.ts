import { expose } from '@/workers/rpc'
import { runObjectOp } from '@/engines/json-tools/tasks'

export const tasks = { runObjectOp }
export type Tasks = typeof tasks
expose(tasks)
