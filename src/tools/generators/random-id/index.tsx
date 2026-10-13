import { useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  ALPHABETS,
  createUlid,
  MAX_ID_COUNT,
  MAX_ID_LENGTH,
  nanoid,
  randomToken,
  resolveAlphabet,
  tokenBits,
  tokenLength,
  idBits,
  type AlphabetPreset,
  type TokenEncoding,
} from '@/engines/generators/randomId'
import { usePersistentState } from '@/hooks/usePersistentState'
import { Toolbar, ToolbarSeparator } from '@/components/tools/Toolbar'
import { SettingsLayout, SettingsSection, SettingRow } from '@/components/tools/SettingsLayout'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Slider } from '@/components/ui/slider'
import { CopyButton } from '@/components/common/CopyButton'
import { formatDuration, formatNumber } from '@/utils/format'
import { modKey } from '@/utils/platform'
import { cn } from '@/utils/cn'
import { NumberInput } from '../_shared/NumberInput'
import { ValueList } from '../_shared/ValueList'
import { DownloadMenu } from '../_shared/DownloadMenu'
import { LocalBadge } from '../_shared/LocalBadge'
import { useRegenerateShortcut } from '../_shared/useShortcut'
import { InsightPanel } from './InsightPanel'

type Kind = 'nanoid' | 'ulid' | 'token'

interface Settings {
  kind: Kind
  preset: AlphabetPreset
  custom: string
  length: number
  monotonic: boolean
  lowercase: boolean
  bytes: number
  encoding: TokenEncoding
  prefix: string
  count: number
}

const DEFAULTS: Settings = {
  kind: 'nanoid',
  preset: 'urlsafe',
  custom: '0123456789abcdef',
  length: 21,
  monotonic: true,
  lowercase: false,
  bytes: 32,
  encoding: 'base64url',
  prefix: '',
  count: 20,
}

const ALPHABET_OPTIONS: { value: AlphabetPreset; label: string; description?: string }[] = [
  ...(Object.entries(ALPHABETS) as [Exclude<AlphabetPreset, 'custom'>, { label: string; chars: string }][]).map(([value, a]) => ({
    value,
    label: a.label,
    description: a.chars.length > 40 ? `${a.chars.slice(0, 36)}…` : a.chars,
  })),
  { value: 'custom', label: 'Custom…', description: 'Your own characters' },
]

const BYTE_PRESETS = [16, 24, 32, 64]

export default function RandomId() {
  const [s, setS] = usePersistentState<Settings>('settings', DEFAULTS)
  const patch = (p: Partial<Settings>) => setS({ ...s, ...p })
  const [nonce, setNonce] = useState(0)
  const [ulidFactory] = useState(() => ({ mono: createUlid({ monotonic: true }), plain: createUlid({ monotonic: false }) }))

  const alphabet = useMemo(() => resolveAlphabet(s.preset, s.custom), [s.preset, s.custom])

  const gen = useMemo(() => {
    void nonce
    const t = performance.now()
    let values: string[] = []
    let error: string | null = null
    if (s.kind === 'nanoid') {
      if (!alphabet.ok) error = alphabet.error
      else values = Array.from({ length: s.count }, () => nanoid(alphabet.chars, s.length))
    } else if (s.kind === 'ulid') {
      const f = s.monotonic ? ulidFactory.mono : ulidFactory.plain
      values = Array.from({ length: s.count }, () => f())
      if (s.lowercase) values = values.map((v) => v.toLowerCase())
    } else {
      values = Array.from({ length: s.count }, () => randomToken(s.bytes, s.encoding, s.prefix))
    }
    return { values, error, ms: performance.now() - t }
  }, [s, alphabet, ulidFactory, nonce])

  const regenerate = () => setNonce((n) => n + 1)
  useRegenerateShortcut(regenerate)

  /** Entropy per ID in bits (ULID: random part only — collisions need the same millisecond). */
  const bits = s.kind === 'nanoid' ? (alphabet.ok ? idBits(alphabet.chars.length, s.length) : 0) : s.kind === 'ulid' ? 80 : tokenBits(s.bytes, s.encoding)
  const values = gen.values
  const name = s.kind === 'nanoid' ? 'ids' : s.kind === 'ulid' ? 'ulids' : 'tokens'

  const settings = (
    <>
      {s.kind === 'nanoid' && (
        <SettingsSection title="Alphabet">
          <Select aria-label="Alphabet" value={s.preset} onValueChange={(preset) => patch({ preset })} options={ALPHABET_OPTIONS} className="w-full" />
          {s.preset === 'custom' ? (
            <Input aria-label="Custom alphabet" className="mono h-7 text-[12.5px]" value={s.custom} onChange={(e) => patch({ custom: e.target.value })} aria-invalid={!alphabet.ok} placeholder="Characters to draw from" />
          ) : (
            <p className="mono break-all rounded-md bg-surface px-2 py-1.5 text-[12px] leading-[18px] text-muted">{ALPHABETS[s.preset].chars}</p>
          )}
          {alphabet.ok && <p className="text-xs text-muted">{alphabet.chars.length} characters · {Math.log2(alphabet.chars.length).toFixed(2)} bits each</p>}
        </SettingsSection>
      )}
      {s.kind === 'nanoid' && (
        <SettingsSection title="Length">
          <div className="flex items-center gap-3">
            <Slider aria-label="Length" min={4} max={64} step={1} value={[Math.min(64, s.length)]} onValueChange={([length]) => patch({ length })} />
            <NumberInput aria-label="Length" value={s.length} onChange={(length) => patch({ length })} min={1} max={MAX_ID_LENGTH} className="w-16" />
          </div>
          <p className="text-xs text-muted">NanoID's default is 21 URL-safe characters (126 bits) — comparable to UUID v4.</p>
        </SettingsSection>
      )}
      {s.kind === 'ulid' && (
        <SettingsSection title="ULID">
          <p className="text-xs text-muted">26 Crockford base32 characters: a 48-bit millisecond timestamp, then 80 random bits. Sorts lexicographically by time.</p>
          <Checkbox checked={s.monotonic} onCheckedChange={(v) => patch({ monotonic: v === true })} label="Monotonic" description="Within the same millisecond, increment the random part so IDs stay in creation order." />
          <Checkbox checked={s.lowercase} onCheckedChange={(v) => patch({ lowercase: v === true })} label="Lowercase" description="Decoders are case-insensitive; canonical form is uppercase." />
        </SettingsSection>
      )}
      {s.kind === 'token' && (
        <SettingsSection title="Token">
          <SettingRow label="Random bytes" hint={`${s.bytes * 8} bits`} htmlFor="tok-bytes">
            <NumberInput id="tok-bytes" value={s.bytes} onChange={(bytes) => patch({ bytes })} min={4} max={512} className="w-20" />
          </SettingRow>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Byte presets">
            {BYTE_PRESETS.map((n) => (
              <Button key={n} size="xs" variant={s.bytes === n ? 'subtle' : 'ghost'} aria-pressed={s.bytes === n} className={cn('tabular', s.bytes === n && 'text-fg')} onClick={() => patch({ bytes: n })}>
                {n} B
              </Button>
            ))}
          </div>
          <SettingRow label="Encoding">
            <Segmented
              aria-label="Encoding"
              value={s.encoding}
              onValueChange={(encoding) => patch({ encoding })}
              options={[
                { value: 'hex', label: 'hex' },
                { value: 'base64url', label: 'base64url' },
                { value: 'base62', label: 'base62', tooltip: 'Letters and digits only — draws enough characters for at least the requested bits' },
              ]}
            />
          </SettingRow>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="tok-prefix" className="text-xs text-muted">
              Prefix
            </label>
            <Input id="tok-prefix" className="mono h-7 text-[12.5px]" value={s.prefix} onChange={(e) => patch({ prefix: e.target.value })} placeholder="e.g. sk_test_" maxLength={40} />
          </div>
          <p className="text-xs text-muted">
            {tokenLength(s.bytes, s.encoding) + s.prefix.length} characters total. The prefix is free text — it identifies the key type and adds no secrecy.
          </p>
        </SettingsSection>
      )}
      <SettingsSection title="Quantity">
        <SettingRow label="How many" hint={`1 – ${formatNumber(MAX_ID_COUNT)}`} htmlFor="rid-count">
          <NumberInput id="rid-count" value={s.count} onChange={(count) => patch({ count })} min={1} max={MAX_ID_COUNT} className="w-24" />
        </SettingRow>
      </SettingsSection>
    </>
  )

  return (
    <>
      <Toolbar>
        <Segmented
          aria-label="ID type"
          value={s.kind}
          onValueChange={(kind) => patch({ kind })}
          options={[
            { value: 'nanoid', label: 'NanoID' },
            { value: 'ulid', label: 'ULID' },
            { value: 'token', label: 'Token / API key' },
          ]}
        />
        <ToolbarSeparator />
        <Button size="sm" variant="primary" onClick={regenerate} disabled={!!gen.error}>
          <RefreshCw /> Regenerate
          <span className="ml-1 hidden items-center gap-0.5 opacity-80 sm:flex">
            <Kbd className="border-white/25 bg-white/10 text-current">{modKey}</Kbd>
            <Kbd className="border-white/25 bg-white/10 text-current">↵</Kbd>
          </span>
        </Button>
        <CopyButton value={() => values.join('\n')} label="Copy all" showLabel disabled={!values.length} />
        <DownloadMenu
          disabled={!values.length}
          options={[
            { label: 'Text, one per line', filename: `${name}.txt`, mime: 'text/plain;charset=utf-8', getContent: () => values.join('\n') + '\n' },
            { label: 'JSON array', filename: `${name}.json`, mime: 'application/json', getContent: () => JSON.stringify(values, null, 2) + '\n' },
            { label: 'CSV (one column)', filename: `${name}.csv`, mime: 'text/csv', getContent: () => ['id', ...values].join('\r\n') + '\r\n' },
          ]}
        />
      </Toolbar>

      <SettingsLayout settings={settings} settingsWidth="md:w-[280px] xl:w-[300px]" className="max-md:[&>aside]:order-last max-md:[&>aside]:border-t max-md:[&>div]:min-h-fit">
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <Pane className="min-h-[300px] max-md:h-[380px] max-md:flex-none" aria-label="Generated IDs">
            <PaneHeader
              title="Generated"
              meta={`${formatNumber(values.length)} × ${s.kind === 'nanoid' ? `${s.length}-char ID` : s.kind === 'ulid' ? 'ULID' : `${s.bytes}-byte token`}`}
              actions={<span className="pr-1.5 text-2xs text-subtle">Click a row to copy</span>}
            />
            {gen.error ? <ErrorDisplay error={gen.error} title="Alphabet" /> : <ValueList values={values} label="Generated IDs" />}
          </Pane>
          <div className="flex shrink-0 flex-col border-t border-border lg:w-[340px] lg:border-l lg:border-t-0 xl:w-[380px]">
            <InsightPanel kind={s.kind} bits={bits} monotonic={s.monotonic} count={s.count} firstUlid={s.kind === 'ulid' ? values[0] : undefined} />
          </div>
        </div>
      </SettingsLayout>

      <StatusBar>
        <StatusItem label="Count">{formatNumber(values.length)}</StatusItem>
        <StatusItem label="Entropy">{bits.toFixed(1)} bits{s.kind === 'ulid' ? ' random / ms' : ''}</StatusItem>
        {values[0] && <StatusItem label="Length">{Array.from(values[0]).length} chars</StatusItem>}
        <StatusItem label="Generated in">{formatDuration(gen.ms)}</StatusItem>
        <StatusSpacer />
        <span className="hidden text-subtle md:inline">crypto.getRandomValues · unbiased</span>
        <LocalBadge />
      </StatusBar>
    </>
  )
}
