import { expose } from '@/workers/rpc'
import { csvToJson, type CsvToJsonOptions } from '@/engines/data/csv-to-json'

export const tasks = {
  convert: ({ text, opts }: { text: string; opts: CsvToJsonOptions }) => csvToJson(text, opts),
}
export type Tasks = typeof tasks
expose(tasks)
