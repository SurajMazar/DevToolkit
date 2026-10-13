/**
 * Minimal typed RPC over postMessage. A worker exposes a record of task functions;
 * the client calls them by name. Cancellation terminates the worker (the only way to
 * truly stop CPU-bound work in the browser) and a fresh one is started on next use.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TaskMap = Record<string, (payload: any) => unknown>

interface Request {
  id: number
  task: string
  payload: unknown
}

type Response = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: { message: string; name?: string } }

export function expose(tasks: TaskMap) {
  self.onmessage = async (e: MessageEvent<Request>) => {
    const { id, task, payload } = e.data
    try {
      const fn = tasks[task]
      if (!fn) throw new Error(`Unknown task: ${task}`)
      const result = await fn(payload)
      ;(self as unknown as Worker).postMessage({ id, ok: true, result } satisfies Response)
    } catch (err) {
      const error = err instanceof Error ? { message: err.message, name: err.name } : { message: String(err) }
      ;(self as unknown as Worker).postMessage({ id, ok: false, error } satisfies Response)
    }
  }
}

export class AbortedError extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'AbortError'
  }
}

export class WorkerClient<T extends TaskMap> {
  private worker: Worker | null = null
  private seq = 0
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  private factory: () => Worker

  constructor(factory: () => Worker) {
    this.factory = factory
  }

  private ensure(): Worker {
    if (this.worker) return this.worker
    const w = this.factory()
    w.onmessage = (e: MessageEvent<Response>) => {
      const p = this.pending.get(e.data.id)
      if (!p) return
      this.pending.delete(e.data.id)
      if (e.data.ok) p.resolve(e.data.result)
      else {
        const err = new Error(e.data.error.message)
        if (e.data.error.name) err.name = e.data.error.name
        p.reject(err)
      }
    }
    w.onerror = (e) => {
      e.preventDefault()
      const err = new Error(e.message || 'The background worker crashed (it may have run out of memory).')
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
      this.reset()
    }
    this.worker = w
    return w
  }

  /** Terminates the worker, rejecting everything in flight. */
  reset() {
    this.worker?.terminate()
    this.worker = null
    for (const p of this.pending.values()) p.reject(new AbortedError())
    this.pending.clear()
  }

  run<K extends keyof T & string>(task: K, payload: Parameters<T[K]>[0], signal?: AbortSignal, transfer?: Transferable[]): Promise<Awaited<ReturnType<T[K]>>> {
    if (signal?.aborted) return Promise.reject(new AbortedError())
    const id = ++this.seq
    const w = this.ensure()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      signal?.addEventListener(
        'abort',
        () => {
          if (!this.pending.has(id)) return
          // Stop the CPU work for real: kill the worker. Others in flight are rejected too,
          // which is fine because callers use latest-wins semantics per client.
          this.reset()
        },
        { once: true },
      )
      w.postMessage({ id, task, payload } satisfies Request, transfer ?? [])
    })
  }
}

export const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError'
