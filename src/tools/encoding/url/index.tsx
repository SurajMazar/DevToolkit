import { useMemo, useState } from 'react'
import { ConverterTool, type ConverterResult } from '@/components/tools/ConverterTool'
import { ToolbarField } from '@/components/tools/Toolbar'
import { StatusItem } from '@/components/tools/StatusBar'
import { Checkbox } from '@/components/ui/checkbox'
import { Select } from '@/components/ui/select'
import { Tooltip } from '@/components/ui/tooltip'
import { usePersistentState } from '@/hooks/usePersistentState'
import { UrlCodecError, decodeUrl, encodeUrl, type UrlEncodeMode } from '@/engines/encoding/url'
import { formatNumber, pluralize } from '@/utils/format'

const MODES: { value: UrlEncodeMode; label: string; description: string }[] = [
  { value: 'component', label: 'Component', description: 'encodeURIComponent — for a single query value or path segment' },
  { value: 'uri', label: 'Full URI', description: 'encodeURI — keeps : / ? # & = so the URL still works' },
  { value: 'form', label: 'Form (x-www-form-urlencoded)', description: 'Like URLSearchParams — space becomes +' },
  { value: 'all', label: 'Every character', description: 'Percent-encodes letters and digits too' },
]

const ENCODE_SAMPLE = 'Crème brûlée & café — 50% off, today only! 東京 😀'
const DECODE_SAMPLE = 'https://shop.example.com/search?q=cr%C3%A8me+br%C3%BBl%C3%A9e+%26+caf%C3%A9&city=%E6%9D%B1%E4%BA%AC&ref=email%2Fspring%3Fid%3D42'

export default function UrlEncoderTool() {
  const [mode, setMode] = useState('encode')
  const [encMode, setEncMode] = usePersistentState<UrlEncodeMode>('encodeMode', 'component')
  const [perLine, setPerLine] = usePersistentState('perLine', false)
  const [lowercase, setLowercase] = usePersistentState('lowercase', false)
  const [plusAsSpace, setPlusAsSpace] = usePersistentState('plusAsSpace', true)
  const [lenient, setLenient] = usePersistentState('lenient', false)

  const options = useMemo(() => ({ encMode, perLine, lowercase, plusAsSpace, lenient }), [encMode, perLine, lowercase, plusAsSpace, lenient])

  const transform = (input: string, m: string): ConverterResult => {
    if (m === 'encode') {
      try {
        const output = encodeUrl(input, { mode: encMode, perLine, lowercase })
        return { output }
      } catch (e) {
        if (e instanceof UrlCodecError)
          return { output: '', error: { message: e.message, line: e.line, column: e.column }, markers: [{ message: e.message, line: e.line, column: e.column }] }
        throw e
      }
    }
    const r = decodeUrl(input, { plusAsSpace, lenient, perLine })
    const markers = r.issues.slice(0, 500).map((i) => ({ message: i.message, line: i.line, column: i.column, endColumn: i.column + i.length, severity: lenient ? ('warning' as const) : ('error' as const) }))
    const first = r.issues[0]
    const more = r.issues.length > 1 ? ` (+${formatNumber(r.issues.length - 1)} more, marked in the input)` : ''
    const status = (
      <>
        <StatusItem label="Escapes">{formatNumber(r.escapes)}</StatusItem>
        {r.issues.length > 0 && <StatusItem tone={r.failed ? 'danger' : 'mod'}>{pluralize(r.issues.length, 'malformed sequence')}</StatusItem>}
      </>
    )
    if (r.failed)
      return {
        output: '',
        error: { message: `${first.message}${more}. Turn on “Keep malformed” to decode the rest anyway.`, line: first.line, column: first.column },
        markers,
        status,
      }
    let warning: string | null = null
    if (first) {
      warning = perLine && !lenient
        ? `${pluralize(r.skippedLines, 'line')} left unchanged because of malformed sequences — first: ${first.message} (line ${first.line}, column ${first.column})${more}`
        : `Kept ${pluralize(r.issues.length, 'malformed sequence')} as-is — first: ${first.message} (line ${first.line}, column ${first.column})`
    } else if (r.stillEncoded) warning = 'The result still contains percent-escapes — the input may be double-encoded. Use Swap to decode it again.'
    return { output: r.text, warning, markers, status, meta: r.escapes ? `${formatNumber(r.escapes)} bytes decoded` : 'nothing to decode' }
  }

  return (
    <ConverterTool
      onModeChange={setMode}
      modes={[
        { value: 'encode', label: 'Encode', inputLabel: 'Text', outputLabel: 'Encoded', placeholder: 'Type or paste text to percent-encode…', sample: ENCODE_SAMPLE, outputExt: 'txt', inverse: 'decode' },
        { value: 'decode', label: 'Decode', inputLabel: 'Encoded', outputLabel: 'Text', placeholder: 'Paste a percent-encoded URL, query string or component…', sample: DECODE_SAMPLE, outputExt: 'txt', inverse: 'encode' },
      ]}
      optionsKey={options}
      inputWordWrap
      outputWordWrap
      emptyTitle={mode === 'encode' ? 'Type or paste text to percent-encode it.' : 'Paste a percent-encoded URL or string to decode it.'}
      emptyDescription={mode === 'encode' ? 'Non-ASCII text is encoded as UTF-8 bytes, e.g. é → %C3%A9.' : 'Malformed escapes like %ZZ or truncated UTF-8 (%E0%A4) are reported with their exact position.'}
      options={
        mode === 'encode' ? (
          <>
            <ToolbarField label="Encode">
              <Select aria-label="Encoding mode" value={encMode} onValueChange={setEncMode} options={MODES} className="w-[148px]" />
            </ToolbarField>
            <Tooltip content="Encode each line on its own; line breaks are kept instead of becoming %0A">
              <span>
                <Checkbox checked={perLine} onCheckedChange={(v) => setPerLine(v === true)} label="Per line" />
              </span>
            </Tooltip>
            <Checkbox checked={lowercase} onCheckedChange={(v) => setLowercase(v === true)} label="Lowercase hex" />
          </>
        ) : (
          <>
            <Tooltip content="Query strings and HTML forms encode spaces as +">
              <span>
                <Checkbox checked={plusAsSpace} onCheckedChange={(v) => setPlusAsSpace(v === true)} label="+ as space" />
              </span>
            </Tooltip>
            <Tooltip content="Leave malformed escapes and invalid UTF-8 untouched instead of failing">
              <span>
                <Checkbox checked={lenient} onCheckedChange={(v) => setLenient(v === true)} label="Keep malformed" />
              </span>
            </Tooltip>
            <Tooltip content="Decode each line independently — a broken line is left unchanged and reported">
              <span>
                <Checkbox checked={perLine} onCheckedChange={(v) => setPerLine(v === true)} label="Per line" />
              </span>
            </Tooltip>
          </>
        )
      }
      transform={transform}
    />
  )
}
