import { useMemo, useRef } from 'react'
import { Link2, Link2Off, RotateCcw } from 'lucide-react'
import {
  CORNER_LABELS,
  CORNERS,
  convertRadiusUnit,
  isElliptical,
  RADIUS_PRESETS,
  radiusDeclaration,
  radiusLonghands,
  radiusTailwind,
  radiusValue,
  uniformRadius,
  type Corner,
  type RadiusState,
  type RadiusUnit,
} from '@/engines/css/radius'
import { usePersistentState } from '@/hooks/usePersistentState'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { Segmented } from '@/components/ui/segmented'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Slider } from '@/components/ui/slider'
import { CopyButton } from '@/components/common/CopyButton'
import { cn } from '@/utils/cn'
import { BuilderLayout, CodeOutputPanel, InspectorRow, InspectorSection, PresetMenu } from '../_shared/Builder'
import { NumberField } from '../_shared/NumberField'
import { ColorField } from '../_shared/ColorField'

type Mode = 'simple' | 'elliptical'
interface Box {
  width: number
  height: number
  fill: string
}

const DEFAULT_RADIUS: RadiusState = { unit: 'px', h: { tl: 24, tr: 24, br: 24, bl: 24 }, v: { tl: 24, tr: 24, br: 24, bl: 24 } }
const DEFAULT_BOX: Box = { width: 320, height: 220, fill: '#4f6d8a' }
const REM = 16

const UNIT_MAX: Record<RadiusUnit, number> = { px: 9999, '%': 100, rem: 625 }

export default function BorderRadiusTool() {
  const [r, setR] = usePersistentState<RadiusState>('radius', DEFAULT_RADIUS)
  const [mode, setMode] = usePersistentState<Mode>('mode', 'simple')
  const [linked, setLinked] = usePersistentState('linked', false)
  const [box, setBox] = usePersistentState<Box>('box', DEFAULT_BOX)

  const setCorner = (corner: Corner, axis: 'h' | 'v' | 'both', value: number) => {
    setR((prev) => {
      const targets = linked ? CORNERS : [corner]
      const h = { ...prev.h }
      const v = { ...prev.v }
      for (const k of targets) {
        if (axis !== 'v') h[k] = value
        if (axis !== 'h') v[k] = value
      }
      return { ...prev, h, v }
    })
  }

  const changeMode = (m: Mode) => {
    setMode(m)
    if (m === 'simple') setR((prev) => ({ ...prev, v: { ...prev.h } }))
  }

  const value = useMemo(() => radiusValue(r), [r])
  const decl = useMemo(() => radiusDeclaration(r), [r])
  const elliptical = isElliptical(r)
  const step = r.unit === 'rem' ? 0.125 : 1
  const precision = r.unit === 'rem' ? 3 : 1

  return (
    <>
      <Toolbar>
        <Segmented
          aria-label="Mode"
          value={mode}
          onValueChange={changeMode}
          options={[
            { value: 'simple', label: 'Simple', tooltip: 'One radius per corner' },
            { value: 'elliptical', label: 'Elliptical', tooltip: 'Separate horizontal and vertical radii (8 values)' },
          ]}
        />
        <ToolbarField label="Unit">
          <Segmented
            aria-label="Unit"
            value={r.unit}
            onValueChange={(unit: RadiusUnit) => setR((prev) => convertRadiusUnit(prev, unit, box, REM))}
            options={[
              { value: 'px', label: 'px' },
              { value: '%', label: '%' },
              { value: 'rem', label: 'rem', tooltip: 'Assumes a 16px root font size' },
            ]}
          />
        </ToolbarField>
        <ToolbarSeparator />
        <PresetMenu
          presets={RADIUS_PRESETS.map((p) => ({ name: p.name, value: p.state }))}
          onPick={(state) => {
            setR(state)
            setMode(isElliptical(state) ? 'elliptical' : 'simple')
            setLinked(false)
          }}
          render={(state) => <span className="size-4 border-[1.5px] border-current text-muted" style={{ borderRadius: radiusValue({ ...state, h: scaleSmall(state.h, state.unit), v: scaleSmall(state.v, state.unit) }) }} />}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setR(DEFAULT_RADIUS)
            setMode('simple')
            setBox(DEFAULT_BOX)
          }}
        >
          <RotateCcw /> Reset
        </Button>
        <ToolbarSpacer />
        <CopyButton value={decl} label="Copy CSS" showLabel variant="secondary" />
      </Toolbar>
      <BuilderLayout
        preview={<ShapeEditor r={r} mode={mode} box={box} value={value} onCorner={setCorner} />}
        output={
          <CodeOutputPanel
            outputs={[
              { id: 'css', label: 'CSS', value: decl, hint: 'Shortest equivalent shorthand' },
              { id: 'tailwind', label: 'Tailwind', value: radiusTailwind(r), hint: 'Arbitrary value class' },
              { id: 'longhand', label: 'Longhands', value: radiusLonghands(r) },
            ]}
          />
        }
        inspector={
          <>
            <InspectorSection
              title="Corners"
              action={
                <IconButton
                  label={linked ? 'Unlink corners' : 'Link corners (edit all at once)'}
                  aria-pressed={linked}
                  icon={linked ? <Link2 /> : <Link2Off />}
                  className={cn(linked && 'bg-accent-soft text-accent-text hover:bg-accent-soft')}
                  onClick={() => setLinked(!linked)}
                />
              }
            >
              <div className="grid grid-cols-2 gap-x-2 gap-y-3">
                {(['tl', 'tr', 'bl', 'br'] as Corner[]).map((k) => (
                  <div key={k} className="flex min-w-0 flex-col gap-1">
                    <span className="text-2xs text-subtle">{CORNER_LABELS[k]}</span>
                    {mode === 'simple' ? (
                      <NumberField label={<CornerGlyph corner={k} />} ariaLabel={`${CORNER_LABELS[k]} radius`} value={r.h[k]} min={0} max={UNIT_MAX[r.unit]} step={step} precision={precision} unit={r.unit} onChange={(n) => setCorner(k, 'both', n)} />
                    ) : (
                      <>
                        <NumberField label="H" ariaLabel={`${CORNER_LABELS[k]} horizontal radius`} value={r.h[k]} min={0} max={UNIT_MAX[r.unit]} step={step} precision={precision} unit={r.unit} onChange={(n) => setCorner(k, 'h', n)} />
                        <NumberField label="V" ariaLabel={`${CORNER_LABELS[k]} vertical radius`} value={r.v[k]} min={0} max={UNIT_MAX[r.unit]} step={step} precision={precision} unit={r.unit} onChange={(n) => setCorner(k, 'v', n)} />
                      </>
                    )}
                  </div>
                ))}
              </div>
              <InspectorRow label="All">
                <Slider
                  aria-label="All corners"
                  min={0}
                  max={r.unit === '%' ? 50 : r.unit === 'rem' ? Math.min(box.width, box.height) / 2 / REM : Math.min(box.width, box.height) / 2}
                  step={step}
                  value={[r.h.tl]}
                  onValueChange={([n]) => setR({ ...uniformRadius(n, r.unit) })}
                  className="flex-1"
                />
              </InspectorRow>
              <p className="text-2xs leading-4 text-subtle">
                {mode === 'elliptical' ? 'Drag the 8 handles on the shape: dots on the top/bottom edges set horizontal radii, dots on the sides set vertical radii.' : 'Drag the handles on the shape, or scrub a field label left/right.'}
                {r.unit === '%' && ' Percentages are relative to the box: horizontal radii to its width, vertical radii to its height.'}
              </p>
            </InspectorSection>
            <InspectorSection title="Preview box">
              <InspectorRow label="Size">
                <NumberField label="W" ariaLabel="Box width" value={box.width} min={40} max={800} onChange={(width) => setBox({ ...box, width })} unit="px" className="flex-1" />
                <NumberField label="H" ariaLabel="Box height" value={box.height} min={40} max={800} onChange={(height) => setBox({ ...box, height })} unit="px" className="flex-1" />
              </InspectorRow>
              <InspectorRow label="Fill">
                <ColorField value={box.fill} onChange={(fill) => setBox({ ...box, fill })} label="Shape fill color" className="flex-1" />
              </InspectorRow>
            </InspectorSection>
          </>
        }
      />
      <StatusBar>
        <StatusItem label="Value">{value}</StatusItem>
        <StatusItem label="Shape">{elliptical ? 'elliptical' : 'circular corners'}</StatusItem>
        <StatusSpacer />
        <StatusItem label="Box">
          {box.width}×{box.height}px
        </StatusItem>
      </StatusBar>
    </>
  )
}

/** Shrinks preset radii for the tiny menu glyph (px values would overflow a 16px square). */
function scaleSmall(rec: Record<Corner, number>, unit: RadiusUnit): Record<Corner, number> {
  if (unit === '%') return rec
  const f = unit === 'rem' ? REM / 6 : 1 / 6
  return Object.fromEntries(CORNERS.map((k) => [k, Math.min(8, rec[k] * f)])) as Record<Corner, number>
}

function CornerGlyph({ corner }: { corner: Corner }) {
  const rot = { tl: 0, tr: 90, br: 180, bl: 270 }[corner]
  return (
    <svg viewBox="0 0 12 12" className="size-3" style={{ transform: `rotate(${rot}deg)` }} aria-hidden>
      <path d="M2 11V7a5 5 0 0 1 5-5h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

interface HandleDef {
  key: string
  corner: Corner
  axis: 'h' | 'v' | 'both'
  /** Position in px within the box. */
  x: number
  y: number
  /** Which edge the handle slides along. */
  along: 'x' | 'y'
  /** Distance from the corner grows in this direction. */
  dir: 1 | -1
}

function ShapeEditor({ r, mode, box, value, onCorner }: { r: RadiusState; mode: Mode; box: Box; value: string; onCorner: (c: Corner, axis: 'h' | 'v' | 'both', v: number) => void }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const { width: W, height: H } = box
  const toPx = (n: number, axis: 'h' | 'v') => (r.unit === 'px' ? n : r.unit === 'rem' ? n * REM : (n / 100) * (axis === 'h' ? W : H))
  const fromPx = (px: number, axis: 'h' | 'v') => {
    const raw = r.unit === 'px' ? px : r.unit === 'rem' ? px / REM : (px / (axis === 'h' ? W : H)) * 100
    return r.unit === 'rem' ? Math.round(raw * 8) / 8 : Math.round(raw)
  }
  // CSS scales all radii down by one factor when adjacent radii overlap.
  const hp = Object.fromEntries(CORNERS.map((k) => [k, toPx(r.h[k], 'h')])) as Record<Corner, number>
  const vp = Object.fromEntries(CORNERS.map((k) => [k, toPx(r.v[k], 'v')])) as Record<Corner, number>
  const f = Math.min(1, W / Math.max(1e-9, hp.tl + hp.tr), W / Math.max(1e-9, hp.bl + hp.br), H / Math.max(1e-9, vp.tl + vp.bl), H / Math.max(1e-9, vp.tr + vp.br))

  const handles: HandleDef[] =
    mode === 'simple'
      ? [
          { key: 'tl', corner: 'tl', axis: 'both', x: hp.tl * f, y: 0, along: 'x', dir: 1 },
          { key: 'tr', corner: 'tr', axis: 'both', x: W - hp.tr * f, y: 0, along: 'x', dir: -1 },
          { key: 'br', corner: 'br', axis: 'both', x: W - hp.br * f, y: H, along: 'x', dir: -1 },
          { key: 'bl', corner: 'bl', axis: 'both', x: hp.bl * f, y: H, along: 'x', dir: 1 },
        ]
      : [
          { key: 'tl-h', corner: 'tl', axis: 'h', x: hp.tl * f, y: 0, along: 'x', dir: 1 },
          { key: 'tr-h', corner: 'tr', axis: 'h', x: W - hp.tr * f, y: 0, along: 'x', dir: -1 },
          { key: 'br-h', corner: 'br', axis: 'h', x: W - hp.br * f, y: H, along: 'x', dir: -1 },
          { key: 'bl-h', corner: 'bl', axis: 'h', x: hp.bl * f, y: H, along: 'x', dir: 1 },
          { key: 'tl-v', corner: 'tl', axis: 'v', x: 0, y: vp.tl * f, along: 'y', dir: 1 },
          { key: 'bl-v', corner: 'bl', axis: 'v', x: 0, y: H - vp.bl * f, along: 'y', dir: -1 },
          { key: 'tr-v', corner: 'tr', axis: 'v', x: W, y: vp.tr * f, along: 'y', dir: 1 },
          { key: 'br-v', corner: 'br', axis: 'v', x: W, y: H - vp.br * f, along: 'y', dir: -1 },
        ]

  const drag = (h: HandleDef, e: React.PointerEvent) => {
    const rect = boxRef.current!.getBoundingClientRect()
    const scale = rect.width / W
    const local = h.along === 'x' ? (e.clientX - rect.left) / scale : (e.clientY - rect.top) / scale
    const len = h.along === 'x' ? W : H
    const dist = Math.min(len, Math.max(0, h.dir === 1 ? local : len - local))
    onCorner(h.corner, h.axis, fromPx(dist, h.axis === 'v' ? 'v' : 'h'))
  }

  const current = (h: HandleDef) => (h.axis === 'v' ? r.v[h.corner] : r.h[h.corner])

  return (
    <div className="flex flex-1 items-center justify-center overflow-auto p-10" style={{ background: 'var(--surface)' }}>
      <div className="relative shrink-0" style={{ width: W, maxWidth: '100%', aspectRatio: `${W} / ${H}` }}>
        <div ref={boxRef} className="absolute inset-0 rounded-none outline outline-1 outline-dashed outline-border-strong" />
        <div className="absolute inset-0" style={{ borderRadius: value, background: box.fill }} role="img" aria-label={`Shape with border-radius ${value}`} />
        {handles.map((h) => (
          <button
            key={h.key}
            type="button"
            aria-label={`${CORNER_LABELS[h.corner]} ${h.axis === 'both' ? '' : h.axis === 'h' ? 'horizontal ' : 'vertical '}radius: ${current(h)}${r.unit}. Arrow keys adjust.`}
            className={cn(
              'absolute z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-[0_0_0_1px_rgb(0_0_0/0.35),0_1px_3px_rgb(0_0_0/0.35)] outline-none focus-visible:ring-4 focus-visible:ring-accent-soft',
              h.along === 'x' ? 'cursor-ew-resize' : 'cursor-ns-resize',
              h.axis === 'v' ? 'border-accent bg-white' : 'border-white bg-accent',
            )}
            style={{ left: `${(h.x / W) * 100}%`, top: `${(h.y / H) * 100}%` }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              e.currentTarget.focus()
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) drag(h, e)
            }}
            onKeyDown={(e) => {
              const inc = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
              if (!inc) return
              e.preventDefault()
              const stepSize = (r.unit === 'rem' ? 0.125 : 1) * (e.shiftKey ? 10 : 1)
              // Moving away from the corner increases the radius.
              const delta = inc * h.dir * stepSize
              onCorner(h.corner, h.axis, Math.max(0, Number((current(h) + delta).toFixed(3))))
            }}
          />
        ))}
        {f < 0.999 && (
          <p className="absolute -bottom-7 left-0 right-0 text-center text-2xs text-subtle">Radii overlap — browsers scale them all down by {Math.round((1 - f) * 100)}%.</p>
        )}
      </div>
    </div>
  )
}
