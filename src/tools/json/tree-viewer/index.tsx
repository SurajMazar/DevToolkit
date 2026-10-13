import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ChevronsDownUp, ChevronsUpDown, ListTree, Loader2, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  carryExpansion,
  expandAll,
  expandAncestors,
  expandToDepth,
  nodeForPointer,
  pathOf,
  searchTree,
  setSubtreeExpanded,
  typeCounts,
  visibleRows,
  type TreeIndex,
} from '@/engines/json-tools/tree'
import { parseToTree, type TaskError } from '@/engines/json-tools/tasks'
import { locatePointer } from '@/engines/json-tools/locate'
import { toJsonPointer } from '@/engines/json-tools/paths'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { useTask } from '@/hooks/useTask'
import { useWorker } from '@/hooks/useWorker'
import type { CodeEditorHandle, EditorMarker } from '@/components/editors/CodeEditor'
import { InputEditorPane } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { EmptyState } from '@/components/tools/EmptyState'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/utils/cn'
import { formatBytes, formatDuration, formatNumber, pluralize } from '@/utils/format'
import ToolWorker from './worker.ts?worker'
import type { Tasks } from './worker'
import { TreeView, type TreeViewHandle } from './TreeView'
import { byteSize } from './values'
import { NodeDetails } from './NodeDetails'
import { TREE_SAMPLE } from './sample'

/** Inputs above this many characters are parsed in the worker. */
const WORKER_THRESHOLD = 200_000
/** Visible-row cap: beyond this the list itself becomes the bottleneck. */
const MAX_VISIBLE_ROWS = 1_000_000

type Scope = 'all' | 'keys' | 'values'
type Tree = TreeIndex & { hasBigNumbers: boolean }

function initialExpansion(t: TreeIndex): Uint8Array {
  return t.size <= 400 ? expandAll(t) : expandToDepth(t, 2)
}

export default function JsonTreeViewer() {
  const [input, setInput] = usePersistentState('input', '')
  const [scope, setScope] = usePersistentState<Scope>('scope', 'all')
  const [query, setQuery] = useState('')
  const [tree, setTree] = useState<Tree | null>(null)
  const [error, setError] = useState<TaskError | null>(null)
  const [selected, setSelected] = useState(0)
  const [version, setVersion] = useState(0)
  const [activeIdx, setActiveIdx] = useState(0)
  const [depthChoice, setDepthChoice] = useState('2')
  const [mobileTab, setMobileTab] = useState<0 | 1>(0)
  const expanded = useRef<Uint8Array>(new Uint8Array(0))
  const inputRef = useRef<CodeEditorHandle>(null)
  const viewRef = useRef<TreeViewHandle>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const prev = useRef<{ tree: Tree; selectedPtr: string } | null>(null)

  const worker = useWorker<Tasks>(() => new ToolWorker({ name: 'json-tree' }))
  const task = useTask<Awaited<ReturnType<typeof parseToTree>>>()

  useIncomingInput(setInput)

  const debounced = useDebouncedValue(input, adaptiveDelay(input.length))

  useEffect(() => {
    if (!debounced.trim()) {
      task.reset()
      setTree(null)
      setError(null)
      prev.current = null
      return
    }
    void task
      .run((signal) => (debounced.length > WORKER_THRESHOLD ? worker.run('parseToTree', debounced, signal) : parseToTree(debounced)))
      .then((r) => {
        if (!r) return
        if (!r.ok) {
          setError(r.error)
          return
        }
        const t = r.value
        const before = prev.current
        const carried = before ? carryExpansion(before.tree, expanded.current, t) : null
        expanded.current = carried ?? initialExpansion(t)
        expanded.current[0] = 1
        const keepSel = before ? nodeForPointer(t, before.selectedPtr) : 0
        setSelected(keepSel >= 0 ? keepSel : 0)
        setTree(t)
        setError(null)
        setVersion((v) => v + 1)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  // Remember the selection by pointer so a re-parse can restore it.
  useEffect(() => {
    if (tree) prev.current = { tree, selectedPtr: selected < tree.size ? toJsonPointer(pathOf(tree, selected)) : '' }
  }, [tree, selected])

  const rows = useMemo(() => (tree ? visibleRows(tree, expanded.current) : new Int32Array(0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, version])

  // ── Search ────────────────────────────────────────────────────────────────
  const debouncedQuery = useDebouncedValue(query, tree && tree.size > 200_000 ? 300 : 120)
  const search = useMemo(() => {
    if (!tree || !debouncedQuery) return null
    return searchTree(tree, debouncedQuery, { keys: scope !== 'values', values: scope !== 'keys' })
  }, [tree, debouncedQuery, scope])
  const matchSet = useMemo(() => (search ? new Set(search.matches) : null), [search])
  const matchCount = search?.matches.length ?? 0
  const activeMatch = search && matchCount ? search.matches[Math.min(activeIdx, matchCount - 1)] : -1

  const bump = () => setVersion((v) => v + 1)

  const focusNode = useCallback(
    (node: number) => {
      if (!tree) return
      if (expandAncestors(tree, expanded.current, node)) bump()
      setSelected(node)
      // Scroll after the new rows render.
      requestAnimationFrame(() => {
        const r = visibleRows(tree, expanded.current)
        let lo = 0
        let hi = r.length - 1
        while (lo <= hi) {
          const mid = (lo + hi) >> 1
          if (r[mid] === node) return viewRef.current?.scrollToRow(mid, 'center')
          if (r[mid] < node) lo = mid + 1
          else hi = mid - 1
        }
      })
    },
    [tree],
  )

  // New results: reveal every match (bounded) and jump to the first one.
  useEffect(() => {
    setActiveIdx(0)
    if (!tree || !search || !search.matches.length) return
    const reveal = search.matches.length <= 2000 ? search.matches : search.matches.subarray(0, 1)
    let changed = false
    for (const m of reveal) changed = expandAncestors(tree, expanded.current, m) || changed
    if (changed) bump()
    focusNode(search.matches[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const stepMatch = (dir: 1 | -1) => {
    if (!search || !matchCount) return
    const next = (activeIdx + dir + matchCount) % matchCount
    setActiveIdx(next)
    focusNode(search.matches[next])
  }

  // ── Expansion actions ─────────────────────────────────────────────────────
  const applyExpansion = (e: Uint8Array, label: string) => {
    if (!tree) return
    e[0] = 1
    const count = visibleRows(tree, e).length
    if (count > MAX_VISIBLE_ROWS) {
      toast.error(`${label} would show ${formatNumber(count)} rows`, { description: `The tree view is limited to ${formatNumber(MAX_VISIBLE_ROWS)} visible rows. Expand to a smaller depth, or search to reveal specific nodes.` })
      return
    }
    expanded.current = e
    bump()
  }

  const onToggle = useCallback(
    (node: number, recursive?: boolean) => {
      if (!tree) return
      const open = expanded.current[node] === 1
      if (recursive) setSubtreeExpanded(tree, expanded.current, node, !open)
      else expanded.current[node] = open ? 0 : 1
      if (node === 0 && open && !recursive) expanded.current[0] = 0
      bump()
    },
    [tree],
  )

  const revealInEditor = () => {
    if (!tree) return
    const loc = locatePointer(input, pathOf(tree, selected))
    const ed = inputRef.current?.editor
    if (!loc || !ed) return
    setMobileTab(0)
    const range = { startLineNumber: loc.line, startColumn: loc.column, endLineNumber: loc.endLine, endColumn: loc.endColumn }
    ed.setSelection(range)
    ed.revealRangeInCenterIfOutsideViewport(range)
    ed.focus()
  }

  const markers: EditorMarker[] | undefined = useMemo(() => (error?.line ? [{ message: error.message, line: error.line, column: error.column ?? 1 }] : undefined), [error])
  const counts = useMemo(() => (tree ? typeCounts(tree) : null), [tree])
  const stale = input !== debounced || task.running

  const loadSample = () => {
    if (inputRef.current?.editor) inputRef.current.replaceAll(TREE_SAMPLE)
    else setInput(TREE_SAMPLE)
  }

  const toolbar = (
    <Toolbar>
      <div className="relative flex shrink-0 items-center">
        <Search className="pointer-events-none absolute left-2 size-3.5 text-subtle" />
        <Input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              stepMatch(e.shiftKey ? -1 : 1)
            } else if (e.key === 'Escape') setQuery('')
          }}
          placeholder="Search keys and values"
          aria-label="Search the tree"
          className="h-7 w-52 pl-7 pr-7 md:w-64"
          disabled={!tree}
        />
        {query && (
          <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-1.5 flex size-4 items-center justify-center rounded-sm text-subtle hover:text-fg">
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <Segmented
        aria-label="Search in"
        value={scope}
        onValueChange={setScope}
        options={[
          { value: 'all', label: 'All', tooltip: 'Match keys and values' },
          { value: 'keys', label: 'Keys' },
          { value: 'values', label: 'Values' },
        ]}
      />
      <span className={cn('min-w-16 shrink-0 text-center text-xs tabular', query && !matchCount ? 'text-danger' : 'text-muted')} aria-live="polite">
        {debouncedQuery && search ? (matchCount ? `${formatNumber(Math.min(activeIdx, matchCount - 1) + 1)} of ${formatNumber(matchCount)}${search.capped ? '+' : ''}` : 'No matches') : ''}
      </span>
      <IconButton label="Previous match" shortcut={['⇧', 'Enter']} icon={<ChevronUp />} onClick={() => stepMatch(-1)} disabled={!matchCount} />
      <IconButton label="Next match" shortcut={['Enter']} icon={<ChevronDown />} onClick={() => stepMatch(1)} disabled={!matchCount} />
      <ToolbarSeparator />
      <Button variant="ghost" size="sm" onClick={() => tree && applyExpansion(expandAll(tree), 'Expand all')} disabled={!tree}>
        <ChevronsUpDown /> Expand all
      </Button>
      <Button variant="ghost" size="sm" onClick={() => tree && applyExpansion(expandToDepth(tree, 1), 'Collapse')} disabled={!tree}>
        <ChevronsDownUp /> Collapse all
      </Button>
      <ToolbarField label="Depth">
        <Select
          aria-label="Expand to depth"
          value={depthChoice}
          disabled={!tree}
          onValueChange={(v) => {
            setDepthChoice(v)
            if (tree) applyExpansion(expandToDepth(tree, Number(v)), `Expanding to depth ${v}`)
          }}
          options={['1', '2', '3', '4', '5', '6', '8', '10'].map((d) => ({ value: d, label: d }))}
          className="w-14"
        />
      </ToolbarField>
      <ToolbarSpacer />
      {tree?.hasBigNumbers && (
        <Badge tone="accent" title="Numbers beyond JavaScript's safe range are shown with their exact original digits">
          Big numbers exact
        </Badge>
      )}
    </Toolbar>
  )

  const inputPane = (
    <InputEditorPane
      ref={inputRef}
      title="JSON"
      value={input}
      onChange={setInput}
      language="json"
      sample={TREE_SAMPLE}
      accept=".json,application/json,text/plain"
      markers={markers}
      placeholder="Paste or drop a JSON document…"
      path="json-tree-input"
    />
  )

  const treePane = (
    <Pane aria-label="Tree">
      <PaneHeader
        title="Tree"
        meta={tree ? `${pluralize(tree.size, 'node')} · ${formatNumber(rows.length)} shown` : undefined}
        actions={stale && input ? <Loader2 className="mr-1.5 size-3.5 animate-spin text-subtle" aria-label="Parsing" /> : null}
      />
      {error && (
        <ErrorDisplay
          error={{ message: error.message, line: error.line, column: error.column }}
          title={tree ? 'Invalid JSON — showing the last valid version' : 'Invalid JSON'}
          onLocate={(l, c) => {
            setMobileTab(0)
            inputRef.current?.revealPosition(l, c)
          }}
        />
      )}
      <div className="relative min-h-0 flex-1">
        {tree ? (
          <TreeView
            ref={viewRef}
            tree={tree}
            rows={rows}
            expanded={expanded.current}
            version={version}
            selected={selected}
            onSelect={setSelected}
            onToggle={onToggle}
            matchSet={matchSet}
            activeMatch={activeMatch}
            query={debouncedQuery}
            highlightKeys={scope !== 'values'}
            highlightValues={scope !== 'keys'}
            dimmed={!!error}
          />
        ) : !input.trim() ? (
          <EmptyState
            icon={<ListTree />}
            title="Paste JSON to explore it as a tree"
            description="Collapse branches, search keys and values, and copy any node's path as JSONPath, JavaScript or JSON Pointer."
            actions={
              <Button size="sm" onClick={loadSample}>
                Load sample response
              </Button>
            }
          />
        ) : !error ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Parsing {formatBytes(byteSize(input))}…
            <Button size="xs" variant="ghost" onClick={task.cancel}>
              Cancel
            </Button>
          </div>
        ) : null}
      </div>
      {tree && selected < tree.size && <NodeDetails tree={tree} node={selected} onReveal={!error ? revealInEditor : undefined} />}
    </Pane>
  )

  return (
    <>
      {toolbar}
      <SplitPane id="json-tree" initial={0.4} min={240} mobileTabs={['JSON', 'Tree']} mobileTab={mobileTab} onMobileTabChange={setMobileTab}>
        {inputPane}
        {treePane}
      </SplitPane>
      <StatusBar>
        {tree && counts ? (
          <>
            <StatusItem label="Nodes">{formatNumber(tree.size)}</StatusItem>
            <StatusItem label="Depth">{tree.maxDepth}</StatusItem>
            <StatusItem label="Objects">{formatNumber(counts.object)}</StatusItem>
            <StatusItem label="Arrays">{formatNumber(counts.array)}</StatusItem>
            <StatusItem label="Values">{formatNumber(counts.string + counts.number + counts.boolean + counts.null)}</StatusItem>
          </>
        ) : (
          <StatusItem label="Nodes">—</StatusItem>
        )}
        <StatusSpacer />
        {task.duration != null && tree && <StatusItem label="Parsed in">{formatDuration(task.duration)}</StatusItem>}
        <StatusItem label="Size">{formatBytes(byteSize(input))}</StatusItem>
        {error ? <StatusItem tone="danger">Invalid JSON</StatusItem> : tree ? <StatusItem tone="ok">Valid</StatusItem> : null}
      </StatusBar>
    </>
  )
}
