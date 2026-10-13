import { useMemo, useState } from 'react'
import { BookOpen } from 'lucide-react'
import { toast } from 'sonner'
import { ConverterTool, type ConverterResult } from '@/components/tools/ConverterTool'
import { ToolbarField, ToolbarSeparator } from '@/components/tools/Toolbar'
import { StatusItem } from '@/components/tools/StatusBar'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { usePersistentState } from '@/hooks/usePersistentState'
import { COMMON_ENTITIES, decodeEntities, encodeEntities, entityForms, type EntityFormat, type EntityScope } from '@/engines/encoding/htmlEntities'
import { copyText } from '@/utils/clipboard'
import { formatNumber, pluralize } from '@/utils/format'

const ENCODE_SAMPLE = `<a href="/search?q=fish&chips" title='Tom's "best"'>Café © 2025 — 10 > 9 & 5 < 7 😀</a>`
const DECODE_SAMPLE = `&lt;p class=&quot;note&quot;&gt;Caf&eacute; &amp; cr&egrave;me br&ucirc;l&eacute;e &mdash; &#8364;5 &#x1F370;&lt;/p&gt;
&lt;small&gt;&copy 2025 &#150; all rights reserved&lt;/small&gt;`

function CopyCell({ value, className }: { value: string; className?: string }) {
  return (
    <button
      type="button"
      className={`mono rounded-sm px-1.5 py-0.5 text-left text-[12px] text-fg hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring ${className ?? ''}`}
      onClick={async () => {
        if (await copyText(value)) toast.success(`Copied ${value === ' ' ? 'no-break space' : value}`)
        else toast.error('Clipboard access was blocked by the browser')
      }}
      title={`Copy ${value}`}
    >
      {value}
    </button>
  )
}

function ReferencePopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <BookOpen /> Reference
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(520px,calc(100vw-16px))] p-0">
        <div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2">
          <p className="text-sm font-medium text-fg">Common entities</p>
          <p className="text-2xs text-subtle">Click any value to copy it</p>
        </div>
        <div className="max-h-[min(420px,60vh)] overflow-y-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-raised">
              <tr className="text-left text-2xs uppercase tracking-wider text-subtle">
                <th className="px-3 py-1.5 font-medium">Char</th>
                <th className="px-1.5 py-1.5 font-medium">Named</th>
                <th className="px-1.5 py-1.5 font-medium">Decimal</th>
                <th className="px-1.5 py-1.5 font-medium">Hex</th>
                <th className="hidden px-3 py-1.5 font-medium sm:table-cell">Name</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {COMMON_ENTITIES.map((e) => {
                const f = entityForms(e.char)
                const visible = /\s|­|​|‍/.test(e.char) ? '␣' : e.char
                return (
                  <tr key={e.name}>
                    <td className="px-2 py-0.5">
                      <button
                        type="button"
                        className="flex h-6 w-8 items-center justify-center rounded-sm text-base text-fg hover:bg-surface-2"
                        title={`Copy the character (${f.codePoint})`}
                        onClick={async () => {
                          if (await copyText(e.char)) toast.success(`Copied ${f.codePoint}`)
                        }}
                      >
                        <span className={visible === '␣' ? 'text-subtle' : ''}>{visible}</span>
                      </button>
                    </td>
                    <td className="py-0.5">
                      <CopyCell value={e.name} />
                    </td>
                    <td className="py-0.5">
                      <CopyCell value={f.decimal} className="text-muted" />
                    </td>
                    <td className="py-0.5">
                      <CopyCell value={f.hex} className="text-muted" />
                    </td>
                    <td className="hidden px-3 py-0.5 text-xs text-muted sm:table-cell">{e.description}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-3 py-2 text-2xs leading-4 text-subtle">
          Decoding uses the full HTML5 named-reference table. In text, only &amp; and &lt; strictly need escaping; in attribute values also the quote you use.
        </p>
      </PopoverContent>
    </Popover>
  )
}

export default function HtmlEntitiesTool() {
  const [mode, setMode] = useState('encode')
  const [scope, setScope] = usePersistentState<EntityScope>('scope', 'special')
  const [format, setFormat] = usePersistentState<EntityFormat>('format', 'named')
  const [attribute, setAttribute] = usePersistentState('attribute', false)
  const options = useMemo(() => ({ scope, format, attribute }), [scope, format, attribute])

  const transform = (input: string, m: string): ConverterResult => {
    if (m === 'encode') {
      const output = encodeEntities(input, { scope, format })
      // Every "&" in the input is escaped too, so each "&" in the output starts a reference we wrote.
      let refs = 0
      for (let i = output.indexOf('&'); i !== -1; i = output.indexOf('&', i + 1)) refs++
      return { output, meta: `${pluralize(refs, 'reference')} written`, status: <StatusItem label="References">{formatNumber(refs)}</StatusItem> }
    }
    const r = decodeEntities(input, { attribute })
    const first = r.notes[0]
    return {
      output: r.text,
      meta: `${pluralize(r.references, 'reference')} decoded`,
      warning: first ? `${first.message} (line ${first.line}, column ${first.column})${r.notes.length > 1 ? ` — +${r.notes.length - 1} more, marked in the input` : ''}` : null,
      markers: r.notes.map((n) => ({ message: n.message, line: n.line, column: n.column, endColumn: n.column + n.length, severity: n.kind === 'unknown' ? 'info' : 'warning' })),
      status: (
        <>
          <StatusItem label="References">{formatNumber(r.references)}</StatusItem>
          {r.notes.length > 0 && <StatusItem tone="mod">{pluralize(r.notes.length, 'note')}</StatusItem>}
        </>
      ),
    }
  }

  return (
    <ConverterTool
      onModeChange={setMode}
      modes={[
        { value: 'encode', label: 'Encode', inputLabel: 'Text', outputLabel: 'HTML', placeholder: 'Type or paste text to escape for HTML…', sample: ENCODE_SAMPLE, outputExt: 'html', inverse: 'decode' },
        { value: 'decode', label: 'Decode', inputLabel: 'HTML', outputLabel: 'Text', placeholder: 'Paste HTML with entities like &amp;lt; &amp;eacute; &amp;#8364; &amp;#x1F600;…', sample: DECODE_SAMPLE, outputExt: 'txt', inverse: 'encode' },
      ]}
      optionsKey={options}
      inputWordWrap
      outputWordWrap
      emptyTitle={mode === 'encode' ? 'Type or paste text to escape it for HTML.' : 'Paste HTML to decode its character references.'}
      emptyDescription={
        mode === 'encode'
          ? 'Escaping & < > " \' is enough to safely place text inside HTML elements and quoted attributes.'
          : 'Named (&eacute;), decimal (&#233;) and hex (&#xE9;) references are decoded exactly as browsers do; legacy and ambiguous forms are pointed out.'
      }
      options={
        <>
          {mode === 'encode' ? (
            <>
              <ToolbarField label="Escape">
                <Select
                  aria-label="Characters to escape"
                  value={scope}
                  onValueChange={setScope}
                  className="w-[150px]"
                  options={[
                    { value: 'special', label: 'Special only', description: '& < > " \' — enough for safe HTML' },
                    { value: 'nonAscii', label: 'Special + non-ASCII', description: 'For ASCII-only files and old mail clients' },
                    { value: 'everything', label: 'Every character', description: 'Including letters, digits and spaces' },
                  ]}
                />
              </ToolbarField>
              <Segmented
                aria-label="Reference format"
                value={format}
                onValueChange={setFormat}
                options={[
                  { value: 'named', label: 'Named' },
                  { value: 'decimal', label: 'Decimal' },
                  { value: 'hex', label: 'Hex' },
                ]}
              />
            </>
          ) : (
            <Tooltip content="Inside attribute values, legacy names followed by = or a letter (e.g. ?a=1&copy=2) are not decoded">
              <span>
                <Checkbox checked={attribute} onCheckedChange={(v) => setAttribute(v === true)} label="Attribute value" />
              </span>
            </Tooltip>
          )}
          <ToolbarSeparator />
          <ReferencePopover />
        </>
      }
      transform={transform}
    />
  )
}
