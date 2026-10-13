import { useId, useMemo, useRef } from 'react'
import { AlertCircle } from 'lucide-react'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { ToolScrollBody } from '@/components/tools/ToolPage'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { Switch } from '@/components/ui/switch'
import { Select } from '@/components/ui/select'
import { Segmented } from '@/components/ui/segmented'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/common/CopyButton'
import { inputClass } from '@/components/ui/input'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import {
  BASE_NAMES,
  bitLength,
  byteLength,
  defaultGroup,
  formatInteger,
  interpretPattern,
  parseInteger,
  signedBitLength,
  twosComplement,
  WIDTHS,
  type IntParseResult,
} from '@/engines/dev/base-convert'
import { cn } from '@/utils/cn'
import { formatNumber } from '@/utils/format'

type FieldId = 'bin' | 'oct' | 'dec' | 'hex' | 'custom'

interface Source {
  field: FieldId
  text: string
}

const FIXED: { id: Exclude<FieldId, 'custom'>; base: number; label: string }[] = [
  { id: 'dec', base: 10, label: 'Decimal' },
  { id: 'hex', base: 16, label: 'Hexadecimal' },
  { id: 'bin', base: 2, label: 'Binary' },
  { id: 'oct', base: 8, label: 'Octal' },
]

const CUSTOM_BASES = Array.from({ length: 35 }, (_, i) => i + 2).filter((b) => ![2, 8, 10, 16].includes(b))

interface Options {
  uppercase: boolean
  group: boolean
  prefix: boolean
}

function NumberField({
  id,
  label,
  base,
  value,
  active,
  error,
  onChange,
  copyText,
  extra,
}: {
  id: string
  label: React.ReactNode
  base: number
  value: string
  active: boolean
  error?: { message: string; position?: number }
  onChange: (text: string) => void
  copyText: string
  extra?: React.ReactNode
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const errId = useId()
  return (
    <div className="grid grid-cols-1 gap-1.5 border-b border-border px-4 py-3 last:border-b-0 md:grid-cols-[150px_1fr] md:gap-4 md:px-6">
      <div className="flex items-center gap-2 md:flex-col md:items-start md:gap-0.5 md:pt-1.5">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {label}
        </label>
        <span className="text-2xs text-subtle tabular">base {base}</span>
        {extra}
      </div>
      <div className="min-w-0">
        <div className="flex items-start gap-1">
          <textarea
            ref={ref}
            id={id}
            value={value}
            rows={1}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? errId : undefined}
            className={cn(inputClass, 'mono field-sizing-content h-auto max-h-40 min-h-8 resize-none [overflow-wrap:anywhere] py-1.5 leading-5 tabular', active && !error && 'border-border-strong')}
          />
          <CopyButton value={copyText} label={`Copy ${typeof label === 'string' ? label.toLowerCase() : 'value'}`} disabled={!copyText} className="mt-0.5" />
        </div>
        {error && (
          <p id={errId} className="mt-1 flex items-start gap-1.5 text-xs text-danger">
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            <span>
              {error.message}
              {error.position != null && <span className="text-muted"> · position {error.position}</span>}
            </span>
          </p>
        )}
        {error?.position != null && (
          <Button
            variant="link"
            size="xs"
            className="mt-0.5 text-xs"
            onClick={() => {
              const el = ref.current
              if (!el) return
              el.focus()
              el.setSelectionRange(error.position! - 1, error.position!)
            }}
          >
            Select the invalid character
          </Button>
        )}
      </div>
    </div>
  )
}

export default function BaseConverter() {
  const [source, setSource] = usePersistentState<Source>('source', { field: 'dec', text: '3735928559' })
  const [customBase, setCustomBase] = usePersistentState('customBase', 36)
  const [opts, setOpts] = usePersistentState<Options>('options', { uppercase: true, group: true, prefix: false })
  const [width, setWidth] = usePersistentState<string>('width', '32')
  const lastValid = useRef<bigint | null>(null)

  useIncomingInput((text) => setSource({ field: /^\s*-?0x/i.test(text) ? 'hex' : /^\s*-?0b/i.test(text) ? 'bin' : 'dec', text: text.trim() }))

  const baseOf = (f: FieldId) => (f === 'custom' ? customBase : FIXED.find((x) => x.id === f)!.base)
  const parsed: IntParseResult = useMemo(() => parseInteger(source.text, baseOf(source.field)), [source, customBase]) // eslint-disable-line react-hooks/exhaustive-deps
  if (parsed.ok) lastValid.current = parsed.value
  const value = parsed.ok ? parsed.value : null
  const shown = value ?? lastValid.current

  const fmt = (v: bigint, base: number) => formatInteger(v, base, { uppercase: opts.uppercase, group: opts.group ? defaultGroup(base) : 0, separator: base === 10 ? ',' : ' ', prefix: opts.prefix })
  const raw = (v: bigint, base: number) => formatInteger(v, base, { uppercase: opts.uppercase, prefix: opts.prefix })

  const fieldValue = (f: FieldId) => {
    if (f === source.field) return source.text
    return shown == null ? '' : fmt(shown, baseOf(f))
  }
  const setField = (f: FieldId) => (text: string) => setSource({ field: f, text })

  const tc = useMemo(() => (value == null ? [] : WIDTHS.map((w) => twosComplement(value, w))), [value])
  const interp = value == null ? null : interpretPattern(value, Number(width))
  const isEmpty = !source.text.trim()

  return (
    <>
      <Toolbar>
        <span className="shrink-0 whitespace-nowrap">
          <Switch checked={opts.group} onCheckedChange={(group) => setOpts({ ...opts, group })} label="Group digits" />
        </span>
        <span className="shrink-0 whitespace-nowrap">
          <Switch checked={opts.uppercase} onCheckedChange={(uppercase) => setOpts({ ...opts, uppercase })} label="Uppercase" />
        </span>
        <span className="shrink-0 whitespace-nowrap">
          <Switch checked={opts.prefix} onCheckedChange={(prefix) => setOpts({ ...opts, prefix })} label="0x / 0b / 0o prefixes" />
        </span>
        <ToolbarSeparator />
        <ToolbarField label="Custom base">
          <Select aria-label="Custom base" value={String(customBase)} onValueChange={(v) => setCustomBase(Number(v))} options={CUSTOM_BASES.map((b) => ({ value: String(b), label: `Base ${b}` }))} />
        </ToolbarField>
        <ToolbarSpacer />
        <Button size="sm" variant="ghost" onClick={() => setSource({ field: 'hex', text: '0xDEAD_BEEF' })}>
          Sample
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSource({ field: 'dec', text: '' })} disabled={isEmpty}>
          Clear
        </Button>
      </Toolbar>
      <ToolScrollBody>
        <div className="grid min-h-full grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
          <section aria-label="Values" className="min-w-0 border-border xl:border-r">
            <div className="flex h-9 items-center border-b border-border px-4 md:px-6">
              <h2 className="eyebrow">Values</h2>
              <span className="ml-3 truncate text-2xs text-subtle">Type in any field — the others update. Separators _ ' , and spaces are ignored.</span>
            </div>
            {FIXED.map((f) => (
              <NumberField
                key={f.id}
                id={`base-${f.id}`}
                label={f.label}
                base={f.base}
                value={fieldValue(f.id)}
                active={source.field === f.id}
                error={source.field === f.id && !parsed.ok && !isEmpty ? parsed.error : undefined}
                onChange={setField(f.id)}
                copyText={value == null ? '' : raw(value, f.base)}
              />
            ))}
            <NumberField
              id="base-custom"
              label={`Base ${customBase}`}
              base={customBase}
              value={fieldValue('custom')}
              active={source.field === 'custom'}
              error={source.field === 'custom' && !parsed.ok && !isEmpty ? parsed.error : undefined}
              onChange={setField('custom')}
              copyText={value == null ? '' : raw(value, customBase)}
              extra={<span className="text-2xs text-subtle">digits 0–9, a–{'0123456789abcdefghijklmnopqrstuvwxyz'[customBase - 1]}</span>}
            />
          </section>

          <section aria-label="Binary representation" className="min-w-0 border-t border-border xl:border-t-0">
            <div className="flex h-9 items-center border-b border-border px-4 md:px-6">
              <h2 className="eyebrow">Size</h2>
            </div>
            <dl className="grid grid-cols-3 gap-px border-b border-border bg-border">
              {[
                ['Bit length', value == null ? '—' : formatNumber(bitLength(value))],
                ['Byte length', value == null ? '—' : formatNumber(byteLength(value))],
                ['Signed width', value == null ? '—' : `${formatNumber(signedBitLength(value))} bits`],
              ].map(([k, v]) => (
                <div key={k} className="bg-workspace px-4 py-2.5 md:px-6">
                  <dt className="text-2xs text-subtle">{k}</dt>
                  <dd className="mono mt-0.5 text-sm tabular text-fg">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="flex h-9 items-center border-b border-border px-4 md:px-6">
              <h2 className="eyebrow">Two's complement</h2>
            </div>
            {value == null ? (
              <p className="px-4 py-6 text-sm text-muted md:px-6">{isEmpty ? 'Enter a number to see its fixed-width representations.' : 'Fix the input to see fixed-width representations.'}</p>
            ) : (
              <div className="divide-y divide-border border-b border-border">
                {tc.map((t) => (
                  <div key={t.bits} className="grid grid-cols-[56px_1fr] gap-3 px-4 py-2.5 md:px-6">
                    <div>
                      <p className="mono text-sm font-medium tabular text-fg">{t.bits}-bit</p>
                      <p className="mt-1">
                        {t.overflow ? (
                          <Badge tone="danger" title="The value does not fit; the pattern shown is truncated to the low bits">Overflow</Badge>
                        ) : t.fitsSigned && t.fitsUnsigned ? (
                          <Badge tone="ok">Fits</Badge>
                        ) : t.fitsSigned ? (
                          <Badge tone="accent">Signed</Badge>
                        ) : (
                          <Badge tone="warn" title="Fits only as an unsigned integer">Unsigned</Badge>
                        )}
                      </p>
                    </div>
                    <div className={cn('min-w-0', t.overflow && 'opacity-60')}>
                      <div className="flex items-start gap-1">
                        <p className="mono min-w-0 flex-1 break-words text-[12.5px] leading-5 tabular text-fg">
                          <span className="text-subtle">0x</span>
                          {t.hex}
                        </p>
                        <CopyButton value={`0x${t.hex.replace(/ /g, '')}`} label={`Copy ${t.bits}-bit hex`} size="icon-xs" />
                      </div>
                      <div className="flex items-start gap-1">
                        <p className="mono min-w-0 flex-1 break-words text-[12px] leading-5 tabular text-muted">{t.binary}</p>
                        <CopyButton value={t.binary.replace(/ /g, '')} label={`Copy ${t.bits}-bit binary`} size="icon-xs" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex h-9 items-center gap-3 border-b border-border px-4 md:px-6">
              <h2 className="eyebrow">Interpret bits as</h2>
              <Segmented size="xs" aria-label="Interpretation width" value={width} onValueChange={setWidth} options={WIDTHS.map((w) => ({ value: String(w), label: String(w) }))} />
            </div>
            <div className="px-4 py-3 md:px-6">
              {value == null ? (
                <p className="text-sm text-muted">—</p>
              ) : interp && interp.ok ? (
                <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-sm">
                  <dt className="text-muted">Signed</dt>
                  <dd className="mono break-all tabular text-fg">{formatInteger(interp.value.signed, 10, { group: 3, separator: ',' })}</dd>
                  <dt className="text-muted">Unsigned</dt>
                  <dd className="mono break-all tabular text-fg">{formatInteger(interp.value.unsigned, 10, { group: 3, separator: ',' })}</dd>
                </dl>
              ) : (
                <p className="text-sm text-muted">{interp && !interp.ok ? interp.error : ''}</p>
              )}
              <p className="mt-2 text-2xs text-subtle">Treats the current value as a raw {width}-bit pattern — e.g. 0xFF in 8 bits is −1 signed, 255 unsigned.</p>
            </div>
          </section>
        </div>
      </ToolScrollBody>
      <StatusBar>
        <StatusItem label="Input">{BASE_NAMES[baseOf(source.field)] ?? `base ${baseOf(source.field)}`}</StatusItem>
        {value != null && <StatusItem label="Sign">{value < 0n ? 'negative' : value === 0n ? 'zero' : 'positive'}</StatusItem>}
        {value != null && <StatusItem label="Digits (dec)">{formatNumber((value < 0n ? -value : value).toString().length)}</StatusItem>}
        <StatusSpacer />
        <StatusItem label="Precision">arbitrary (BigInt)</StatusItem>
        {!parsed.ok && !isEmpty && <StatusItem tone="danger">Invalid input</StatusItem>}
      </StatusBar>
    </>
  )
}
