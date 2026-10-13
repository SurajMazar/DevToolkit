import { ArrowDown, ArrowUp, CornerDownRight, Plus, X } from 'lucide-react'
import { FIELD_TYPES, makeField, type Field, type FieldType, type SchemaIssue } from '@/engines/generators/randomData'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/utils/cn'
import { FieldOptionsButton, optionsSummary } from './FieldOptions'

const GROUPS = [...new Set(FIELD_TYPES.map((t) => t.group))]
const typeOptions = (nested: boolean) =>
  GROUPS.map((g) => ({
    label: g,
    options: FIELD_TYPES.filter((t) => t.group === g && !(nested && t.type === 'object')).map((t) => ({ value: t.type, label: t.label })),
  })).filter((g) => g.options.length > 0)

const TOP_TYPES = typeOptions(false)
const CHILD_TYPES = typeOptions(true)

function uniqueName(base: string, fields: Field[]) {
  const names = new Set(fields.map((f) => f.name))
  if (!names.has(base)) return base
  let i = 2
  while (names.has(`${base}_${i}`)) i++
  return `${base}_${i}`
}

function retype(f: Field, type: FieldType): Field {
  const fresh = makeField(f.name, type)
  return { ...f, type, options: fresh.options, children: type === 'object' ? (f.children?.length ? f.children : [makeField('value', 'integer')]) : undefined }
}

function FieldRow({
  field,
  index,
  total,
  nested,
  issues,
  onChange,
  onRemove,
  onMove,
}: {
  field: Field
  index: number
  total: number
  nested?: boolean
  issues: Map<string, string[]>
  onChange: (f: Field) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const errs = issues.get(field.id)
  return (
    <div className={cn('group/field flex flex-col gap-0.5 py-1.5', nested ? 'pl-6' : '')}>
      <div className="flex items-center gap-1.5">
        {nested && <CornerDownRight className="-ml-5 size-3.5 shrink-0 text-subtle" aria-hidden />}
        <div className="flex shrink-0 flex-col opacity-50 group-hover/field:opacity-100 focus-within:opacity-100">
          <button type="button" aria-label={`Move ${field.name || 'field'} up`} disabled={index === 0} onClick={() => onMove(-1)} className="flex h-3.5 w-4 items-center justify-center rounded-xs text-subtle hover:text-fg disabled:opacity-30">
            <ArrowUp className="size-3" />
          </button>
          <button type="button" aria-label={`Move ${field.name || 'field'} down`} disabled={index === total - 1} onClick={() => onMove(1)} className="flex h-3.5 w-4 items-center justify-center rounded-xs text-subtle hover:text-fg disabled:opacity-30">
            <ArrowDown className="size-3" />
          </button>
        </div>
        <Input aria-label="Field name" className="mono h-7 min-w-0 flex-1 text-[12.5px]" value={field.name} onChange={(e) => onChange({ ...field, name: e.target.value })} aria-invalid={!!errs} placeholder="field_name" />
        <Select aria-label={`Type of ${field.name || 'field'}`} value={field.type} onValueChange={(t) => onChange(retype(field, t))} options={nested ? CHILD_TYPES : TOP_TYPES} className="w-[44%] max-w-52 shrink-0" />
        <FieldOptionsButton field={field} onChange={onChange} />
        <IconButton label={`Remove ${field.name || 'field'}`} size="icon-xs" icon={<X />} onClick={onRemove} />
      </div>
      <p className={cn('truncate pl-[22px] text-2xs', errs ? 'text-danger' : 'text-subtle')}>{errs ? errs.join(' ') : optionsSummary(field)}</p>
    </div>
  )
}

function FieldList({ fields, onChange, nested, issues }: { fields: Field[]; onChange: (fields: Field[]) => void; nested?: boolean; issues: Map<string, string[]> }) {
  const update = (i: number, f: Field) => onChange(fields.map((x, j) => (j === i ? f : x)))
  const move = (i: number, dir: -1 | 1) => {
    const next = [...fields]
    const j = i + dir
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <>
      {fields.map((f, i) => (
        <div key={f.id}>
          <FieldRow field={f} index={i} total={fields.length} nested={nested} issues={issues} onChange={(nf) => update(i, nf)} onRemove={() => onChange(fields.filter((_, j) => j !== i))} onMove={(d) => move(i, d)} />
          {f.type === 'object' && (
            <div className="ml-2 border-l border-border pl-1">
              <FieldList fields={f.children ?? []} nested issues={issues} onChange={(children) => update(i, { ...f, children })} />
              <Button size="xs" variant="ghost" className="ml-6 text-muted" onClick={() => update(i, { ...f, children: [...(f.children ?? []), makeField(uniqueName('field', f.children ?? []), 'loremWords')] })}>
                <Plus /> Add field to {f.name || 'object'}
              </Button>
            </div>
          )}
        </div>
      ))}
    </>
  )
}

export function SchemaEditor({ fields, onChange, issues }: { fields: Field[]; onChange: (f: Field[]) => void; issues: SchemaIssue[] }) {
  const byField = new Map<string, string[]>()
  for (const i of issues) if (i.fieldId) byField.set(i.fieldId, [...(byField.get(i.fieldId) ?? []), i.message])
  return (
    <div className="flex flex-col px-3 py-2">
      <FieldList fields={fields} onChange={onChange} issues={byField} />
      <div className="flex gap-1 pt-1.5">
        <Button size="sm" variant="ghost" className="text-muted" onClick={() => onChange([...fields, makeField(uniqueName('field', fields), 'loremWords')])}>
          <Plus /> Add field
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted"
          onClick={() => onChange([...fields, makeField(uniqueName('object', fields), 'object', {}, { children: [makeField('key', 'enum'), makeField('value', 'integer')] })])}
        >
          <Plus /> Add nested object
        </Button>
      </div>
    </div>
  )
}
