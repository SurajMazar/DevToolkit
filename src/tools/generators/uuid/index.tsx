import { useMemo, useState } from 'react'
import { RefreshCw, ScanSearch } from 'lucide-react'
import {
  DEFAULT_UUID_FORMAT,
  formatUuid,
  generateUuids,
  joinUuids,
  MAX_UUID_COUNT,
  uuidsToCsv,
  type UuidFormat,
  type UuidListMode,
  type UuidVersion,
} from '@/engines/generators/uuid'
import { usePersistentState } from '@/hooks/usePersistentState'
import { Toolbar, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SettingsLayout, SettingsSection, SettingRow } from '@/components/tools/SettingsLayout'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { IconButton } from '@/components/ui/icon-button'
import { CopyButton } from '@/components/common/CopyButton'
import { formatBytes, formatDuration, formatNumber, utf8Length } from '@/utils/format'
import { modKey } from '@/utils/platform'
import { cn } from '@/utils/cn'
import { NumberInput } from '../_shared/NumberInput'
import { ValueList } from '../_shared/ValueList'
import { DownloadMenu } from '../_shared/DownloadMenu'
import { LocalBadge } from '../_shared/LocalBadge'
import { useRegenerateShortcut } from '../_shared/useShortcut'
import { UuidInspector } from './Inspector'

const VERSION_INFO: Record<UuidVersion, string> = {
  v4: '122 random bits from crypto.randomUUID(). The default choice for opaque IDs.',
  v7: '48-bit Unix-ms timestamp + random bits. Sorts by creation time — friendlier to database indexes.',
  nil: 'All zeros. A sentinel for “no value”.',
  max: 'All ones (RFC 9562). A sentinel for “greater than any UUID”.',
}

const LIST_MODES: { value: UuidListMode; label: string; tooltip: string }[] = [
  { value: 'lines', label: 'Lines', tooltip: 'One per line' },
  { value: 'quoted', label: 'Quoted', tooltip: '"…", comma-separated' },
  { value: 'json', label: 'JSON', tooltip: 'JSON array' },
  { value: 'sql', label: 'SQL', tooltip: "('…') rows for INSERT … VALUES" },
]

const QUICK_COUNTS = [1, 10, 100, 1000, 10000]

function v7Time(canonical: string): string {
  const ms = parseInt(canonical.slice(0, 8) + canonical.slice(9, 13), 16)
  const d = new Date(ms)
  return `${d.toLocaleTimeString(undefined, { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

export default function UuidGenerator() {
  const [version, setVersion] = usePersistentState<UuidVersion>('version', 'v4')
  const [count, setCount] = usePersistentState('count', 10)
  const [format, setFormat] = usePersistentState<UuidFormat>('format', DEFAULT_UUID_FORMAT)
  const [listMode, setListMode] = usePersistentState<UuidListMode>('listMode', 'lines')
  const [inspectInput, setInspectInput] = usePersistentState('inspect', '')
  const [nonce, setNonce] = useState(0)

  const generated = useMemo(() => {
    const t = performance.now()
    const values = generateUuids(version, count)
    return { values, ms: performance.now() - t, nonce }
  }, [version, count, nonce])

  const formatted = useMemo(() => generated.values.map((v) => formatUuid(v, format)), [generated, format])
  const joined = () => joinUuids(formatted, listMode)
  const regenerate = () => setNonce((n) => n + 1)
  useRegenerateShortcut(regenerate)

  const patchFormat = (p: Partial<UuidFormat>) => setFormat({ ...format, ...p })
  const isConstant = version === 'nil' || version === 'max'
  const example = formatted[0] ?? ''
  const outputBytes = useMemo(() => utf8Length(joinUuids(formatted, listMode)), [formatted, listMode])

  const settings = (
    <>
      <SettingsSection title="Version">
        <Segmented
          aria-label="UUID version"
          value={version}
          onValueChange={setVersion}
          className="w-full [&>*]:flex-1 [&>*]:justify-center"
          options={[
            { value: 'v4', label: 'v4' },
            { value: 'v7', label: 'v7' },
            { value: 'nil', label: 'Nil' },
            { value: 'max', label: 'Max' },
          ]}
        />
        <p className="text-xs text-muted">{VERSION_INFO[version]}</p>
      </SettingsSection>

      <SettingsSection title="Quantity">
        <SettingRow label="How many" hint={`1 – ${formatNumber(MAX_UUID_COUNT)}`} htmlFor="uuid-count">
          <NumberInput id="uuid-count" value={count} onChange={setCount} min={1} max={MAX_UUID_COUNT} className="w-24" />
        </SettingRow>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Quick quantities">
          {QUICK_COUNTS.map((n) => (
            <Button key={n} size="xs" variant={count === n ? 'subtle' : 'ghost'} aria-pressed={count === n} className={cn('tabular', count === n && 'text-fg')} onClick={() => setCount(n)}>
              {formatNumber(n)}
            </Button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Format">
        <SettingRow label="Case">
          <Segmented
            aria-label="Letter case"
            value={format.case}
            onValueChange={(c) => patchFormat({ case: c })}
            options={[
              { value: 'lower', label: 'abc' },
              { value: 'upper', label: 'ABC' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Hyphens" htmlFor="uuid-hyphens">
          <Switch id="uuid-hyphens" checked={format.hyphens} onCheckedChange={(hyphens) => patchFormat({ hyphens })} />
        </SettingRow>
        <SettingRow label="Wrap">
          <Segmented
            aria-label="Wrapping"
            value={format.wrap}
            onValueChange={(wrap) => patchFormat({ wrap })}
            options={[
              { value: 'none', label: 'None' },
              { value: 'braces', label: '{ }', tooltip: 'Braces, as in Windows GUIDs' },
              { value: 'urn', label: 'URN', tooltip: 'urn:uuid:… (RFC 9562 §4)' },
            ]}
          />
        </SettingRow>
        <p className="mono truncate rounded-md bg-surface px-2 py-1.5 text-[11.5px] text-muted" title={example}>
          {example}
        </p>
      </SettingsSection>

      <SettingsSection title="Copy all & .txt as">
        <Segmented aria-label="List format" value={listMode} onValueChange={setListMode} className="w-full [&>*]:flex-1 [&>*]:justify-center" options={LIST_MODES} />
        <div className="mono rounded-md bg-surface px-2 py-1.5 text-[11.5px] leading-[18px] text-muted" aria-label="Preview">
          {joinUuids(formatted.slice(0, 2), listMode)
            .split('\n')
            .slice(0, 4)
            .map((line, i) => (
              <div key={i} className="truncate whitespace-pre">
                {line}
              </div>
            ))}
        </div>
      </SettingsSection>
    </>
  )

  const list = (
    <Pane className="min-h-[300px] max-md:h-[380px] max-md:flex-none" aria-label="Generated UUIDs">
      <PaneHeader
        title="Generated"
        meta={`${formatNumber(count)} × ${version === 'v4' || version === 'v7' ? `UUID ${version}` : `${version} UUID`}`}
        actions={<span className="pr-1.5 text-2xs text-subtle">Click a row to copy</span>}
      />
      <ValueList
        values={formatted}
        label="Generated UUIDs"
        meta={version === 'v7' ? (i) => v7Time(generated.values[i]) : undefined}
        actions={(i) => (
          <IconButton label="Inspect" size="icon-xs" icon={<ScanSearch />} onClick={() => setInspectInput(formatted[i])} />
        )}
      />
    </Pane>
  )

  return (
    <>
      <Toolbar>
        <Button size="sm" variant="primary" onClick={regenerate}>
          <RefreshCw /> Regenerate
          <span className="ml-1 hidden items-center gap-0.5 opacity-80 sm:flex">
            <Kbd className="border-white/25 bg-white/10 text-current">{modKey}</Kbd>
            <Kbd className="border-white/25 bg-white/10 text-current">↵</Kbd>
          </span>
        </Button>
        <ToolbarSeparator />
        <CopyButton value={joined} label={`Copy all (${LIST_MODES.find((m) => m.value === listMode)!.label})`} showLabel variant="ghost" />
        <DownloadMenu
          options={[
            { label: `Text — ${LIST_MODES.find((m) => m.value === listMode)!.label.toLowerCase()}`, filename: `uuids-${version}.txt`, mime: 'text/plain;charset=utf-8', getContent: () => joined() + '\n' },
            { label: 'JSON array', filename: `uuids-${version}.json`, mime: 'application/json', getContent: () => joinUuids(formatted, 'json') + '\n' },
            { label: 'CSV (one column)', filename: `uuids-${version}.csv`, mime: 'text/csv', getContent: () => uuidsToCsv(formatted) },
          ]}
        />
        <ToolbarSpacer />
        {isConstant && <span className="shrink-0 text-xs text-subtle">Constant value — every row is identical</span>}
      </Toolbar>

      <SettingsLayout settings={settings} settingsWidth="md:w-[280px] xl:w-[300px]" className="max-md:[&>aside]:order-last max-md:[&>aside]:border-t max-md:[&>div]:min-h-fit">
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {list}
          <div className="flex shrink-0 flex-col border-t border-border lg:w-[360px] lg:border-l lg:border-t-0 xl:w-[420px]">
            <UuidInspector value={inspectInput} onChange={setInspectInput} firstGenerated={formatted[0]} />
          </div>
        </div>
      </SettingsLayout>

      <StatusBar>
        <StatusItem label="Count">{formatNumber(count)}</StatusItem>
        <StatusItem label="Version">{version}</StatusItem>
        {version === 'v7' && <StatusItem label="Order">strictly increasing</StatusItem>}
        <StatusItem label="Generated in">{formatDuration(generated.ms)}</StatusItem>
        <StatusItem label="Copy-all size">{formatBytes(outputBytes)}</StatusItem>
        <StatusSpacer />
        <span className="hidden text-subtle md:inline">{version === 'v4' ? 'crypto.randomUUID()' : version === 'v7' ? 'uuid v7 · crypto.getRandomValues' : 'RFC 9562 constant'}</span>
        <LocalBadge />
      </StatusBar>
    </>
  )
}

