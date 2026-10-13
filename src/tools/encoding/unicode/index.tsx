import { useMemo, useRef, useState } from 'react'
import { ConverterTool, type ConverterResult } from '@/components/tools/ConverterTool'
import { OutputEditorPane } from '@/components/tools/EditorPane'
import { ToolbarField, ToolbarSeparator } from '@/components/tools/Toolbar'
import { StatusItem } from '@/components/tools/StatusBar'
import { EmptyState } from '@/components/tools/EmptyState'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { usePersistentState } from '@/hooks/usePersistentState'
import { ESCAPE_FORMATS, escapeUnicode, unescapeUnicode, type EscapeFormat } from '@/engines/encoding/unicode'
import { formatNumber, pluralize } from '@/utils/format'
import { CodePointTable } from './CodePointTable'

const ESCAPE_SAMPLE = `Café crème — 5 € · 東京 · 👩🏽‍💻 shipped it! ✓`
const UNESCAPE_SAMPLE = `{"title": "Caf\\u00e9 cr\\u00e8me \\u2014 5 \\u20AC", "city": "\\u{6771}\\u{4EAC}", "emoji": "\\uD83D\\uDC69\\uD83C\\uDFFD\\u200D\\uD83D\\uDCBB"}
CSS: content: "\\2713 "; · HTML: &#x1F680; &#9731; · Python: \\U0001F40D · Code points: U+0048 U+0069`

type View = 'escaped' | 'codepoints'

export default function UnicodeEscapesTool() {
  const [mode, setMode] = useState('escape')
  const [format, setFormat] = usePersistentState<EscapeFormat>('format', 'js')
  const [onlyNonAscii, setOnlyNonAscii] = usePersistentState('onlyNonAscii', true)
  const [lowercase, setLowercase] = usePersistentState('lowercase', false)
  const [view, setView] = usePersistentState<View>('view', 'escaped')
  const options = useMemo(() => ({ format, onlyNonAscii, lowercase }), [format, onlyNonAscii, lowercase])
  /** The plain text whose code points are listed (escape: input · unescape: decoded output). */
  const plain = useRef('')

  const transform = (input: string, m: string): ConverterResult => {
    if (m === 'escape') {
      plain.current = input
      const r = escapeUnicode(input, format, { onlyNonAscii, lowercase })
      return {
        output: r.text,
        meta: `${pluralize(r.escaped, 'character')} escaped`,
        warning: r.loneSurrogates ? `The input contains ${pluralize(r.loneSurrogates, 'unpaired surrogate')} (broken UTF-16). They were escaped as-is, but only \\uXXXX can represent them faithfully.` : null,
        status: <StatusItem label="Escaped">{formatNumber(r.escaped)}</StatusItem>,
      }
    }
    const r = unescapeUnicode(input)
    plain.current = r.text
    const decoded = Object.values(r.counts).reduce((a, b) => a + (b ?? 0), 0)
    const errors = r.issues.filter((i) => i.severity === 'error')
    const first = errors[0] ?? r.issues[0]
    const kinds = Object.entries(r.counts)
      .filter(([, n]) => n)
      .map(([k]) => FORMAT_LABEL[k] ?? k)
    return {
      output: r.text,
      meta: decoded ? `${pluralize(decoded, 'escape')} decoded · ${kinds.join(', ')}` : 'no escapes found',
      warning: first
        ? `${errors.length ? `${pluralize(errors.length, 'invalid sequence')} kept as-is` : pluralize(r.issues.length, 'warning')} — ${first.message} (line ${first.line}, column ${first.column})`
        : null,
      markers: r.issues.slice(0, 500).map((i) => ({ message: i.message, line: i.line, column: i.column, endColumn: i.column + i.length, severity: i.severity })),
      status: (
        <>
          <StatusItem label="Decoded">{formatNumber(decoded)}</StatusItem>
          {errors.length > 0 && <StatusItem tone="danger">{pluralize(errors.length, 'invalid')}</StatusItem>}
        </>
      ),
    }
  }

  const fmt = ESCAPE_FORMATS.find((f) => f.id === format)!

  return (
    <ConverterTool
      onModeChange={setMode}
      modes={[
        { value: 'escape', label: 'Escape', inputLabel: 'Text', outputLabel: 'Escaped', placeholder: 'Type or paste text to escape…', sample: ESCAPE_SAMPLE, outputExt: 'txt', inverse: 'unescape' },
        { value: 'unescape', label: 'Unescape', inputLabel: 'Escaped', outputLabel: 'Text', placeholder: 'Paste escapes in any notation: \\u00E9  \\u{1F600}  \\xE9  &#xE9;  &#233;  U+00E9  \\E9  \\U0001F600…', sample: UNESCAPE_SAMPLE, outputExt: 'txt', inverse: 'escape' },
      ]}
      optionsKey={options}
      inputWordWrap
      outputWordWrap
      emptyTitle={mode === 'escape' ? 'Type or paste text to escape it.' : 'Paste escaped text to decode it.'}
      emptyDescription={mode === 'escape' ? fmt.description : 'Any mix of \\u, \\u{…}, \\x, \\U, &#x…;, &#…;, U+, %u and CSS escapes is detected automatically.'}
      options={
        <>
          {mode === 'escape' && (
            <>
              <ToolbarField label="Format">
                <Select
                  aria-label="Escape format"
                  value={format}
                  onValueChange={setFormat}
                  className="w-[124px] font-mono"
                  options={ESCAPE_FORMATS.map((f) => ({ value: f.id, label: f.label, description: `${f.description} — ${f.example}` }))}
                />
              </ToolbarField>
              {format !== 'uplus' && <Checkbox checked={onlyNonAscii} onCheckedChange={(v) => setOnlyNonAscii(v === true)} label="Only non-ASCII" />}
              <Checkbox checked={lowercase} onCheckedChange={(v) => setLowercase(v === true)} label="Lowercase hex" />
              <ToolbarSeparator />
            </>
          )}
          <Segmented
            aria-label="Output view"
            value={view}
            onValueChange={setView}
            options={[
              { value: 'escaped', label: mode === 'escape' ? 'Escaped' : 'Text' },
              { value: 'codepoints', label: 'Code points' },
            ]}
          />
        </>
      }
      renderOutput={(result, m) =>
        view === 'codepoints' ? (
          <CodePointTable text={result.output ? plain.current : ''} />
        ) : (
          <OutputEditorPane
            title={m.outputLabel}
            value={result.output}
            meta={result.meta}
            filename="output.txt"
            wordWrap
            path="unicode-output"
            emptyState={!result.output ? <EmptyState compact title={mode === 'escape' ? 'Type or paste text to escape it.' : 'Paste escaped text to decode it.'} description={mode === 'escape' ? fmt.description : undefined} /> : undefined}
          />
        )
      }
      transform={transform}
    />
  )
}

const FORMAT_LABEL: Record<string, string> = {
  js: '\\u',
  es6: '\\u{}',
  hex: '\\x',
  python: '\\U',
  'html-hex': '&#x;',
  'html-dec': '&#;',
  css: 'CSS',
  uplus: 'U+',
  'percent-u': '%u',
  simple: '\\n etc.',
}
