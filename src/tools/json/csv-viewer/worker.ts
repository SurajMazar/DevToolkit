import { expose } from '@/workers/rpc'
import { buildDataset, sortOrder, type DatasetOptions, type PackedColumn, type ProgressInfo } from '@/engines/data/table'

export interface ProgressMessage extends ProgressInfo {
  type: 'progress'
}

export const tasks = {
  /** Parses CSV text (or a File, read here so the main thread stays free). Posts progress messages. */
  parse: async ({ text, file, opts }: { text?: string; file?: File; opts: DatasetOptions }) => {
    if (file) (self as unknown as Worker).postMessage({ type: 'progress', phase: 'reading', progress: 0, rows: 0 } satisfies ProgressMessage)
    const src = text ?? (file ? await file.text() : '')
    let last = 0
    return buildDataset(src, opts, (p) => {
      const now = performance.now()
      if (now - last < 60 && p.phase === 'parsing') return
      last = now
      ;(self as unknown as Worker).postMessage({ type: 'progress', ...p } satisfies ProgressMessage)
    })
  },
  sort: ({ col, numeric, dir }: { col: PackedColumn; numeric: Float64Array | null; dir: 'asc' | 'desc' }) => sortOrder(col, numeric, dir),
}
export type Tasks = typeof tasks
expose(tasks)
