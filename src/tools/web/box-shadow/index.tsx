import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ClipboardPaste, Copy, Eye, EyeOff, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatHex, parse } from 'culori'
import { layerToCss, parseBoxShadow, shadowColor, SHADOW_PRESETS, shadowDeclaration, shadowTailwind, shadowValue, type ShadowLayer, type ShadowLayerInput } from '@/engines/css/shadow'
import { usePersistentState } from '@/hooks/usePersistentState'
import { Toolbar, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CopyButton } from '@/components/common/CopyButton'
import { formatBytes } from '@/utils/format'
import { cn } from '@/utils/cn'
import { BuilderLayout, CodeOutputPanel, InspectorRow, InspectorSection, PresetMenu } from '../_shared/Builder'
import { NumberField } from '../_shared/NumberField'
import { ColorField } from '../_shared/ColorField'
import { CHECKER } from '../_shared/checker'

const newId = () => crypto.randomUUID().slice(0, 8)
const toLayers = (inputs: ShadowLayerInput[]): ShadowLayer[] => inputs.map((l) => ({ ...l, id: newId(), visible: true }))
const presetLayers = (name: string) => {
  const p = SHADOW_PRESETS.find((x) => x.name === name)!
  const r = parseBoxShadow(p.value)
  return r.ok ? toLayers(r.layers) : []
}

interface Stage {
  canvas: string
  element: string
  width: number
  height: number
  radius: number
}

const DEFAULT_STAGE: Stage = { canvas: '#f1f2f4', element: '#ffffff', width: 240, height: 160, radius: 12 }

export default function BoxShadowTool() {
  const [layers, setLayers] = usePersistentState<ShadowLayer[]>('layers', () => presetLayers('Large elevation'))
  const [stage, setStage] = usePersistentState<Stage>('stage', DEFAULT_STAGE)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = layers.find((l) => l.id === selectedId) ?? layers[0]

  const patch = (id: string, p: Partial<ShadowLayer>) => setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)))
  const add = () => {
    const l: ShadowLayer = { id: newId(), x: 0, y: 4, blur: 12, spread: 0, color: '#0f172a', alpha: 0.12, inset: false, visible: true }
    setLayers((ls) => [...ls, l])
    setSelectedId(l.id)
  }
  const duplicate = (id: string) => {
    const copy = { ...layers.find((l) => l.id === id)!, id: newId() }
    setLayers((ls) => {
      const i = ls.findIndex((l) => l.id === id)
      return [...ls.slice(0, i + 1), copy, ...ls.slice(i + 1)]
    })
    setSelectedId(copy.id)
  }
  const remove = (id: string) => {
    setLayers((ls) => ls.filter((l) => l.id !== id))
    if (selectedId === id) setSelectedId(null)
  }
  const move = (id: string, dir: -1 | 1) =>
    setLayers((ls) => {
      const i = ls.findIndex((l) => l.id === id)
      const j = i + dir
      if (j < 0 || j >= ls.length) return ls
      const next = [...ls]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const value = useMemo(() => shadowValue(layers), [layers])
  const css = useMemo(() => shadowDeclaration(layers), [layers])
  const tw = useMemo(() => shadowTailwind(layers), [layers])
  const visibleCount = layers.filter((l) => l.visible).length

  return (
    <>
      <Toolbar>
        <PresetMenu
          presets={SHADOW_PRESETS.map((p) => ({ name: p.name, value: p.value }))}
          onPick={(_, name) => {
            setLayers(presetLayers(name))
            setSelectedId(null)
          }}
          render={(v) => <span className="size-3.5 rounded-[3px] bg-white" style={{ boxShadow: v }} />}
        />
        <ImportPopover
          onImport={(ls) => {
            setLayers(toLayers(ls))
            setSelectedId(null)
          }}
        />
        <Button size="sm" variant="ghost" onClick={() => setStage(DEFAULT_STAGE)}>
          <RotateCcw /> Reset stage
        </Button>
        <ToolbarSeparator />
        <Button size="sm" variant="ghost" onClick={add}>
          <Plus /> Add layer
        </Button>
        <ToolbarSpacer />
        <CopyButton value={css} label="Copy CSS" showLabel variant="secondary" />
      </Toolbar>
      <BuilderLayout
        preview={
          <div className="flex flex-1 items-center justify-center overflow-hidden p-10" style={{ background: stage.canvas }} role="img" aria-label="Box shadow preview">
            <div
              style={{ width: stage.width, height: stage.height, borderRadius: stage.radius, background: stage.element, boxShadow: value === 'none' ? undefined : value, maxWidth: '100%' }}
              className="shrink-0 transition-[box-shadow] duration-75"
            />
          </div>
        }
        output={
          <CodeOutputPanel
            outputs={[
              { id: 'css', label: 'CSS', value: css },
              { id: 'tailwind', label: 'Tailwind', value: tw, hint: 'Arbitrary value class' },
              { id: 'value', label: 'Value', value },
            ]}
          />
        }
        inspector={
          <>
            <InspectorSection
              title={`Layers · ${layers.length}`}
              action={
                <Button size="xs" variant="ghost" onClick={add}>
                  <Plus /> Add
                </Button>
              }
            >
              {layers.length === 0 ? (
                <p className="py-2 text-sm text-muted">
                  No layers — the element has <code className="mono text-xs">box-shadow: none</code>. Add a layer or pick a preset.
                </p>
              ) : (
                <ul className="-mx-1.5 flex flex-col" aria-label="Shadow layers (first is drawn on top)">
                  {layers.map((l, i) => (
                    <li
                      key={l.id}
                      className={cn('group flex h-8 items-center gap-1 rounded-md pl-1 pr-0.5', selected?.id === l.id ? 'bg-accent-soft' : 'hover:bg-surface-2/60')}
                    >
                      <IconButton
                        label={l.visible ? 'Hide layer' : 'Show layer'}
                        size="icon-xs"
                        icon={l.visible ? <Eye /> : <EyeOff />}
                        onClick={() => patch(l.id, { visible: !l.visible })}
                      />
                      <button
                        type="button"
                        onClick={() => setSelectedId(l.id)}
                        aria-pressed={selected?.id === l.id}
                        className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-soft', !l.visible && 'opacity-50')}
                      >
                        <span className="relative size-3 shrink-0 overflow-hidden rounded-[3px] border border-border-strong" style={{ background: CHECKER }}>
                          <span className="absolute inset-0" style={{ background: shadowColor(l.color, l.alpha) }} />
                        </span>
                        <span className="mono truncate text-[12px] text-fg">{layerToCss(l)}</span>
                      </button>
                      <span className="flex shrink-0 items-center opacity-60 group-hover:opacity-100 focus-within:opacity-100">
                        <IconButton label="Move up (draw above)" size="icon-xs" icon={<ArrowUp />} disabled={i === 0} onClick={() => move(l.id, -1)} />
                        <IconButton label="Move down" size="icon-xs" icon={<ArrowDown />} disabled={i === layers.length - 1} onClick={() => move(l.id, 1)} />
                        <IconButton label="Duplicate layer" size="icon-xs" icon={<Copy />} onClick={() => duplicate(l.id)} />
                        <IconButton label="Remove layer" size="icon-xs" icon={<Trash2 />} onClick={() => remove(l.id)} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </InspectorSection>

            {selected && (
              <InspectorSection title={`Layer ${layers.indexOf(selected) + 1}`} action={<Switch checked={selected.inset} onCheckedChange={(inset) => patch(selected.id, { inset })} label="Inset" />}>
                <SliderRow label="X offset" value={selected.x} min={-100} max={100} onChange={(x) => patch(selected.id, { x })} />
                <SliderRow label="Y offset" value={selected.y} min={-100} max={100} onChange={(y) => patch(selected.id, { y })} />
                <SliderRow label="Blur" value={selected.blur} min={0} max={200} onChange={(blur) => patch(selected.id, { blur })} />
                <SliderRow label="Spread" value={selected.spread} min={-100} max={100} onChange={(spread) => patch(selected.id, { spread })} />
                <InspectorRow label="Color">
                  <ColorField value={selected.color} onChange={(c) => patch(selected.id, { color: toHex(c), alpha: alphaOf(c, selected.alpha) })} label="Shadow color" className="flex-1" />
                </InspectorRow>
                <SliderRow label="Opacity" value={Math.round(selected.alpha * 100)} min={0} max={100} unit="%" onChange={(a) => patch(selected.id, { alpha: a / 100 })} />
              </InspectorSection>
            )}

            <InspectorSection title="Stage">
              <InspectorRow label="Canvas">
                <ColorField value={stage.canvas} onChange={(canvas) => setStage({ ...stage, canvas })} label="Canvas color" className="flex-1" />
              </InspectorRow>
              <InspectorRow label="Element">
                <ColorField value={stage.element} onChange={(element) => setStage({ ...stage, element })} label="Element color" className="flex-1" />
              </InspectorRow>
              <InspectorRow label="Size">
                <NumberField label="W" ariaLabel="Element width" value={stage.width} min={16} max={800} onChange={(width) => setStage({ ...stage, width })} unit="px" className="flex-1" />
                <NumberField label="H" ariaLabel="Element height" value={stage.height} min={16} max={800} onChange={(height) => setStage({ ...stage, height })} unit="px" className="flex-1" />
              </InspectorRow>
              <SliderRow label="Radius" value={stage.radius} min={0} max={120} onChange={(radius) => setStage({ ...stage, radius })} />
            </InspectorSection>
          </>
        }
      />
      <StatusBar>
        <StatusItem label="Layers">
          {visibleCount}
          {visibleCount !== layers.length && ` of ${layers.length} visible`}
        </StatusItem>
        <StatusItem label="Inset">{layers.filter((l) => l.visible && l.inset).length}</StatusItem>
        <StatusItem label="CSS">{formatBytes(new TextEncoder().encode(css).length)}</StatusItem>
        <StatusSpacer />
        <StatusItem>First layer is drawn on top</StatusItem>
      </StatusBar>
    </>
  )
}

function toHex(c: string): string {
  const parsed = parse(c)
  return (parsed && formatHex(parsed)) || c
}
/** A typed color with its own alpha (e.g. rgb(0 0 0 / 0.2)) sets the layer opacity too. */
function alphaOf(c: string, fallback: number): number {
  const a = parse(c)?.alpha
  return a === undefined ? fallback : a
}

function SliderRow({ label, value, min, max, onChange, unit = 'px' }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; unit?: string }) {
  return (
    <InspectorRow label={label}>
      <Slider aria-label={label} value={[Math.min(max, Math.max(min, value))]} min={min} max={max} step={1} onValueChange={([v]) => onChange(v)} className="flex-1" />
      <NumberField label="" ariaLabel={label} value={value} onChange={onChange} unit={unit} className="w-[76px]" precision={1} />
    </InspectorRow>
  )
}

function ImportPopover({ onImport }: { onImport: (layers: ShadowLayerInput[]) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    const r = parseBoxShadow(text)
    if (!r.ok) {
      setError(r.error)
      return
    }
    onImport(r.layers)
    toast.success(`Imported ${r.layers.length} layer${r.layers.length === 1 ? '' : 's'}`)
    setOpen(false)
    setText('')
    setError(null)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost">
          <ClipboardPaste /> Import CSS
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px]">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <label htmlFor="shadow-import" className="text-sm font-medium">
            Paste a box-shadow value
          </label>
          <Textarea
            id="shadow-import"
            autoFocus
            rows={4}
            value={text}
            aria-invalid={!!error}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
            }}
            placeholder="box-shadow: 0 1px 2px rgb(0 0 0 / 0.05), inset 0 0 0 1px #e5e7eb;"
            className="mono text-xs"
          />
          {error ? <p className="text-xs text-danger">{error}</p> : <p className="text-2xs text-subtle">Replaces the current layers. px lengths; any CSS color.</p>}
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="primary" disabled={!text.trim()}>
              Import
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
