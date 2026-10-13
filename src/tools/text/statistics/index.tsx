import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Copy, CornerDownRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { computeStats, type StatsOptions, type TextStats } from '@/engines/text/stats'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput, useSendToTool } from '@/hooks/useIncomingInput'
import { useWorker } from '@/hooks/useWorker'
import { useTask } from '@/hooks/useTask'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { useIsMobile } from '@/hooks/useMediaQuery'
import type { CodeEditorHandle } from '@/components/editors/CodeEditor'
import { InputEditorPane } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { EmptyState } from '@/components/tools/EmptyState'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { copyText } from '@/utils/clipboard'
import { cn } from '@/utils/cn'
import { formatBytes, formatDuration, formatNumber } from '@/utils/format'
import StatsWorker from './worker.ts?worker'
import type { Tasks } from './worker'

/** Above this size statistics are computed in a background worker. */
const WORKER_THRESHOLD = 120_000
const TOP_N = 12

const SAMPLE = `Release notes — version 4.2

This release focuses on performance. Cold start is now 38% faster, and the cache layer was rewritten from scratch: the new cache keeps hot entries in memory and evicts cold entries in the background. Memory usage during large imports dropped by roughly half, and imports no longer block the editor.

We also fixed 27 bugs reported by the community. Thank you to everyone who filed detailed reports! The most requested fix — preserving the selection when switching tabs — is finally here. Tabs also restore their scroll position.

Breaking changes are minimal: the legacy \`exportAll()\` helper was removed. Use \`export({ scope: "all" })\` instead. See the migration guide for details on the new export options.

Internationalization: Japanese (日本語) and Nepali (नेपाली) translations were added. Emoji in file names, like 📁 or 👩‍💻, are now handled correctly in the editor, in exports and in the cache.`

interface Prefs {
  readingWpm: number
  speakingWpm: number
  excludeStopWords: boolean
}
const DEFAULT_PREFS: Prefs = { readingWpm: 238, speakingWpm: 140, excludeStopWords: true }

function formatTime(seconds: number): string {
  if (seconds <= 0) return '0 s'
  if (seconds < 1) return '< 1 s'
  if (seconds < 60) return `${Math.round(seconds)} s`
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h) return `${h} h ${m} min`
  return s ? `${m} min ${s} s` : `${m} min`
}

const dec = (n: number, d = 1) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: n % 1 ? d : 0 }) : '—')

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-b border-border px-4 pb-2.5 pt-2 last:border-b-0">
      <div className="mb-1 flex h-6 items-center justify-between">
        <h3 className="eyebrow">{title}</h3>
        {action}
      </div>
      <dl className="flex flex-col">{children}</dl>
    </section>
  )
}

function Row({ label, hint, children, title }: { label: string; hint?: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="flex min-h-7 items-center gap-3 py-0.5" title={title}>
      <dt className="flex min-w-0 shrink-0 items-baseline gap-1.5 text-[13px] text-muted">
        {label}
        {hint && <span className="text-2xs text-subtle">{hint}</span>}
      </dt>
      <span aria-hidden className="min-w-4 flex-1 translate-y-1 border-b border-dotted border-border-strong/70" />
      <dd className="min-w-0 truncate text-right text-[13px] text-fg tabular">{children}</dd>
    </div>
  )
}

function WpmField({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return (
    <label className="flex items-center gap-1 text-2xs text-subtle">
      <Input
        aria-label={label}
        inputMode="numeric"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          const n = Number(e.target.value)
          if (Number.isFinite(n) && n >= 20 && n <= 2000) onChange(Math.round(n))
        }}
        onBlur={() => setDraft(String(value))}
        aria-invalid={!(Number(draft) >= 20 && Number(draft) <= 2000)}
        className="h-6 w-12 px-1.5 text-right text-xs tabular"
      />
      wpm
    </label>
  )
}

function statsAsText(s: TextStats, p: Prefs): string {
  const rows: [string, string | number][] = [
    ['Characters (UTF-16 code units)', s.characters],
    ['Characters (graphemes)', s.graphemes],
    ['Characters excluding spaces', s.charactersNoSpaces],
    ['Letters', s.letters],
    ['Digits', s.digits],
    ['UTF-8 bytes', s.bytesUtf8],
    ['Words', s.words],
    ['Unique words', s.uniqueWords],
    ['Average word length', dec(s.avgWordLength, 2)],
    ['Longest word', s.longestWord],
    ['Lines', s.lines],
    ['Non-empty lines', s.nonEmptyLines],
    ['Sentences', s.sentences],
    ['Paragraphs', s.paragraphs],
    ['Words per sentence', dec(s.avgSentenceWords, 2)],
    ['Longest line', s.longestLine.number ? `line ${s.longestLine.number} (${s.longestLine.length} chars)` : '—'],
    [`Reading time (${p.readingWpm} wpm)`, formatTime(s.readingSeconds)],
    [`Speaking time (${p.speakingWpm} wpm)`, formatTime(s.speakingSeconds)],
  ]
  return rows.map(([k, v]) => `${k}\t${typeof v === 'number' ? v : v}`).join('\n')
}

export default function TextStatistics() {
  const [input, setInput] = usePersistentState('input', '')
  const [prefs, setPrefs] = usePersistentState<Prefs>('prefs', DEFAULT_PREFS)
  const p = { ...DEFAULT_PREFS, ...prefs }
  const inputRef = useRef<CodeEditorHandle>(null)
  const isMobile = useIsMobile()
  const [mobileTab, setMobileTab] = useState<'text' | 'stats'>('text')
  const send = useSendToTool()
  const worker = useWorker<Tasks>(() => new StatsWorker({ name: 'devtoolkit-text-stats' }))
  const task = useTask<{ stats: TextStats; text: string; key: string }>()

  useIncomingInput(setInput)

  const source = useDebouncedValue(input, adaptiveDelay(input.length))
  const options: StatsOptions = useMemo(() => ({ readingWpm: p.readingWpm, speakingWpm: p.speakingWpm, excludeStopWords: p.excludeStopWords, topN: TOP_N }), [p.readingWpm, p.speakingWpm, p.excludeStopWords])
  const optKey = JSON.stringify(options)
  const big = source.length > WORKER_THRESHOLD

  const syncStats = useMemo(() => (big ? null : computeStats(source, options)), [big, source, options])

  const { run } = task
  useEffect(() => {
    if (!big) return
    void run(async (signal) => ({ stats: await worker.run('stats', { text: source, options }, signal), text: source, key: optKey }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [big, source, optKey, run, worker])

  const workerCurrent = task.result && task.result.text === source && task.result.key === optKey
  const stats: TextStats | null = syncStats ?? (task.result?.stats ?? null)
  const stale = big && !workerCurrent

  const jumpToLine = (line: number) => {
    if (isMobile) setMobileTab('text')
    requestAnimationFrame(() => {
      const ed = inputRef.current?.editor
      const model = ed?.getModel()
      if (!ed || !model || line > model.getLineCount()) return
      const range = { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: model.getLineMaxColumn(line) }
      ed.setSelection(range)
      ed.revealRangeInCenter(range)
      ed.focus()
    })
  }

  const copyAs = async (kind: 'text' | 'json') => {
    if (!stats) return
    const text = kind === 'json' ? JSON.stringify({ ...stats, readingWpm: p.readingWpm, speakingWpm: p.speakingWpm }, null, 2) : statsAsText(stats, p)
    if (await copyText(text)) toast.success(kind === 'json' ? 'Statistics copied as JSON' : 'Statistics copied as a table')
    else toast.error('Clipboard access was blocked by the browser')
  }

  const maxCount = stats?.topWords[0]?.count ?? 1

  const toolbar = (
    <Toolbar>
      <ToolbarField label="Reading">
        <WpmField label="Reading speed in words per minute" value={p.readingWpm} onChange={(readingWpm) => setPrefs({ ...p, readingWpm })} />
      </ToolbarField>
      <ToolbarField label="Speaking">
        <WpmField label="Speaking speed in words per minute" value={p.speakingWpm} onChange={(speakingWpm) => setPrefs({ ...p, speakingWpm })} />
      </ToolbarField>
      <ToolbarSeparator />
      <Checkbox checked={p.excludeStopWords} onCheckedChange={(v) => setPrefs({ ...p, excludeStopWords: v === true })} label="Hide stop words" />
      <ToolbarSpacer />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" disabled={!stats || !input}>
            <Copy /> Copy stats
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => void copyAs('text')}>As table (tab-separated)</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyAs('json')}>As JSON</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Toolbar>
  )

  const inputPane = (
    <InputEditorPane
      ref={inputRef}
      value={input}
      onChange={setInput}
      sample={SAMPLE}
      title="Text"
      path="stats-input"
      wordWrap
      placeholder="Paste or type text to analyse…"
      emptyState={<EmptyState compact title="Paste text to measure it" description="Counts update as you type. Nothing leaves your browser." />}
    />
  )

  const s = stats && input ? stats : null
  const panel = (
    <aside aria-label="Statistics" className="flex min-h-0 flex-1 flex-col bg-workspace">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border pl-4 pr-2">
        <h2 className="eyebrow">Statistics</h2>
        {stale && (
          <span className="flex items-center gap-1.5 text-2xs text-subtle">
            <Loader2 className="size-3 animate-spin" /> Updating…
            {task.running && (
              <button type="button" className="text-accent-text hover:underline" onClick={task.cancel}>
                Cancel
              </button>
            )}
          </span>
        )}
      </div>
      {task.error && big && <ErrorDisplay error={task.error.message} title="Could not compute statistics" />}
      {!s ? (
        <EmptyState compact title="No text yet" description="Characters, words, sentences, reading time and the most frequent words will appear here." />
      ) : (
        <div className={cn('min-h-0 flex-1 overflow-y-auto', stale && 'opacity-60')}>
          <Section title="Characters">
            <Row label="Characters" hint="UTF-16">{formatNumber(s.characters)}</Row>
            <Row label="Graphemes" hint="as seen" title="User-perceived characters: 👩‍💻 counts as one">{formatNumber(s.graphemes)}</Row>
            <Row label="Without spaces">{formatNumber(s.charactersNoSpaces)}</Row>
            <Row label="Letters">{formatNumber(s.letters)}</Row>
            <Row label="Digits">{formatNumber(s.digits)}</Row>
            <Row label="UTF-8 size">
              {formatNumber(s.bytesUtf8)} B{s.bytesUtf8 >= 1024 && <span className="text-subtle"> · {formatBytes(s.bytesUtf8)}</span>}
            </Row>
          </Section>
          <Section title="Words">
            <Row label="Words">{formatNumber(s.words)}</Row>
            <Row label="Unique words" hint="case-insensitive">{formatNumber(s.uniqueWords)}</Row>
            <Row label="Average length">{s.words ? `${dec(s.avgWordLength)} chars` : '—'}</Row>
            <Row label="Longest word" title={s.longestWord}>
              {s.longestWord ? (
                <>
                  <span className="mono text-[12.5px]">{s.longestWord}</span> <span className="text-subtle">({[...s.longestWord].length})</span>
                </>
              ) : (
                '—'
              )}
            </Row>
          </Section>
          <Section title="Structure">
            <Row label="Lines">{formatNumber(s.lines)}</Row>
            <Row label="Non-empty lines">{formatNumber(s.nonEmptyLines)}</Row>
            <Row label="Sentences">{formatNumber(s.sentences)}</Row>
            <Row label="Paragraphs">{formatNumber(s.paragraphs)}</Row>
            <Row label="Words per sentence">{s.sentences ? dec(s.avgSentenceWords) : '—'}</Row>
            <Row label="Longest line">
              {s.longestLine.number ? (
                <button
                  type="button"
                  onClick={() => jumpToLine(s.longestLine.number)}
                  className="inline-flex items-center gap-1 rounded-sm text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  title={s.longestLine.text}
                >
                  <CornerDownRight className="size-3" />
                  Ln {formatNumber(s.longestLine.number)} · {formatNumber(s.longestLine.length)} chars
                </button>
              ) : (
                '—'
              )}
            </Row>
          </Section>
          <Section title="Time">
            <Row label="Reading" hint={`${p.readingWpm} wpm`}>{formatTime(s.readingSeconds)}</Row>
            <Row label="Speaking" hint={`${p.speakingWpm} wpm`}>{formatTime(s.speakingSeconds)}</Row>
          </Section>
          <Section
            title={`Frequent words${p.excludeStopWords ? '' : ' · incl. stop words'}`}
            action={
              <Button size="xs" variant="ghost" className="-mr-2 text-muted" onClick={() => send('/text/word-frequency', input)}>
                Full table <ArrowUpRight />
              </Button>
            }
          >
            {s.topWords.length === 0 ? (
              <p className="py-1 text-xs text-subtle">{s.words ? 'Only stop words — turn off “Hide stop words” to include them.' : 'No words found.'}</p>
            ) : (
              <ol className="flex flex-col">
                {s.topWords.map((w, i) => (
                  <li key={w.word} className="grid h-7 grid-cols-[20px_minmax(0,1fr)_72px_40px] items-center gap-2 text-[13px]">
                    <span className="text-right text-2xs text-subtle tabular">{i + 1}</span>
                    <span className="mono truncate text-[12.5px]" title={w.word}>
                      {w.word}
                    </span>
                    <span className="h-1 overflow-hidden rounded-full bg-surface-2">
                      <span className="block h-full rounded-full bg-accent/70" style={{ width: `${Math.max(4, (w.count / maxCount) * 100)}%` }} />
                    </span>
                    <span className="text-right tabular">{formatNumber(w.count)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      )}
    </aside>
  )

  const status = (
    <StatusBar>
      <StatusItem label="Words">{s ? formatNumber(s.words) : '—'}</StatusItem>
      <StatusItem label="Chars">{s ? formatNumber(s.characters) : '—'}</StatusItem>
      <StatusItem label="Reading">{s ? formatTime(s.readingSeconds) : '—'}</StatusItem>
      {big && <StatusItem tone="mod">Worker</StatusItem>}
      {big && task.duration != null && workerCurrent && <StatusItem label="Computed in">{formatDuration(task.duration)}</StatusItem>}
      <StatusSpacer />
      <Badge tone="neutral">Processed locally</Badge>
    </StatusBar>
  )

  if (isMobile) {
    return (
      <>
        {toolbar}
        <div className="flex shrink-0 items-center border-b border-border bg-bg px-3 py-1.5">
          <Segmented aria-label="Visible pane" value={mobileTab} onValueChange={setMobileTab} className="w-full [&>*]:flex-1 [&>*]:justify-center" options={[{ value: 'text', label: 'Text' }, { value: 'stats', label: 'Stats' }]} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{mobileTab === 'text' ? inputPane : panel}</div>
        {status}
      </>
    )
  }

  return (
    <>
      {toolbar}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{inputPane}</div>
        <div className="flex w-[340px] shrink-0 flex-col border-l border-border lg:w-[380px]">{panel}</div>
      </div>
      {status}
    </>
  )
}
