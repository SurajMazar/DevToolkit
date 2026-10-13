import { useMemo, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { collisionProbability, decodeUlid, formatBigCount, idsForCollisionProbability } from '@/engines/generators/randomId'
import { humanDuration } from '@/engines/generators/password'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/common/CopyButton'
import { formatNumber } from '@/utils/format'
import { InfoTable, type InfoRow } from '../_shared/InfoTable'
import { NumberInput } from '../_shared/NumberInput'

type Per = 'second' | 'hour' | 'day'
const PER_SECONDS: Record<Per, number> = { second: 1, hour: 3600, day: 86400 }

function formatProbability(p: number): string {
  if (p === 0) return '0'
  if (p >= 0.001) return `${(p * 100).toPrecision(3)}%`
  return `≈ 1 in ${formatBigCount(1 / p)}`
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="eyebrow">{children}</h3>
}

export function InsightPanel({ kind, bits, monotonic, count, firstUlid }: { kind: 'nanoid' | 'ulid' | 'token'; bits: number; monotonic: boolean; count: number; firstUlid?: string }) {
  const [rate, setRate] = useState(1000)
  const [per, setPer] = useState<Per>('hour')
  const [ulidInput, setUlidInput] = useState('')

  const n1 = idsForCollisionProbability(bits, 0.01)
  const n50 = idsForCollisionProbability(bits, 0.5)
  const timeTo1 = n1 / (rate / PER_SECONDS[per])
  const pNow = collisionProbability(bits, count)

  const decoded = useMemo(() => (ulidInput.trim() ? decodeUlid(ulidInput) : null), [ulidInput])

  return (
    <section aria-label="Collision odds" className="flex min-h-0 flex-1 flex-col bg-workspace">
      <div className="flex h-9 shrink-0 items-center border-b border-border px-3">
        <h2 className="eyebrow">{kind === 'ulid' ? 'Collisions & decoder' : 'Collision odds'}</h2>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[20px] font-semibold leading-7 tabular">{bits.toFixed(1)}</span>
            <span className="text-sm text-muted">{kind === 'ulid' ? 'random bits per millisecond' : 'bits of entropy per ID'}</span>
          </div>
          <InfoTable
            keyWidth="w-[132px]"
            rows={[
              { key: '1% collision risk', hint: kind === 'ulid' ? 'IDs in one ms' : 'after generating', value: `~${formatBigCount(n1)} IDs`, sans: true },
              { key: '50% risk', hint: kind === 'ulid' ? 'IDs in one ms' : 'birthday bound', value: `~${formatBigCount(n50)} IDs`, sans: true },
              { key: `Among ${formatNumber(count)}`, hint: kind === 'ulid' ? 'all in one ms' : 'generated here', value: formatProbability(pNow), sans: true },
            ]}
          />
          <p className="text-xs text-muted">
            {kind === 'ulid'
              ? monotonic
                ? 'A monotonic generator never repeats itself; the risk applies to independent generators creating IDs in the same millisecond.'
                : 'Two ULIDs can only collide if created in the same millisecond, so the risk depends on per-millisecond volume.'
              : 'Birthday bound: n ≈ √(2 · 2^bits · ln(1/(1−p))). Assumes uniform randomness, which this generator provides.'}
          </p>
        </div>

        {kind !== 'ulid' && (
          <div className="flex flex-col gap-2">
            <Heading>Time to 1% risk</Heading>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">At</span>
              <NumberInput aria-label="IDs generated" value={rate} onChange={setRate} min={1} max={1e12} className="w-28" />
              <span className="text-muted">IDs per</span>
              <Select
                aria-label="Per"
                value={per}
                onValueChange={setPer}
                options={[
                  { value: 'second', label: 'second' },
                  { value: 'hour', label: 'hour' },
                  { value: 'day', label: 'day' },
                ]}
              />
            </div>
            <p className="text-sm">
              <span className="text-muted">≈ </span>
              <span className="font-medium text-fg">{humanDuration(timeTo1)}</span>
              <span className="text-muted"> before a 1% chance of any duplicate.</span>
            </p>
          </div>
        )}

        {kind === 'ulid' && (
          <div className="flex flex-col gap-2">
            <Heading>Decode a ULID</Heading>
            <Input aria-label="ULID to decode" className="mono text-[12.5px]" placeholder="Paste a ULID…" value={ulidInput} onChange={(e) => setUlidInput(e.target.value)} aria-invalid={decoded ? !decoded.ok : undefined} />
            {!decoded && firstUlid && (
              <Button size="sm" className="self-start" onClick={() => setUlidInput(firstUlid)}>
                Decode first generated
              </Button>
            )}
            {decoded && !decoded.ok && (
              <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm">
                <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
                <p>{decoded.error}</p>
              </div>
            )}
            {decoded?.ok && (
              <InfoTable
                rows={
                  [
                    {
                      key: 'Valid',
                      sans: true,
                      value: (
                        <span className="inline-flex items-center gap-1.5 text-ok">
                          <CheckCircle2 className="size-3.5" /> Yes
                        </span>
                      ),
                    },
                    { key: 'Timestamp', hint: 'UTC', value: new Date(decoded.timestampMs).toISOString(), action: <CopyButton value={new Date(decoded.timestampMs).toISOString()} label="Copy timestamp" size="icon-xs" /> },
                    { key: 'Local time', sans: true, value: new Date(decoded.timestampMs).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) },
                    { key: 'Unix ms', value: String(decoded.timestampMs), action: <CopyButton value={String(decoded.timestampMs)} label="Copy Unix milliseconds" size="icon-xs" /> },
                    { key: 'Random', hint: '80 bits, hex', value: decoded.randomHex },
                    { key: 'Canonical', value: decoded.canonical, action: <CopyButton value={decoded.canonical} label="Copy canonical ULID" size="icon-xs" /> },
                  ] satisfies InfoRow[]
                }
              />
            )}
          </div>
        )}
      </div>
    </section>
  )
}
