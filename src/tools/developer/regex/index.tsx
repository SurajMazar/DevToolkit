import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, TimerOff } from 'lucide-react'
import type { editor as MonacoEditor } from 'monaco-esm/editor/editor.api.js'
import { CodeEditor, type CodeEditorHandle } from '@/components/editors/CodeEditor'
import { InputEditorPane } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import { CopyButton } from '@/components/common/CopyButton'
import { DownloadButton } from '@/components/common/DownloadButton'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { useTask } from '@/hooks/useTask'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { compileRegex, type MatchResult, type RegexMatch, type ReplaceResult } from '@/engines/regex/core'
import { RegexTimeoutError, SafeRegexRunner } from '@/engines/regex/safe'
import { explainRegex, FLAG_INFO, parseRegexLiteral } from '@/engines/dev/regex-explain'
import type { LibraryPattern } from '@/engines/dev/regex-library'
import type { VirtualListHandle } from '../_shared/VirtualList'
import { PatternInput, type PatternInputHandle } from './PatternInput'
import { ExplainPanel } from './ExplainPanel'
import { MatchesPanel } from './MatchesPanel'
import { SamplesPanel } from './SamplesPanel'
import { LibraryDialog } from './LibraryDialog'
import { cn } from '@/utils/cn'
import { formatDuration, formatNumber } from '@/utils/format'

const TIMEOUT_MS = 1500
const MATCH_CAP = 5000
const FLAG_ORDER = ['g', 'i', 'm', 's', 'u', 'v', 'y', 'd'] as const
/** Canonical order used by RegExp.prototype.flags. */
const CANONICAL = 'dgimsuvy'

const DEFAULT_PATTERN = '(?<date>(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})) (?<time>[\\d:]{8})\\s+(?<level>ERROR|WARN)\\s+\\[(\\w+)\\]'
const SAMPLE_TEXT = `2026-10-13 09:12:44 INFO  [api] GET /v2/orders 200 in 42ms
2026-10-13 09:12:45 WARN  [db] slow query (1203ms): SELECT * FROM orders WHERE customer_id = $1
2026-10-13 09:12:47 ERROR [payments] card_declined for ord_10432 (ada@example.com)
2026-10-13 09:13:02 INFO  [api] POST /v2/refunds 201 in 88ms
2026-10-14 00:00:01 ERROR [cron] nightly export failed: ETIMEDOUT 10.0.4.17:5432
2026-10-14 00:00:05 WARN  [cron] retrying in 30s (attempt 2/5)`

// Monaco strips characters like "/" and "[" from decoration class names, so Tailwind
// arbitrary/opacity utilities cannot be used here. These classes only reference tokens.
const DECORATION_CSS = `
.rx-m0{background:color-mix(in oklab,var(--accent) 20%,transparent);box-shadow:inset 0 -1.5px 0 var(--accent);border-radius:2px}
.rx-m1{background:color-mix(in oklab,var(--mod) 20%,transparent);box-shadow:inset 0 -1.5px 0 var(--mod);border-radius:2px}
.rx-active{background:color-mix(in oklab,var(--accent) 36%,transparent);box-shadow:inset 0 0 0 1px var(--accent);border-radius:2px}
.rx-g0{background:color-mix(in oklab,var(--add) 38%,transparent)}
.rx-g1{background:color-mix(in oklab,var(--del) 34%,transparent)}
.rx-g2{background:color-mix(in oklab,var(--mod) 38%,transparent)}
.rx-g3{background:color-mix(in oklab,var(--accent) 42%,transparent)}
.rx-empty{border-left:2px solid var(--accent);margin-left:-1px}
`
const MATCH_CLASSES = ['rx-m0', 'rx-m1']
const ACTIVE_CLASS = 'rx-active'
const GROUP_CLASSES = ['rx-g0', 'rx-g1', 'rx-g2', 'rx-g3']
const EMPTY_CLASS = 'rx-empty'

function toggleFlag(flags: string, f: string) {
  let set = new Set(flags.split(''))
  if (set.has(f)) set.delete(f)
  else {
    set.add(f)
    if (f === 'u') set.delete('v')
    if (f === 'v') set.delete('u')
  }
  set = new Set([...set].filter((x) => CANONICAL.includes(x)))
  return CANONICAL.split('').filter((x) => set.has(x)).join('')
}

function literalOf(pattern: string, flags: string) {
  // Escape "/" that is not already escaped and not inside a character class.
  let out = ''
  let inClass = false
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\') {
      out += c + (pattern[i + 1] ?? '')
      i++
      continue
    }
    if (c === '[') inClass = true
    else if (c === ']') inClass = false
    out += c === '/' && !inClass ? '\\/' : c
  }
  return `/${out || '(?:)'}/${flags}`
}

interface Keyed<T> {
  key: string
  text: string
  value: T
}

export default function RegexTester() {
  const [pattern, setPattern] = usePersistentState('pattern', DEFAULT_PATTERN)
  const [flags, setFlags] = usePersistentState('flags', 'gm')
  const [text, setText] = usePersistentState('text', SAMPLE_TEXT)
  const [replacement, setReplacement] = usePersistentState('replacement', '$<level> $<date>T$<time> ($7)')
  const [tab, setTab] = usePersistentState('tab', 'matches')
  const [active, setActive] = useState<number | null>(null)
  const [groupHover, setGroupHover] = useState<{ match: number; group: number } | null>(null)
  const [patternHl, setPatternHl] = useState<{ start: number; end: number } | null>(null)
  const [mobileTab, setMobileTab] = useState<0 | 1>(0)
  const [ed, setEd] = useState<MonacoEditor.IStandaloneCodeEditor | null>(null)
  // Separate runners so a timeout in one (which kills its worker) never cancels the other.
  const [matchRunner] = useState(() => new SafeRegexRunner(TIMEOUT_MS))
  const [replaceRunner] = useState(() => new SafeRegexRunner(TIMEOUT_MS))
  // A runner's first call includes starting its worker; on a slow device that start-up alone
  // could exceed the limit, so a timeout before the worker has ever answered is retried once.
  const warm = useRef({ match: false, replace: false })
  useEffect(() => {
    matchRunner.match({ pattern: '(?:)', flags: '', text: '' }).then(() => (warm.current.match = true), () => {})
    replaceRunner.replace({ pattern: '(?:)', flags: '', text: '', replacement: '' }).then(() => (warm.current.replace = true), () => {})
    return () => {
      matchRunner.dispose()
      replaceRunner.dispose()
    }
  }, [matchRunner, replaceRunner])
  const editorRef = useRef<CodeEditorHandle>(null)
  const patternRef = useRef<PatternInputHandle>(null)
  const listRef = useRef<VirtualListHandle>(null)
  const decorations = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null)
  useIncomingInput(setText)

  const compiled = useMemo(() => compileRegex(pattern, flags), [pattern, flags])
  const explain = useMemo(() => explainRegex(pattern, flags), [pattern, flags])
  const valid = compiled.ok && pattern !== ''

  const dText = useDebouncedValue(text, Math.max(60, adaptiveDelay(text.length)))
  const dPattern = useDebouncedValue(pattern, 60)
  const key = `${flags}\u0000${dPattern}`
  const matchTask = useTask<Keyed<MatchResult>>()
  const replaceTask = useTask<Keyed<ReplaceResult>>()

  useEffect(() => {
    if (!dPattern || !compileRegex(dPattern, flags).ok) {
      matchTask.reset()
      return
    }
    const t = dText
    void matchTask.run(async (signal) => {
      const exec = () => matchRunner.match({ pattern: dPattern, flags, text: t, cap: MATCH_CAP }, signal)
      let value: MatchResult
      try {
        value = await exec()
      } catch (e) {
        if (!(e instanceof RegexTimeoutError) || warm.current.match) throw e
        warm.current.match = true
        value = await exec()
      }
      warm.current.match = true
      return { key, text: t, value }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dText])

  const dReplacement = useDebouncedValue(replacement, 80)
  useEffect(() => {
    if (tab !== 'replace' || !dPattern || !compileRegex(dPattern, flags).ok) {
      replaceTask.reset()
      return
    }
    const t = dText
    void replaceTask.run(async (signal) => {
      const exec = () => replaceRunner.replace({ pattern: dPattern, flags, text: t, replacement: dReplacement }, signal)
      let value: ReplaceResult
      try {
        value = await exec()
      } catch (e) {
        if (!(e instanceof RegexTimeoutError) || warm.current.replace) throw e
        warm.current.replace = true
        value = await exec()
      }
      warm.current.replace = true
      return { key: `${key}\u0000${dReplacement}`, text: t, value }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dText, dReplacement, tab])

  const result = valid && matchTask.result ? matchTask.result.value : null
  const timedOut = matchTask.error instanceof RegexTimeoutError || matchTask.error?.name === 'RegexTimeoutError'
  const stale = valid && (matchTask.result?.key !== `${flags}\u0000${pattern}` || matchTask.result?.text !== text)

  // --- Editor decorations ---------------------------------------------------
  useEffect(() => {
    if (!ed) return
    const model = ed.getModel()
    if (!model) return
    if (!decorations.current) decorations.current = ed.createDecorationsCollection()
    const r = matchTask.result
    if (!valid || !r || model.getValueLength() !== r.text.length) {
      decorations.current.clear()
      return
    }
    const decos: MonacoEditor.IModelDeltaDecoration[] = []
    const range = (s: number, e: number) => {
      const a = model.getPositionAt(s)
      const b = model.getPositionAt(e)
      return { startLineNumber: a.lineNumber, startColumn: a.column, endLineNumber: b.lineNumber, endColumn: b.column }
    }
    r.value.matches.forEach((m, i) => {
      if (m.end === m.index) {
        decos.push({ range: range(m.index, m.index), options: { beforeContentClassName: EMPTY_CLASS, stickiness: 1 } })
        return
      }
      decos.push({ range: range(m.index, m.end), options: { inlineClassName: i === active ? ACTIVE_CLASS : MATCH_CLASSES[i % 2], stickiness: 1, hoverMessage: i === active ? undefined : { value: `Match ${i + 1} · ${m.index}–${m.end}` } } })
    })
    const showGroupsOf = groupHover?.match ?? active
    if (showGroupsOf != null && r.value.matches[showGroupsOf]) {
      for (const g of r.value.matches[showGroupsOf].groups) {
        if (g.start === undefined || g.end === undefined || g.start === g.end) continue
        if (groupHover && groupHover.group !== g.index) continue
        decos.push({ range: range(g.start, g.end), options: { inlineClassName: GROUP_CLASSES[(g.index - 1) % GROUP_CLASSES.length], stickiness: 1 } })
      }
    }
    decorations.current.set(decos)
  }, [ed, matchTask.result, valid, active, groupHover])

  // Cursor inside a match → select it in the list.
  const matchesRef = useRef<RegexMatch[]>([])
  matchesRef.current = result?.matches ?? []
  useEffect(() => {
    if (!ed) return
    const d = ed.onDidChangeCursorPosition((e) => {
      const model = ed.getModel()
      if (!model || e.source === 'api') return
      const off = model.getOffsetAt(e.position)
      const ms = matchesRef.current
      let lo = 0
      let hi = ms.length - 1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (ms[mid].end < off) lo = mid + 1
        else if (ms[mid].index > off) hi = mid - 1
        else {
          setActive(mid)
          listRef.current?.scrollToIndex(mid)
          return
        }
      }
    })
    return () => d.dispose()
  }, [ed])

  const reveal = useCallback(
    (m: RegexMatch) => {
      const model = ed?.getModel()
      if (!ed || !model) return
      const a = model.getPositionAt(m.index)
      const b = model.getPositionAt(m.end)
      ed.setSelection({ startLineNumber: a.lineNumber, startColumn: a.column, endLineNumber: b.lineNumber, endColumn: b.column })
      ed.revealRangeInCenterIfOutsideViewport({ startLineNumber: a.lineNumber, startColumn: a.column, endLineNumber: b.lineNumber, endColumn: b.column })
      setMobileTab(0)
    },
    [ed],
  )

  // Hovering a capture group highlights its source in the pattern.
  const groupRange = (index: number) => {
    let found: { start: number; end: number } | null = null
    const walk = (ns: typeof explain.nodes) => {
      for (const n of ns) {
        if (found) return
        if ((n.kind === 'group' || n.kind === 'error') && n.groupIndex === index) found = { start: n.start, end: n.end - (n.quantifier?.text.length ?? 0) }
        if (n.children) walk(n.children)
      }
    }
    walk(explain.nodes)
    return found
  }

  const setTestText = (t: string) => {
    if (editorRef.current?.editor) editorRef.current.replaceAll(t)
    else setText(t)
  }
  const applyLibrary = (p: LibraryPattern, withSample: boolean) => {
    setPattern(p.pattern)
    setFlags(p.flags.includes('g') ? p.flags : toggleFlag(p.flags, 'g'))
    if (withSample) setTestText(p.sample)
    setTab('matches')
  }
  const onPasteLiteral = (t: string) => {
    const lit = parseRegexLiteral(t)
    if (!lit) return false
    setPattern(lit.pattern)
    setFlags(CANONICAL.split('').filter((f) => lit.flags.includes(f)).join(''))
    return true
  }

  const groupCount = compiled.ok ? (compiled.groupCount ?? 0) : explain.groupCount
  const replaceOut = replaceTask.result?.value

  const toolbar = (
    <Toolbar>
      <LibraryDialog onUse={applyLibrary} />
      <ToolbarSeparator />
      <div role="group" aria-label="Flags" className="flex shrink-0 items-center gap-0.5">
        {FLAG_ORDER.map((f) => {
          const on = flags.includes(f)
          const info = FLAG_INFO[f]
          return (
            <Tooltip key={f} content={`${f} · ${info.name} — ${info.description}`}>
              <button
                type="button"
                aria-pressed={on}
                aria-label={`${info.name} flag (${f})`}
                onClick={() => setFlags(toggleFlag(flags, f))}
                className={cn(
                  'mono h-7 min-w-7 rounded-md px-1.5 text-[13px] transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-ring',
                  on ? 'bg-accent-soft font-medium text-accent-text' : 'text-subtle hover:bg-surface-2 hover:text-fg',
                )}
              >
                {f}
              </button>
            </Tooltip>
          )
        })}
      </div>
      <ToolbarSpacer />
      <CopyButton value={() => literalOf(pattern, flags)} label="Copy as /literal/" showLabel disabled={!pattern} />
    </Toolbar>
  )

  const patternBar = (
    <div className="shrink-0 border-b border-border bg-bg px-3 py-2 md:px-4">
      <PatternInput ref={patternRef} value={pattern} onChange={setPattern} onPasteLiteral={onPasteLiteral} nodes={explain.nodes} highlight={patternHl} invalid={!compiled.ok} flags={flags} />
    </div>
  )

  const banners = (
    <>
      {!compiled.ok && <ErrorDisplay title="Syntax error" error={compiled.error ?? 'Invalid pattern'} />}
      {compiled.ok && timedOut && (
        <ErrorDisplay
          title="Timed out"
          error={matchTask.error!.message}
          action={
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
              <TimerOff className="size-3.5" /> {TIMEOUT_MS / 1000}s limit
            </span>
          }
        />
      )}
      {compiled.ok && matchTask.error && !timedOut && <ErrorDisplay error={matchTask.error.message} />}
      {compiled.ok && !timedOut && explain.warnings.length > 0 && (
        <div className="flex shrink-0 items-start gap-2 border-b border-warn/25 bg-warn-soft px-3 py-1.5 text-xs text-fg" onMouseEnter={() => setPatternHl(explain.warnings[0])} onMouseLeave={() => setPatternHl(null)}>
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-warn" />
          <span>{explain.warnings[0].message} Matching runs in a worker with a {TIMEOUT_MS / 1000}s limit, so the page stays responsive.</span>
        </div>
      )}
    </>
  )

  const right = (
    <Pane aria-label="Results">
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="overflow-x-auto [scrollbar-width:none]">
          <TabsTrigger value="matches">
            Matches {result && <span className="text-subtle tabular">{formatNumber(result.total)}</span>}
            {matchTask.running && <Loader2 className="animate-spin text-subtle" />}
          </TabsTrigger>
          <TabsTrigger value="replace">Replace</TabsTrigger>
          <TabsTrigger value="explain">Explain</TabsTrigger>
          <TabsTrigger value="samples">Samples</TabsTrigger>
        </TabsList>
        <TabsContent value="matches" className={cn('flex min-h-0 flex-1 flex-col', stale && 'opacity-70')}>
          {!pattern ? (
            <p className="px-4 py-6 text-sm text-muted">Enter a pattern above, or pick one from the Library.</p>
          ) : !compiled.ok ? (
            <p className="px-4 py-6 text-sm text-muted">Fix the syntax error to see matches.</p>
          ) : timedOut ? (
            <p className="px-4 py-6 text-sm text-muted">No results — matching was stopped after {TIMEOUT_MS / 1000}s.</p>
          ) : result ? (
            <MatchesPanel
              ref={listRef}
              result={result}
              active={active}
              onActive={setActive}
              onGroupHover={(m, g) => {
                setGroupHover(g == null ? null : { match: m, group: g })
                setPatternHl(g == null ? null : groupRange(g))
              }}
              onReveal={reveal}
              global={flags.includes('g')}
            />
          ) : (
            <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted">
              <Loader2 className="size-4 animate-spin" /> Matching…
            </p>
          )}
        </TabsContent>
        <TabsContent value="replace" className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-border px-4 py-2">
            <Input value={replacement} onChange={(e) => setReplacement(e.target.value)} aria-label="Replacement" placeholder="Replacement, e.g. $2/$1 or $<name>" className="mono" />
            <p className="mt-1.5 text-2xs text-subtle">
              <code className="mono text-muted">$1</code> group · <code className="mono text-muted">$&lt;name&gt;</code> named group · <code className="mono text-muted">$&amp;</code> whole match · <code className="mono text-muted">$`</code> / <code className="mono text-muted">$'</code> before / after · <code className="mono text-muted">$$</code> literal $
              {!flags.includes('g') && <span className="text-warn"> · without g only the first match is replaced</span>}
            </p>
          </div>
          <PaneHeader
            title="Output"
            meta={replaceOut ? `${formatNumber(replaceOut.count)} replacement${replaceOut.count === 1 ? '' : 's'}` : undefined}
            actions={
              <>
                <CopyButton value={() => replaceOut?.output ?? ''} label="Copy output" disabled={!replaceOut} />
                <DownloadButton getContent={() => replaceOut?.output ?? ''} filename="replaced.txt" label="Download output" disabled={!replaceOut} />
              </>
            }
          />
          {replaceTask.error && <ErrorDisplay error={replaceTask.error.message} />}
          <div className="relative min-h-0 flex-1">
            <CodeEditor value={compiled.ok ? (replaceOut?.output ?? '') : ''} readOnly ariaLabel="Replacement output" wordWrap path="regex-replace-output" />
          </div>
        </TabsContent>
        <TabsContent value="explain" className="flex min-h-0 flex-1 flex-col">
          <ExplainPanel explain={explain} onHover={setPatternHl} onSelect={(s, e) => patternRef.current?.select(s, e)} />
        </TabsContent>
        <TabsContent value="samples" className="flex min-h-0 flex-1 flex-col">
          <SamplesPanel pattern={pattern} flags={flags} valid={valid} onAppend={(s) => setTestText(text ? `${text}\n${s}` : s)} />
        </TabsContent>
      </Tabs>
    </Pane>
  )

  return (
    <>
      <style>{DECORATION_CSS}</style>
      {toolbar}
      {patternBar}
      {banners}
      <SplitPane id="regex" initial={0.55} mobileTabs={['Test string', 'Results']} mobileTab={mobileTab} onMobileTabChange={setMobileTab}>
        <InputEditorPane
          ref={editorRef}
          title="Test string"
          value={text}
          onChange={setText}
          sample={SAMPLE_TEXT}
          placeholder="Paste text to test the pattern against…"
          onMount={(e) => setEd(e)}
          path="regex-test-string"
          wordWrap
          options={{ occurrencesHighlight: 'off', selectionHighlight: false }}
        />
        {right}
      </SplitPane>
      <StatusBar>
        <StatusItem label="Matches">{result && !timedOut ? formatNumber(result.total) : '—'}</StatusItem>
        <StatusItem label="Groups">{groupCount}</StatusItem>
        <StatusItem label="Flags">{flags || 'none'}</StatusItem>
        {timedOut && <StatusItem tone="danger">Timed out after {TIMEOUT_MS / 1000}s</StatusItem>}
        {!compiled.ok && <StatusItem tone="danger">Invalid pattern</StatusItem>}
        <StatusSpacer />
        {matchTask.duration != null && result && !timedOut && <StatusItem label="Took">{formatDuration(matchTask.duration)}</StatusItem>}
        <StatusItem label="Engine">JavaScript · worker, {TIMEOUT_MS / 1000}s limit</StatusItem>
      </StatusBar>
    </>
  )
}
