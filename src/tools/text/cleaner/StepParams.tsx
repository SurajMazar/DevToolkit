import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { EXTRACT_LABELS, OP_INFO, type CleanerOp, type ExtractKind } from '@/engines/text/cleaner'
import { cn } from '@/utils/cn'

function Row({ label, children, className }: { label?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-7 items-center gap-2', className)}>
      {label && <span className="w-[68px] shrink-0 text-xs text-muted">{label}</span>}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">{children}</div>
    </div>
  )
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="[&_label]:text-xs [&_label]:text-muted [&_label]:leading-4">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} label={label} />
    </span>
  )
}

function NumberField({ value, onChange, min, max, label, className }: { value: number; onChange: (v: number) => void; min: number; max: number; label: string; className?: string }) {
  return (
    <Input
      type="number"
      aria-label={label}
      min={min}
      max={max}
      value={Number.isFinite(value) ? value : ''}
      onChange={(e) => {
        const n = Math.round(Number(e.target.value))
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)))
      }}
      className={cn('mono h-7 w-16 px-2 text-xs tabular', className)}
    />
  )
}

function TextField({ value, onChange, label, placeholder, className }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; className?: string }) {
  return <Input aria-label={label} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cn('mono h-7 px-2 text-xs', className)} />
}

const NORMALIZE_HINTS = {
  NFC: 'Canonical composition — é stored as one code point',
  NFD: 'Canonical decomposition — e + combining accent',
  NFKC: 'Compatibility composition — ﬁ → fi, ① → 1, full-width → ASCII',
  NFKD: 'Compatibility decomposition',
} as const

const SEPARATORS = [
  { value: '. ', label: '1. text' },
  { value: ') ', label: '1) text' },
  { value: ': ', label: '1: text' },
  { value: ' | ', label: '1 | text' },
  { value: ' ', label: '1 text' },
  { value: '\t', label: '1⇥text (tab)' },
  { value: '', label: '1text (none)' },
]

/** Inline parameter editor for one pipeline step. Ops without parameters show their description. */
export function StepParams({ op, onChange }: { op: CleanerOp; onChange: (op: CleanerOp) => void }) {
  const set = <T extends CleanerOp>(patch: Partial<T>) => onChange({ ...op, ...patch } as CleanerOp)

  switch (op.kind) {
    case 'trimLines':
      return (
        <Row label="Side">
          <Segmented size="xs" aria-label="Trim side" value={op.side} onValueChange={(side) => set({ side })} options={[{ value: 'both', label: 'Both' }, { value: 'start', label: 'Start' }, { value: 'end', label: 'End' }]} />
        </Row>
      )
    case 'collapseSpaces':
      return (
        <Row>
          <Check checked={op.includeTabs} onChange={(includeTabs) => set({ includeTabs })} label="Tabs & NBSP too" />
          <Check checked={op.keepIndent} onChange={(keepIndent) => set({ keepIndent })} label="Keep indentation" />
        </Row>
      )
    case 'tabsToSpaces':
      return (
        <Row label="Width">
          <NumberField label="Spaces per tab" value={op.size} min={1} max={16} onChange={(size) => set({ size })} />
          <Check checked={op.tabStops} onChange={(tabStops) => set({ tabStops })} label="Align to tab stops" />
        </Row>
      )
    case 'spacesToTabs':
      return (
        <Row label="Width">
          <NumberField label="Spaces per tab" value={op.size} min={1} max={16} onChange={(size) => set({ size })} />
          <Segmented size="xs" aria-label="Where" value={op.scope} onValueChange={(scope) => set({ scope })} options={[{ value: 'leading', label: 'Indentation' }, { value: 'all', label: 'Everywhere' }]} />
        </Row>
      )
    case 'lineEndings':
      return (
        <Row label="Convert to">
          <Segmented size="xs" aria-label="Line ending" value={op.eol} onValueChange={(eol) => set({ eol })} options={[{ value: 'lf', label: 'LF' }, { value: 'crlf', label: 'CRLF' }, { value: 'cr', label: 'CR' }]} />
          <span className="text-2xs text-subtle">{op.eol === 'lf' ? 'Unix, macOS' : op.eol === 'crlf' ? 'Windows' : 'Classic Mac'}</span>
        </Row>
      )
    case 'removeBlankLines':
      return (
        <>
          <Row label="Mode">
            <Segmented size="xs" aria-label="Blank line mode" value={op.mode} onValueChange={(mode) => set({ mode })} options={[{ value: 'all', label: 'Remove all' }, { value: 'collapse', label: 'Collapse runs' }]} />
          </Row>
          <Row>
            <Check checked={op.whitespaceIsBlank} onChange={(whitespaceIsBlank) => set({ whitespaceIsBlank })} label="Whitespace-only lines are blank" />
          </Row>
        </>
      )
    case 'dedupeLines':
      return (
        <Row>
          <Check checked={op.caseInsensitive} onChange={(caseInsensitive) => set({ caseInsensitive })} label="Ignore case" />
          <Check checked={op.ignoreWhitespace} onChange={(ignoreWhitespace) => set({ ignoreWhitespace })} label="Ignore surrounding spaces" />
          <Check checked={op.keepBlank} onChange={(keepBlank) => set({ keepBlank })} label="Keep blank lines" />
        </Row>
      )
    case 'sortLines':
      return (
        <>
          <Row label="Order">
            <Segmented size="xs" aria-label="Sort order" value={op.order} onValueChange={(order) => set({ order })} options={[{ value: 'asc', label: 'A → Z' }, { value: 'desc', label: 'Z → A' }]} />
          </Row>
          <Row>
            <Check checked={op.natural} onChange={(natural) => set({ natural })} label="Natural (2 < 10)" />
            <Check checked={op.locale} onChange={(locale) => set({ locale })} label="Locale-aware" />
            <Check checked={op.caseInsensitive} onChange={(caseInsensitive) => set({ caseInsensitive })} label="Ignore case" />
          </Row>
        </>
      )
    case 'addLineNumbers':
      return (
        <>
          <Row label="Format">
            <Select aria-label="Number format" value={op.separator} onValueChange={(separator) => set({ separator })} options={SEPARATORS} className="h-7 text-xs" />
            <NumberField label="Start at" value={op.start} min={0} max={1_000_000_000} onChange={(start) => set({ start })} className="w-20" />
          </Row>
          <Row label="Padding">
            <Segmented size="xs" aria-label="Number padding" value={op.pad} onValueChange={(pad) => set({ pad })} options={[{ value: 'none', label: 'None' }, { value: 'zero', label: '007' }, { value: 'space', label: '··7' }]} />
            <Check checked={op.skipBlank} onChange={(skipBlank) => set({ skipBlank })} label="Skip blank lines" />
          </Row>
        </>
      )
    case 'prefixSuffix':
      return (
        <>
          <Row label="Prefix">
            <TextField label="Prefix" value={op.prefix} onChange={(prefix) => set({ prefix })} placeholder="e.g. - or &quot;" />
          </Row>
          <Row label="Suffix">
            <TextField label="Suffix" value={op.suffix} onChange={(suffix) => set({ suffix })} placeholder="e.g. &quot;," />
          </Row>
          <Row>
            <Check checked={op.skipBlank} onChange={(skipBlank) => set({ skipBlank })} label="Skip blank lines" />
          </Row>
        </>
      )
    case 'stripHtml':
      return (
        <Row>
          <Check checked={op.decodeEntities} onChange={(decodeEntities) => set({ decodeEntities })} label="Decode entities (&amp;amp; → &)" />
          <Check checked={op.blockNewlines} onChange={(blockNewlines) => set({ blockNewlines })} label="Blocks on new lines" />
        </Row>
      )
    case 'removeSpecial':
      return (
        <>
          <Row>
            <Check checked={op.keepPunctuation} onChange={(keepPunctuation) => set({ keepPunctuation })} label={`Keep basic punctuation  . , ; : ! ? ' " ( ) -`} />
          </Row>
          <Row label="Also keep">
            <TextField label="Additional characters to keep" value={op.extra} onChange={(extra) => set({ extra })} placeholder="e.g. @_#/" />
          </Row>
        </>
      )
    case 'removePunctuation':
      return (
        <Row>
          <Check checked={op.symbols} onChange={(symbols) => set({ symbols })} label="Symbols too ($ + © …)" />
          <Check checked={op.keepApostrophes} onChange={(keepApostrophes) => set({ keepApostrophes })} label="Keep apostrophes in words" />
        </Row>
      )
    case 'normalizeUnicode':
      return (
        <>
          <Row label="Form">
            <Segmented
              size="xs"
              aria-label="Normalization form"
              value={op.form}
              onValueChange={(form) => set({ form })}
              options={(['NFC', 'NFD', 'NFKC', 'NFKD'] as const).map((f) => ({ value: f, label: f }))}
            />
          </Row>
          <p className="text-2xs text-subtle">{NORMALIZE_HINTS[op.form]}</p>
        </>
      )
    case 'extract':
      return (
        <Row label="Items">
          <Select
            aria-label="What to extract"
            value={op.what}
            onValueChange={(what: ExtractKind) => set({ what })}
            options={(Object.keys(EXTRACT_LABELS) as ExtractKind[]).map((k) => ({ value: k, label: EXTRACT_LABELS[k].label }))}
            className="h-7 text-xs"
          />
          <Check checked={op.dedupe} onChange={(dedupe) => set({ dedupe })} label="Unique only" />
        </Row>
      )
    default:
      return <p className="text-xs text-subtle">{OP_INFO.get(op.kind)?.description}</p>
  }
}
