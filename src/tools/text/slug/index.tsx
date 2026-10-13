import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Link2, Plus, Settings2, X } from 'lucide-react'
import { DEFAULT_SLUG_OPTIONS, slugifyLines, type SlugOptions } from '@/engines/text-utils/slug'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { InputEditorPane } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarField, ToolbarSeparator } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { EmptyState } from '@/components/tools/EmptyState'
import { Segmented } from '@/components/ui/segmented'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CopyButton } from '@/components/common/CopyButton'
import { DownloadButton } from '@/components/common/DownloadButton'
import { formatNumber, pluralize } from '@/utils/format'
import { cn } from '@/utils/cn'

const SAMPLE = `How to Build a REST API with Node.js & Express
10 Tips for Writing Clean Code in 2024
Crème Brûlée: The Ultimate Guide
Straße, Größe & Übermaß — German for Developers
Привет, мир! Getting started with Cyrillic
The Quick Brown Fox Jumps Over the Lazy Dog
What's New in TypeScript 5.4?
東京 Travel Guide
How to Build a REST API with Node.js & Express`

const ROW_HEIGHT = 36

interface SlugUi extends SlugOptions {
  separatorChoice: '-' | '_' | '.' | 'custom'
  customSeparator: string
  makeUnique: boolean
}

const DEFAULT_UI: SlugUi = { ...DEFAULT_SLUG_OPTIONS, separatorChoice: '-', customSeparator: '~', makeUnique: false }

function ReplacementsEditor({ value, onChange }: { value: SlugOptions['replacements']; onChange: (v: SlugOptions['replacements']) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      {value.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input value={r.from} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} aria-label={`Replace ${i + 1}: find`} placeholder="&" className="mono h-7 w-20" />
          <span className="text-xs text-subtle">→</span>
          <Input value={r.to} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} aria-label={`Replace ${i + 1}: with`} placeholder="and" className="mono h-7 min-w-0 flex-1" />
          <IconButton label="Remove replacement" icon={<X />} size="icon-xs" onClick={() => onChange(value.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Button size="xs" variant="ghost" className="self-start" onClick={() => onChange([...value, { from: '', to: '' }])}>
        <Plus /> Add replacement
      </Button>
    </div>
  )
}

export default function SlugGenerator() {
  const [input, setInput] = usePersistentState('input', '')
  const [ui, setUi] = usePersistentState<SlugUi>('options', DEFAULT_UI)
  const [maxText, setMaxText] = useState(ui.maxLength ? String(ui.maxLength) : '')
  const isMobile = useIsMobile()
  const [mobileTab, setMobileTab] = useState<0 | 1>(0)
  const scroller = useRef<HTMLDivElement>(null)
  useIncomingInput(setInput)

  const set = <K extends keyof SlugUi>(k: K, v: SlugUi[K]) => setUi((u) => ({ ...u, [k]: v }))
  const separator = ui.separatorChoice === 'custom' ? ui.customSeparator : ui.separatorChoice

  const debounced = useDebouncedValue(input, adaptiveDelay(input.length))
  const text = useDeferredValue(debounced)
  const opts: SlugOptions = useMemo(() => ({ ...ui, separator }), [ui, separator])
  const rows = useMemo(() => slugifyLines(text, opts, ui.makeUnique), [text, opts, ui.makeUnique])
  const stats = useMemo(() => {
    let dup = 0
    let empty = 0
    let longest = 0
    const unique = new Set<string>()
    for (const r of rows) {
      if (r.duplicateOf != null) dup++
      if (!r.slug) empty++
      if (r.slug.length > longest) longest = r.slug.length
      unique.add(r.slug)
    }
    return { dup, empty, longest, unique: unique.size }
  }, [rows])

  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_HEIGHT, overscan: 12 })

  const maxInvalid = maxText !== '' && (!/^\d+$/.test(maxText) || Number(maxText) < 1)
  const optionsActive = ui.removeStopWords || !ui.keepNumbers || ui.german || ui.makeUnique || JSON.stringify(ui.replacements) !== JSON.stringify(DEFAULT_SLUG_OPTIONS.replacements)

  const allSlugs = () => rows.map((r) => r.slug).join('\n')
  const asCsv = () => ['title,slug', ...rows.map((r) => `"${r.input.replace(/"/g, '""')}","${r.slug.replace(/"/g, '""')}"`)].join('\n')

  const toolbar = (
    <Toolbar>
      <ToolbarField label="Separator">
        <Segmented
          aria-label="Separator"
          value={ui.separatorChoice}
          onValueChange={(v) => set('separatorChoice', v)}
          options={[
            { value: '-', label: <span className="mono px-0.5">-</span> },
            { value: '_', label: <span className="mono px-0.5">_</span> },
            { value: '.', label: <span className="mono px-0.5">.</span> },
            { value: 'custom', label: 'Custom' },
          ]}
        />
      </ToolbarField>
      {ui.separatorChoice === 'custom' && (
        <Input value={ui.customSeparator} onChange={(e) => set('customSeparator', e.target.value)} aria-label="Custom separator" className="mono h-7 w-14" placeholder="~" />
      )}
      <ToolbarSeparator />
      <Checkbox checked={ui.lowercase} onCheckedChange={(v) => set('lowercase', v === true)} label="Lowercase" />
      <Checkbox checked={ui.transliterate} onCheckedChange={(v) => set('transliterate', v === true)} label="ASCII only" />
      <ToolbarField label="Max length">
        <Input
          type="number"
          min={1}
          value={maxText}
          placeholder="none"
          aria-invalid={maxInvalid}
          aria-label="Maximum slug length"
          onChange={(e) => {
            setMaxText(e.target.value)
            const n = Number(e.target.value)
            if (e.target.value === '') set('maxLength', 0)
            else if (Number.isInteger(n) && n >= 1) set('maxLength', n)
          }}
          className="h-7 w-[72px] tabular"
        />
      </ToolbarField>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={cn(optionsActive && 'text-accent-text')}>
            <Settings2 /> Options
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px]">
          <div className="flex flex-col gap-3">
            <Checkbox checked={ui.removeStopWords} onCheckedChange={(v) => set('removeStopWords', v === true)} label="Remove English stop words" description="a, an, the, of, to, for… (never all words)" />
            <Checkbox checked={ui.keepNumbers} onCheckedChange={(v) => set('keepNumbers', v === true)} label="Keep numbers" />
            <Checkbox checked={ui.german} disabled={!ui.transliterate} onCheckedChange={(v) => set('german', v === true)} label="German umlauts as ae / oe / ue" description="Größe → groesse (with ASCII only)" />
            <Checkbox checked={ui.makeUnique} onCheckedChange={(v) => set('makeUnique', v === true)} label="Make duplicate slugs unique" description="Appends -2, -3… to repeated slugs" />
            <div className="h-px bg-border" />
            <div className="flex items-center justify-between">
              <p className="eyebrow">Replacements</p>
              <Button size="xs" variant="ghost" onClick={() => set('replacements', DEFAULT_SLUG_OPTIONS.replacements)}>
                Reset
              </Button>
            </div>
            <ReplacementsEditor value={ui.replacements} onChange={(v) => set('replacements', v)} />
          </div>
        </PopoverContent>
      </Popover>
    </Toolbar>
  )

  const inputPane = (
    <InputEditorPane
      title="Titles"
      value={input}
      onChange={setInput}
      sample={SAMPLE}
      placeholder="One title per line…"
      path="slug-input"
      footer={
        <>
          <span>{pluralize(rows.length, 'title')}</span>
        </>
      }
    />
  )

  const table = (
    <Pane aria-label="Slugs">
      <PaneHeader
        title="Slugs"
        meta={rows.length ? `${pluralize(rows.length, 'slug')}${stats.dup ? ` · ${pluralize(stats.dup, 'duplicate')}` : ''}` : undefined}
        actions={
          <>
            <CopyButton value={asCsv} label="Copy as CSV (title, slug)" disabled={!rows.length} tooltip="Copy as CSV (title, slug)" />
            <DownloadButton getContent={allSlugs} filename="slugs.txt" label="Download slugs" disabled={!rows.length} />
            <CopyButton value={allSlugs} label="Copy all" showLabel disabled={!rows.length} />
          </>
        }
      />
      {!rows.length ? (
        <div className="min-h-0 flex-1">
          <EmptyState icon={<Link2 />} title="Type titles on the left — one per line" description="Each line becomes a URL-safe slug. Copy a single row or all of them." />
        </div>
      ) : (
        <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto" role="table" aria-label="Slugs">
          <div className="min-w-[560px]">
            <div role="row" className="sticky top-0 z-10 grid h-8 grid-cols-[48px_minmax(0,0.85fr)_minmax(0,1.3fr)_52px_40px] items-center border-b border-border bg-workspace text-2xs font-medium uppercase tracking-wider text-subtle">
              <div role="columnheader" className="pr-3 text-right">Line</div>
              <div role="columnheader" className="px-2">Title</div>
              <div role="columnheader" className="px-2">Slug</div>
              <div role="columnheader" className="px-2 text-right">Len</div>
              <div role="columnheader" className="sr-only">Copy</div>
            </div>
            <div style={{ height: virtualizer.getTotalSize() }} className="relative">
              {virtualizer.getVirtualItems().map((v) => {
                const r = rows[v.index]
                const over = r.truncated
                return (
                  <div
                    key={v.key}
                    role="row"
                    className="group absolute left-0 grid w-full grid-cols-[48px_minmax(0,0.85fr)_minmax(0,1.3fr)_52px_40px] items-center border-b border-border/60 text-sm hover:bg-surface-2/50"
                    style={{ height: ROW_HEIGHT, transform: `translateY(${v.start}px)` }}
                  >
                    <div role="cell" className="tabular pr-3 text-right text-2xs text-subtle">{r.line}</div>
                    <div role="cell" className="truncate px-2 text-muted" title={r.input}>{r.input}</div>
                    <div role="cell" className="flex min-w-0 items-center gap-2 px-2">
                      {r.slug ? (
                        <span className="mono truncate text-[12.5px] text-fg" title={r.slug}>{r.slug}</span>
                      ) : (
                        <span className="text-xs text-warn">{ui.transliterate ? 'Empty — no Latin letters or digits (turn off “ASCII only”)' : 'Empty — no letters or digits'}</span>
                      )}
                      {r.dropped && r.slug && (
                        <Badge tone="neutral" title={`No ASCII equivalent — dropped: ${r.dropped}. Turn off “ASCII only” to keep them.`}>
                          dropped {r.dropped.length > 6 ? `${[...r.dropped].slice(0, 6).join('')}…` : r.dropped}
                        </Badge>
                      )}
                      {r.duplicateOf != null && (
                        <Badge tone="warn" title={ui.makeUnique ? 'Suffix added to keep slugs unique' : `Same slug as line ${r.duplicateOf}`}>
                          {ui.makeUnique ? 'deduped' : `dup of ${r.duplicateOf}`}
                        </Badge>
                      )}
                    </div>
                    <div role="cell" className={cn('tabular px-2 text-right text-2xs', over ? 'text-mod' : 'text-subtle')} title={over ? 'Cut at the maximum length' : undefined}>
                      {r.slug.length}
                    </div>
                    <div role="cell" className="flex justify-center">
                      <CopyButton value={r.slug} label={`Copy slug for line ${r.line}`} disabled={!r.slug} size="icon-xs" className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100" />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </Pane>
  )

  return (
    <>
      {toolbar}
      <SplitPane id="slug" initial={0.4} mobileTabs={['Titles', 'Slugs']} mobileTab={mobileTab} onMobileTabChange={setMobileTab}>
        {inputPane}
        {table}
      </SplitPane>
      <StatusBar>
        <StatusItem label="Slugs">{formatNumber(rows.length)}</StatusItem>
        <StatusItem label="Unique">{formatNumber(stats.unique)}</StatusItem>
        {stats.dup > 0 && <StatusItem label="Duplicates" tone="mod">{formatNumber(stats.dup)}</StatusItem>}
        {stats.empty > 0 && <StatusItem label="Empty" tone="danger">{formatNumber(stats.empty)}</StatusItem>}
        <StatusItem label="Longest">{formatNumber(stats.longest)} chars</StatusItem>
        <StatusSpacer />
        {!isMobile && (
          <StatusItem label="Rules">
            {ui.transliterate ? 'ASCII' : 'Unicode'} · sep “{separator}”{ui.maxLength ? ` · max ${ui.maxLength}` : ''}
          </StatusItem>
        )}
      </StatusBar>
    </>
  )
}
