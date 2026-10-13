import { expose } from '@/workers/rpc'
import { analyzeUtf8 } from '@/engines/encoding/utf8'

export const tasks = {
  analyze: (bytes: Uint8Array) => analyzeUtf8(bytes),
}
export type Tasks = typeof tasks
expose(tasks)
