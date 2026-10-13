import { useEffect, useMemo, useRef, useState } from 'react'
import { AlignLeft, Download, Loader2, Maximize, Minus, Plus, Settings2, ShieldAlert, Shapes } from 'lucide-react'
import { toast } from 'sonner'
import { analyzeSvg, cssBackgroundSnippet, svgToBase64DataUri, svgToJsx, svgToMiniDataUri, type SvgInfo, type SvgIssue } from '@/engines/html/svg'
import { DEFAULT_SVGO, type SvgoOptions } from '@/engines/html/svgo'
import { sizeStats } from '@/engines/css/minify'
import type { CodeEditorHandle } from '@/components/editors/CodeEditor'
import { InputEditorPane, OutputEditorPane } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { Pane } from '@/components/tools/Pane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { EmptyState } from '@/components/tools/EmptyState'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Segmented } from '@/components/ui/segmented'
import { Checkbox } from '@/components/ui/checkbox'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CopyButton } from '@/components/common/CopyButton'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { useWorker } from '@/hooks/useWorker'
import { useTask } from '@/hooks/useTask'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { downloadText } from '@/utils/download'
import { formatBytes, pluralize, utf8Length } from '@/utils/format'
import { cn } from '@/utils/cn'
import { CHECKER_LG } from '../_shared/checker'
import SvgWorker from './worker.ts?worker'
import type { Tasks } from './worker'

const SAMPLE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with Inkscape (http://www.inkscape.org/) -->
<svg
   xmlns="http://www.w3.org/2000/svg"
   xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
   width="128"
   height="128"
   viewBox="0 0 128 128"
   version="1.1"
   id="svg8"
   inkscape:version="1.3">
  <title id="title1">Mountain badge</title>
  <defs id="defs2">
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color:#0f766e;stop-opacity:1.000000" />
      <stop offset="1" style="stop-color:#134e4a;stop-opacity:1.000000" />
    </linearGradient>
  </defs>
  <g id="layer1" inkscape:label="Badge">
    <circle cx="64.000000" cy="64.000000" r="60.000000" fill="url(#sky)" />
    <path
       d="M 18.000000,96.000000 L 50.000000,48.000000 L 66.000000,72.000000 L 78.000000,56.000000 L 110.000000,96.000000 Z"
       fill="#f5f4f1"
       fill-opacity="0.95" />
    <circle cx="88.000000" cy="38.000000" r="9.000000" fill="#fcd34d" />
  </g>
</svg>
`

type Bg = 'checker' | 'light' | 'dark'

function useObjectUrl(content: string | null, type: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!content) {
      setUrl(null)
      return
    }
    const u = URL.createObjectURL(new Blob([content], { type }))
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [content, type])
  return url
}

const ISSUE_TEXT: Record<SvgIssue['kind'], string> = {
  script: 'Scripts',
  'event-handler': 'Event handlers',
  'javascript-url': 'javascript: URLs',
  'external-ref': 'External references',
  'foreign-object': 'Embedded HTML',
  'embedded-content': 'Embedded content',
  'css-import': 'CSS imports',
}

export default function SvgTool() {
  const [input, setInput] = usePersistentState('input', '')
  const [opts, setOpts] = usePersistentState<SvgoOptions>('svgo', DEFAULT_SVGO)
  const [tab, setTab] = usePersistentState<'preview' | 'optimized' | 'export'>('tab', 'preview')
  const [mobileTab, setMobileTab] = useState<0 | 1>(0)
  const inputRef = useRef<CodeEditorHandle>(null)
  const worker = useWorker<Tasks>(() => new SvgWorker({ name: 'devtoolkit-svg' }))
  const task = useTask<{ ok: true; data: string } | { ok: false; error: { message: string; line?: number; column?: number } }>()
  useIncomingInput(setInput)

  const debounced = useDebouncedValue(input, adaptiveDelay(input.length) + 120)
  const analysis = useMemo(() => (debounced.trim() ? analyzeSvg(debounced) : null), [debounced])
  const optsKey = JSON.stringify(opts)

  useEffect(() => {
    if (!debounced.trim() || (analysis && !analysis.ok)) {
      task.reset()
      return
    }
    void task.run((signal) => worker.run('optimize', { svg: debounced, options: opts }, signal))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, optsKey, analysis?.ok])

  const optimized = task.result?.ok ? task.result.data : null
  const optError = task.result && !task.result.ok ? task.result.error : task.error ? { message: task.error.message } : null
  const stats = optimized ? sizeStats(debounced, optimized) : null
  const parseError = analysis && !analysis.ok ? analysis.error : null
  const info = analysis?.ok ? analysis.info : null

  const prettifyInput = async () => {
    if (!input.trim()) return
    try {
      const r = await worker.run('prettify', { svg: input, indent: opts.indent })
      if (!r.ok) {
        toast.error('Could not format the SVG', { description: r.error.message + (r.error.line ? ` (line ${r.error.line})` : '') })
        return
      }
      if (inputRef.current?.editor) inputRef.current.replaceAll(r.data)
      else setInput(r.data)
    } catch (e) {
      toast.error(String(e))
    }
  }

  const set = (p: Partial<SvgoOptions>) => setOpts({ ...opts, ...p })
  const pluginsChanged = !opts.presetDefault || opts.keepIds || opts.keepDesc || opts.removeViewBox || opts.removeDimensions || opts.removeTitle || opts.removeScripts

  const right = (
    <Pane aria-label="Result">
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="bg-workspace">
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="optimized">
            Optimized
            {stats && <span className={cn('tabular text-2xs', stats.saved > 0 ? 'text-add' : 'text-subtle')}>−{Math.max(0, stats.percent).toFixed(0)}%</span>}
          </TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
          {task.running && <Loader2 className="my-auto ml-auto size-3.5 animate-spin text-subtle" aria-label="Optimizing" />}
        </TabsList>
        {parseError && <ErrorDisplay error={parseError} onLocate={(l, c) => inputRef.current?.revealPosition(l, c)} />}
        {!parseError && optError && <ErrorDisplay title="SVGO" error={optError} onLocate={(l, c) => inputRef.current?.revealPosition(l, c)} />}
        <TabsContent value="preview" className="flex min-h-0 flex-1 flex-col">
          {info ? (
            <SvgPreview original={debounced} optimized={optimized} intrinsic={info.intrinsic} info={info} />
          ) : (
            !parseError && (
              <EmptyState
                icon={<Shapes />}
                title="Paste, open or drop an SVG"
                description="It is previewed as an image, so scripts and external resources never run or load. Then optimize it with SVGO and export a data URI, CSS or JSX."
                actions={
                  <Button size="sm" onClick={() => setInput(SAMPLE)}>
                    Load sample
                  </Button>
                }
              />
            )
          )}
        </TabsContent>
        <TabsContent value="optimized" className="flex min-h-0 flex-1 flex-col">
          <OutputEditorPane
            title="Optimized SVG"
            value={optimized ?? ''}
            language="xml"
            wordWrap={!opts.pretty}
            filename="optimized.svg"
            mime="image/svg+xml"
            meta={stats ? `${formatBytes(stats.before)} → ${formatBytes(stats.after)}` : undefined}
            emptyState={<EmptyState compact title={input.trim() ? 'Nothing to show — fix the error above.' : 'Paste an SVG to optimize it.'} />}
          />
        </TabsContent>
        <TabsContent value="export" className="min-h-0 flex-1 overflow-y-auto">
          {info ? <ExportList original={debounced} optimized={optimized} /> : <EmptyState compact title="Paste a valid SVG to export it." />}
        </TabsContent>
      </Tabs>
    </Pane>
  )

  return (
    <>
      <Toolbar>
        <Checkbox checked={opts.multipass} onCheckedChange={(v) => set({ multipass: v === true })} label="Multipass" />
        <ToolbarField label="Precision">
          <Select aria-label="Number precision" value={String(opts.precision)} onValueChange={(v) => set({ precision: Number(v) })} options={[0, 1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} decimals` }))} />
        </ToolbarField>
        <Checkbox checked={opts.pretty} onCheckedChange={(v) => set({ pretty: v === true })} label="Pretty output" />
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost" className={cn(pluginsChanged && 'text-accent-text')}>
              <Settings2 /> Plugins
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[320px]">
            <div className="flex flex-col gap-3">
              <Checkbox checked={opts.presetDefault} onCheckedChange={(v) => set({ presetDefault: v === true })} label="preset-default" description="SVGO's safe default optimizations (~34 plugins)" />
              <div className={cn('ml-6 flex flex-col gap-2.5', !opts.presetDefault && 'pointer-events-none opacity-50')}>
                <Checkbox checked={opts.keepIds} onCheckedChange={(v) => set({ keepIds: v === true })} label="Keep IDs" description="Disable cleanupIds — needed if CSS/JS targets them" />
                <Checkbox checked={opts.keepDesc} onCheckedChange={(v) => set({ keepDesc: v === true })} label="Keep <desc>" description="Disable removeDesc" />
              </div>
              <div className="h-px bg-border" />
              <Checkbox checked={opts.removeViewBox} onCheckedChange={(v) => set({ removeViewBox: v === true })} label="removeViewBox" description="Breaks scaling — off by default" />
              <Checkbox checked={opts.removeDimensions} onCheckedChange={(v) => set({ removeDimensions: v === true })} label="removeDimensions" description="Drop width/height, keep viewBox (responsive)" />
              <Checkbox checked={opts.removeTitle} onCheckedChange={(v) => set({ removeTitle: v === true })} label="removeTitle" description="<title> is the accessible name — keep it for meaningful icons" />
              <Checkbox checked={opts.removeScripts} onCheckedChange={(v) => set({ removeScripts: v === true })} label="removeScripts" description="Remove <script>, on* handlers and javascript: links" />
              {opts.pretty && (
                <ToolbarField label="Indent">
                  <Select aria-label="Pretty indent" value={String(opts.indent)} onValueChange={(v) => set({ indent: Number(v) })} options={[{ value: '2', label: '2 spaces' }, { value: '4', label: '4 spaces' }]} />
                </ToolbarField>
              )}
            </div>
          </PopoverContent>
        </Popover>
        <ToolbarSeparator />
        <Button size="sm" variant="ghost" onClick={prettifyInput} disabled={!input.trim()}>
          <AlignLeft /> Format input
        </Button>
        <ToolbarSpacer />
        <Button
          size="sm"
          variant="secondary"
          disabled={!optimized}
          onClick={() => optimized && downloadText(new Blob([optimized], { type: 'image/svg+xml' }), 'optimized.svg')}
        >
          <Download /> Download optimized
        </Button>
      </Toolbar>
      <SplitPane id="svg-tool" initial={0.45} mobileTabs={['SVG', 'Result']} mobileTab={mobileTab} onMobileTabChange={setMobileTab}>
        <InputEditorPane
          ref={inputRef}
          title="SVG"
          value={input}
          onChange={setInput}
          language="xml"
          sample={SAMPLE}
          accept=".svg,image/svg+xml"
          placeholder="Paste SVG markup, open a .svg file or drop one here…"
          markers={parseError?.line ? [{ message: parseError.message, line: parseError.line, column: parseError.column ?? 1 }] : undefined}
          path="svg-input.svg"
        />
        {right}
      </SplitPane>
      <StatusBar>
        <StatusItem label="Original">{input ? formatBytes(utf8Length(debounced)) : '—'}</StatusItem>
        <StatusItem label="Optimized">{stats ? formatBytes(stats.after) : '—'}</StatusItem>
        {stats && (
          <StatusItem label="Saved" tone={stats.saved > 0 ? 'add' : undefined}>
            {stats.percent.toFixed(1)}%
          </StatusItem>
        )}
        {info && <StatusItem label="Elements">{info.elementCount}</StatusItem>}
        {info && <StatusItem label="Size">{`${round(info.intrinsic.width)}×${round(info.intrinsic.height)}`}</StatusItem>}
        <StatusSpacer />
        {task.duration != null && optimized && <StatusItem label="SVGO">{Math.round(task.duration)} ms</StatusItem>}
        {info && info.issues.length > 0 && <StatusItem tone="mod">{pluralize(info.issues.length, 'warning')}</StatusItem>}
        {(parseError || optError) && <StatusItem tone="danger">Error</StatusItem>}
      </StatusBar>
    </>
  )
}

const round = (n: number) => Number(n.toFixed(2))

function SvgPreview({ original, optimized, intrinsic, info }: { original: string; optimized: string | null; intrinsic: { width: number; height: number }; info: SvgInfo }) {
  const [source, setSource] = usePersistentState<'original' | 'optimized'>('previewSource', 'original')
  const [bg, setBg] = usePersistentState<Bg>('previewBg', 'checker')
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const svg = source === 'optimized' && optimized ? optimized : original
  const url = useObjectUrl(svg, 'image/svg+xml')
  const box = useRef<HTMLDivElement>(null)
  const [fitScale, setFitScale] = useState(1)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const pad = 48
      const s = Math.min((el.clientWidth - pad) / intrinsic.width, (el.clientHeight - pad) / intrinsic.height)
      setFitScale(Math.max(0.01, Math.min(s, 8)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [intrinsic.width, intrinsic.height])

  const scale = zoom === 'fit' ? fitScale : zoom
  const steps = [0.25, 0.5, 1, 2, 4, 8]
  const zoomBy = (dir: 1 | -1) => {
    const next = dir > 0 ? steps.find((s) => s > scale + 1e-6) : [...steps].reverse().find((s) => s < scale - 1e-6)
    if (next) setZoom(next)
  }
  const background = bg === 'checker' ? CHECKER_LG : bg === 'light' ? '#ffffff' : '#111214'
  const grouped = info.issues.reduce<Record<string, SvgIssue[]>>((acc, i) => ((acc[i.kind] ??= []).push(i), acc), {})

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        <Segmented
          size="xs"
          aria-label="Preview source"
          value={source}
          onValueChange={setSource}
          options={[
            { value: 'original', label: 'Original' },
            { value: 'optimized', label: 'Optimized', disabled: !optimized },
          ]}
        />
        <Segmented
          size="xs"
          aria-label="Preview background"
          value={bg}
          onValueChange={setBg}
          options={[
            { value: 'checker', label: 'Checker' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton label="Zoom out" size="icon-xs" icon={<Minus />} onClick={() => zoomBy(-1)} />
          <button type="button" className="tabular h-6 min-w-12 rounded-sm px-1 text-xs text-muted hover:bg-surface-2 hover:text-fg" onClick={() => setZoom(1)} title="Actual size (100%)">
            {Math.round(scale * 100)}%
          </button>
          <IconButton label="Zoom in" size="icon-xs" icon={<Plus />} onClick={() => zoomBy(1)} />
          <IconButton label="Fit to view" size="icon-xs" icon={<Maximize />} onClick={() => setZoom('fit')} className={cn(zoom === 'fit' && 'text-accent-text')} />
        </div>
      </div>
      <div ref={box} className="relative flex min-h-[200px] flex-1 items-center justify-center overflow-auto" style={{ background }}>
        {url && (
          <img
            src={url}
            alt="SVG preview (rendered as an image — scripts do not run)"
            draggable={false}
            className="max-w-none shrink-0 select-none"
            style={{ width: intrinsic.width * scale, height: intrinsic.height * scale, imageRendering: scale > 2 ? 'pixelated' : undefined }}
          />
        )}
      </div>
      <div className="max-h-[40%] shrink-0 overflow-y-auto border-t border-border bg-workspace px-3 py-2.5 text-xs">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted">width × height</dt>
          <dd className="mono truncate">
            {info.width ?? <span className="text-subtle">auto</span>} × {info.height ?? <span className="text-subtle">auto</span>}
            <span className="ml-2 text-subtle">→ {round(intrinsic.width)}×{round(intrinsic.height)} px</span>
          </dd>
          <dt className="text-muted">viewBox</dt>
          <dd className="mono truncate">{info.viewBox ?? <span className="text-warn">none — the SVG will not scale</span>}</dd>
          <dt className="text-muted">Elements</dt>
          <dd className="truncate">
            {info.elementCount} <span className="text-subtle">({info.elements.slice(0, 6).map(([n, c]) => `${n} ${c}`).join(', ')}{info.elements.length > 6 ? ', …' : ''})</span>
          </dd>
        </dl>
        {info.issues.length > 0 && (
          <div className="mt-2.5 rounded-md border border-warn/25 bg-warn-soft px-2.5 py-2">
            <p className="flex items-center gap-1.5 font-medium text-fg">
              <ShieldAlert className="size-3.5 text-warn" /> Active or external content
            </p>
            <p className="mt-0.5 text-subtle">Not run in this preview (images never execute scripts or load resources), but it would if the SVG is inlined or opened directly. Enable removeScripts to strip scripts.</p>
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {Object.entries(grouped).map(([kind, items]) => (
                <li key={kind}>
                  <span className="text-fg">{ISSUE_TEXT[kind as SvgIssue['kind']]}</span>
                  <span className="text-subtle"> · {items.slice(0, 3).map((i) => `line ${i.line}`).join(', ')}{items.length > 3 ? ` +${items.length - 3}` : ''}</span>
                  <span className="mono block truncate text-2xs text-muted">{items[0].message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

function ExportList({ original, optimized }: { original: string; optimized: string | null }) {
  const [source, setSource] = usePersistentState<'optimized' | 'original'>('exportSource', 'optimized')
  const svg = source === 'optimized' && optimized ? optimized : original
  const items = useMemo(() => {
    const mini = svgToMiniDataUri(svg)
    const b64 = svgToBase64DataUri(svg)
    let jsx: string
    try {
      jsx = svgToJsx(svg)
    } catch (e) {
      jsx = `// Could not convert: ${(e as Error).message}`
    }
    return [
      { id: 'mini', label: 'Data URI · URL-encoded', hint: 'Smallest for SVG; safe in url("…") and HTML attributes', value: mini },
      { id: 'b64', label: 'Data URI · Base64', hint: 'Widest compatibility; ~33% larger', value: b64 },
      { id: 'css', label: 'CSS background-image', hint: 'Uses the URL-encoded data URI', value: cssBackgroundSnippet(mini) },
      { id: 'img', label: 'HTML <img>', hint: 'Add meaningful alt text', value: `<img src="${mini}" alt="" />` },
      { id: 'jsx', label: 'JSX', hint: 'camelCased attributes, style objects', value: jsx },
    ]
  }, [svg])
  return (
    <div className="flex flex-col">
      <div className="flex h-10 items-center gap-2 border-b border-border px-3">
        <span className="text-xs text-muted">Source</span>
        <Segmented
          size="xs"
          aria-label="Export source"
          value={source}
          onValueChange={setSource}
          options={[
            { value: 'optimized', label: 'Optimized', disabled: !optimized },
            { value: 'original', label: 'Original' },
          ]}
        />
      </div>
      <ul className="divide-y divide-border">
        {items.map((it) => (
          <li key={it.id} className="px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{it.label}</span>
              <span className="tabular text-2xs text-subtle">{formatBytes(utf8Length(it.value))}</span>
              <span className="ml-auto flex items-center">
                <CopyButton value={it.value} label={`Copy ${it.label}`} size="icon-xs" />
              </span>
            </div>
            <p className="text-2xs text-subtle">{it.hint}</p>
            <pre className="mono mt-1.5 line-clamp-3 whitespace-pre-wrap break-all rounded-md bg-surface px-2 py-1.5 text-[11.5px] leading-[17px] text-muted">{it.value}</pre>
          </li>
        ))}
      </ul>
    </div>
  )
}
