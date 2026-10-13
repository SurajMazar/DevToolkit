import { useMemo } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { formatUuid, inspectUuid } from '@/engines/generators/uuid'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/common/CopyButton'
import { EmptyState } from '@/components/tools/EmptyState'
import { InfoTable, type InfoRow } from '../_shared/InfoTable'

function relative(ms: number): string {
  const diff = ms - Date.now()
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_557_600_000],
    ['month', 2_629_800_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
    ['second', 1000],
  ]
  for (const [u, size] of units) if (abs >= size) return rtf.format(Math.round(diff / size), u)
  return 'just now'
}

export function UuidInspector({ value, onChange, firstGenerated }: { value: string; onChange: (v: string) => void; firstGenerated?: string }) {
  const result = useMemo(() => (value.trim() ? inspectUuid(value) : null), [value])

  const copy = (v: string, label: string) => <CopyButton value={v} label={`Copy ${label}`} size="icon-xs" />

  let body: React.ReactNode
  if (!result) {
    body = (
      <EmptyState
        compact
        title="Inspect any UUID"
        description="Paste a UUID to see its version, variant and embedded timestamp. Braces, URN and hyphen-less forms are accepted."
        actions={
          firstGenerated && (
            <Button size="sm" onClick={() => onChange(firstGenerated)}>
              Inspect first generated
            </Button>
          )
        }
      />
    )
  } else if (!result.ok) {
    body = (
      <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm">
        <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
        <p>{result.error}</p>
      </div>
    )
  } else {
    const r = result.value
    const rows: InfoRow[] = [
      {
        key: 'Valid',
        sans: true,
        value: (
          <span className="inline-flex items-center gap-1.5 text-ok">
            <CheckCircle2 className="size-3.5" /> Yes{r.inputForm !== 'canonical' && <span className="text-subtle">· {r.inputForm}</span>}
          </span>
        ),
      },
      { key: 'Version', sans: true, value: r.special ? r.versionName : `${r.version} — ${r.versionName}` },
      { key: 'Variant', sans: true, value: r.variant },
    ]
    if (r.timestampMs != null) {
      const d = new Date(r.timestampMs)
      const valid = !Number.isNaN(d.getTime())
      const iso = valid ? d.toISOString() : 'out of range'
      rows.push(
        { key: 'Timestamp', hint: 'UTC', value: iso + (r.timestamp100ns ? ` +${r.timestamp100ns}×100ns` : ''), action: valid ? copy(iso, 'timestamp') : undefined },
        { key: 'Local time', sans: true, value: valid ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : '—', hint: valid ? relative(r.timestampMs) : undefined },
        { key: 'Unix ms', value: String(r.timestampMs), action: copy(String(r.timestampMs), 'Unix milliseconds') },
      )
    }
    if (r.clockSeq != null) rows.push({ key: 'Clock sequence', value: String(r.clockSeq) })
    if (r.node) rows.push({ key: 'Node', value: r.node })
    const lower = r.canonical
    rows.push(
      { key: 'Canonical', value: lower, action: copy(lower, 'canonical form') },
      { key: 'Uppercase', value: formatUuid(lower, { case: 'upper', hyphens: true, wrap: 'none' }), action: copy(formatUuid(lower, { case: 'upper', hyphens: true, wrap: 'none' }), 'uppercase') },
      { key: 'No hyphens', value: formatUuid(lower, { case: 'lower', hyphens: false, wrap: 'none' }), action: copy(formatUuid(lower, { case: 'lower', hyphens: false, wrap: 'none' }), 'without hyphens') },
      { key: 'URN', value: `urn:uuid:${lower}`, action: copy(`urn:uuid:${lower}`, 'URN') },
    )
    body = (
      <div className="flex flex-col gap-2.5">
        <InfoTable rows={rows} />
        {r.notes.length > 0 && (
          <ul className="flex flex-col gap-1 text-xs text-muted">
            {r.notes.map((n) => (
              <li key={n}>· {n}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <section aria-label="UUID inspector" className="flex min-h-0 flex-1 flex-col bg-workspace">
      <div className="flex h-9 shrink-0 items-center border-b border-border px-3">
        <h2 className="eyebrow">Inspector</h2>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <Input
          aria-label="UUID to inspect"
          className="mono text-[12.5px]"
          placeholder="Paste a UUID…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={result ? !result.ok : undefined}
        />
        {body}
      </div>
    </section>
  )
}
