import { WorkerClient } from '@/workers/rpc'
import type { RegexTasks } from './regex.worker'
import RegexWorker from './regex.worker.ts?worker'

export class RegexTimeoutError extends Error {
  constructor(ms: number) {
    super(`The pattern ran for more than ${ms / 1000}s and was stopped. It probably backtracks catastrophically (e.g. nested quantifiers like (a+)+). Simplify the pattern or make it more specific.`)
    this.name = 'RegexTimeoutError'
  }
}

/**
 * Runs regexes off the main thread with a hard time limit. A runaway pattern is killed by
 * terminating its worker — the page never freezes. Create one runner per tool (useState).
 */
export class SafeRegexRunner {
  private client = new WorkerClient<RegexTasks>(() => new RegexWorker({ name: 'devtoolkit-regex' }))
  /** Resolves once the worker has loaded, so startup time never counts against the limit. */
  private warm: Promise<unknown> | null = null
  constructor(private timeoutMs = 2000) {}

  private ensureWarm() {
    this.warm ??= this.client.run('ping', undefined).catch(() => {
      this.warm = null
    })
    return this.warm
  }

  private async withTimeout<K extends keyof RegexTasks & string>(task: K, payload: Parameters<RegexTasks[K]>[0], signal?: AbortSignal): Promise<ReturnType<RegexTasks[K]>> {
    await this.ensureWarm()
    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      ctrl.abort()
    }, this.timeoutMs)
    try {
      return (await this.client.run(task, payload, ctrl.signal)) as ReturnType<RegexTasks[K]>
    } catch (e) {
      // An abort terminated the worker; the next call must warm a fresh one.
      if (ctrl.signal.aborted) this.warm = null
      if (timedOut) throw new RegexTimeoutError(this.timeoutMs)
      throw e
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  match(p: Parameters<RegexTasks['match']>[0], signal?: AbortSignal) {
    return this.withTimeout('match', p, signal)
  }

  replace(p: Parameters<RegexTasks['replace']>[0], signal?: AbortSignal) {
    return this.withTimeout('replace', p, signal)
  }

  dispose() {
    this.warm = null
    this.client.reset()
  }
}
