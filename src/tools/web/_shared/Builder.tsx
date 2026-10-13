import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { CopyButton } from '@/components/common/CopyButton'
import { Segmented } from '@/components/ui/segmented'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { usePersistentState } from '@/hooks/usePersistentState'
import { cn } from '@/utils/cn'

/**
 * Layout for visual CSS builders: a large preview canvas with the generated code under it,
 * and a compact inspector column on the right (stacked below on phones).
 */
export function BuilderLayout({ preview, output, inspector }: { preview: React.ReactNode; output: React.ReactNode; inspector: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col bg-workspace md:min-h-0">
        <div className="relative flex min-h-[300px] flex-1 flex-col md:min-h-0">{preview}</div>
        {output}
      </div>
      <aside aria-label="Inspector" className="shrink-0 border-t border-border bg-bg md:min-h-0 md:w-[320px] md:overflow-y-auto md:border-l md:border-t-0 lg:w-[340px]">
        {inspector}
      </aside>
    </div>
  )
}

/** Inspector section: eyebrow title + optional action, tight spacing. */
export function InspectorSection({ title, action, children, className }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-2.5 border-b border-border px-4 py-3.5 last:border-b-0', className)}>
      {(title || action) && (
        <div className="flex min-h-6 items-center justify-between gap-2">
          {title && <h3 className="eyebrow">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/** Label column + control, for inspector rows. */
export function InspectorRow({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2', className)}>
      <span className="truncate text-xs text-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">{children}</div>
    </div>
  )
}

export interface CodeOutput {
  id: string
  label: string
  value: string
  hint?: string
}

/** Generated-code strip under a preview: format tabs, copy button, the code itself. */
export function CodeOutputPanel({ outputs, persistKey = 'outputTab', className }: { outputs: CodeOutput[]; persistKey?: string; className?: string }) {
  const [tab, setTab] = usePersistentState(persistKey, outputs[0].id)
  const current = outputs.find((o) => o.id === tab) ?? outputs[0]
  return (
    <section aria-label="Generated code" className={cn('shrink-0 border-t border-border bg-workspace', className)}>
      <div className="flex h-9 items-center gap-2 border-b border-border pl-3 pr-1.5">
        <Segmented size="xs" aria-label="Output format" value={current.id} onValueChange={setTab} options={outputs.map((o) => ({ value: o.id, label: o.label }))} />
        {current.hint && <span className="hidden truncate text-2xs text-subtle sm:inline">{current.hint}</span>}
        <div className="ml-auto">
          <CopyButton value={current.value} label={`Copy ${current.label}`} showLabel />
        </div>
      </div>
      <pre className="mono max-h-40 overflow-auto whitespace-pre-wrap break-all px-3 py-2.5 text-[12.5px] leading-5 text-fg">{current.value}</pre>
    </section>
  )
}

/** "Presets ▾" menu with a small visual for each preset. */
export function PresetMenu<T>({ presets, onPick, render, label = 'Presets' }: { presets: { name: string; value: T }[]; onPick: (v: T, name: string) => void; render: (v: T) => React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost">
          {label} <ChevronDown className="-mr-1 text-subtle" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {presets.map((p) => (
          <DropdownMenuItem key={p.name} onSelect={() => onPick(p.value, p.name)} className="h-8">
            <span className="flex size-5 shrink-0 items-center justify-center">{render(p.value)}</span>
            <span>{p.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Circular angle control: drag (or use arrow keys) to set a CSS angle (0° = up, clockwise). */
export function AngleDial({ value, onChange, label = 'Angle', size = 28 }: { value: number; onChange: (deg: number) => void; label?: string; size?: number }) {
  const set = (e: React.PointerEvent<HTMLDivElement>, snap: boolean) => {
    const r = e.currentTarget.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = e.clientY - (r.top + r.height / 2)
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI
    deg = (deg + 360) % 360
    onChange(snap ? Math.round(deg / 15) * 15 : Math.round(deg))
  }
  const rad = (value * Math.PI) / 180
  const c = size / 2
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${Math.round(value)} degrees`}
      title="Drag to rotate · Shift snaps to 15°"
      className="shrink-0 cursor-grab rounded-full border border-border-strong bg-workspace outline-none focus-visible:ring-2 focus-visible:ring-accent-soft active:cursor-grabbing"
      style={{ width: size, height: size }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        set(e, e.shiftKey)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) set(e, e.shiftKey)
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 15 : 1
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange((value + step) % 360)
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange((value - step + 360) % 360)
        else return
        e.preventDefault()
      }}
    >
      <svg width={size} height={size} aria-hidden className="pointer-events-none">
        <line x1={c} y1={c} x2={c + Math.sin(rad) * (c - 4)} y2={c - Math.cos(rad) * (c - 4)} stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" />
        <circle cx={c} cy={c} r={2} fill="var(--fg-muted)" />
      </svg>
    </div>
  )
}
