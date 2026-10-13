import { useMemo, useState } from 'react'
import { ConverterTool, type ConverterMode, type ConverterResult } from '@/components/tools/ConverterTool'
import { ToolbarField, ToolbarSeparator } from '@/components/tools/Toolbar'
import { StatusItem } from '@/components/tools/StatusBar'
import { Checkbox } from '@/components/ui/checkbox'
import { Select } from '@/components/ui/select'
import { usePersistentState } from '@/hooks/usePersistentState'
import { EscapeError, escapeJsonString, stringifyAsString, unescapeJsonString, unstringifyNested } from '@/engines/json-tools/escape'
import { formatNumber, pluralize } from '@/utils/format'
import { JSON_SAMPLE, LITERAL_SAMPLE, NESTED_SAMPLE, TEXT_SAMPLE } from './samples'

const MODES: ConverterMode[] = [
  { value: 'escape', label: 'Escape', inputLabel: 'Text', outputLabel: 'JSON string', placeholder: 'Type or paste any text to turn it into a JSON string literal…', sample: TEXT_SAMPLE, outputExt: 'txt', inverse: 'unescape' },
  { value: 'unescape', label: 'Unescape', inputLabel: 'JSON string', outputLabel: 'Text', placeholder: 'Paste a JSON string literal — with or without the surrounding quotes…', sample: LITERAL_SAMPLE, outputExt: 'txt', inverse: 'escape' },
  { value: 'expand', label: 'Expand nested', inputLabel: 'JSON', outputLabel: 'Expanded JSON', inputLanguage: 'json', outputLanguage: 'json', placeholder: 'Paste JSON whose string values contain stringified JSON (or a JSON string literal of JSON)…', sample: NESTED_SAMPLE, outputExt: 'json', inverse: 'stringify' },
  { value: 'stringify', label: 'Stringify JSON', inputLabel: 'JSON', outputLabel: 'Escaped string', inputLanguage: 'json', placeholder: 'Paste JSON to embed it as an escaped string value…', sample: JSON_SAMPLE, outputExt: 'txt', inverse: 'expand' },
]

function toResult(e: unknown): ConverterResult {
  if (e instanceof EscapeError) {
    return { output: '', error: { message: e.message, line: e.line, column: e.column }, markers: [{ message: e.message, line: e.line, column: e.column }] }
  }
  return { output: '', error: (e as Error).message }
}

export default function JsonEscapeTool() {
  const [quotes, setQuotes] = usePersistentState('quotes', true)
  const [asciiOnly, setAsciiOnly] = usePersistentState('asciiOnly', false)
  const [escapeSlash, setEscapeSlash] = usePersistentState('escapeSlash', false)
  const [indent, setIndent] = usePersistentState<'2' | '4' | '0'>('indent', '2')
  const [mode, setMode] = useState('escape')
  const options = useMemo(() => ({ quotes, asciiOnly, escapeSlash, indent }), [quotes, asciiOnly, escapeSlash, indent])

  const transform = (input: string, m: string): ConverterResult => {
    try {
      switch (m) {
        case 'escape': {
          const out = escapeJsonString(input, { quotes, asciiOnly, escapeSlash })
          return { output: out, meta: `${formatNumber(out.length - input.length)} chars added` }
        }
        case 'unescape': {
          const r = unescapeJsonString(input)
          return { output: r.text, warning: r.warnings.join(' ') || null, meta: r.quoted ? 'Quoted literal' : 'Unquoted body' }
        }
        case 'expand': {
          const r = unstringifyNested(input, Number(indent))
          return {
            output: r.output,
            meta: r.expanded ? `${pluralize(r.expanded, 'string')} expanded · ${pluralize(r.levels, 'level')} deep` : 'No nested JSON found',
            warning: r.expanded ? null : 'No string values containing JSON objects or arrays were found — the output is the input, re-formatted.',
            status: <StatusItem label="Expanded">{formatNumber(r.expanded)}</StatusItem>,
          }
        }
        case 'stringify':
          return { output: stringifyAsString(input, { quotes, asciiOnly }), meta: 'Minified, then escaped' }
      }
      return { output: '' }
    } catch (e) {
      return toResult(e)
    }
  }

  return (
    <ConverterTool
      modes={MODES}
      onModeChange={setMode}
      optionsKey={options}
      inputWordWrap
      outputWordWrap
      emptyTitle={
        {
          escape: 'Type or paste text to get a JSON string literal.',
          unescape: 'Paste a JSON string literal to decode it.',
          expand: 'Paste JSON that contains stringified JSON.',
          stringify: 'Paste JSON to embed it as an escaped string.',
        }[mode]
      }
      emptyDescription={
        mode === 'expand'
          ? 'Values like "{\\"a\\":1}" are parsed recursively, however deeply they are nested.'
          : mode === 'unescape'
            ? 'Invalid escapes are reported with their exact line and column.'
            : undefined
      }
      options={
        mode === 'escape' || mode === 'stringify' ? (
          <>
            <Checkbox checked={quotes} onCheckedChange={(v) => setQuotes(v === true)} label="Surrounding quotes" />
            <Checkbox checked={asciiOnly} onCheckedChange={(v) => setAsciiOnly(v === true)} label="ASCII only (\uXXXX)" />
            {mode === 'escape' && <Checkbox checked={escapeSlash} onCheckedChange={(v) => setEscapeSlash(v === true)} label="Escape / as \/" />}
          </>
        ) : mode === 'expand' ? (
          <>
            <ToolbarField label="Indent">
              <Select
                aria-label="Indentation"
                value={indent}
                onValueChange={setIndent}
                options={[
                  { value: '2', label: '2 spaces' },
                  { value: '4', label: '4 spaces' },
                  { value: '0', label: 'Minified' },
                ]}
              />
            </ToolbarField>
            <ToolbarSeparator />
            <span className="shrink-0 text-xs text-subtle">Parses string values that contain JSON objects or arrays, recursively</span>
          </>
        ) : (
          <span className="shrink-0 text-xs text-subtle">Accepts input with or without the surrounding double quotes</span>
        )
      }
      transform={transform}
    />
  )
}
