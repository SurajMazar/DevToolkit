import { useMemo, useRef, useState } from 'react'
import { Plus, RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import {
  colorAt,
  GRADIENT_PRESETS,
  gradientDeclarations,
  gradientTailwind,
  gradientToCss,
  INTERPOLATION_SPACES,
  POLAR_SPACES,
  presetToGradient,
  sortStops,
  validateGradient,
  type Gradient,
  type GradientStop,
  type HueMethod,
  type InterpolationSpace,
  type RadialShape,
  type RadialSize,
} from '@/engines/css/gradient'
import { usePersistentState } from '@/hooks/usePersistentState'
import { Toolbar, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { Segmented } from '@/components/ui/segmented'
import { Checkbox } from '@/components/ui/checkbox'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { CopyButton } from '@/components/common/CopyButton'
import { formatBytes } from '@/utils/format'
import { cn } from '@/utils/cn'
import { AngleDial, BuilderLayout, CodeOutputPanel, InspectorRow, InspectorSection, PresetMenu } from '../_shared/Builder'
import { NumberField } from '../_shared/NumberField'
import { ColorField } from '../_shared/ColorField'
import { CHECKER, CHECKER_LG } from '../_shared/checker'

const newId = () => crypto.randomUUID().slice(0, 8)

const DEFAULT: Gradient = presetToGradient(GRADIENT_PRESETS[2], () => newId())

const SIZES: { value: RadialSize; label: string }[] = [
  { value: 'farthest-corner', label: 'Farthest corner' },
  { value: 'farthest-side', label: 'Farthest side' },
  { value: 'closest-corner', label: 'Closest corner' },
  { value: 'closest-side', label: 'Closest side' },
]

const HUES: { value: HueMethod; label: string; description: string }[] = [
  { value: 'shorter', label: 'Shorter hue', description: 'Default — the short way round' },
  { value: 'longer', label: 'Longer hue', description: 'The long way round the wheel' },
  { value: 'increasing', label: 'Increasing hue', description: 'Always clockwise' },
  { value: 'decreasing', label: 'Decreasing hue', description: 'Always counter-clockwise' },
]

function supports(value: string): boolean {
  try {
    return typeof CSS !== 'undefined' && CSS.supports('background-image', value)
  } catch {
    return false
  }
}

/** CSS the current browser can render (drops the interpolation clause if unsupported). */
function renderable(g: Gradient): string {
  const css = gradientToCss(g)
  return supports(css) ? css : gradientToCss(g, { withInterpolation: false })
}

export default function GradientTool() {
  const [g, setG] = usePersistentState<Gradient>('gradient', DEFAULT)
  const [selected, setSelected] = useState<string | null>(null)
  const update = (patch: Partial<Gradient>) => setG((prev) => ({ ...prev, ...patch }))
  const setStop = (id: string, patch: Partial<GradientStop>) => setG((prev) => ({ ...prev, stops: prev.stops.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  const removeStop = (id: string) => setG((prev) => (prev.stops.length <= 2 ? prev : { ...prev, stops: prev.stops.filter((s) => s.id !== id) }))
  const addStop = (position: number) => {
    const id = newId()
    setG((prev) => ({ ...prev, stops: [...prev.stops, { id, color: colorAt(prev.stops, position), position: Math.round(position) }] }))
    setSelected(id)
  }

  const css = useMemo(() => gradientToCss(g), [g])
  const fallbackCss = useMemo(() => gradientToCss(g, { withInterpolation: false }), [g])
  const declarations = useMemo(() => gradientDeclarations(g), [g])
  const tailwind = useMemo(() => gradientTailwind(g), [g])
  const issues = validateGradient(g)
  const modernSupported = useMemo(() => supports(css), [css])
  const renderCss = modernSupported ? css : fallbackCss
  const sorted = sortStops(g.stops)
  const isPolar = POLAR_SPACES.has(g.interpolation)

  // Bar shows the stops left→right with the same interpolation.
  const barRender = useMemo(() => renderable({ ...g, type: 'linear', repeating: false, angle: 90 }), [g])

  return (
    <>
      <Toolbar>
        <Segmented
          aria-label="Gradient type"
          value={g.type}
          onValueChange={(type) => update({ type })}
          options={[
            { value: 'linear', label: 'Linear' },
            { value: 'radial', label: 'Radial' },
            { value: 'conic', label: 'Conic' },
          ]}
        />
        <Checkbox checked={g.repeating} onCheckedChange={(v) => update({ repeating: v === true })} label="Repeating" />
        <ToolbarSeparator />
        <PresetMenu
          presets={GRADIENT_PRESETS.map((p) => ({ name: p.name, value: p }))}
          onPick={(p) => {
            setG(presetToGradient(p, () => newId()))
            setSelected(null)
          }}
          render={(p) => <span className="size-5 rounded-[4px] border border-border" style={{ background: renderable(presetToGradient(p, String)) }} />}
        />
        <Button size="sm" variant="ghost" onClick={() => setG(presetToGradient(GRADIENT_PRESETS[2], () => newId()))}>
          <RotateCcw /> Reset
        </Button>
        <ToolbarSpacer />
        <CopyButton value={declarations} label="Copy CSS" showLabel variant="secondary" />
      </Toolbar>
      <BuilderLayout
        preview={
          <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
            <PreviewCanvas g={g} css={renderCss} onMove={(x, y) => update({ x, y })} />
            <StopsBar
              stops={g.stops}
              background={barRender}
              selected={selected}
              onSelect={setSelected}
              onMove={(id, position) => setStop(id, { position })}
              onAdd={addStop}
              onRemove={removeStop}
            />
          </div>
        }
        output={
          <CodeOutputPanel
            persistKey="outputTab"
            outputs={[
              { id: 'css', label: 'CSS', value: declarations, hint: g.interpolation !== 'default' ? 'First line is an sRGB fallback for older browsers' : undefined },
              { id: 'tailwind', label: 'Tailwind', value: tailwind, hint: 'Arbitrary value class' },
              { id: 'value', label: 'Value', value: css, hint: 'For background-image, mask-image, border-image…' },
            ]}
          />
        }
        inspector={
          <>
            <InspectorSection title={g.type === 'linear' ? 'Direction' : g.type === 'radial' ? 'Shape' : 'Rotation & center'}>
              {(g.type === 'linear' || g.type === 'conic') && (
                <InspectorRow label={g.type === 'linear' ? 'Angle' : 'From'}>
                  <AngleDial value={g.angle} onChange={(angle) => update({ angle })} label={g.type === 'linear' ? 'Gradient angle' : 'Conic start angle'} />
                  <NumberField label={<RotateCw className="size-3.5" />} ariaLabel="Angle in degrees" value={g.angle} onChange={(angle) => update({ angle })} min={-360} max={360} unit="deg" className="flex-1" />
                </InspectorRow>
              )}
              {g.type === 'linear' && (
                <div className="grid grid-cols-8 gap-0.5">
                  {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => update({ angle: a })}
                      className={cn('tabular h-6 rounded-sm text-2xs text-muted hover:bg-surface-2 hover:text-fg', g.angle === a && 'bg-accent-soft text-accent-text')}
                      aria-label={`Set angle to ${a} degrees`}
                    >
                      {a}°
                    </button>
                  ))}
                </div>
              )}
              {g.type === 'radial' && (
                <>
                  <InspectorRow label="Shape">
                    <Segmented
                      aria-label="Radial shape"
                      value={g.shape}
                      onValueChange={(shape: RadialShape) => update({ shape })}
                      options={[
                        { value: 'ellipse', label: 'Ellipse' },
                        { value: 'circle', label: 'Circle' },
                      ]}
                      className="w-full [&>*]:flex-1 [&>*]:justify-center"
                    />
                  </InspectorRow>
                  <InspectorRow label="Size">
                    <Select aria-label="Radial size" value={g.size} onValueChange={(size) => update({ size })} options={SIZES} className="w-full" />
                  </InspectorRow>
                </>
              )}
              {g.type !== 'linear' && (
                <InspectorRow label="Center">
                  <NumberField label="X" ariaLabel="Center X" value={g.x} onChange={(x) => update({ x })} unit="%" className="flex-1" />
                  <NumberField label="Y" ariaLabel="Center Y" value={g.y} onChange={(y) => update({ y })} unit="%" className="flex-1" />
                </InspectorRow>
              )}
              {g.type !== 'linear' && <p className="text-2xs text-subtle">Drag the center handle on the preview to move it.</p>}
            </InspectorSection>

            <InspectorSection title="Color interpolation">
              <InspectorRow label="Space">
                <Select aria-label="Interpolation color space" value={g.interpolation} onValueChange={(interpolation: InterpolationSpace) => update({ interpolation })} options={INTERPOLATION_SPACES} className="w-full" />
              </InspectorRow>
              {isPolar && (
                <InspectorRow label="Hue">
                  <Select aria-label="Hue interpolation method" value={g.hue} onValueChange={(hue: HueMethod) => update({ hue })} options={HUES} className="w-full" />
                </InspectorRow>
              )}
              {g.interpolation !== 'default' && (
                <p className="text-2xs leading-4 text-subtle">
                  <code className="mono">in {g.interpolation}</code> needs Chrome 111+, Safari 16.2+ or Firefox 127+. The CSS includes a plain fallback line first.
                  {!modernSupported && <span className="text-warn"> This browser doesn't support it — the preview shows the fallback.</span>}
                </p>
              )}
            </InspectorSection>

            <InspectorSection
              title={`Stops · ${g.stops.length}`}
              action={
                <Button size="xs" variant="ghost" onClick={() => addStop(nextGapPosition(g.stops))}>
                  <Plus /> Add stop
                </Button>
              }
            >
              <ul className="flex flex-col gap-1" aria-label="Color stops">
                {sorted.map((s, i) => (
                  <li
                    key={s.id}
                    onFocusCapture={() => setSelected(s.id)}
                    onClick={() => setSelected(s.id)}
                    className={cn('-mx-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1', selected === s.id && 'bg-accent-soft')}
                  >
                    <ColorField value={s.color} onChange={(color) => setStop(s.id, { color })} label={`Stop ${i + 1} color`} className="flex-1" />
                    <NumberField label="@" ariaLabel={`Stop ${i + 1} position`} value={s.position} onChange={(position) => setStop(s.id, { position })} min={-100} max={200} unit="%" precision={1} className="w-[84px]" />
                    <IconButton label={`Remove stop ${i + 1}`} icon={<Trash2 />} size="icon-xs" disabled={g.stops.length <= 2} onClick={() => removeStop(s.id)} />
                  </li>
                ))}
              </ul>
              <p className="text-2xs text-subtle">Click the bar to add a stop · drag handles to move · Delete removes the focused handle. Colors accept any CSS syntax (hex, rgb, hsl, oklch, named…).</p>
            </InspectorSection>
          </>
        }
      />
      <StatusBar>
        <StatusItem label="Type">
          {g.repeating ? 'repeating ' : ''}
          {g.type}
        </StatusItem>
        <StatusItem label="Stops">{g.stops.length}</StatusItem>
        <StatusItem label="Interpolation">{g.interpolation === 'default' ? 'default' : g.interpolation}</StatusItem>
        <StatusItem label="CSS">{formatBytes(new TextEncoder().encode(declarations).length)}</StatusItem>
        <StatusSpacer />
        {issues.length > 0 ? <StatusItem tone="danger">{issues[0].message}</StatusItem> : !modernSupported && <StatusItem tone="mod">Preview uses sRGB fallback</StatusItem>}
      </StatusBar>
    </>
  )
}

/** Position in the middle of the widest gap between stops. */
function nextGapPosition(stops: GradientStop[]): number {
  const s = sortStops(stops).map((x) => Math.min(100, Math.max(0, x.position)))
  const pts = [0, ...s, 100]
  let best = 50
  let gap = -1
  for (let i = 0; i < pts.length - 1; i++) {
    if (pts[i + 1] - pts[i] > gap) {
      gap = pts[i + 1] - pts[i]
      best = (pts[i] + pts[i + 1]) / 2
    }
  }
  return Math.round(best)
}

function PreviewCanvas({ g, css, onMove }: { g: Gradient; css: string; onMove: (x: number, y: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const move = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const snap = (n: number) => Math.round(Math.min(100, Math.max(0, n)))
    onMove(snap(((e.clientX - r.left) / r.width) * 100), snap(((e.clientY - r.top) / r.height) * 100))
  }
  return (
    <div className="relative min-h-[200px] flex-1 overflow-hidden rounded-lg border border-border" style={{ background: CHECKER_LG }}>
      <div ref={ref} className="absolute inset-0" style={{ background: css }} role="img" aria-label="Gradient preview" />
      {g.type !== 'linear' && (
        <button
          type="button"
          aria-label={`Gradient center at ${g.x}% ${g.y}% — drag or use arrow keys`}
          className="absolute size-4 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-white bg-black/30 shadow-[0_0_0_1px_rgb(0_0_0/0.4),0_1px_3px_rgb(0_0_0/0.4)] outline-none focus-visible:ring-4 focus-visible:ring-accent-soft"
          style={{ left: `${g.x}%`, top: `${g.y}%` }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e)
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 10 : 1
            const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
            if (!d) return
            e.preventDefault()
            onMove(Math.min(100, Math.max(0, g.x + d[0])), Math.min(100, Math.max(0, g.y + d[1])))
          }}
        />
      )}
    </div>
  )
}

function StopsBar({
  stops,
  background,
  selected,
  onSelect,
  onMove,
  onAdd,
  onRemove,
}: {
  stops: GradientStop[]
  background: string
  selected: string | null
  onSelect: (id: string) => void
  onMove: (id: string, pos: number) => void
  onAdd: (pos: number) => void
  onRemove: (id: string) => void
}) {
  const bar = useRef<HTMLDivElement>(null)
  const posFrom = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect()
    return Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100))
  }
  return (
    <div className="shrink-0 pb-1">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="eyebrow">Stops</span>
        <span className="text-2xs text-subtle">Click the bar to add a stop</span>
      </div>
      <div className="relative mx-2">
        <div
          ref={bar}
          className="h-7 cursor-copy overflow-hidden rounded-md border border-border-strong"
          style={{ background: CHECKER }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.bar) onAdd(posFrom(e.clientX))
          }}
          title="Click to add a stop"
        >
          <div data-bar="1" className="size-full" style={{ background }} />
        </div>
        <div className="relative h-5">
          {stops.map((s, i) => {
            const left = Math.min(100, Math.max(0, s.position))
            return (
              <button
                key={s.id}
                type="button"
                aria-label={`Stop ${i + 1}: ${s.color} at ${s.position}%. Arrow keys move, Delete removes.`}
                className={cn(
                  'absolute top-1 size-4 -translate-x-1/2 cursor-ew-resize rounded-[4px] border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35),0_1px_2px_rgb(0_0_0/0.3)] outline-none',
                  selected === s.id && 'ring-2 ring-accent ring-offset-1 ring-offset-workspace',
                )}
                style={{ left: `${left}%`, background: s.color }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  e.currentTarget.focus()
                  onSelect(s.id)
                }}
                onPointerMove={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) onMove(s.id, Math.round(posFrom(e.clientX)))
                }}
                onFocus={() => onSelect(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault()
                    onRemove(s.id)
                  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault()
                    const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowLeft' ? -1 : 1)
                    onMove(s.id, Math.min(100, Math.max(0, s.position + step)))
                  }
                }}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
