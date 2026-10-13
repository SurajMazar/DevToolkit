import { Dices, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { CopyButton } from '@/components/common/CopyButton'
import { ToolbarField } from '@/components/tools/Toolbar'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useTask } from '@/hooks/useTask'
import { useWorker } from '@/hooks/useWorker'
import type { SampleResult } from '@/engines/dev/regex-samples'
import { visible } from './MatchesPanel'
import SampleWorker from './worker.ts?worker'
import type { Tasks } from './worker'

const TIMEOUT = 3000

export function SamplesPanel({ pattern, flags, valid, onAppend }: { pattern: string; flags: string; valid: boolean; onAppend: (s: string) => void }) {
  const [count, setCount] = usePersistentState('sampleCount', '10')
  const [maxRepeat, setMaxRepeat] = usePersistentState('sampleRepeat', '5')
  const worker = useWorker<Tasks>(() => new SampleWorker({ name: 'regex-samples' }))
  const task = useTask<SampleResult & { key: string }>()
  const key = `${flags}/${pattern}`
  const generate = () =>
    task.run(async (signal) => {
      const ctrl = new AbortController()
      const onAbort = () => ctrl.abort()
      signal.addEventListener('abort', onAbort)
      let timedOut = false
      const t = setTimeout(() => {
        timedOut = true
        ctrl.abort()
      }, TIMEOUT)
      try {
        return { ...(await worker.run('samples', { pattern, flags, count: Number(count), maxRepeat: Number(maxRepeat) }, ctrl.signal)), key }
      } catch (e) {
        if (timedOut) throw new Error('Generating or verifying samples took longer than 3 s and was stopped — the pattern probably backtracks heavily.')
        throw e
      } finally {
        clearTimeout(t)
        signal.removeEventListener('abort', onAbort)
      }
    })
  const r = task.result
  const stale = r && r.key !== key
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2">
        <ToolbarField label="Count">
          <Select aria-label="Number of samples" value={count} onValueChange={setCount} options={['5', '10', '20', '50'].map((v) => ({ value: v, label: v }))} />
        </ToolbarField>
        <ToolbarField label="Max repeat">
          <Select
            aria-label="Maximum repetitions for * and +"
            value={maxRepeat}
            onValueChange={setMaxRepeat}
            options={['2', '3', '5', '8', '12'].map((v) => ({ value: v, label: v, description: v === '5' ? 'Caps *, + and {n,}' : undefined }))}
          />
        </ToolbarField>
        <Button size="sm" variant="primary" onClick={generate} disabled={!valid || !pattern || task.running} className="ml-auto">
          {task.running ? <Loader2 className="animate-spin" /> : <Dices />} {r ? 'Regenerate' : 'Generate'}
        </Button>
      </div>
      <p className="border-b border-border px-4 py-1.5 text-2xs text-subtle">
        Heuristic: strings are generated from the pattern with randexp, then checked against the real JavaScript engine. Assertions and unicode classes are approximated.
      </p>
      {task.error && <ErrorDisplay error={task.error.message} />}
      {r?.error && <ErrorDisplay error={r.error} />}
      {stale && <p className="border-b border-border bg-surface px-4 py-1.5 text-xs text-muted">The pattern changed since these were generated.</p>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!r ? (
          <p className="px-4 py-6 text-sm text-muted">{valid && pattern ? 'Generate example strings that this pattern should match.' : 'Enter a valid pattern first.'}</p>
        ) : (
          <>
            <ul>
              {r.samples.map((s, i) => (
                <li key={i} className="group flex items-center gap-2 border-b border-border/60 px-4 py-1">
                  <Badge tone={s.verdict === 'full' ? 'ok' : s.verdict === 'partial' ? 'warn' : 'danger'} title={s.verdict === 'full' ? 'The whole string matches' : s.verdict === 'partial' ? 'Only part of the string matches' : 'The real engine does not match this'}>
                    {s.verdict === 'full' ? 'match' : s.verdict === 'partial' ? 'partial' : 'no match'}
                  </Badge>
                  <span className="mono min-w-0 flex-1 truncate text-[12.5px] text-fg">{visible(s.text)}</span>
                  <CopyButton value={s.text} label="Copy sample" size="icon-xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />
                  <IconButton label="Append to test string" icon={<Plus />} size="icon-xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => onAppend(s.text)} />
                </li>
              ))}
            </ul>
            {r.notes.length > 0 && (
              <ul className="flex flex-col gap-1 px-4 py-3">
                {r.notes.map((n, i) => (
                  <li key={i} className="text-xs text-muted">
                    {n}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
