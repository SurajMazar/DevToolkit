import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Columns2, Eye, FileCode2, FileText, ListTree, PanelLeftClose, PencilLine } from 'lucide-react'
import { toast } from 'sonner'
import type { editor as MonacoEditor } from 'monaco-esm/editor/editor.api.js'
import { buildStandaloneHtml, documentTitle, markdownStats, renderMarkdown, titleToFilename, type MarkdownHeading } from '@/engines/text-utils/markdown'
import { sanitizeRenderedHtml } from '@/engines/text-utils/markdown-sanitize'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { useIsMobile } from '@/hooks/useMediaQuery'
import type { CodeEditorHandle } from '@/components/editors/CodeEditor'
import { InputEditorPane, useTextMetrics } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { EmptyState } from '@/components/tools/EmptyState'
import { Segmented } from '@/components/ui/segmented'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CopyButton } from '@/components/common/CopyButton'
import { downloadText } from '@/utils/download'
import { formatBytes, formatNumber, pluralize } from '@/utils/format'
import { cn } from '@/utils/cn'
import { SAMPLE_MARKDOWN } from './sample'

type ViewMode = 'split' | 'editor' | 'preview'

function Outline({ headings, onSelect, activeId, className }: { headings: MarkdownHeading[]; onSelect: (id: string) => void; activeId: string | null; className?: string }) {
  if (!headings.length) return <p className={cn('px-3 py-2 text-xs text-subtle', className)}>No headings yet. Lines starting with # appear here.</p>
  const minLevel = Math.min(...headings.map((h) => h.level))
  return (
    <nav aria-label="Document outline" className={cn('flex flex-col py-1.5', className)}>
      {headings.map((h, i) => (
        <button
          key={`${h.id}-${i}`}
          type="button"
          onClick={() => onSelect(h.id)}
          title={h.text}
          className={cn(
            'relative truncate rounded-sm py-1 pr-2 text-left text-xs leading-[18px] transition-colors duration-100 hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
            h.level === minLevel ? 'font-medium text-fg' : 'text-muted',
            activeId === h.id && 'bg-accent-soft text-fg hover:bg-accent-soft',
          )}
          style={{ paddingLeft: 10 + (h.level - minLevel) * 12 }}
        >
          {h.text}
        </button>
      ))}
    </nav>
  )
}

export default function MarkdownPreview() {
  const [input, setInput] = usePersistentState('input', '')
  const [view, setView] = usePersistentState<ViewMode>('view', 'split')
  const [syncScroll, setSyncScroll] = usePersistentState('syncScroll', true)
  const [showOutline, setShowOutline] = usePersistentState('outline', true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const isMobile = useIsMobile()
  const [mobileTab, setMobileTab] = useState<0 | 1>(0)
  const inputRef = useRef<CodeEditorHandle>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const [editor, setEditor] = useState<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const paneBodyRef = useRef<HTMLDivElement>(null)
  const [paneWidth, setPaneWidth] = useState(1000)

  useEffect(() => {
    const el = paneBodyRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setPaneWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  })

  useIncomingInput(setInput)

  const debounced = useDebouncedValue(input, adaptiveDelay(input.length))
  const source = useDeferredValue(debounced)
  const rendered = useMemo(() => {
    try {
      const r = renderMarkdown(source)
      const safe = sanitizeRenderedHtml(r.html, { blockRemoteImages: true })
      return { ...r, safeHtml: safe.html, blockedImages: safe.blockedImages, error: null as string | null }
    } catch (e) {
      return { html: '', headings: [] as MarkdownHeading[], safeHtml: '', blockedImages: [] as string[], error: (e as Error).message }
    }
  }, [source])
  const stats = useMemo(() => markdownStats(source), [source])
  const metrics = useTextMetrics(input)

  const exportBody = useCallback(() => sanitizeRenderedHtml(renderMarkdown(input).html, { blockRemoteImages: false }).html, [input])

  const download = () => {
    const r = renderMarkdown(input)
    const body = sanitizeRenderedHtml(r.html, { blockRemoteImages: false }).html
    const title = documentTitle(r.headings)
    downloadText(buildStandaloneHtml(body, title), `${titleToFilename(title)}.html`, 'text/html;charset=utf-8')
    toast.success('Downloaded standalone HTML', { description: 'Sanitized, with minimal embedded styles. Remote images load when you open the file.' })
  }

  // ── Synchronized (proportional) scrolling ───────────────────────────────────
  const pinnedUntil = useRef(0)
  const lock = useRef<{ who: 'editor' | 'preview' | null; until: number }>({ who: null, until: 0 })
  const showEditor = isMobile ? mobileTab === 0 : view !== 'preview'
  const showPreview = isMobile ? mobileTab === 1 : view !== 'editor'
  const syncActive = syncScroll && showEditor && showPreview

  useEffect(() => {
    if (!editor || !syncActive) return
    const d = editor.onDidScrollChange((e) => {
      if (!e.scrollTopChanged) return
      const now = performance.now()
      if (lock.current.who === 'preview' && now < lock.current.until) return
      const el = previewRef.current
      if (!el) return
      const max = e.scrollHeight - editor.getLayoutInfo().height
      const ratio = max > 0 ? e.scrollTop / max : 0
      lock.current = { who: 'editor', until: now + 80 }
      el.scrollTop = ratio * (el.scrollHeight - el.clientHeight)
    })
    return () => d.dispose()
  }, [editor, syncActive])

  const onPreviewScroll = () => {
    const el = previewRef.current
    if (!el) return
    // Track the heading at the top for the outline highlight.
    const hs = el.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]')
    let current: string | null = null
    const top = el.getBoundingClientRect().top + 24
    for (const h of hs) {
      if (h.getBoundingClientRect().top <= top) current = h.id
      else break
    }
    if (performance.now() > pinnedUntil.current) setActiveId(current ?? hs[0]?.id ?? null)
    if (!syncActive || !editor) return
    const now = performance.now()
    if (lock.current.who === 'editor' && now < lock.current.until) return
    const max = el.scrollHeight - el.clientHeight
    const ratio = max > 0 ? el.scrollTop / max : 0
    lock.current = { who: 'preview', until: now + 80 }
    editor.setScrollTop(ratio * (editor.getScrollHeight() - editor.getLayoutInfo().height))
  }

  const scrollToId = (id: string) => {
    const el = previewRef.current
    const target = el?.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
    if (!el || !target) return
    pinnedUntil.current = performance.now() + 300
    el.scrollTo({ top: target.offsetTop - 12 })
    setActiveId(id)
  }

  const onPreviewClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    const href = a?.getAttribute('href')
    if (a && href?.startsWith('#')) {
      e.preventDefault()
      scrollToId(decodeURIComponent(href.slice(1)))
    }
  }

  const loadSample = () => {
    if (inputRef.current?.editor) inputRef.current.replaceAll(SAMPLE_MARKDOWN)
    else setInput(SAMPLE_MARKDOWN)
  }

  const inputPane = (
    <InputEditorPane
      ref={inputRef}
      title="Markdown"
      value={input}
      onChange={setInput}
      language="markdown"
      wordWrap
      sample={SAMPLE_MARKDOWN}
      accept=".md,.markdown,.mdown,.txt,text/markdown,text/plain"
      placeholder="# Write Markdown here…"
      path="markdown-input.md"
      onMount={(ed) => setEditor(ed)}
      footer={
        <>
          <span>{pluralize(metrics.lines, 'line')}</span>
          <span>{formatBytes(metrics.bytes)}</span>
        </>
      }
    />
  )

  const outlineButton = (
    <IconButton
      label={showOutline ? 'Hide outline' : 'Show outline'}
      aria-pressed={showOutline}
      icon={showOutline ? <PanelLeftClose /> : <ListTree />}
      onClick={() => setShowOutline(!showOutline)}
    />
  )

  // The outline column only fits when the preview is wide enough; otherwise it is a popover.
  const outlineDocked = !isMobile && paneWidth >= 640

  const outlinePopover = (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" disabled={!rendered.headings.length}>
          <ListTree /> Outline
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[60vh] w-72 overflow-y-auto p-1">
        <Outline headings={rendered.headings} onSelect={scrollToId} activeId={activeId} />
      </PopoverContent>
    </Popover>
  )

  const previewPane = (
    <Pane aria-label="Preview">
      <PaneHeader
        title="Preview"
        meta={
          rendered.blockedImages.length > 0 ? (
            <span title={rendered.blockedImages.join('\n')}>{pluralize(rendered.blockedImages.length, 'remote image')} not loaded</span>
          ) : undefined
        }
        actions={
          <>
            {outlineDocked ? outlineButton : outlinePopover}
            <CopyButton value={exportBody} label="Copy rendered HTML" disabled={!input.trim()} />
          </>
        }
      />
      <div ref={paneBodyRef} className="relative flex min-h-0 flex-1">
        {showOutline && outlineDocked && input.trim() !== '' && (
          <aside className="flex w-[184px] shrink-0 flex-col border-r border-border bg-workspace xl:w-[208px]">
            <p className="eyebrow flex h-8 shrink-0 items-center px-3">Outline</p>
            <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
              <Outline headings={rendered.headings} onSelect={scrollToId} activeId={activeId} />
            </div>
          </aside>
        )}
        <div ref={previewRef} onScroll={onPreviewScroll} className="relative min-w-0 flex-1 overflow-y-auto" onClick={onPreviewClick}>
          {rendered.error ? (
            <p role="alert" className="m-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-fg">
              Could not render this Markdown: {rendered.error}
            </p>
          ) : input.trim() === '' ? (
            <EmptyState
              icon={<FileText />}
              title="Write or paste Markdown to see it rendered"
              description="GitHub-flavored: tables, task lists, strikethrough, autolinks and fenced code. Scripts and remote content never run or load."
              actions={
                <Button size="sm" onClick={loadSample}>
                  Load sample README
                </Button>
              }
            />
          ) : (
            <article
              className="prose-preview mx-auto max-w-[780px] px-6 pb-16 pt-5 md:px-8"
              // Sanitized with DOMPurify in sanitizeRenderedHtml (no scripts, handlers or remote loads).
              dangerouslySetInnerHTML={{ __html: rendered.safeHtml }}
            />
          )}
        </div>
      </div>
    </Pane>
  )

  return (
    <>
      <Toolbar>
        {!isMobile && (
          <Segmented
            aria-label="View mode"
            value={view}
            onValueChange={setView}
            options={[
              { value: 'split', label: 'Split', icon: <Columns2 /> },
              { value: 'editor', label: 'Editor', icon: <PencilLine /> },
              { value: 'preview', label: 'Preview', icon: <Eye /> },
            ]}
          />
        )}
        {!isMobile && <ToolbarSeparator />}
        {isMobile && <span className="text-xs text-subtle">GitHub-flavored</span>}
        {!isMobile && <Checkbox checked={syncScroll} onCheckedChange={(v) => setSyncScroll(v === true)} disabled={view !== 'split'} label="Sync scroll" />}
        <ToolbarSpacer />
        <CopyButton value={exportBody} label="Copy HTML" showLabel disabled={!input.trim()} tooltip="Copy sanitized HTML (remote images kept as links)" />
        <Button size="sm" variant="ghost" onClick={download} disabled={!input.trim()}>
          <FileCode2 /> Download .html
        </Button>
      </Toolbar>
      {isMobile ? (
        <SplitPane mobileTabs={['Markdown', 'Preview']} mobileTab={mobileTab} onMobileTabChange={setMobileTab}>
          {inputPane}
          {previewPane}
        </SplitPane>
      ) : view === 'split' ? (
        <SplitPane id="markdown-preview" initial={0.5} min={240}>
          {inputPane}
          {previewPane}
        </SplitPane>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">{view === 'editor' ? inputPane : previewPane}</div>
      )}
      <StatusBar>
        <StatusItem label="Words">{formatNumber(stats.words)}</StatusItem>
        <StatusItem label="Reading">{stats.readingMinutes ? `~${stats.readingMinutes} min` : '—'}</StatusItem>
        <StatusItem label="Headings">{formatNumber(rendered.headings.length)}</StatusItem>
        <StatusItem label="Size">{formatBytes(metrics.bytes)}</StatusItem>
        {rendered.blockedImages.length > 0 && <StatusItem tone="mod">{pluralize(rendered.blockedImages.length, 'remote image')} blocked</StatusItem>}
        <StatusSpacer />
        {!isMobile && <StatusItem label="Flavor">GFM</StatusItem>}
        {!isMobile && <Badge tone="neutral">Sanitized · no network</Badge>}
      </StatusBar>
    </>
  )
}
