import { expose } from '@/workers/rpc'
import { jsonToCsv, type JsonToCsvOptions } from '@/engines/data/json-to-csv'

export const tasks = {
  convert: ({ text, opts }: { text: string; opts: JsonToCsvOptions }) => jsonToCsv(text, opts),
}
export type Tasks = typeof tasks
expose(tasks)
