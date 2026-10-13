import { useMemo, useRef } from 'react'
import { ChevronDown, Pipette } from 'lucide-react'
import { formatHex, type Color } from 'culori'
import { analyzeColor, parseColor, toPickerHex, withAlpha } from '@/engines/color/convert'
import { contrast, formatRatio } from '@/engines/color/contrast'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { Toolbar, ToolbarSpacer } from '@/components/tools/Toolbar'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { KeyValueTable } from '@/components/tools/SettingsLayout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { CopyButton } from '@/components/common/CopyButton'
import { cn } from '@/utils/cn'
import { CHECKER_LG, CHECKER } from '../_shared/checker'

const EXAMPLES = [
  { label: 'Teal (hex)', value: '#0f766e' },
  { label: 'Translucent RGB', value: 'rgb(59 130 246 / 0.6)' },
  { label: 'HSL', value: 'hsl(28 85% 56%)' },
  { label: 'OKLCH', value: 'oklch(70% 0.14 160)' },
  { label: 'Wide gamut (P3)', value: 'color(display-p3 0.1 0.85 0.35)' },
  { label: 'Named', value: 'rebeccapurple' },
  { label: 'Short hex + alpha', value: '#f80c' },
]

export default function ColorConverter() {
  const [input, setInput] = usePersistentState('input', '#0f766e')
  const lastValid = useRef<Color | null>(null)
  useIncomingInput(setInput)

  const parsed = useMemo(() => parseColor(input), [input])
  if (parsed.ok) lastValid.current = parsed.color
  const color = parsed.ok ? parsed.color : lastValid.current
  const analysis = useMemo(() => (color ? analyzeColor(color) : null), [color])
  const pickerHex = color ? toPickerHex(color) : '#000000'
  const css = color && analysis ? (analysis.inSrgb ? (analysis.alpha < 1 ? analysis.formats.find((f) => f.id === 'rgb')!.value : formatHex(analysis.srgb)) : input.trim()) : 'transparent'

  return (
    <>
      <Toolbar>
        <div
          className={cn(
            'flex h-8 w-[460px] min-w-[220px] max-w-full shrink items-center gap-2 rounded-md border border-border bg-workspace pl-1 transition-[border-color,box-shadow] duration-120 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft',
            !parsed.ok && input.trim() !== '' && 'border-danger focus-within:border-danger focus-within:ring-danger-soft',
          )}
        >
          <label className="relative size-6 shrink-0 cursor-pointer overflow-hidden rounded-[4px] border border-border-strong" style={{ background: CHECKER }} title="Open color picker">
            <span className="absolute inset-0" style={{ background: css }} />
            <input
              type="color"
              aria-label="Pick a color"
              value={pickerHex}
              onChange={(e) => setInput(withAlpha(e.target.value, analysis?.alpha ?? 1))}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
          </label>
          <input
            aria-label="Color"
            aria-invalid={!parsed.ok && input.trim() !== ''}
            spellCheck={false}
            autoComplete="off"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="#0f766e, rgb(…), hsl(…), oklch(…), color(display-p3 …), rebeccapurple"
            className="mono h-full min-w-0 flex-1 bg-transparent pr-2 text-[13px] text-fg outline-none placeholder:text-subtle"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost">
              Examples <ChevronDown className="-mr-1 text-subtle" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Try a syntax</DropdownMenuLabel>
            {EXAMPLES.map((ex) => (
              <DropdownMenuItem key={ex.value} onSelect={() => setInput(ex.value)}>
                <span className="relative size-3.5 shrink-0 overflow-hidden rounded-[3px] border border-border-strong" style={{ background: CHECKER }}>
                  <span className="absolute inset-0" style={{ background: ex.value }} />
                </span>
                <span className="flex-1">{ex.label}</span>
                <span className="mono max-w-28 truncate text-2xs text-subtle">{ex.value}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <ToolbarSpacer />
      </Toolbar>
      {!parsed.ok && input.trim() !== '' && (
        <ErrorDisplay error={parsed.error} action={lastValid.current ? <span className="shrink-0 text-xs text-muted">Showing the last valid color</span> : undefined} />
      )}
      {analysis && !analysis.inSrgb && (
        <ErrorDisplay
          severity="warning"
          title="Outside sRGB"
          error={`This color is ${analysis.inP3 ? 'inside Display P3 but' : 'even outside Display P3 and'} cannot be shown exactly on sRGB screens. HEX, RGB, HSL, HSV, HWB and CMYK show the nearest sRGB color (gamut-mapped in OKLCH); LAB, LCH, OKLAB and OKLCH are exact.`}
        />
      )}
      {!analysis ? (
        <div className="flex flex-1 items-center justify-center bg-workspace p-6 text-center">
          <div className="max-w-sm">
            <div className="mx-auto mb-3 flex size-9 items-center justify-center rounded-lg border border-border bg-surface text-subtle">
              <Pipette className="size-[18px]" />
            </div>
            <p className="text-sm font-medium">Enter a color to convert it</p>
            <p className="mt-1 text-sm text-muted">Any CSS color works — hex, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch(), color() or a name — or use the picker.</p>
          </div>
        </div>
      ) : (
        <div className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto bg-workspace md:flex-row md:overflow-hidden', !parsed.ok && 'opacity-60')}>
          <aside aria-label="Preview" className="flex shrink-0 flex-col gap-4 border-b border-border p-4 md:w-[340px] md:overflow-y-auto md:border-b-0 md:border-r lg:w-[380px]">
            <div className="overflow-hidden rounded-lg border border-border" style={{ background: CHECKER_LG }}>
              <div className="grid h-44 grid-cols-2">
                <div style={{ background: css }} className="flex items-end p-2">
                  <span className="rounded-sm bg-black/45 px-1.5 py-0.5 text-2xs text-white">{analysis.alpha < 1 ? `${Math.round(analysis.alpha * 100)}% alpha` : 'Color'}</span>
                </div>
                <div style={{ background: formatHex(analysis.srgb) }} className="flex items-end justify-end p-2">
                  <span className="rounded-sm bg-black/45 px-1.5 py-0.5 text-2xs text-white">{analysis.inSrgb ? 'Opaque' : 'sRGB mapped'}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(['#ffffff', '#000000'] as const).map((bg) => {
                const ratio = contrast(color!, { mode: 'rgb', r: bg === '#ffffff' ? 1 : 0, g: bg === '#ffffff' ? 1 : 0, b: bg === '#ffffff' ? 1 : 0 }).ratio
                return (
                  <div key={bg} className="flex items-center justify-between rounded-md border border-border px-3 py-2" style={{ background: bg }}>
                    <span className="text-lg font-semibold" style={{ color: css }}>
                      Aa
                    </span>
                    <span className="tabular rounded-sm px-1 text-2xs" style={{ color: bg === '#ffffff' ? '#3b3b3b' : '#d4d4d4' }}>
                      {formatRatio(ratio)}:1 on {bg === '#ffffff' ? 'white' : 'black'}
                    </span>
                  </div>
                )
              })}
            </div>
            <dl className="flex flex-col gap-2.5 text-sm">
              <InfoRow label="Nearest name">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-3.5 shrink-0 rounded-[3px] border border-border-strong" style={{ background: analysis.nearestNamed.hex }} />
                  <span className="mono truncate">{analysis.nearestNamed.name}</span>
                  {analysis.nearestNamed.deltaE < 0.01 ? (
                    <Badge tone="ok">exact</Badge>
                  ) : (
                    <Badge tone={analysis.nearestNamed.deltaE < 2.3 ? 'ok' : analysis.nearestNamed.deltaE < 10 ? 'neutral' : 'warn'} title="CIEDE2000 color difference. Below ~2.3 is barely noticeable.">
                      ΔE₀₀ {analysis.nearestNamed.deltaE.toFixed(2)}
                    </Badge>
                  )}
                  <CopyButton value={analysis.nearestNamed.name} label="Copy color name" size="icon-xs" />
                </span>
              </InfoRow>
              <InfoRow label="Gamut">
                {analysis.inSrgb ? <Badge tone="ok">sRGB</Badge> : analysis.inP3 ? <Badge tone="warn">Display P3 only</Badge> : <Badge tone="danger">Outside P3</Badge>}
              </InfoRow>
              <InfoRow label="Luminance">
                <span className="tabular mono">{analysis.luminance.toFixed(4)}</span>
                <span className="ml-1.5 text-2xs text-subtle">WCAG relative luminance</span>
              </InfoRow>
              <InfoRow label="Alpha">
                <span className="tabular mono">{Number(analysis.alpha.toFixed(3))}</span>
              </InfoRow>
            </dl>
          </aside>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <h2 className="eyebrow mb-2">Formats</h2>
            <KeyValueTable
              rows={analysis.formats.map((f) => ({
                key: f.label,
                hint: f.note ?? (f.mapped ? 'Gamut-mapped to sRGB' : undefined),
                value: f.value,
                tone: f.mapped ? 'warn' : undefined,
                action: <CopyButton value={f.value} label={`Copy ${f.label}`} size="icon-xs" />,
              }))}
            />
            <p className="mt-3 text-2xs leading-4 text-subtle">
              HSV/HSB and CMYK are not CSS syntax. CMYK here is a naive device-independent formula (K = 1 − max(R,G,B)) — real print colors depend on the press, paper and ICC profile.
            </p>
          </div>
        </div>
      )}
      <StatusBar>
        <StatusItem label="Input">{parsed.ok ? (parsed.color.mode === 'rgb' ? 'sRGB' : parsed.color.mode) : input.trim() ? 'invalid' : '—'}</StatusItem>
        {analysis && <StatusItem label="HEX">{formatHex(analysis.srgb)}</StatusItem>}
        {analysis && <StatusItem label="Gamut">{analysis.inSrgb ? 'sRGB' : analysis.inP3 ? 'P3' : 'wider than P3'}</StatusItem>}
        <StatusSpacer />
        {!parsed.ok && input.trim() && <StatusItem tone="danger">Invalid color</StatusItem>}
      </StatusBar>
    </>
  )
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-6 items-center gap-3">
      <dt className="w-24 shrink-0 text-xs text-muted">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center">{children}</dd>
    </div>
  )
}
