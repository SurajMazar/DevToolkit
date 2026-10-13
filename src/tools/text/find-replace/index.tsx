import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CaseSensitive, ChevronDown, ChevronUp, Loader2, Regex, Replace, ReplaceAll, WholeWord } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { toast } from 'sonner'
import type { editor as MonacoEditor } from 'monaco-esm/editor/editor.api.js'
import type { Monaco } from '@/components/editors/monaco/loader'
import { RegexTimeoutError, SafeRegexRunner } from '@/engines/regex/safe'
import type { MatchResult, ReplaceResult } from '@/engines/regex/core'
import {
  buildLineIndex,
  checkReplacement,
  DEFAULT_FIND_OPTIONS,
  describeFlags,
  matchIndexAtOrAfter,
  prepareReplacement,
  prepareSearch,
  previewMatch,
  visualize,
  type FindOptions,
} from '@/engines/text/find-replace'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { useTask } from '@/hooks/useTask'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { useIsMobile } from '@/hooks/useMediaQuery'
import type { CodeEditorHandle } from '@/components/editors/CodeEditor'
import { InputEditorPane, OutputEditorPane } from '@/components/tools/EditorPane'
import { Pane, PaneBody, PaneHeader } from '@/components/tools/Pane'
import { Toolbar, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { EmptyState } from '@/components/tools/EmptyState'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Segmented } from '@/components/ui/segmented'
import { Tooltip } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/common/CopyButton'
import { cn } from '@/utils/cn'
import { formatDuration, formatNumber, pluralize } from '@/utils/format'

/** Matches beyond this are counted but not highlighted or listed. */
const MATCH_CAP = 10_000

const SAMPLE = `2024-03-02 09:14:07 INFO  [api] GET /users/42 200 12ms user=ana.lopez@example.com
2024-03-02 09:14:09 WARN  [api] GET /users/7 404 3ms user=bob@example.org
2024-03-02 09:15:30 ERROR [db] Timeout after 5000ms on query "SELECT * FROM orders"
2024-03-02 09:16:02 INFO  [api] POST /orders 201 48ms user=ana.lopez@example.com
2024-03-02 09:16:45 ERROR [api] GET /reports/2024 500 912ms user=chen@example.net
2024-03-03 10:01:12 INFO  [auth] Login ok user=dmitri@example.net`

const SAMPLE_QUERY = { find: '(?<date>\\d{4})-(\\d{2})-(\\d{2})', replace: '$3/$2/$<date>', regex: true }

function ToggleIcon({ pressed, onChange, label, icon, text, disabled }: { pressed: boolean; onChange: (v: boolean) => void; label: string; icon?: React.ReactNode; text?: string; disabled?: boolean }) {
  return (
    <Tooltip content={label}>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={() => onChange(!pressed)}
        className={cn('mono text-xs', pressed && 'bg-accent-soft text-accent-text hover:bg-accent-soft hover:text-accent-text')}
      >
        {icon ?? text}
      </Button>
    </Tooltip>
  )
}

interface MatchRun {
  result: MatchResult
  text: string
  key: string
}
interface ReplaceRun {
  result: ReplaceResult
  text: string
  key: string
}

export default function FindReplace() {
  const [input, setInput] = usePersistentState('input', '')
  const [find, setFind] = usePersistentState('find', '')
  const [replacement, setReplacement] = usePersistentState('replace', '')
  const [opts, setOpts] = usePersistentState<FindOptions>('options', DEFAULT_FIND_OPTIONS)
  const [view, setView] = usePersistentState<'preview' | 'matches'>('view', 'preview')
  const [current, setCurrent] = useState(0)
  const inputRef = useRef<CodeEditorHandle>(null)
  const findRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<{ ed: MonacoEditor.IStandaloneCodeEditor; monaco: Monaco } | null>(null)
  const decorations = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null)
  const [editorVersion, setEditorVersion] = useState(0)
  const isMobile = useIsMobile()
  const [mobileTab, setMobileTab] = useState<0 | 1>(0)

  const [matchRunner] = useState(() => new SafeRegexRunner(2000))
  const [replaceRunner] = useState(() => new SafeRegexRunner(2000))
  useEffect(() => () => {
    matchRunner.dispose()
    replaceRunner.dispose()
  }, [matchRunner, replaceRunner])
  const matchTask = useTask<MatchRun>()
  const replaceTask = useTask<ReplaceRun>()

  useIncomingInput(setInput)

  const source = useDebouncedValue(input, adaptiveDelay(input.length))
  const query = useDebouncedValue(find, find.length > 0 ? 80 : 0)
  const rep = useDebouncedValue(replacement, 80)
  const o = useMemo(() => ({ ...DEFAULT_FIND_OPTIONS, ...opts }), [opts])
  const setOpt = <K extends keyof FindOptions>(k: K, v: FindOptions[K]) => setOpts({ ...o, [k]: v })

  // Instant syntax feedback (compilation is linear-time; matching happens in the worker).
  const check = useMemo(() => (find ? prepareSearch(find, o) : null), [find, o])
  const preparedRep = useMemo(() => prepareReplacement(rep, o.regex), [rep, o.regex])
  const repWarning = useMemo(() => (check?.ok && o.regex && rep ? checkReplacement(preparedRep, check.groupCount, check.groupNames) : null), [check, o.regex, rep, preparedRep])
  const debouncedCheck = useMemo(() => (query ? prepareSearch(query, o) : null), [query, o])
  const search = debouncedCheck?.ok ? debouncedCheck.search : null
  const searchKey = search ? `${search.pattern}/${search.flags}` : ''

  const { run: runMatch, reset: resetMatch } = matchTask
  const { run: runReplace, reset: resetReplace } = replaceTask
  useEffect(() => {
    if (!search || !source) {
      resetMatch()
      return
    }
    void runMatch(async (signal) => ({ result: await matchRunner.match({ pattern: search.pattern, flags: search.flags, text: source, cap: MATCH_CAP }, signal), text: source, key: searchKey }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey, source, runMatch, resetMatch, matchRunner])

  const repKey = `${searchKey}→${preparedRep}`
  useEffect(() => {
    if (!search || !source) {
      resetReplace()
      return
    }
    void runReplace(async (signal) => ({ result: await replaceRunner.replace({ pattern: search.pattern, flags: search.flags, text: source, replacement: preparedRep }, signal), text: source, key: repKey }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repKey, source, runReplace, resetReplace, replaceRunner])

  const matchesCurrent = matchTask.result && matchTask.result.key === searchKey && matchTask.result.text === source
  const matches = useMemo(() => (matchesCurrent ? matchTask.result!.result.matches : []), [matchesCurrent, matchTask.result])
  const total = matchesCurrent ? matchTask.result!.result.total : 0
  const capped = matchesCurrent ? matchTask.result!.result.capped : false
  const replaceCurrent = replaceTask.result && replaceTask.result.key === repKey && replaceTask.result.text === source
  const output = !query || !search ? '' : replaceCurrent ? replaceTask.result!.result.output : ''
  const replaceCount = replaceCurrent ? replaceTask.result!.result.count : 0
  const lineStarts = useMemo(() => buildLineIndex(source), [source])

  // Keep the current match near the cursor when the match set changes.
  useEffect(() => {
    const ed = editorRef.current?.ed
    const model = ed?.getModel()
    const pos = ed?.getPosition()
    const offset = model && pos ? model.getOffsetAt(pos) : 0
    setCurrent(Math.max(0, matchIndexAtOrAfter(matches, offset)))
  }, [matches])

  // Highlight matches in the input editor.
  useEffect(() => {
    const e = editorRef.current
    if (!e || !editorVersion) return
    const model = e.ed.getModel()
    if (!model) return
    if (!decorations.current) decorations.current = e.ed.createDecorationsCollection()
    if (!matches.length) {
      decorations.current.clear()
      return
    }
    // Only paint when the editor still holds the text the matches were computed on.
    if (model.getValueLength() !== source.length) return
    const { OverviewRulerLane, MinimapPosition } = e.monaco.editor
    const decos: MonacoEditor.IModelDeltaDecoration[] = matches.map((m, i) => {
      const a = model.getPositionAt(m.index)
      const b = model.getPositionAt(m.end)
      const isCurrent = i === current
      return {
        range: { startLineNumber: a.lineNumber, startColumn: a.column, endLineNumber: b.lineNumber, endColumn: b.column },
        options: {
          className: isCurrent ? 'currentFindMatch' : 'findMatch',
          stickiness: 1,
          zIndex: isCurrent ? 13 : 10,
          overviewRuler: { color: { id: 'editorOverviewRuler.findMatchForeground' }, position: OverviewRulerLane.Center },
          minimap: { color: { id: 'minimap.findMatchHighlight' }, position: MinimapPosition.Inline },
        },
      }
    })
    decorations.current.set(decos)
  }, [matches, current, editorVersion, source])

  const reveal = useCallback(
    (i: number, focusEditor = false) => {
      const e = editorRef.current
      const m = matches[i]
      const model = e?.ed.getModel()
      if (!e || !m || !model) return
      const a = model.getPositionAt(m.index)
      const b = model.getPositionAt(m.end)
      const range = { startLineNumber: a.lineNumber, startColumn: a.column, endLineNumber: b.lineNumber, endColumn: b.column }
      e.ed.setSelection(range)
      e.ed.revealRangeInCenterIfOutsideViewport(range)
      if (focusEditor) e.ed.focus()
    },
    [matches],
  )

  const go = (dir: 1 | -1) => {
    if (!matches.length) return
    const next = (current + dir + matches.length) % matches.length
    setCurrent(next)
    reveal(next)
    if (isMobile) setMobileTab(0)
  }

  const replaceAll = () => {
    if (!replaceCurrent || replaceCount === 0) return
    if (inputRef.current?.editor) inputRef.current.replaceAll(output)
    else setInput(output)
    toast.success(`Replaced ${pluralize(replaceCount, 'match', 'matches')}`, { description: 'Undo with Ctrl/⌘+Z in the input editor.' })
  }

  const replaceOne = () => {
    const e = editorRef.current
    const m = matches[current]
    const model = e?.ed.getModel()
    if (!e || !m || !model || model.getValueLength() !== source.length) return
    const p = previewMatch(source, lineStarts, m, preparedRep)
    const a = model.getPositionAt(m.index)
    const b = model.getPositionAt(m.end)
    e.ed.pushUndoStop()
    e.ed.executeEdits('find-replace', [{ range: { startLineNumber: a.lineNumber, startColumn: a.column, endLineNumber: b.lineNumber, endColumn: b.column }, text: p.after }])
    e.ed.pushUndoStop()
    // Place the cursor after the replacement so the next match becomes current.
    const after = model.getPositionAt(m.index + p.after.length)
    e.ed.setPosition(after)
  }

  /** Loads the sample text; when Find is empty also fills in a sample regex to show groups at work. */
  const loadSample = () => {
    if (!find) {
      setFind(SAMPLE_QUERY.find)
      setReplacement(SAMPLE_QUERY.replace)
      setOpts({ ...o, regex: SAMPLE_QUERY.regex })
    }
    return SAMPLE
  }

  const error = check && !check.ok ? check.error : null
  const timeout = matchTask.error instanceof RegexTimeoutError || replaceTask.error instanceof RegexTimeoutError
  const runError = matchTask.error ?? replaceTask.error
  const busy = matchTask.running || replaceTask.running
  const matchLabel = !find ? '' : error ? 'Invalid' : !matchesCurrent ? (busy ? '…' : '') : total === 0 ? 'No results' : `${formatNumber(current + 1)} of ${formatNumber(total)}${capped ? '+' : ''}`

  const toolbar = (
    <Toolbar>
      <Segmented
        aria-label="Search mode"
        value={o.regex ? 'regex' : 'text'}
        onValueChange={(v) => setOpt('regex', v === 'regex')}
        options={[
          { value: 'text', label: 'Text' },
          { value: 'regex', label: 'Regex', icon: <Regex /> },
        ]}
      />
      <ToolbarSeparator />
      <div className="flex items-center gap-0.5">
        <ToggleIcon pressed={o.caseSensitive} onChange={(v) => setOpt('caseSensitive', v)} label="Match case" icon={<CaseSensitive className="!size-4" />} />
        <ToggleIcon pressed={o.wholeWord} onChange={(v) => setOpt('wholeWord', v)} label="Whole word" icon={<WholeWord className="!size-4" />} />
      </div>
      {o.regex && (
        <>
          <ToolbarSeparator />
          <span className="text-xs text-subtle">Flags</span>
          <div className="flex items-center gap-0.5">
            <ToggleIcon pressed={o.multiline} onChange={(v) => setOpt('multiline', v)} label="Multiline (m): ^ and $ match at line breaks" text="m" />
            <ToggleIcon pressed={o.dotAll} onChange={(v) => setOpt('dotAll', v)} label="Dot all (s): . matches line breaks" text="s" />
            <ToggleIcon pressed={o.unicode} onChange={(v) => setOpt('unicode', v)} label="Unicode (u): \p{…} classes, strict escapes" text="u" />
          </div>
        </>
      )}
      <ToolbarSpacer />
      {search && <span className="mono hidden text-2xs text-subtle lg:inline">/{search.pattern.length > 48 ? search.pattern.slice(0, 48) + '…' : search.pattern}/{describeFlags(search.flags)}</span>}
    </Toolbar>
  )

  const fieldClass =
    'mono h-8 min-w-0 flex-1 rounded-md border border-border bg-workspace px-2.5 text-[13px] text-fg placeholder:font-sans placeholder:text-subtle hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger-soft'

  const queryPanel = (
    <div className="shrink-0 border-b border-border bg-bg">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 px-3 py-2 md:px-4">
        <label htmlFor="fr-find" className="w-14 text-xs text-muted">
          Find
        </label>
        <div className="relative flex min-w-0 items-center">
          <input
            id="fr-find"
            ref={findRef}
            value={find}
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                go(e.shiftKey ? -1 : 1)
              }
            }}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!error}
            placeholder={o.regex ? 'Regular expression, e.g. (\\w+)@(\\w+)\\.com' : 'Text to find'}
            className={cn(fieldClass, 'pr-28')}
          />
          <span className={cn('pointer-events-none absolute right-2.5 text-2xs tabular', error ? 'text-danger' : total === 0 && matchesCurrent ? 'text-warn' : 'text-subtle')} aria-live="polite">
            {matchLabel}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton label="Previous match" shortcut={['⇧', '↵']} icon={<ChevronUp />} onClick={() => go(-1)} disabled={!matches.length} />
          <IconButton label="Next match" shortcut={['↵']} icon={<ChevronDown />} onClick={() => go(1)} disabled={!matches.length} />
        </div>

        <label htmlFor="fr-replace" className="w-14 text-xs text-muted">
          Replace
        </label>
        <input
          id="fr-replace"
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          placeholder={o.regex ? 'Replacement — $1, $<name>, $& and \\n are supported' : 'Replacement text (empty deletes matches)'}
          className={fieldClass}
        />
        <div className="flex items-center gap-1">
          <Tooltip content="Replace the current match in the input">
            <Button size="sm" variant="ghost" onClick={replaceOne} disabled={!matches.length || !matchesCurrent}>
              <Replace /> <span className="hidden sm:inline">Replace</span>
            </Button>
          </Tooltip>
          <Tooltip content="Apply every replacement to the input (undoable)">
            <Button size="sm" variant="primary" onClick={replaceAll} disabled={!replaceCurrent || replaceCount === 0}>
              <ReplaceAll /> <span className="hidden sm:inline">Replace all</span>
            </Button>
          </Tooltip>
        </div>
      </div>
      {error && <ErrorDisplay error={error} title="Invalid pattern" className="border-b-0 border-t" />}
      {!error && runError && (
        <ErrorDisplay
          error={runError.message}
          title={timeout ? 'Pattern timed out' : 'Search failed'}
          className="border-b-0 border-t"
        />
      )}
      {!error && !runError && repWarning && <ErrorDisplay severity="warning" error={repWarning} className="border-b-0 border-t" />}
    </div>
  )

  const inputPane = (
    <InputEditorPane
      ref={inputRef}
      value={input}
      onChange={setInput}
      sample={loadSample}
      title="Text"
      path="find-replace-input"
      placeholder="Paste the text to search…"
      onMount={(ed, monaco) => {
        editorRef.current = { ed, monaco }
        decorations.current = null
        setEditorVersion((n) => n + 1)
      }}
      emptyState={<EmptyState compact title="Paste text to search" description="Matches are highlighted here as you type in Find. Load the sample to try a regex with named groups." />}
    />
  )

  const viewSwitch = (
    <Segmented
      size="xs"
      aria-label="Result view"
      value={view}
      onValueChange={setView}
      options={[
        { value: 'preview', label: 'Result' },
        { value: 'matches', label: matchesCurrent && total ? `Matches ${formatNumber(Math.min(total, MATCH_CAP))}${capped ? '+' : ''}` : 'Matches' },
      ]}
    />
  )

  const resultEmpty = !input ? (
    <EmptyState compact title="The replaced text appears here" description="Nothing is changed until you press Replace all." />
  ) : !find ? (
    <EmptyState compact title="Type something to find" description={o.regex ? 'Regex mode: capture groups can be reused in the replacement as $1 or $<name>.' : 'Plain text mode. Switch to Regex for patterns and capture groups.'} />
  ) : error ? (
    <EmptyState compact title="Fix the pattern to see a preview" description={error} />
  ) : runError ? (
    <EmptyState compact title="No preview" description={timeout ? 'The pattern took too long and was stopped.' : runError.message} />
  ) : matchesCurrent && total === 0 ? (
    <EmptyState compact title="No matches" description={`Nothing in the text matches ${o.regex ? 'this pattern' : `“${find}”`}${o.caseSensitive ? ' (case-sensitive)' : ''}${o.wholeWord ? ' as a whole word' : ''}.`} />
  ) : busy ? (
    <EmptyState compact icon={<Loader2 className="animate-spin" />} title="Searching…" />
  ) : undefined

  const previewPane = (
    <OutputEditorPane
      title="Result"
      value={matchesCurrent && total === 0 ? '' : output}
      headerExtra={viewSwitch}
      meta={replaceCurrent && replaceCount > 0 ? `${pluralize(replaceCount, 'replacement')}` : undefined}
      filename="replaced.txt"
      path="find-replace-output"
      emptyState={resultEmpty}
    />
  )

  const matchesPane = (
    <Pane aria-label="Matches">
      <PaneHeader
        title="Matches"
        actions={
          <CopyButton
            label="Copy matches (before → after, TSV)"
            disabled={!matches.length}
            value={() => matches.map((m) => {
              const p = previewMatch(source, lineStarts, m, preparedRep)
              return `${p.line}:${p.column}\t${p.before}\t${p.after}`
            }).join('\n')}
          />
        }
      >
        {viewSwitch}
      </PaneHeader>
      <PaneBody>
        {matches.length ? (
          <MatchList matches={matches} source={source} lineStarts={lineStarts} replacement={preparedRep} current={current} onPick={(i) => { setCurrent(i); reveal(i, true); if (isMobile) setMobileTab(0) }} />
        ) : (
          resultEmpty ?? <EmptyState compact title="No matches" />
        )}
      </PaneBody>
      {capped && (
        <div className="flex h-7 shrink-0 items-center border-t border-border px-3 text-2xs text-subtle">
          Showing the first {formatNumber(MATCH_CAP)} matches. Replace all still applies to every match ({formatNumber(replaceCount)}).
        </div>
      )}
    </Pane>
  )

  const right = view === 'preview' ? previewPane : matchesPane

  const status = (
    <StatusBar>
      <StatusItem label="Mode">{o.regex ? 'Regex' : 'Text'}</StatusItem>
      <StatusItem label="Matches">{matchesCurrent ? `${formatNumber(total)}${capped ? '+' : ''}` : '—'}</StatusItem>
      {replaceCurrent && <StatusItem label="Replacements">{formatNumber(replaceCount)}</StatusItem>}
      {matchTask.duration != null && matchesCurrent && <StatusItem label="Search">{formatDuration(matchTask.duration)}</StatusItem>}
      {busy && (
        <StatusItem>
          <Loader2 className="size-3 animate-spin" />
        </StatusItem>
      )}
      {timeout && <StatusItem tone="danger">Timed out (2 s limit)</StatusItem>}
      <StatusSpacer />
      <StatusItem label="Engine">JavaScript RegExp · worker, 2 s limit</StatusItem>
      <Badge tone="neutral">Processed locally</Badge>
    </StatusBar>
  )

  return (
    <>
      {toolbar}
      {queryPanel}
      <SplitPane id="find-replace" initial={0.5} min={220} mobileTabs={['Text', 'Result']} mobileTab={mobileTab} onMobileTabChange={setMobileTab}>
        {inputPane}
        {right}
      </SplitPane>
      {status}
    </>
  )
}

function MatchList({
  matches,
  source,
  lineStarts,
  replacement,
  current,
  onPick,
}: {
  matches: MatchResult['matches']
  source: string
  lineStarts: number[]
  replacement: string
  current: number
  onPick: (i: number) => void
}) {
  const parent = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: matches.length, getScrollElement: () => parent.current, estimateSize: () => 30, overscan: 12 })
  useEffect(() => {
    if (current >= 0 && current < matches.length) v.scrollToIndex(current, { align: 'auto' })
  }, [current, matches.length, v])
  return (
    <div ref={parent} className="absolute inset-0 overflow-auto" role="listbox" aria-label="Matches" aria-activedescendant={`fr-match-${current}`}>
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((it) => {
          const p = previewMatch(source, lineStarts, matches[it.index], replacement)
          const active = it.index === current
          return (
            <div
              key={it.key}
              id={`fr-match-${it.index}`}
              role="option"
              aria-selected={active}
              onClick={() => onPick(it.index)}
              className={cn(
                'absolute inset-x-0 flex h-[30px] cursor-default items-center gap-3 border-b border-border/60 px-3 text-[12.5px] hover:bg-surface-2/60',
                active && 'bg-accent-soft hover:bg-accent-soft',
              )}
              style={{ top: it.start }}
            >
              <span className="mono w-16 shrink-0 text-2xs text-subtle tabular">
                {p.line}:{p.column}
              </span>
              <span className="mono min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-pre">
                <span className="rounded-sm bg-del-bg px-0.5 text-del">{visualize(p.before) || <i className="text-subtle">empty</i>}</span>
                <ArrowRight className="mx-1.5 inline size-3 text-subtle" />
                <span className="rounded-sm bg-add-bg px-0.5 text-add">{visualize(p.after) || <i className="text-subtle">(deleted)</i>}</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
