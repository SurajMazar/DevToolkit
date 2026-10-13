import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeftRight, ArrowUp, Braces, ChevronDown, ChevronsDownUp, ChevronsUpDown, Download, Filter, Loader2, Play, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { DEFAULT_JSON_DIFF_OPTIONS, NodeStatus, parsePathPattern, pathToText, type ArrayMatch, type JsonChange } from '@/engines/diff/json-diff'
import { splitLines } from '@/engines/diff/text-diff'
import { stringifyJson } from '@/engines/json/stringify'
import { parseJson } from '@/engines/json/parse'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useWorker } from '@/hooks/useWorker'
import { useTask } from '@/hooks/useTask'
import { useDebouncedValue } from '@/hooks/useDebounced'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { createDiffWorker } from '@/workers/factories'
import type { DiffTasks, JsonDiffTaskResult } from '@/workers/diff.tasks'
import type { CodeEditorHandle, EditorMarker } from '@/components/editors/CodeEditor'
import { InputEditorPane } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { DiffViewer } from '@/components/tools/DiffViewer'
import { EmptyState } from '@/components/tools/EmptyState'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input, Textarea } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Field } from '@/components/ui/label'
import { DiffTree, type DiffTreeHandle } from './DiffTree'
import { ChangeCopyMenu, ChangeList, FilterBar, useFilteredChanges, type ChangeFilter } from './ChangeList'
import { JSON_A, JSON_B } from './samples'
import { copyText } from '@/utils/clipboard'
import { downloadText } from '@/utils/download'
import { formatBytes, formatDuration, formatNumber } from '@/utils/format'
import { cn } from '@/utils/cn'
import { modKey } from '@/utils/platform'

type View = 'input' | 'tree' | 'changes' | 'text'

interface Settings {
  arrayMatch: ArrayMatch
  arrayKeys: string
  ignorePaths: string
  looseTypes: boolean
  ignoreStringCase: boolean
  ignoreArrayOrder: boolean
  detectKeyOrder: boolean
  sortKeys: boolean
  onlyChanges: boolean
}

const DEFAULTS: Settings = {
  arrayMatch: 'smart',
  arrayKeys: 'id',
  ignorePaths: '',
  looseTypes: false,
  ignoreStringCase: false,
  ignoreArrayOrder: false,
  detectKeyOrder: false,
  sortKeys: true,
  onlyChanges: false,
}

const AUTO_LIMIT = 8_000_000

interface Computed {
  res: JsonDiffTaskResult
  a: string
  b: string
  key: string
}

export default function JsonDiff() {
  const [a, setA] = usePersistentState('a', '')
  const [b, setB] = usePersistentState('b', '')
  const [s, setS] = usePersistentState<Settings>('settings', DEFAULTS)
  const settings = { ...DEFAULTS, ...s }
  const set = (patch: Partial<Settings>) => setS({ ...settings, ...patch })
  const [view, setView] = usePersistentState<View>('view', 'input')
  const [toggled, setToggled] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState(-1)
  const [activeChange, setActiveChange] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ChangeFilter>({ added: true, removed: true, modified: true, type: true, order: true })
  const [mobileTab, setMobileTab] = useState<0 | 1>(0)
  const isMobile = useIsMobile()
  const refA = useRef<CodeEditorHandle>(null)
  const refB = useRef<CodeEditorHandle>(null)
  const treeRef = useRef<DiffTreeHandle>(null)
  const worker = useWorker<DiffTasks>(createDiffWorker)
  const task = useTask<Computed>()

  // Validate ignore-path patterns up front so bad ones are reported, not silently dropped.
  const { ignorePaths, patternErrors } = useMemo(() => {
    const lines = settings.ignorePaths.split('\n').map((l) => l.trim()).filter(Boolean)
    const ok: string[] = []
    const errs: string[] = []
    for (const l of lines) {
      try {
        parsePathPattern(l)
        ok.push(l)
      } catch (e) {
        errs.push((e as Error).message)
      }
    }
    return { ignorePaths: ok, patternErrors: errs }
  }, [settings.ignorePaths])

  const options = useMemo(
    () => ({
      ...DEFAULT_JSON_DIFF_OPTIONS,
      arrayMatch: settings.arrayMatch,
      arrayKeys: settings.arrayKeys.split(/[\s,]+/).filter(Boolean),
      ignorePaths,
      looseTypes: settings.looseTypes,
      ignoreStringCase: settings.ignoreStringCase,
      ignoreArrayOrder: settings.ignoreArrayOrder,
      detectKeyOrder: settings.detectKeyOrder,
    }),
    [settings.arrayMatch, settings.arrayKeys, ignorePaths, settings.looseTypes, settings.ignoreStringCase, settings.ignoreArrayOrder, settings.detectKeyOrder],
  )
  const optKey = JSON.stringify([options, settings.sortKeys])

  const total = a.length + b.length
  const auto = total <= AUTO_LIMIT
  const delay = total < 100_000 ? 150 : total < 2_000_000 ? 400 : 800
  const da = useDebouncedValue(a, delay)
  const db = useDebouncedValue(b, delay)

  const compare = useCallback(
    (ta: string, tb: string) =>
      task.run(async (signal) => {
        const res = await worker.run('jsonDiff', { a: ta, b: tb, options, sortKeys: settings.sortKeys, withText: true }, signal)
        return { res, a: ta, b: tb, key: optKey }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [worker, optKey],
  )

  useEffect(() => {
    if (!auto) return
    if (!da.trim() || !db.trim()) {
      task.reset()
      return
    }
    void compare(da, db)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [da, db, compare, auto])

  const computed = task.result
  const res = computed?.res
  const ok = res?.ok ? res : null
  const stale = !computed || computed.a !== a || computed.b !== b || computed.key !== optKey
  const changes = ok?.result.changes ?? []
  const visibleChanges = useFilteredChanges(changes, query, filter)

  useEffect(() => {
    setToggled(new Set())
    setSelected(-1)
    setActiveChange(0)
  }, [ok?.result])

  const errorMarkers = (side: 'left' | 'right'): EditorMarker[] | undefined =>
    res && !res.ok && res.side === side ? [{ message: res.error.message, line: res.error.line, column: res.error.column }] : undefined

  const runCompare = () => {
    void compare(a, b)
    if (view === 'input') setView('tree')
  }

  const findNodeForChange = useCallback(
    (ci: number) => {
      if (!ok) return -1
      const t = ok.result.tree
      for (let i = 0; i < t.changeIndex.length; i++) if (t.changeIndex[i] === ci) return i
      return -1
    },
    [ok],
  )

  const revealChange = useCallback(
    (ci: number) => {
      if (!ok) return
      setActiveChange(ci)
      const node = findNodeForChange(ci)
      if (node < 0) return
      // Make sure every ancestor is expanded.
      const t = ok.result.tree
      setToggled((prev) => {
        const next = new Set(prev)
        let p = t.parent[node]
        while (p >= 0) {
          const defaultOpen = p === 0 || t.status[p] === NodeStatus.Contains
          if (!defaultOpen) next.add(p)
          else next.delete(p)
          p = t.parent[p]
        }
        return next
      })
      setSelected(node)
      setView('tree')
      requestAnimationFrame(() => requestAnimationFrame(() => treeRef.current?.reveal(node)))
    },
    [ok, findNodeForChange],
  )

  const go = (dir: 1 | -1) => {
    if (!changes.length) return
    const pos = visibleChanges.indexOf(activeChange)
    const nextPos = pos === -1 ? 0 : (pos + dir + visibleChanges.length) % visibleChanges.length
    const next = visibleChanges[nextPos]
    if (next !== undefined) revealChange(next)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F7' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) {
        e.preventDefault()
        go(e.shiftKey || e.key === 'ArrowUp' ? -1 : 1)
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        runCompare()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const setBoth = (ta: string, tb: string) => {
    refA.current?.editor ? refA.current.replaceAll(ta) : setA(ta)
    refB.current?.editor ? refB.current.replaceAll(tb) : setB(tb)
  }

  const formatInputs = () => {
    const fa = parseJson(a)
    const fb = parseJson(b)
    if (!fa.ok || !fb.ok) {
      toast.error('Fix the JSON errors before formatting')
      return
    }
    setBoth(stringifyJson(fa.value, { indent: 2 }), stringifyJson(fb.value, { indent: 2 }))
  }

  const exportPatch = async (mode: 'copy' | 'download') => {
    try {
      const text = await worker.run('jsonPatch', { a, b })
      if (mode === 'copy') toast[(await copyText(text)) ? 'success' : 'error']('JSON Patch (RFC 6902) copied')
      else downloadText(text, 'changes.patch.json', 'application/json-patch+json')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const exportChanges = () =>
    stringifyJson(
      changes.map((c) => ({ type: c.type, path: c.pathText, from: c.left, to: c.right, ...(c.type === 'type' ? { fromType: c.leftType, toType: c.rightType } : {}) })),
      { indent: 2 },
    )

  const selectedChange: JsonChange | null = ok && selected >= 0 && ok.result.tree.changeIndex[selected] >= 0 ? changes[ok.result.tree.changeIndex[selected]] : null
  const selectedPath = useMemo(() => {
    if (!ok || selected < 0) return null
    if (selectedChange) return selectedChange.pathText
    // Build a display path from the tree for unchanged nodes.
    const t = ok.result.tree
    const segs: string[] = []
    let i = selected
    while (i > 0) {
      segs.unshift(t.keys[i])
      i = t.parent[i]
    }
    return pathToText(segs.map((k) => (k.startsWith('[') ? (/^\[\d+\]$/.test(k) ? Number(k.slice(1, -1)) : k) : k)) as never[])
  }, [ok, selected, selectedChange])

  const bothEmpty = !a.trim() && !b.trim()
  const textLinesA = useMemo(() => (ok ? splitLines(ok.leftText) : []), [ok])
  const textLinesB = useMemo(() => (ok ? splitLines(ok.rightText) : []), [ok])

  // ── Toolbar ──────────────────────────────────────────────────────────────────
  const toolbar = (
    <Toolbar>
      <Segmented
        aria-label="View"
        value={view}
        onValueChange={(v) => (v !== 'input' && !auto && stale ? runCompare() : setView(v))}
        options={[
          { value: 'input', label: 'Edit' },
          { value: 'tree', label: 'Tree', tooltip: 'Structural differences as a tree' },
          { value: 'changes', label: 'Changes', tooltip: 'Every change as a list' },
          { value: 'text', label: 'Text', tooltip: 'Line diff of the normalized (formatted) documents' },
        ]}
      />
      <ToolbarSeparator />
      <ToolbarField label="Arrays">
        <Select
          aria-label="Array matching"
          value={settings.arrayMatch}
          onValueChange={(arrayMatch) => set({ arrayMatch })}
          options={[
            { value: 'smart', label: 'Smart', description: 'Align equal elements; detects insertions' },
            { value: 'index', label: 'By index', description: 'Compare position by position' },
            { value: 'key', label: 'By key', description: 'Match objects by an identifier field' },
          ]}
        />
      </ToolbarField>
      {settings.arrayMatch === 'key' && (
        <Input aria-label="Identifier field(s)" value={settings.arrayKeys} onChange={(e) => set({ arrayKeys: e.target.value })} placeholder="id" className="h-7 w-28 mono text-xs" title="Identifier field names, comma separated (first present wins)" />
      )}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={cn(ignorePaths.length > 0 && 'text-accent-text')}>
            <Filter /> Ignore{ignorePaths.length > 0 && ` (${ignorePaths.length})`}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[360px]">
          <Field label="Ignore paths" hint="One per line. * matches one level, ** any depth. JSON Pointers (/a/0) work too.">
            <Textarea
              value={settings.ignorePaths}
              onChange={(e) => set({ ignorePaths: e.target.value })}
              rows={5}
              className="mono text-xs"
              placeholder={'$.order.updatedAt\nitems[*].etag\n**.timestamp'}
            />
          </Field>
          {patternErrors.map((e) => (
            <p key={e} className="mt-1.5 text-xs text-danger">{e}</p>
          ))}
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={cn((settings.looseTypes || settings.ignoreStringCase || settings.ignoreArrayOrder || settings.detectKeyOrder) && 'text-accent-text')}>
            <Settings2 /> Compare
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <div className="flex flex-col gap-3">
            <Checkbox checked={!settings.looseTypes} onCheckedChange={(v) => set({ looseTypes: v !== true })} label="Type-aware" description={'1 and "1" are different (a type change)'} />
            <Checkbox checked={settings.ignoreStringCase} onCheckedChange={(v) => set({ ignoreStringCase: v === true })} label="Ignore case in strings" />
            <Checkbox checked={settings.ignoreArrayOrder} onCheckedChange={(v) => set({ ignoreArrayOrder: v === true })} label="Ignore array order" description="Arrays are compared as unordered collections" />
            <Checkbox checked={settings.detectKeyOrder} onCheckedChange={(v) => set({ detectKeyOrder: v === true })} label="Report key order changes" description="Object key order is ignored by default" />
            <div className="h-px bg-border" />
            <Checkbox checked={settings.sortKeys} onCheckedChange={(v) => set({ sortKeys: v === true })} label="Sort keys in Text view" description="Normalizes key order before the line diff" />
          </div>
        </PopoverContent>
      </Popover>
      {view === 'tree' && (
        <>
          <ToolbarSeparator />
          <Checkbox checked={settings.onlyChanges} onCheckedChange={(v) => set({ onlyChanges: v === true })} label="Only differences" />
          <IconButton
            label="Expand all"
            icon={<ChevronsUpDown />}
            onClick={() => {
              if (!ok) return
              const t = ok.result.tree
              const next = new Set<number>()
              for (let i = 0; i < t.depth.length; i++) {
                const container = ['object', 'array'].includes(t.leftKind[i]) || ['object', 'array'].includes(t.rightKind[i])
                const defOpen = i === 0 || t.status[i] === NodeStatus.Contains
                if (container && !defOpen) next.add(i)
              }
              setToggled(next)
            }}
            disabled={!ok}
          />
          <IconButton
            label="Collapse to changes"
            icon={<ChevronsDownUp />}
            onClick={() => setToggled(new Set())}
            disabled={!ok}
          />
        </>
      )}
      <ToolbarSpacer />
      <div className="flex items-center gap-0.5">
        <IconButton label="Previous change" shortcut={['⇧', 'F7']} icon={<ArrowUp />} onClick={() => go(-1)} disabled={!changes.length} />
        <span className="min-w-14 text-center text-xs text-muted tabular">
          {changes.length ? `${Math.max(1, visibleChanges.indexOf(activeChange) + 1)} / ${formatNumber(visibleChanges.length)}` : '0 / 0'}
        </span>
        <IconButton label="Next change" shortcut={['F7']} icon={<ArrowDown />} onClick={() => go(1)} disabled={!changes.length} />
      </div>
      <ToolbarSeparator />
      <IconButton label="Swap sides" icon={<ArrowLeftRight />} onClick={() => setBoth(b, a)} disabled={bothEmpty} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={!ok || ok.result.identical}>
            <Download /> Export <ChevronDown className="!size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>JSON Patch (RFC 6902)</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => void exportPatch('copy')}>Copy patch</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void exportPatch('download')}>Download patch</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Change report</DropdownMenuLabel>
          <DropdownMenuItem onSelect={async () => toast[(await copyText(exportChanges())) ? 'success' : 'error']('Change list copied')}>Copy as JSON</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => downloadText(exportChanges(), 'json-diff-changes.json', 'application/json')}>Download as JSON</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Toolbar>
  )

  // ── Body ─────────────────────────────────────────────────────────────────────
  const emptyState = (
    <EmptyState
      icon={<Braces />}
      title="Paste JSON into both editors to compare their structure and values."
      description="Key order is ignored, arrays are aligned intelligently, and big numbers keep full precision."
      actions={<Button onClick={() => setBoth(JSON_A, JSON_B)}>Load example</Button>}
    />
  )

  const inputs = (
    <SplitPane id="json-diff-inputs" mobileTabs={['Original', 'Modified']} mobileTab={mobileTab} onMobileTabChange={setMobileTab}>
      <InputEditorPane
        ref={refA}
        title="Original"
        value={a}
        onChange={setA}
        language="json"
        path="json-diff-a.json"
        accept=".json,application/json"
        sample={JSON_A}
        markers={errorMarkers('left')}
        emptyState={bothEmpty ? emptyState : <EmptyState compact title="Paste or drop the original JSON" />}
      />
      <InputEditorPane
        ref={refB}
        title="Modified"
        value={b}
        onChange={setB}
        language="json"
        path="json-diff-b.json"
        accept=".json,application/json"
        sample={JSON_B}
        markers={errorMarkers('right')}
        emptyState={<EmptyState compact title="Paste or drop the modified JSON" />}
      />
    </SplitPane>
  )

  let body: React.ReactNode
  if (view === 'input') body = inputs
  else if (bothEmpty) body = emptyState
  else if (!ok) {
    body = (
      <EmptyState
        icon={task.running ? <Loader2 className="animate-spin" /> : <Play />}
        title={task.running ? 'Comparing…' : res && !res.ok ? 'Fix the JSON error to compare' : 'Ready to compare'}
        description={task.running ? 'Parsing and comparing in a background thread.' : `Inputs total ${formatBytes(total)}.`}
        actions={
          task.running ? (
            <Button onClick={task.cancel}>Cancel</Button>
          ) : res && !res.ok ? (
            <Button onClick={() => setView('input')}>Back to editors</Button>
          ) : (
            <Button variant="primary" onClick={runCompare}>
              <Play /> Compare
            </Button>
          )
        }
      />
    )
  } else if (ok.result.identical) {
    body = (
      <EmptyState
        icon={<Braces />}
        title="The documents are equivalent"
        description={`No structural differences across ${formatNumber(ok.result.stats.nodesLeft)} nodes${ignorePaths.length ? ' (excluding ignored paths)' : ''}. Key order and number formatting (1.0 vs 1) don't count as changes.`}
      />
    )
  } else if (view === 'tree') {
    const t = ok.result.tree
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        <DiffTree
          ref={treeRef}
          tree={t}
          toggled={toggled}
          onToggle={(n) => setToggled((prev) => { const next = new Set(prev); if (next.has(n)) next.delete(n); else next.add(n); return next })}
          onlyChanges={settings.onlyChanges}
          selected={selected}
          onSelect={(n) => {
            setSelected(n)
            if (t.changeIndex[n] >= 0) setActiveChange(t.changeIndex[n])
          }}
        />
        {selected >= 0 && selectedPath && (
          <div className="flex shrink-0 flex-col gap-1.5 border-t border-border bg-bg px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="eyebrow">Path</span>
              <code className="mono min-w-0 flex-1 truncate text-xs text-fg">{selectedPath}</code>
              {selectedChange ? <ChangeCopyMenu change={selectedChange} /> : <Button size="xs" variant="ghost" onClick={async () => toast[(await copyText(selectedPath)) ? 'success' : 'error']('Path copied')}>Copy path</Button>}
            </div>
            {selectedChange && selectedChange.type !== 'order' && (
              <div className="grid grid-cols-2 gap-2">
                <pre className="mono max-h-28 overflow-auto rounded-md bg-del-bg px-2 py-1 text-xs">{selectedChange.left !== undefined ? stringifyJson(selectedChange.left, { indent: 2 }) : '(absent)'}</pre>
                <pre className="mono max-h-28 overflow-auto rounded-md bg-add-bg px-2 py-1 text-xs">{selectedChange.right !== undefined ? stringifyJson(selectedChange.right, { indent: 2 }) : '(absent)'}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    )
  } else if (view === 'changes') {
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        <FilterBar changes={changes} query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} shown={visibleChanges.length} />
        <ChangeList changes={changes} visible={visibleChanges} onReveal={revealChange} />
      </div>
    )
  } else {
    body = ok.text ? (
      ok.text.identical ? (
        <EmptyState icon={<Braces />} title="The formatted documents are identical line by line" description="Structural differences may still exist in the Tree view if you changed the comparison options." />
      ) : (
        <DiffViewer
          linesA={textLinesA}
          linesB={textLinesB}
          result={ok.text}
          layout={isMobile ? 'unified' : 'split'}
          granularity="word"
          ignoreCase={false}
          whitespace="none"
          wrap={isMobile}
          collapse={settings.onlyChanges}
          context={3}
          activeHunk={-1}
          labels={['Original (normalized)', 'Modified (normalized)']}
        />
      )
    ) : null
  }

  const st = ok?.result.stats
  return (
    <>
      {toolbar}
      {res && !res.ok && (
        <ErrorDisplay
          title={res.side === 'left' ? 'Original is not valid JSON' : 'Modified is not valid JSON'}
          error={res.error}
          onLocate={(l, c) => {
            setView('input')
            if (isMobile) setMobileTab(res.side === 'left' ? 0 : 1)
            setTimeout(() => (res.side === 'left' ? refA : refB).current?.revealPosition(l, c), 50)
          }}
        />
      )}
      {view !== 'input' && ok && stale && !task.running && (
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-3 py-1.5 text-xs text-muted">
          <span className="flex-1">The inputs or options changed since this comparison.</span>
          <Button size="xs" variant="primary" onClick={runCompare}>
            Re-compare <span className="opacity-70">{modKey}↵</span>
          </Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
      <StatusBar>
        {st ? (
          <>
            <StatusItem tone="add">+{formatNumber(st.added)} added</StatusItem>
            <StatusItem tone="del">−{formatNumber(st.removed)} removed</StatusItem>
            <StatusItem tone="mod">~{formatNumber(st.modified)} modified</StatusItem>
            {st.typeChanged > 0 && <StatusItem tone="mod">{formatNumber(st.typeChanged)} type changes</StatusItem>}
            {st.reordered > 0 && <StatusItem>{formatNumber(st.reordered)} reordered</StatusItem>}
            {st.ignored > 0 && <StatusItem label="Ignored">{formatNumber(st.ignored)}</StatusItem>}
          </>
        ) : (
          <StatusItem>{bothEmpty ? 'Waiting for input' : task.running ? 'Comparing…' : res && !res.ok ? 'Invalid JSON' : auto ? 'Ready' : `Large input (${formatBytes(total)}) — press Compare`}</StatusItem>
        )}
        <StatusSpacer />
        {ok?.hasBigNumbers && <StatusItem tone="accent">Big numbers preserved exactly</StatusItem>}
        {st && <StatusItem label="Nodes">{formatNumber(st.nodesLeft)} → {formatNumber(st.nodesRight)}</StatusItem>}
        {ok && <StatusItem label="Diff">{formatDuration(ok.result.elapsedMs)}</StatusItem>}
        {task.running && <Loader2 className="size-3 animate-spin text-muted" />}
        {view === 'input' && !auto && (
          <Button size="xs" variant="primary" onClick={runCompare}>
            <Play /> Compare
          </Button>
        )}
        {view === 'input' && a.trim() && b.trim() && (
          <Button size="xs" variant="ghost" onClick={formatInputs}>
            Format both
          </Button>
        )}
      </StatusBar>
    </>
  )
}
