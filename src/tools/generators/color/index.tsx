import { useEffect, useMemo, useState } from 'react'
import { Dices } from 'lucide-react'
import {
  EXPORT_FORMATS,
  exportPalette,
  harmony,
  PALETTE_TYPES,
  parseColor,
  randomPalette,
  tintsAndShades,
  type ExportFormat,
  type PaletteType,
  type RandomSwatch,
  type Swatch,
  type ValueFormat,
} from '@/engines/generators/color'
import { usePersistentState } from '@/hooks/usePersistentState'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { OutputEditorPane } from '@/components/tools/EditorPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { modKey } from '@/utils/platform'
import { LocalBadge } from '../_shared/LocalBadge'
import { useRegenerateShortcut } from '../_shared/useShortcut'
import { SwatchCard } from './SwatchCard'

const VALUE_FORMATS: { value: ValueFormat; label: string }[] = [
  { value: 'hex', label: 'HEX' },
  { value: 'rgb', label: 'RGB' },
  { value: 'hsl', label: 'HSL' },
  { value: 'oklch', label: 'OKLCH' },
]

export default function ColorPalette() {
  const [baseText, setBaseText] = usePersistentState('base', '#3b82f6')
  const [type, setType] = usePersistentState<PaletteType>('type', 'scale')
  const [name, setName] = usePersistentState('name', 'brand')
  const [exportFormat, setExportFormat] = usePersistentState<ExportFormat>('export', 'css')
  const [valueFormat, setValueFormat] = usePersistentState<ValueFormat>('valueFormat', 'hex')
  const [randomSwatches, setRandomSwatches] = usePersistentState<RandomSwatch[]>('random', [])

  const parsed = useMemo(() => parseColor(baseText), [baseText])
  const [lastValid, setLastValid] = useState('#3b82f6')
  useEffect(() => {
    if (parsed.ok) setLastValid(parsed.hex)
  }, [parsed])
  const base = parsed.ok ? parsed.hex : lastValid

  useEffect(() => {
    if (type === 'random' && randomSwatches.length === 0) setRandomSwatches(randomPalette([]))
  }, [type, randomSwatches.length, setRandomSwatches])

  const shuffle = () => setRandomSwatches(randomPalette(randomSwatches))
  useRegenerateShortcut(shuffle, type === 'random')

  const swatches: Swatch[] = useMemo(() => {
    if (type === 'scale') return tintsAndShades(base)
    if (type === 'random') return randomSwatches.map((s, i) => ({ key: String(i + 1), label: `Color ${i + 1}`, hex: s.hex }))
    return harmony(base, type)
  }, [type, base, randomSwatches])

  const exported = useMemo(() => exportPalette(swatches, exportFormat, name, valueFormat), [swatches, exportFormat, name, valueFormat])
  const fmt = EXPORT_FORMATS.find((f) => f.value === exportFormat)!
  const typeMeta = PALETTE_TYPES.find((t) => t.value === type)!
  const lockedCount = randomSwatches.filter((s) => s.locked).length

  const toggleLock = (i: number) => setRandomSwatches(randomSwatches.map((s, j) => (j === i ? { ...s, locked: !s.locked } : s)))

  const palettePane = (
    <Pane aria-label="Palette">
      <PaneHeader title="Palette" meta={typeMeta.description} actions={<span className="pr-1.5 text-2xs text-subtle">Click a swatch to copy</span>} />
      <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
        <div className={type === 'scale' ? 'grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2' : 'grid max-w-[1100px] grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2'}>
          {swatches.map((s, i) => (
            <SwatchCard
              key={s.key}
              swatch={s}
              valueFormat={valueFormat}
              tall={type !== 'scale'}
              locked={type === 'random' ? randomSwatches[i]?.locked : undefined}
              onToggleLock={type === 'random' ? () => toggleLock(i) : undefined}
            />
          ))}
        </div>
        {type !== 'random' && type !== 'scale' && (
          <p className="mt-3 text-xs text-subtle">Hues are rotated in OKLCH so lightness and chroma stay perceptually consistent; colors outside sRGB are gamut-mapped (CSS Color 4).</p>
        )}
        {type === 'scale' && <p className="mt-3 text-xs text-subtle">Generated in OKLCH: lightness follows an even 50–950 curve, chroma tapers at the ends, hue is held constant. Your base color sits exactly at its nearest step.</p>}
        {type === 'random' && <p className="mt-3 text-xs text-subtle">Random harmonious palette from crypto.getRandomValues. Lock swatches to keep them; the first locked color anchors the hue of new ones.</p>}
      </div>
    </Pane>
  )

  const exportPane = (
    <OutputEditorPane
      title="Export"
      value={exported}
      language={fmt.language}
      filename={`${name || 'palette'}.${fmt.ext}`}
      path="color-export"
      footer={false}
      headerExtra={
        <Select aria-label="Export format" value={exportFormat} onValueChange={setExportFormat} options={EXPORT_FORMATS.map(({ value, label }) => ({ value, label }))} className="ml-1" />
      }
    />
  )

  return (
    <>
      <Toolbar>
        {type !== 'random' ? (
          <ToolbarField label="Base">
            <span className="relative flex size-7 shrink-0 overflow-hidden rounded-md border border-border-strong">
              <input type="color" aria-label="Pick base color" value={base} onChange={(e) => setBaseText(e.target.value)} className="absolute -inset-2 size-[calc(100%+16px)] cursor-pointer border-0 bg-transparent p-0" />
            </span>
            <Input aria-label="Base color (any CSS color)" className="mono h-7 w-44 text-[12.5px]" value={baseText} onChange={(e) => setBaseText(e.target.value)} aria-invalid={!parsed.ok} spellCheck={false} />
          </ToolbarField>
        ) : (
          <Button size="sm" variant="primary" onClick={shuffle}>
            <Dices /> Shuffle
            <span className="ml-1 hidden items-center gap-0.5 opacity-80 sm:flex">
              <Kbd className="border-white/25 bg-white/10 text-current">{modKey}</Kbd>
              <Kbd className="border-white/25 bg-white/10 text-current">↵</Kbd>
            </span>
          </Button>
        )}
        <ToolbarSeparator />
        <ToolbarField label="Palette">
          <Select aria-label="Palette type" value={type} onValueChange={setType} options={PALETTE_TYPES} className="w-48" />
        </ToolbarField>
        <ToolbarSeparator />
        <Segmented aria-label="Value format" value={valueFormat} onValueChange={setValueFormat} options={VALUE_FORMATS} />
        <ToolbarSpacer />
        <ToolbarField label="Token name">
          <Input aria-label="Token name" className="mono h-7 w-32 text-[12.5px]" value={name} onChange={(e) => setName(e.target.value)} placeholder="brand" />
        </ToolbarField>
      </Toolbar>
      {type !== 'random' && !parsed.ok && <ErrorDisplay error={`${parsed.error} Showing the last valid color (${lastValid}).`} />}
      {type !== 'random' && parsed.ok && parsed.hadAlpha && <ErrorDisplay severity="warning" error="Transparency is ignored — palettes are generated from the opaque color." />}
      <div className="flex min-h-0 flex-1 flex-col">
        <SplitPane id="color-palette-v" direction="vertical" initial={0.64} min={160} mobileTabs={['Palette', 'Export']}>
          {palettePane}
          {exportPane}
        </SplitPane>
      </div>
      <StatusBar>
        <StatusItem label="Palette">{typeMeta.label}</StatusItem>
        <StatusItem label="Swatches">{swatches.length}</StatusItem>
        {type !== 'random' && (
          <StatusItem label="Base">
            <span className="mono">{base}</span>
          </StatusItem>
        )}
        {type === 'random' && <StatusItem label="Locked">{lockedCount}</StatusItem>}
        <StatusSpacer />
        <span className="hidden text-subtle md:inline">WCAG 2.x contrast · AAA ≥ 7 · AA ≥ 4.5 · Large text ≥ 3</span>
        <LocalBadge />
      </StatusBar>
    </>
  )
}
