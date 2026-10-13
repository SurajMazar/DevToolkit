import { expose } from '@/workers/rpc'
import { formatCode, type CodeFormatOptions, type CodeLanguageId } from '@/engines/dev/code-format'

export const tasks = {
  format: (p: { code: string; language: CodeLanguageId; options: CodeFormatOptions }) => formatCode(p.code, p.language, p.options),
}
export type Tasks = typeof tasks
expose(tasks)
