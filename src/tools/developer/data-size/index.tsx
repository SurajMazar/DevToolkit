import { useMemo } from 'react'
import { ArrowRightLeft, Info } from 'lucide-react'
import { SettingsLayout, SettingsSection } from '@/components/tools/SettingsLayout'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Field } from '@/components/ui/label'
import { IconButton } from '@/components/ui/icon-button'
import { CopyButton } from '@/components/common/CopyButton'
import { usePersistentState } from '@/hooks/usePersistentState'
import {
  approxNumber,
  bestUnit,
  convert,
  formatRational,
  formatSeconds,
  parseDecimal,
  RATE_UNITS,
  rateById,
  rational,
  SIZE_UNITS,
  toBits,
  transferSeconds,
  UNIT_GROUPS,
  unitById,
  type Rational,
  type SizeUnit,
} from '@/engines/dev/data-size'
import { cn } from '@/utils/cn'

const PRECISIONS = ['0', '1', '2', '3', '4', '6', '8', '12', 'exact'] as const
type Precision = (typeof PRECISIONS)[number]

const UNIT_OPTIONS = UNIT_GROUPS.map((g) => ({
  label: g.title,
  options: SIZE_UNITS.filter((u) => u.group === g.id).map((u) => ({ value: u.id, label: `${u.symbol} · ${u.name}` })),
}))

function TransferPanel({ bits }: { bits: Rational | null }) {
  const [rate, setRate] = usePersistentState('rate', '100')
  const [rateUnit, setRateUnit] = usePersistentState('rateUnit', 'Mbps')
  const [efficiency, setEfficiency] = usePersistentState('efficiency', '100')
  const rateParsed = parseDecimal(rate)
  const effParsed = parseDecimal(efficiency)
  const effOk = effParsed.ok && effParsed.value.num > 0n && effParsed.value.num <= effParsed.value.den * 100n
  const seconds =
    bits && rateParsed.ok && effOk && effParsed.ok
      ? transferSeconds(bits, rateParsed.value, rateById.get(rateUnit)!, rational(effParsed.value.num, effParsed.value.den * 100n))
      : null
  return (
    <SettingsSection title="Transfer time">
      <div className="flex gap-2">
        <Field label="Bandwidth" className="flex-1">
          <Input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" aria-invalid={!rateParsed.ok} className="mono tabular" />
        </Field>
        <Field label="Unit" className="w-[104px]">
          <Select aria-label="Bandwidth unit" size="md" value={rateUnit} onValueChange={setRateUnit} options={RATE_UNITS.map((r) => ({ value: r.id, label: r.label }))} />
        </Field>
      </div>
      <Field label="Efficiency" hint="Real transfers lose ~5–15% to protocol overhead (TCP/IP, TLS).">
        <div className="relative">
          <Input value={efficiency} onChange={(e) => setEfficiency(e.target.value)} inputMode="decimal" aria-invalid={!effOk} className="mono tabular pr-7" />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-subtle">%</span>
        </div>
      </Field>
      <div className="rounded-md border border-border bg-workspace px-3 py-2.5">
        {!rateParsed.ok ? (
          <p className="text-sm text-danger">{rateParsed.error}</p>
        ) : !effOk ? (
          <p className="text-sm text-danger">Efficiency must be between 0 and 100%.</p>
        ) : seconds ? (
          <>
            <p className="mono text-lg font-medium tabular text-fg">{formatSeconds(approxNumber(seconds))}</p>
            <p className="mono mt-0.5 text-2xs text-subtle tabular">{formatRational(seconds, { precision: 3, group: true }).text} s</p>
          </>
        ) : (
          <p className="text-sm text-muted">{bits ? 'Bandwidth must be greater than zero.' : 'Enter a size to estimate.'}</p>
        )}
      </div>
    </SettingsSection>
  )
}

export default function DataSizeConverter() {
  const [value, setValue] = usePersistentState('value', '1')
  const [unitId, setUnitId] = usePersistentState('unit', 'TB')
  const [precision, setPrecision] = usePersistentState<Precision>('precision', '3')
  const [group, setGroup] = usePersistentState('group', true)
  const unit = unitById.get(unitId) ?? unitById.get('TB')!
  const parsed = useMemo(() => parseDecimal(value), [value])
  const fmt = useMemo(() => ({ precision: precision === 'exact' ? ('exact' as const) : Number(precision), group }), [precision, group])

  const bits = parsed.ok ? toBits(parsed.value, unit) : null
  const bytes = bits ? rational(bits.num, bits.den * 8n) : null
  const rows = useMemo(() => {
    if (!parsed.ok) return null
    return SIZE_UNITS.map((u) => ({ unit: u, value: convert(parsed.value, unit, u) }))
  }, [parsed, unit])

  const pickRow = (u: SizeUnit, v: Rational) => {
    setValue(formatRational(v, { precision: 'exact' }).text)
    setUnitId(u.id)
  }

  // The marketing-vs-OS note uses the counterpart system of the input unit.
  const note = useMemo(() => {
    if (!bits || bits.num === 0n) return null
    const si = bestUnit(bits, 'byte-si')
    const iec = bestUnit(bits, 'byte-iec')
    const siVal = formatRational(convert(bits, unitById.get('bit')!, si), { precision: 2, group: true }).text
    const iecVal = formatRational(convert(bits, unitById.get('bit')!, iec), { precision: 2, group: true }).text
    return { si: `${siVal} ${si.symbol}`, iec: `${iecVal} ${iec.symbol}`, windows: `${iecVal} ${iec.symbol.replace('i', '')}`, same: si.symbol === 'B' }
  }, [bits])

  const settings = (
    <>
      <SettingsSection title="Size">
        <div className="flex gap-2">
          <Field label="Value" className="flex-1">
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode="decimal"
              aria-invalid={!parsed.ok}
              aria-describedby={!parsed.ok ? 'size-error' : undefined}
              className="mono tabular"
              autoFocus
            />
          </Field>
          <Field label="Unit" className="w-[120px]">
            <Select aria-label="Input unit" size="md" value={unit.id} onValueChange={setUnitId} options={UNIT_OPTIONS} />
          </Field>
        </div>
        {!parsed.ok && (
          <p id="size-error" className="-mt-1 text-sm text-danger">
            {parsed.error}
          </p>
        )}
        <p className="text-2xs text-subtle">Accepts decimals, exponents (1e12) and separators (1_000, 2,048).</p>
      </SettingsSection>
      <TransferPanel bits={bits} />
    </>
  )

  return (
    <>
      <Toolbar>
        <ToolbarField label="Precision">
          <Select
            aria-label="Decimal places"
            value={precision}
            onValueChange={setPrecision}
            options={PRECISIONS.map((p) => ({ value: p, label: p === 'exact' ? 'Exact' : `${p} decimals`, description: p === 'exact' ? 'Full decimal expansion (always finite here)' : undefined }))}
          />
        </ToolbarField>
        <ToolbarSeparator />
        <span className="shrink-0 whitespace-nowrap">
          <Switch checked={group} onCheckedChange={setGroup} label="Thousands separators" />
        </span>
        <ToolbarSpacer />
        <span className="hidden text-xs text-subtle md:inline">Click a row to use it as the input</span>
      </Toolbar>
      <SettingsLayout settings={settings}>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {bytes && (
            <div className="border-b border-border px-4 py-4 md:px-6">
              <p className="eyebrow">Exact size</p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="mono break-all text-lg font-medium tabular text-fg">{formatRational(bytes, { precision: 'exact', group: true }).text}</span>
                <span className="text-sm text-muted">bytes</span>
                <span className="mono text-sm tabular text-subtle">= {formatRational(bits!, { precision: 'exact', group: true }).text} bits</span>
                <CopyButton value={() => formatRational(bytes, { precision: 'exact' }).text} label="Copy exact byte count" />
              </div>
              {note && !note.same && (
                <div className="mt-3 flex max-w-3xl items-start gap-2 rounded-md bg-surface px-3 py-2 text-sm text-muted">
                  <Info className="mt-0.5 size-4 shrink-0 text-subtle" />
                  <p>
                    A drive sold as <span className="mono text-fg">{note.si}</span> (decimal, as manufacturers count) holds <span className="mono text-fg">{note.iec}</span> in binary units —
                    Windows shows this as “{note.windows}” because it uses binary math with decimal labels. Nothing is missing; it is the same number of bytes.
                  </p>
                </div>
              )}
            </div>
          )}
          {!rows ? (
            <div className="px-6 py-10 text-center text-sm text-muted">Enter a valid, non-negative number to see every unit.</div>
          ) : (
            <div className="grid gap-x-8 gap-y-2 px-4 py-4 md:px-6 xl:grid-cols-2">
              {UNIT_GROUPS.map((g) => (
                <section key={g.id} aria-label={g.title} className="min-w-0">
                  <div className="pb-1.5 pt-2">
                    <h3 className="eyebrow">{g.title}</h3>
                    <p className="text-2xs text-subtle">{g.note}</p>
                  </div>
                  <table className="w-full table-fixed border-collapse text-sm">
                    <tbody>
                      {rows
                        .filter((r) => r.unit.group === g.id)
                        .map(({ unit: u, value: v }) => {
                          const f = formatRational(v, fmt)
                          const active = u.id === unit.id
                          return (
                            <tr
                              key={u.id}
                              onClick={() => pickRow(u, v)}
                              className={cn('group cursor-default border-t border-border first:border-t-0 hover:bg-surface-2/60', active && 'bg-accent-soft hover:bg-accent-soft')}
                              title={`Use ${u.symbol} as the input unit`}
                            >
                              <td className="w-16 py-1.5 pl-2 pr-2">
                                <span className={cn('mono text-[12.5px] font-medium', active ? 'text-accent-text' : 'text-fg')}>{u.symbol}</span>
                              </td>
                              <td className="hidden w-24 py-1.5 pr-2 text-xs text-subtle sm:table-cell">{u.name}</td>
                              <td className="min-w-0 py-1.5 pr-1 text-right">
                                <span className="mono block truncate text-[12.5px] tabular text-fg" title={formatRational(v, { precision: 'exact', group: true }).text}>
                                  {!f.exact && <span className="mr-1 text-subtle">≈</span>}
                                  {f.text === '0' && v.num !== 0n ? <span className="text-muted">{Number(approxNumber(v).toPrecision(4)).toExponential()}</span> : f.text}
                                </span>
                              </td>
                              <td className="w-[60px] py-0.5 pr-1 text-right" onClick={(e) => e.stopPropagation()}>
                                <span className="inline-flex opacity-50 group-hover:opacity-100">
                                  <CopyButton value={() => formatRational(v, { precision: 'exact' }).text} label={`Copy value in ${u.symbol}`} size="icon-xs" />
                                  <IconButton label={`Use ${u.symbol} as input`} icon={<ArrowRightLeft />} size="icon-xs" onClick={() => pickRow(u, v)} />
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>
          )}
        </div>
      </SettingsLayout>
      <StatusBar>
        <StatusItem label="Input">{parsed.ok ? `${formatRational(parsed.value, { precision: 6, group: true }).text} ${unit.symbol}` : '—'}</StatusItem>
        {bytes && <StatusItem label="Bytes">{formatRational(bytes, { precision: 3, group: true }).text}</StatusItem>}
        <StatusSpacer />
        <StatusItem label="Arithmetic">exact (BigInt)</StatusItem>
        {!parsed.ok && <StatusItem tone="danger">Invalid number</StatusItem>}
      </StatusBar>
    </>
  )
}
