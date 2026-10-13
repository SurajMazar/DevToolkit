import { Settings2 } from 'lucide-react'
import { FIELD_TYPE_MAP, type Field, type FieldOptions as Opts } from '@/engines/generators/randomData'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Field as FormField } from '@/components/ui/label'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/utils/cn'
import { NumberInput } from '../_shared/NumberInput'

const pct = (p: number) => Math.round(p * 100)

/** One-line description of a field's options, shown under the field row. */
export function optionsSummary(f: Field): string {
  const o = f.options
  const parts: string[] = []
  switch (f.type) {
    case 'autoIncrement':
      parts.push(`from ${o.start ?? 1}, step ${o.step ?? 1}`)
      break
    case 'integer':
      parts.push(`${o.min} – ${o.max}`)
      break
    case 'float':
      parts.push(`${o.min} – ${o.max}, ${o.decimals} decimals`)
      break
    case 'boolean':
      parts.push(`${pct(o.probability ?? 0.5)}% true`)
      break
    case 'enum':
      parts.push((o.values ?? []).join(', ') || 'no values')
      break
    case 'date':
    case 'datetime':
      parts.push(`${o.from} → ${o.to}`)
      break
    case 'loremWords':
    case 'loremSentence':
      parts.push(`${o.min}–${o.max} words`)
      break
    case 'object':
      parts.push(`${f.children?.length ?? 0} fields`)
      break
    default:
      parts.push(`e.g. ${FIELD_TYPE_MAP.get(f.type)?.example ?? ''}`)
  }
  if (f.nullProbability > 0) parts.push(`${pct(f.nullProbability)}% null`)
  return parts.join(' · ')
}

function hasOptions(f: Field) {
  return ['autoIncrement', 'integer', 'float', 'boolean', 'enum', 'date', 'datetime', 'loremWords', 'loremSentence'].includes(f.type)
}

export function FieldOptionsButton({ field, onChange }: { field: Field; onChange: (f: Field) => void }) {
  const o = field.options
  const set = (p: Partial<Opts>) => onChange({ ...field, options: { ...o, ...p } })
  const customised = field.nullProbability > 0 || hasOptions(field)

  let body: React.ReactNode = null
  switch (field.type) {
    case 'autoIncrement':
      body = (
        <div className="grid grid-cols-2 gap-2">
          <FormField label="Start">
            <NumberInput aria-label="Start" value={o.start ?? 1} onChange={(start) => set({ start })} min={-1e15} max={1e15} />
          </FormField>
          <FormField label="Step">
            <NumberInput aria-label="Step" value={o.step ?? 1} onChange={(step) => set({ step })} min={-1e9} max={1e9} />
          </FormField>
        </div>
      )
      break
    case 'integer':
    case 'float':
      body = (
        <div className={cn('grid gap-2', field.type === 'float' ? 'grid-cols-3' : 'grid-cols-2')}>
          <FormField label="Min">
            <NumberInput aria-label="Minimum" value={o.min ?? 0} onChange={(min) => set({ min })} min={-1e15} max={1e15} integer={field.type === 'integer'} />
          </FormField>
          <FormField label="Max">
            <NumberInput aria-label="Maximum" value={o.max ?? 100} onChange={(max) => set({ max })} min={-1e15} max={1e15} integer={field.type === 'integer'} />
          </FormField>
          {field.type === 'float' && (
            <FormField label="Decimals">
              <NumberInput aria-label="Decimals" value={o.decimals ?? 2} onChange={(decimals) => set({ decimals })} min={0} max={10} />
            </FormField>
          )}
        </div>
      )
      break
    case 'boolean':
      body = (
        <FormField label="Chance of true">
          <NumberInput aria-label="Chance of true" value={pct(o.probability ?? 0.5)} onChange={(v) => set({ probability: v / 100 })} min={0} max={100} suffix="%" />
        </FormField>
      )
      break
    case 'enum':
      body = (
        <FormField label="Values" hint="One per line (or comma-separated). Picked uniformly.">
          <Textarea
            aria-label="Enum values"
            className="mono min-h-24 text-[12.5px]"
            defaultValue={(o.values ?? []).join('\n')}
            onChange={(e) =>
              set({
                values: e.target.value
                  .split(e.target.value.includes('\n') ? /\n/ : /,/)
                  .map((v) => v.trim())
                  .filter(Boolean),
              })
            }
          />
        </FormField>
      )
      break
    case 'date':
    case 'datetime':
      body = (
        <div className="grid grid-cols-2 gap-2">
          <FormField label="From">
            <Input type="date" aria-label="From date" className="h-7" value={o.from ?? ''} onChange={(e) => set({ from: e.target.value })} />
          </FormField>
          <FormField label="To">
            <Input type="date" aria-label="To date" className="h-7" value={o.to ?? ''} onChange={(e) => set({ to: e.target.value })} />
          </FormField>
        </div>
      )
      break
    case 'loremWords':
    case 'loremSentence':
      body = (
        <div className="grid grid-cols-2 gap-2">
          <FormField label="Min words">
            <NumberInput aria-label="Minimum words" value={o.min ?? 2} onChange={(min) => set({ min })} min={1} max={100} />
          </FormField>
          <FormField label="Max words">
            <NumberInput aria-label="Maximum words" value={o.max ?? 5} onChange={(max) => set({ max })} min={1} max={100} />
          </FormField>
        </div>
      )
      break
  }

  return (
    <Popover>
      <Tooltip content="Field options">
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Options for ${field.name || 'field'}`} className={cn(customised && 'text-fg')}>
            <Settings2 />
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-72">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">
            {field.name || 'Field'} <span className="font-normal text-subtle">· {FIELD_TYPE_MAP.get(field.type)?.label}</span>
          </p>
          {body}
          <FormField label="Null probability" hint="Chance that this value is null instead.">
            <NumberInput aria-label="Null probability" value={pct(field.nullProbability)} onChange={(v) => onChange({ ...field, nullProbability: v / 100 })} min={0} max={100} suffix="%" />
          </FormField>
        </div>
      </PopoverContent>
    </Popover>
  )
}
