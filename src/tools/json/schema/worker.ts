import { expose } from '@/workers/rpc'
import { generateSchema, runSchemaValidation } from '@/engines/json-tools/tasks'

export const tasks = { runSchemaValidation, generateSchema }
export type Tasks = typeof tasks
expose(tasks)
