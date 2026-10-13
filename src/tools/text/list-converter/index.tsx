import { useMemo, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { ConverterTool, type ConverterResult } from '@/components/tools/ConverterTool'
import { ToolbarField, ToolbarSeparator } from '@/components/tools/Toolbar'
import { StatusItem } from '@/components/tools/StatusBar'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { usePersistentState } from '@/hooks/usePersistentState'
import {
  convertList,
  DEFAULT_LIST_OPTIONS,
  DELIMITERS,
  describeDelimiter,
  LIST_PRESETS,
  type Direction,
  type ListOptions,
  type QuoteStyle,
  type SortOrder,
  type WrapStyle,
} from '@/engines/text-utils/list'
import { formatNumber, pluralize } from '@/utils/format'
import { cn } from '@/utils/cn'

const SAMPLE_LINES = `alice@example.com
bob@example.com
carol.o'neil@example.com
dave@example.com

bob@example.com
erin@example.com`

const SAMPLE_LIST = `"Smith, John", Jane Doe, 'O''Brien', "Lee ""Ace"" Park",  Zoë Ångström  , 42`

interface UiState extends ListOptions {
  delimiterChoice: string
  customDelimiter: string
}

const DEFAULT_UI: UiState = { ...DEFAULT_LIST_OPTIONS, delimiterChoice: 'comma-space', customDelimiter: ' / ' }

function delimiterOf(ui: UiState): string {
  if (ui.delimiterChoice === 'custom') return ui.customDelimiter.replace(/\\t/g, '\t').replace(/\\n/g, '\n')
  return DELIMITERS.find((d) => d.value === ui.delimiterChoice)?.char ?? ', '
}

/** Which preset (if any) the current options match exactly. */
function activePreset(ui: UiState): string {
  for (const p of LIST_PRESETS) {
    const o = p.options
    const delim = delimiterOf(ui)
    if (
      o.delimiter === delim &&
      o.quote === ui.quote &&
      o.wrap === ui.wrap &&
      (o.escape === undefined || o.escape === ui.escape) &&
      (o.bareNumbers === undefined || o.bareNumbers === ui.bareNumbers)
    )
      return p.id
  }
  return 'custom'
}

export default function ListConverter() {
  const [ui, setUi] = usePersistentState<UiState>('options', DEFAULT_UI)
  const [mode, setMode] = useState('auto')
  const set = <K extends keyof UiState>(k: K, v: UiState[K]) => setUi((u) => ({ ...u, [k]: v }))
  const delimiter = delimiterOf(ui)
  const preset = activePreset(ui)

  const options: ListOptions = useMemo(() => ({ ...ui, delimiter, autoDelimiter: ui.autoDelimiter }), [ui, delimiter])

  const applyPreset = (id: string) => {
    const p = LIST_PRESETS.find((x) => x.id === id)
    if (!p) return
    const choice = DELIMITERS.find((d) => d.char === p.options.delimiter)?.value ?? 'custom'
    setUi((u) => ({ ...u, ...p.options, delimiterChoice: choice, customDelimiter: choice === 'custom' ? (p.options.delimiter ?? u.customDelimiter) : u.customDelimiter }))
  }

  const advancedActive = ui.dedupe || ui.sort !== 'none' || !ui.trim || !ui.removeEmpty || ui.bareNumbers || ui.escape !== 'backslash' || !ui.quoteAware || ui.quoteLines

  const toolbarOptions = (
    <>
      <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
        <span>Presets</span>
        <div className="flex items-center gap-0.5" role="group" aria-label="Presets">
          {LIST_PRESETS.map((p) => (
            <Button
              key={p.id}
              size="xs"
              variant={preset === p.id ? 'subtle' : 'ghost'}
              aria-pressed={preset === p.id}
              title={p.description}
              className={cn(preset === p.id && 'text-fg shadow-[0_0_0_1px_var(--border-strong)]')}
              onClick={() => applyPreset(p.id)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>
      <ToolbarSeparator />
      <ToolbarField label="Delimiter">
        <Select
          aria-label="Delimiter"
          value={ui.delimiterChoice}
          onValueChange={(v) => set('delimiterChoice', v)}
          options={[...DELIMITERS.map((d) => ({ value: d.value, label: d.label, description: <span className="mono">{describeDelimiter(d.char)}</span> })), { value: 'custom', label: 'Custom…' }]}
        />
      </ToolbarField>
      {ui.delimiterChoice === 'custom' && (
        <Input value={ui.customDelimiter} onChange={(e) => set('customDelimiter', e.target.value)} aria-label="Custom delimiter" placeholder="e.g. ' | ' or \t" className="mono h-7 w-20" />
      )}
      <ToolbarField label="Quote">
        <Select
          aria-label="Quote items"
          value={ui.quote}
          onValueChange={(v: QuoteStyle) => set('quote', v)}
          options={[
            { value: 'none', label: 'None' },
            { value: 'single', label: "Single ' '" },
            { value: 'double', label: 'Double " "' },
            { value: 'backtick', label: 'Backtick ` `' },
            { value: 'csv', label: 'CSV (as needed)', description: 'Only items with the delimiter, quotes or line breaks' },
          ]}
        />
      </ToolbarField>
      <ToolbarField label="Wrap">
        <Select
          aria-label="Wrap output"
          value={ui.wrap}
          onValueChange={(v: WrapStyle) => set('wrap', v)}
          options={[
            { value: 'none', label: 'None' },
            { value: 'brackets', label: '[ ]', description: 'JSON / JS array' },
            { value: 'parens', label: '( )', description: 'SQL IN list, tuple' },
            { value: 'braces', label: '{ }', description: 'Set literal' },
          ]}
        />
      </ToolbarField>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={cn(advancedActive && 'text-accent-text')}>
            <Settings2 /> Options
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[320px]">
          <div className="flex flex-col gap-3">
            <p className="eyebrow">Items</p>
            <Checkbox checked={ui.trim} onCheckedChange={(v) => set('trim', v === true)} label="Trim whitespace around items" />
            <Checkbox checked={ui.removeEmpty} onCheckedChange={(v) => set('removeEmpty', v === true)} label="Remove empty items" />
            <Checkbox checked={ui.dedupe} onCheckedChange={(v) => set('dedupe', v === true)} label="Remove duplicates" description="Keeps the first occurrence" />
            {ui.dedupe && (
              <div className="ml-6">
                <Checkbox checked={ui.dedupeIgnoreCase} onCheckedChange={(v) => set('dedupeIgnoreCase', v === true)} label="Ignore case" />
              </div>
            )}
            <Field label="Sort">
              <Select
                aria-label="Sort"
                value={ui.sort}
                onValueChange={(v: SortOrder) => set('sort', v)}
                options={[
                  { value: 'none', label: 'Keep original order' },
                  { value: 'natural', label: 'Natural (a2 before a10)' },
                  { value: 'asc', label: 'A → Z (code point)' },
                  { value: 'desc', label: 'Z → A (code point)' },
                  { value: 'length', label: 'By length' },
                ]}
                size="md"
              />
            </Field>
            <div className="h-px bg-border" />
            <p className="eyebrow">Quoting</p>
            <Field label="Escape quotes inside items">
              <Segmented
                aria-label="Escape style"
                value={ui.escape}
                onValueChange={(v) => set('escape', v)}
                options={[
                  { value: 'backslash', label: 'Backslash \\"' },
                  { value: 'double', label: 'Doubled ""' },
                ]}
              />
            </Field>
            <Checkbox checked={ui.bareNumbers} onCheckedChange={(v) => set('bareNumbers', v === true)} label="Leave numbers unquoted" description="('a', 2) instead of ('a', '2')" />
            <div className="h-px bg-border" />
            <p className="eyebrow">Splitting a list</p>
            <Checkbox checked={ui.autoDelimiter} onCheckedChange={(v) => set('autoDelimiter', v === true)} label="Detect delimiter automatically" description="Otherwise the delimiter above is used" />
            <Checkbox checked={ui.quoteAware} onCheckedChange={(v) => set('quoteAware', v === true)} label="Respect quoted items" description={'"a, b", c → 2 items'} />
            <Checkbox checked={ui.quoteLines} onCheckedChange={(v) => set('quoteLines', v === true)} label="Quote items in the output lines" />
          </div>
        </PopoverContent>
      </Popover>
    </>
  )

  return (
    <ConverterTool
      onModeChange={setMode}
      modes={[
        { value: 'auto', label: 'Auto', inputLabel: 'Input', outputLabel: 'Output', placeholder: 'Paste one item per line — or a delimited list to split it…', sample: SAMPLE_LINES, outputExt: 'txt', inverse: 'auto' },
        { value: 'join', label: 'Lines → List', inputLabel: 'Lines', outputLabel: 'List', placeholder: 'One item per line…', sample: SAMPLE_LINES, outputExt: 'txt', inverse: 'split' },
        { value: 'split', label: 'List → Lines', inputLabel: 'List', outputLabel: 'Lines', placeholder: 'a, b, "c, d"…', sample: SAMPLE_LIST, outputExt: 'txt', inverse: 'join' },
      ]}
      optionsKey={options}
      options={toolbarOptions}
      outputWordWrap
      emptyTitle="Paste a list to convert it."
      emptyDescription={mode === 'split' ? 'Quoted items may contain the delimiter: "a, b", c → 2 items.' : 'Lines become a delimited list; a single delimited line becomes one item per line.'}
      transform={(input, m): ConverterResult => {
        const r = convertList(input, m as Direction | 'auto', options)
        const removed = [r.removedEmpty ? pluralize(r.removedEmpty, 'empty item') : '', r.removedDuplicates ? pluralize(r.removedDuplicates, 'duplicate') : ''].filter(Boolean).join(', ')
        return {
          output: r.output,
          warning: r.warning,
          meta: (
            <span>
              {m === 'auto' && <span className="text-muted">{r.direction === 'join' ? 'Lines → list' : 'List → lines'} · </span>}
              {pluralize(r.count, 'item')}
              {r.direction === 'split' && ` · split on ${describeDelimiter(r.delimiter)}`}
              {removed && ` · removed ${removed}`}
            </span>
          ),
          status: (
            <>
              <StatusItem label="Items">{formatNumber(r.count)}</StatusItem>
              <StatusItem label="Direction">{r.direction === 'join' ? 'Lines → list' : 'List → lines'}{m === 'auto' ? ' (auto)' : ''}</StatusItem>
              {r.removedDuplicates > 0 && <StatusItem label="Duplicates removed">{formatNumber(r.removedDuplicates)}</StatusItem>}
            </>
          ),
        }
      }}
    />
  )
}
