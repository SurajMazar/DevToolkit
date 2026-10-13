import { useMemo, useState } from 'react'
import { FileDown } from 'lucide-react'
import { ConverterTool, type ConverterResult } from '@/components/tools/ConverterTool'
import { ToolbarField } from '@/components/tools/Toolbar'
import { StatusItem } from '@/components/tools/StatusBar'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { usePersistentState } from '@/hooks/usePersistentState'
import { BASE_INFO, bytesToUtf8Text, parseByteNotation, prefixFor, textToByteNotation, type ByteBase, type BytePrefix, type ByteSeparator } from '@/engines/encoding/bytes'
import { sniffMime } from '@/engines/encoding/base64'
import { downloadText } from '@/utils/download'
import { formatBytes, formatNumber, pluralize } from '@/utils/format'

const ENCODE_SAMPLE = 'Hi! café ☕ 🚀'
const DECODE_SAMPLE = `48 65 6c 6c 6f 2c 20 55 54 46 2d 38 20 e2 9c 93
f0 9f 91 8b 20 63 61 66 c3 a9`

type BaseOrAuto = ByteBase | 'auto'

export default function TextBytesTool() {
  const [mode, setMode] = useState('encode')
  const [base, setBase] = usePersistentState<ByteBase>('base', 'hex')
  const [separator, setSeparator] = usePersistentState<ByteSeparator>('separator', 'space')
  const [prefix, setPrefix] = usePersistentState<BytePrefix>('prefix', 'none')
  const [perLine, setPerLine] = usePersistentState('perLine', '0')
  const [uppercase, setUppercase] = usePersistentState('uppercase', false)
  const [readAs, setReadAs] = usePersistentState<BaseOrAuto>('readAs', 'auto')

  const prefixOptions = useMemo(() => {
    const opts: { value: BytePrefix; label: string }[] = [{ value: 'none', label: 'None' }]
    if (BASE_INFO[base].cPrefix) opts.push({ value: 'c', label: BASE_INFO[base].cPrefix })
    if (BASE_INFO[base].escape) opts.push({ value: 'escape', label: BASE_INFO[base].escape! })
    return opts
  }, [base])
  const effectivePrefix: BytePrefix = prefixOptions.some((o) => o.value === prefix) ? prefix : 'none'
  const options = useMemo(() => ({ base, separator, effectivePrefix, perLine, uppercase, readAs }), [base, separator, effectivePrefix, perLine, uppercase, readAs])

  const transform = (input: string, m: string): ConverterResult => {
    if (m === 'encode') {
      const output = textToByteNotation(input, { base, separator, prefix: effectivePrefix, uppercase, bytesPerLine: Number(perLine) })
      const bytes = new TextEncoder().encode(input).length
      return { output, meta: `${pluralize(bytes, 'byte')} · UTF-8`, status: <StatusItem label="Bytes">{formatNumber(bytes)}</StatusItem> }
    }
    const parsed = parseByteNotation(input, readAs)
    const baseLabel = BASE_INFO[parsed.base].name
    const status = (
      <>
        <StatusItem label="Read as">
          {baseLabel}
          {parsed.detected === 'forced' ? '' : parsed.detected === 'prefix' ? ' (prefix)' : ' (detected)'}
        </StatusItem>
        <StatusItem label="Bytes">{formatNumber(parsed.bytes.length)}</StatusItem>
      </>
    )
    if (parsed.issues.length) {
      const first = parsed.issues[0]
      return {
        output: '',
        error: {
          message: `${first.message}${parsed.issues.length > 1 ? ` (+${parsed.issues.length - 1} more, marked in the input)` : ''}${parsed.detected === 'heuristic' ? ` — read as ${baseLabel.toLowerCase()}; pick the format in “Read as” if that’s wrong` : ''}`,
          line: first.line,
          column: first.column,
        },
        markers: parsed.issues.map((i) => ({ message: i.message, line: i.line, column: i.column, endColumn: i.column + i.length })),
        status,
      }
    }
    const text = bytesToUtf8Text(parsed)
    let warning: string | null = null
    const markers: ConverterResult['markers'] = []
    if (text.invalidCount) {
      const first = text.invalid[0]
      const mime = sniffMime(parsed.bytes)
      warning = `${pluralize(text.invalidCount, 'invalid UTF-8 sequence')} shown as �. First at byte ${first.byteOffset}: ${first.message}.${mime ? ` The bytes look like ${mime} — download them instead.` : ''}`
      for (const iv of text.invalid) {
        const lc = lineCol(input, iv.sourceOffset)
        markers.push({ message: `Byte ${iv.byteOffset}: ${iv.message}`, line: lc.line, column: lc.column, endColumn: lc.column + 2, severity: 'warning' })
      }
    } else if (parsed.ambiguousWith && parsed.detected === 'heuristic') {
      warning = `Ambiguous input: read as ${baseLabel.toLowerCase()}, but it is also valid ${BASE_INFO[parsed.ambiguousWith].name.toLowerCase()}. Choose “Read as” to switch.`
    }
    return { output: text.text, warning, markers, status, meta: `${formatBytes(parsed.bytes.length)} → UTF-8` }
  }

  return (
    <ConverterTool
      onModeChange={setMode}
      modes={[
        { value: 'encode', label: 'Text → Bytes', inputLabel: 'Text', outputLabel: 'Bytes', placeholder: 'Type or paste text — it is encoded as UTF-8…', sample: ENCODE_SAMPLE, outputExt: 'txt', inverse: 'decode' },
        { value: 'decode', label: 'Bytes → Text', inputLabel: 'Bytes', outputLabel: 'Text', placeholder: 'Paste bytes: 48 69 · 0x48,0x69 · \\x48\\x69 · 01001000 01101001 · 72 105…', sample: DECODE_SAMPLE, outputExt: 'txt', inverse: 'encode' },
      ]}
      optionsKey={options}
      inputWordWrap
      outputWordWrap
      emptyTitle={mode === 'encode' ? 'Type or paste text to see its bytes.' : 'Paste bytes to decode them as UTF-8 text.'}
      emptyDescription={
        mode === 'encode'
          ? 'Each character becomes 1–4 UTF-8 bytes, shown in binary, octal, decimal or hex.'
          : 'Binary, octal, decimal and hex are detected automatically, with or without 0x / \\x / % prefixes and separators.'
      }
      options={
        mode === 'encode' ? (
          <>
            <Segmented
              aria-label="Number base"
              value={base}
              onValueChange={setBase}
              options={[
                { value: 'bin', label: 'Bin' },
                { value: 'oct', label: 'Oct' },
                { value: 'dec', label: 'Dec' },
                { value: 'hex', label: 'Hex' },
              ]}
            />
            <ToolbarField label="Separator">
              <Select
                aria-label="Separator"
                value={separator}
                onValueChange={setSeparator}
                options={[
                  { value: 'space', label: 'Space' },
                  { value: 'comma', label: 'Comma' },
                  { value: 'newline', label: 'New line' },
                  { value: 'none', label: 'None' },
                ]}
              />
            </ToolbarField>
            {prefixOptions.length > 1 && (
              <ToolbarField label="Prefix">
                <Select aria-label="Prefix" value={effectivePrefix} onValueChange={setPrefix} options={prefixOptions} className="font-mono" />
              </ToolbarField>
            )}
            {separator !== 'newline' && (
              <ToolbarField label="Per line">
                <Select
                  aria-label="Bytes per line"
                  value={perLine}
                  onValueChange={setPerLine}
                  options={[
                    { value: '0', label: 'All' },
                    { value: '8', label: '8 bytes' },
                    { value: '16', label: '16 bytes' },
                    { value: '32', label: '32 bytes' },
                  ]}
                />
              </ToolbarField>
            )}
            {base === 'hex' && <Checkbox checked={uppercase} onCheckedChange={(v) => setUppercase(v === true)} label="Uppercase" />}
            {base === 'hex' && effectivePrefix !== 'none' && <span className="hidden text-2xs text-subtle xl:inline">e.g. {prefixFor(base, effectivePrefix)}48</span>}
          </>
        ) : (
          <ToolbarField label="Read as">
            <Select
              aria-label="Input format"
              value={readAs}
              onValueChange={setReadAs}
              options={[
                { value: 'auto', label: 'Auto-detect' },
                { value: 'hex', label: 'Hex' },
                { value: 'bin', label: 'Binary' },
                { value: 'oct', label: 'Octal' },
                { value: 'dec', label: 'Decimal' },
              ]}
            />
          </ToolbarField>
        )
      }
      outputActions={(output, input, result) =>
        mode === 'decode' && output && !result.error ? (
          <IconButton
            label="Download raw bytes (binary-safe)"
            icon={<FileDown />}
            onClick={() => {
              const p = parseByteNotation(input, readAs)
              downloadText(new Blob([p.bytes as BlobPart], { type: sniffMime(p.bytes) ?? 'application/octet-stream' }), 'bytes.bin')
            }}
          />
        ) : null
      }
      transform={transform}
    />
  )
}

function lineCol(text: string, offset: number) {
  let line = 1
  let last = -1
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++
    last = i
  }
  return { line, column: offset - last }
}
