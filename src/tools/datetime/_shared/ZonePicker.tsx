import { useMemo, useState } from 'react'
import { Command } from 'cmdk'
import { Check, ChevronDown, Globe, MapPin } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { formatUtcOffsetShort, localTimeZone, offsetNsAt, searchZones, zoneCity } from '@/engines/datetime/zones'
import { cn } from '@/utils/cn'

interface ZonePickerProps {
  value: string
  onChange: (zone: string) => void
  /** Instant used to show current offsets. */
  atMs: number
  'aria-label': string
  className?: string
  /** Render the trigger as a compact "add" button instead of the current value. */
  trigger?: React.ReactNode
  align?: 'start' | 'end'
  /** Zones to mark as already chosen. */
  selected?: string[]
}

function offsetLabel(zone: string, atMs: number) {
  try {
    return formatUtcOffsetShort(offsetNsAt(atMs, zone))
  } catch {
    return ''
  }
}

/** Searchable IANA zone combobox: cities, abbreviations (PST, IST), ids and UTC offsets. */
export function ZonePicker({ value, onChange, atMs, className, trigger, align = 'start', selected, ...rest }: ZonePickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const local = useMemo(() => localTimeZone(), [])
  const results = useMemo(() => (open ? searchZones(query, atMs, undefined, query ? 80 : 500) : []), [query, atMs, open])
  const chosen = new Set(selected ?? [value])

  const pick = (zone: string) => {
    onChange(zone)
    setOpen(false)
    setQuery('')
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery('') }}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button variant="secondary" size="sm" aria-label={rest['aria-label']} className={cn('max-w-[300px] justify-between gap-2 font-normal', className)}>
            <Globe className="text-subtle" />
            <span className="truncate">{value}</span>
            {value === local && <span className="text-2xs text-subtle">local</span>}
            <span className="mono text-2xs text-subtle">{offsetLabel(value, atMs)}</span>
            <ChevronDown className="text-subtle" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[min(380px,calc(100vw-16px))] p-0">
        <Command shouldFilter={false} label={rest['aria-label']} loop>
          <div className="border-b border-border px-3">
            <Command.Input
              value={query}
              onValueChange={setQuery}
              autoFocus
              placeholder="City, zone, abbreviation or offset (+5:30)…"
              className="h-10 w-full bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
            />
          </div>
          <Command.List className="max-h-[min(50vh,340px)] overflow-y-auto overscroll-contain p-1">
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted">No time zone matches “{query}”.</Command.Empty>
            {!query && local !== 'UTC' && (
              <ZoneItem zone={local} atMs={atMs} onSelect={pick} active={chosen.has(local)} hint="This device" icon={<MapPin className="size-3.5 text-accent-text" />} keyPrefix="local" />
            )}
            {results.map((r) => (
              <ZoneItem key={r.zone} zone={r.zone} atMs={atMs} onSelect={pick} active={chosen.has(r.zone)} hint={r.matched} />
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function ZoneItem({ zone, atMs, onSelect, active, hint, icon, keyPrefix = '' }: { zone: string; atMs: number; onSelect: (z: string) => void; active: boolean; hint?: string; icon?: React.ReactNode; keyPrefix?: string }) {
  const region = zone.includes('/') ? zone.slice(0, zone.lastIndexOf('/')).replace(/_/g, ' ') : ''
  return (
    <Command.Item
      value={`${keyPrefix}${zone}`}
      onSelect={() => onSelect(zone)}
      className="flex h-9 cursor-default select-none items-center gap-2 rounded-md px-2 text-sm outline-none data-[selected=true]:bg-surface-2"
    >
      <span className="flex w-4 shrink-0 justify-center">{active ? <Check className="size-3.5 text-accent-text" /> : icon}</span>
      <span className="min-w-0 flex-1 truncate">
        <span className="text-fg">{zoneCity(zone)}</span>
        {region && <span className="ml-1.5 text-xs text-subtle">{region}</span>}
        {hint && <span className="ml-1.5 text-xs text-accent-text">{hint}</span>}
      </span>
      <span className="mono shrink-0 text-2xs text-muted tabular">{offsetLabel(zone, atMs)}</span>
    </Command.Item>
  )
}
