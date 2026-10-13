import { expose } from '@/workers/rpc'
import { formatSql, minifySql, lexOptionsFor, SqlLexError, type SqlFormatOptions } from '@/engines/dev/sql'

export const tasks = {
  format: (p: { sql: string; options: SqlFormatOptions }) => formatSql(p.sql, p.options),
  minify: (p: { sql: string; language: string; keepHints: boolean; statementPerLine: boolean }) => {
    try {
      return { ok: true as const, ...minifySql(p.sql, { ...lexOptionsFor(p.language), keepHints: p.keepHints, statementPerLine: p.statementPerLine }) }
    } catch (e) {
      if (e instanceof SqlLexError) return { ok: false as const, message: e.message, offset: e.offset }
      throw e
    }
  },
}
export type Tasks = typeof tasks
expose(tasks)
