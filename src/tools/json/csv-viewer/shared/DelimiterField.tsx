import { useState } from 'react'
import { Select } from '@/components/ui/select'
import { ToolbarField } from '@/components/tools/Toolbar'
import { delimiterLabel } from '@/engines/data/csv'

const PRESETS = [',', ';', '\t', '|']
const AUTO = 'auto'
const CUSTOM = 'custom'

/**
 * Delimiter picker: presets, optional auto-detect (value ''), or a custom string.
 * `detected` is shown next to "Auto" so the user sees what was chosen.
 */
export function DelimiterField({ value, onChange, allowAuto, detected, label = 'Delimiter' }: { value: string; onChange: (v: string) => void; allowAuto?: boolean; detected?: string; label?: string }) {
  const [customMode, setCustomMode] = useState(() => value !== '' && !PRESETS.includes(value))
  const selectValue = allowAuto && value === '' ? AUTO : customMode || !PRESETS.includes(value) ? CUSTOM : value
  const options = [
    ...(allowAuto ? [{ value: AUTO, label: detected ? `Auto · ${delimiterLabel(detected)}` : 'Auto-detect' }] : []),
    { value: ',', label: 'Comma  ,' },
    { value: ';', label: 'Semicolon  ;' },
    { value: '\t', label: 'Tab  ⇥' },
    { value: '|', label: 'Pipe  |' },
    { value: CUSTOM, label: 'Custom…' },
  ]
  return (
    <ToolbarField label={label}>
      <Select
        aria-label={label}
        value={selectValue}
        onValueChange={(v) => {
          if (v === CUSTOM) {
            setCustomMode(true)
            if (value === '' || PRESETS.includes(value)) onChange(value || ',')
            return
          }
          setCustomMode(false)
          onChange(v === AUTO ? '' : v)
        }}
        options={options}
        className="min-w-[7.5rem]"
      />
      {selectValue === CUSTOM && (
        <input
          aria-label="Custom delimiter"
          value={value === '\t' ? '\\t' : value}
          onChange={(e) => onChange(e.target.value.replace(/\\t/g, '\t'))}
          maxLength={8}
          spellCheck={false}
          placeholder="e.g. ~"
          className="mono h-7 w-14 rounded-md border border-border bg-workspace px-2 text-sm text-fg outline-none focus:border-accent aria-[invalid=true]:border-danger"
          aria-invalid={!value}
        />
      )}
    </ToolbarField>
  )
}
