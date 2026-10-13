import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import {
  REPRESENTATIONS,
  describeCodePoint,
  displayGlyph,
  represent,
  segmentCodePoints,
  segmentGraphemes,
  summarizeUnicode,
  type CharFlag,
  type CodePointInfo,
  type InspectUnit,
  type Representation,
} from '@/engines/text-utils/unicode'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { InputEditorPane } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { EmptyState } from '@/components/tools/EmptyState'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/common/CopyButton'
import { copyText } from '@/utils/clipboard'
import { formatNumber } from '@/utils/format'
import { cn } from '@/utils/cn'

const SAMPLE = `Café vs Café — same look, different code points.
Login: pаypal.com (the "а" is Cyrillic)
Price: €42 · x² · ½ · ﬁle · 日本語 · العربية
Emoji: 👩🏽‍💻 🇯🇵 ❤️ 👍🏿
Hidden: zero​width and a soft­hyphen`

const MAX_UNITS = 200_000
const ROW_HEIGHT = 34

type Granularity = 'codepoint' | 'grapheme'
type Filter = 'all' | 'non-ascii' | 'flagged'

const FLAG_STYLE: Partial<Record<CharFlag, { label: string; tone: 'danger' | 'warn' | 'mod' | 'accent' | 'neutral' }>> = {
  invisible: { label: 'invisible', tone: 'danger' },
  control: { label: 'control', tone: 'danger' },
  confusable: { label: 'confusable', tone: 'warn' },
  combining: { label: 'combining', tone: 'mod' },
  'variation-selector': { label: 'variation sel.', tone: 'accent' },
  'emoji-modifier': { label: 'skin tone', tone: 'accent' },
  'private-use': { label: 'private use', tone: 'warn' },
  unassigned: { label: 'unassigned', tone: 'danger' },
  surrogate: { label: 'lone surrogate', tone: 'danger' },
}

interface Row {
  unit: InspectUnit
  infos: CodePointInfo[]
  flags: CharFlag[]
}

function buildRow(unit: InspectUnit): Row {
  const infos = unit.cps.map(describeCodePoint)
  const flags = [...new Set(infos.flatMap((i) => i.flags))]
  return { unit, infos, flags }
}

const COLUMNS = (g: Granularity) =>
  g === 'grapheme'
    ? '64px minmax(140px,1.3fr) 72px minmax(120px,1fr) 100px minmax(110px,1fr) minmax(100px,1fr) minmax(110px,1fr) minmax(110px,1fr) minmax(90px,0.8fr) minmax(140px,1.1fr)'
    : '64px 96px 76px minmax(160px,1.1fr) 104px 112px 104px 116px 124px 96px minmax(150px,1fr)'

const HEADERS = ['Glyph', 'Code point', 'Decimal', 'Category', 'Script', 'UTF-8', 'UTF-16', 'HTML', 'JS', 'CSS', 'Flags']

function Cell({ children, mono = true, className, title }: { children: React.ReactNode; mono?: boolean; className?: string; title?: string }) {
  return (
    <div title={title} className={cn('min-w-0 truncate px-2', mono && 'mono text-[12px]', className)}>
      {children}
    </div>
  )
}

function SummaryStat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'warn' | 'danger' }) {
  return (
    <div className="flex shrink-0 flex-col">
      <span className="text-2xs text-subtle">{label}</span>
      <span className={cn('tabular text-sm font-medium text-fg', tone === 'warn' && 'text-warn', tone === 'danger' && 'text-danger')}>{value}</span>
    </div>
  )
}

export default function UnicodeInspector() {
  const [input, setInput] = usePersistentState('input', '')
  const [granularity, setGranularity] = usePersistentState<Granularity>('granularity', 'codepoint')
  const [copyAs, setCopyAs] = usePersistentState<Representation>('copyAs', 'codepoint')
  const [filter, setFilter] = usePersistentState<Filter>('filter', 'all')
  const [selected, setSelected] = useState<number | null>(null)
  const isMobile = useIsMobile()
  const [mobileTab, setMobileTab] = useState<0 | 1>(0)
  const scroller = useRef<HTMLDivElement>(null)

  useIncomingInput(setInput)

  const debounced = useDebouncedValue(input, adaptiveDelay(input.length))
  const text = useDeferredValue(debounced)
  const summary = useMemo(() => summarizeUnicode(text), [text])
  const seg = useMemo(() => (granularity === 'grapheme' ? segmentGraphemes(text, MAX_UNITS) : segmentCodePoints(text, MAX_UNITS)), [text, granularity])
  const rows = useMemo(() => {
    if (filter === 'all') return seg.units
    return seg.units.filter((u) => {
      if (filter === 'non-ascii') return u.cps.some((cp) => cp > 0x7f)
      return u.cps.some((cp) => describeCodePoint(cp).flags.some((f) => f !== 'non-ascii'))
    })
  }, [seg, filter])

  const rowCache = useMemo(() => new Map<number, Row>(), [rows])
  const getRow = (i: number) => {
    let r = rowCache.get(i)
    if (!r) rowCache.set(i, (r = buildRow(rows[i])))
    return r
  }

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
  })

  const copyRow = async (i: number) => {
    setSelected(i)
    const r = getRow(i)
    const value = represent(r.unit.cps, copyAs)
    const ok = await copyText(value)
    const label = REPRESENTATIONS.find((x) => x.value === copyAs)?.label
    if (ok) toast.success(`Copied ${label}`, { description: value.length > 80 ? value.slice(0, 80) + '…' : value })
    else toast.error('Clipboard access was blocked by the browser')
  }

  const scripts = summary.scripts.filter((s) => s.name !== 'Common' && s.name !== 'Inherited')
  const mixedScripts = scripts.length > 1 && scripts.some((s) => s.name === 'Latin') && scripts.some((s) => s.name === 'Cyrillic' || s.name === 'Greek')
  const columns = COLUMNS(granularity)

  const inputPane = (
    <InputEditorPane
      title="Text"
      value={input}
      onChange={setInput}
      sample={SAMPLE}
      wordWrap
      placeholder="Paste text to inspect every character…"
      path="unicode-input"
      footer={
        <>
          <span>{formatNumber(summary.codePoints)} code points</span>
          <span>{formatNumber(summary.graphemes)} graphemes</span>
          <span>{formatNumber(summary.utf8Bytes)} UTF-8 bytes</span>
          <span className="ml-auto hidden sm:inline">Line breaks are normalized to LF by the editor</span>
        </>
      }
    />
  )

  const table = (
    <Pane aria-label="Characters">
      <PaneHeader
        title={granularity === 'grapheme' ? 'Graphemes' : 'Code points'}
        meta={`${formatNumber(rows.length)}${filter !== 'all' ? ` ${filter === 'flagged' ? 'flagged' : 'non-ASCII'} of ${formatNumber(seg.units.length)}` : ''} · click a row to copy its ${REPRESENTATIONS.find((r) => r.value === copyAs)?.label.toLowerCase()}`}
        actions={
          <CopyButton
            label="Copy whole text as selected representation"
            disabled={!text}
            value={() => (copyAs === 'char' ? text : seg.units.map((u) => represent(u.cps, copyAs)).join(copyAs === 'html' || copyAs === 'js' || copyAs === 'json' || copyAs === 'url' || copyAs === 'css' ? '' : ' '))}
          />
        }
      />
      {text && (
        <div className="flex shrink-0 items-center gap-x-6 gap-y-2 overflow-x-auto border-b border-border bg-bg px-3 py-2 [scrollbar-width:none]">
          <SummaryStat label="Code points" value={formatNumber(summary.codePoints)} />
          <SummaryStat label="Graphemes" value={formatNumber(summary.graphemes)} />
          <SummaryStat label="UTF-16 units" value={formatNumber(summary.utf16Units)} />
          <SummaryStat label="UTF-8 bytes" value={formatNumber(summary.utf8Bytes)} />
          <SummaryStat label="Non-ASCII" value={formatNumber(summary.nonAscii)} />
          <SummaryStat label="Invisible" value={formatNumber(summary.invisible)} tone={summary.invisible ? 'danger' : undefined} />
          <SummaryStat label="Combining" value={formatNumber(summary.combining)} />
          <SummaryStat label="Confusable" value={formatNumber(summary.confusable)} tone={summary.confusable ? 'warn' : undefined} />
          <div className="h-7 w-px shrink-0 bg-border" aria-hidden />
          <SummaryStat label="Scripts" value={<span className="whitespace-nowrap">{scripts.length ? scripts.slice(0, 4).map((s) => s.name.replace(/_/g, ' ')).join(', ') + (scripts.length > 4 ? ` +${scripts.length - 4}` : '') : 'Common only'}</span>} tone={mixedScripts ? 'warn' : undefined} />
          <SummaryStat
            label="Normalization"
            value={<span className="whitespace-nowrap">{summary.normalization.nfc ? 'NFC' : 'Not NFC'}{summary.normalization.nfd && !summary.normalization.nfc ? ' · NFD' : ''}{!summary.normalization.nfkc ? ' · compat chars' : ''}</span>}
          />
        </div>
      )}
      {mixedScripts && <ErrorDisplay severity="warning" error="Latin is mixed with Cyrillic or Greek letters — a common trick in look-alike domains and usernames. Check the rows flagged as confusable." />}
      {seg.truncated && <ErrorDisplay severity="warning" error={`Large input: the table lists the first ${formatNumber(MAX_UNITS)} ${granularity === 'grapheme' ? 'graphemes' : 'code points'}. Summary counts above cover the whole text.`} />}
      {!text ? (
        <div className="min-h-0 flex-1">
          <EmptyState title="Paste text to see every character it contains" description="Each code point gets its category, script, UTF-8 / UTF-16 encoding and escapes. Invisible, combining and look-alike characters are flagged." />
        </div>
      ) : rows.length === 0 ? (
        <div className="min-h-0 flex-1">
          <EmptyState compact title={filter === 'flagged' ? 'Nothing flagged — no invisible, combining or confusable characters.' : 'Only ASCII characters in this text.'} />
        </div>
      ) : (
        <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto" role="table" aria-label="Characters" aria-rowcount={rows.length + 1}>
          <div className="min-w-[1180px]">
            <div role="row" className="sticky top-0 z-10 grid h-8 items-center border-b border-border bg-workspace text-2xs font-medium uppercase tracking-wider text-subtle" style={{ gridTemplateColumns: columns }}>
              {HEADERS.map((h, i) => (
                <div role="columnheader" key={h} className={cn('truncate px-2', i === 0 && 'text-center')}>
                  {granularity === 'grapheme' && h === 'Code point' ? 'Code points' : granularity === 'grapheme' && h === 'Decimal' ? 'Offset' : h}
                </div>
              ))}
            </div>
            <div style={{ height: virtualizer.getTotalSize() }} className="relative">
              {virtualizer.getVirtualItems().map((v) => {
                const r = getRow(v.index)
                const cps = r.unit.cps
                const first = r.infos[0]
                const glyph = displayGlyph(cps)
                const multi = cps.length > 1
                return (
                  <div
                    key={v.key}
                    role="row"
                    tabIndex={0}
                    onClick={() => copyRow(v.index)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        void copyRow(v.index)
                      }
                    }}
                    title={`Click to copy ${REPRESENTATIONS.find((x) => x.value === copyAs)?.label}`}
                    className={cn(
                      'absolute left-0 grid w-full cursor-default items-center border-b border-border/60 text-sm outline-none transition-colors duration-75 hover:bg-surface-2/60 focus-visible:bg-accent-soft',
                      selected === v.index && 'bg-accent-soft hover:bg-accent-soft',
                    )}
                    style={{ height: ROW_HEIGHT, transform: `translateY(${v.start}px)`, gridTemplateColumns: columns }}
                  >
                    <div role="cell" className="flex h-full items-center justify-center border-r border-border/60">
                      <span
                        className={cn(
                          glyph.special
                            ? cn('rounded-[3px] px-1 font-sans text-[10px] font-semibold', r.flags.some((f) => f === 'invisible' || f === 'control' || f === 'unassigned' || f === 'surrogate') ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-muted')
                            : 'text-[20px] leading-none',
                        )}
                      >
                        {glyph.text}
                      </span>
                    </div>
                    <Cell className="text-fg" title={represent(cps, 'codepoint')}>
                      {represent(cps, 'codepoint')}
                    </Cell>
                    <Cell className="text-muted tabular">{multi || granularity === 'grapheme' ? (granularity === 'grapheme' ? r.unit.offset : cps.join(' ')) : first.cp}</Cell>
                    <Cell mono={false} className="text-xs" title={r.infos.map((i) => `${i.category.code} ${i.category.name}`).join(' + ')}>
                      <span className="mono mr-1.5 text-fg">{r.infos.map((i) => i.category.code).join('+')}</span>
                      <span className="text-muted">{multi ? `${cps.length} code points` : first.category.name}</span>
                    </Cell>
                    <Cell mono={false} className="text-xs text-muted">
                      {[...new Set(r.infos.map((i) => i.script))].join(', ').replace(/_/g, ' ')}
                    </Cell>
                    <Cell className="text-muted" title={represent(cps, 'utf8')}>{represent(cps, 'utf8')}</Cell>
                    <Cell className="text-muted" title={represent(cps, 'utf16')}>{represent(cps, 'utf16')}</Cell>
                    <Cell className="text-muted" title={represent(cps, 'html')}>{represent(cps, 'html')}</Cell>
                    <Cell className="text-muted" title={represent(cps, 'js')}>{represent(cps, 'js')}</Cell>
                    <Cell className="text-muted" title={represent(cps, 'css')}>{represent(cps, 'css')}</Cell>
                    <div role="cell" className="flex min-w-0 items-center gap-1 overflow-hidden px-2">
                      {multi && r.infos.some((i) => i.label && i.flags.includes('invisible')) && (
                        <span className="mono shrink-0 text-2xs text-muted">{r.infos.filter((i) => i.label && i.flags.includes('invisible')).map((i) => i.label).join('+')}</span>
                      )}
                      {r.flags.map((f) => {
                        const s = FLAG_STYLE[f]
                        if (!s) return null
                        const title = f === 'confusable' ? `Looks like “${r.infos.find((i) => i.confusable)?.confusable}”` : undefined
                        return (
                          <Badge key={f} tone={s.tone === 'warn' ? 'warn' : s.tone} title={title}>
                            {s.label}
                            {f === 'confusable' && <span className="mono">≈{r.infos.find((i) => i.confusable)?.confusable}</span>}
                          </Badge>
                        )
                      })}
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
      <Toolbar>
        <Segmented
          aria-label="Granularity"
          value={granularity}
          onValueChange={(g) => {
            setGranularity(g)
            setSelected(null)
          }}
          options={[
            { value: 'codepoint', label: 'Code points' },
            { value: 'grapheme', label: 'Graphemes' },
          ]}
        />
        <ToolbarSeparator />
        <ToolbarField label="Show">
          <Segmented
            aria-label="Row filter"
            value={filter}
            onValueChange={(f) => {
              setFilter(f)
              setSelected(null)
            }}
            options={[
              { value: 'all', label: 'All' },
              { value: 'non-ascii', label: 'Non-ASCII' },
              { value: 'flagged', label: 'Flagged' },
            ]}
          />
        </ToolbarField>
        <ToolbarSeparator />
        <ToolbarField label="Click copies">
          <Select
            aria-label="Representation copied on click"
            value={copyAs}
            onValueChange={setCopyAs}
            options={REPRESENTATIONS.map((r) => ({ value: r.value, label: r.label, description: <span className="mono">{r.example}</span> }))}
          />
        </ToolbarField>
        <ToolbarSpacer />
        {summary.invisible > 0 && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-danger">
            <TriangleAlert className="size-3.5" /> {formatNumber(summary.invisible)} invisible
          </span>
        )}
      </Toolbar>
      <SplitPane direction="vertical" id="unicode-inspector" initial={0.26} min={110} mobileTabs={['Text', 'Characters']} mobileTab={mobileTab} onMobileTabChange={setMobileTab}>
        {inputPane}
        {table}
      </SplitPane>
      <StatusBar>
        <StatusItem label="Code points">{formatNumber(summary.codePoints)}</StatusItem>
        <StatusItem label="Graphemes">{formatNumber(summary.graphemes)}</StatusItem>
        <StatusItem label="UTF-16">{formatNumber(summary.utf16Units)}</StatusItem>
        <StatusItem label="UTF-8">{formatNumber(summary.utf8Bytes)} B</StatusItem>
        {!isMobile && <StatusItem label="Non-ASCII">{formatNumber(summary.nonAscii)}</StatusItem>}
        <StatusSpacer />
        {selected != null && rows[selected] && !isMobile && (
          <StatusItem label="Selected">
            <span className="mono">{represent(rows[selected].cps, 'codepoint')}</span>
          </StatusItem>
        )}
      </StatusBar>
    </>
  )
}
