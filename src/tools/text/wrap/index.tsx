import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, Info, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { DEFAULT_UNWRAP, DEFAULT_WRAP, lineWidthStats, unwrapText, wrapText, type UnwrapOptions, type WrapOptions } from '@/engines/text-utils/wrap'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { useIsMobile } from '@/hooks/useMediaQuery'
import type { CodeEditorHandle } from '@/components/editors/CodeEditor'
import { InputEditorPane, OutputEditorPane } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { EmptyState } from '@/components/tools/EmptyState'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Segmented } from '@/components/ui/segmented'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatNumber, pluralize } from '@/utils/format'
import { cn } from '@/utils/cn'

const SAMPLE = `Hard wrapping keeps commit messages, code comments and plain-text emails readable in terminals and diff views. Most style guides recommend 72 or 80 columns.

    Indented paragraphs keep their indentation on every wrapped line, which is handy for nested notes in a README or a docstring.

- List items get a hanging indent so continuation lines line up under the text instead of the bullet marker.
- Long URLs like https://example.com/a/really/long/path/that/cannot/be/broken stay intact unless "Break long words" is on.

// Comment blocks are detected too: when every line starts with the same prefix,
// it is stripped before wrapping and added back to each new line.

Wide characters count as two columns: 日本語のテキストも正しく折り返されます。絵文字 🎉 も同様です。`

const PREFIXES = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'none', label: 'None' },
  { value: '// ', label: '// ', description: 'C, JS, Go…' },
  { value: '# ', label: '# ', description: 'Shell, Python, YAML' },
  { value: '> ', label: '> ', description: 'Email / Markdown quote' },
  { value: ' * ', label: ' * ', description: 'Block comment body' },
  { value: '-- ', label: '-- ', description: 'SQL, Lua, Haskell' },
  { value: '; ', label: '; ', description: 'Lisp, INI, assembly' },
  { value: 'custom', label: 'Custom…' },
]

interface WrapUi {
  width: number
  breakLongWords: boolean
  preserveParagraphs: boolean
  preserveIndent: boolean
  reflow: boolean
  prefixChoice: string
  customPrefix: string
  tabSize: number
}

const DEFAULT_UI: WrapUi = {
  width: DEFAULT_WRAP.width,
  breakLongWords: false,
  preserveParagraphs: true,
  preserveIndent: true,
  reflow: true,
  prefixChoice: 'auto',
  customPrefix: '',
  tabSize: 4,
}

function WidthRules() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <Info /> Width rules
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] text-[13px] leading-[19px] text-muted">
        <p className="mb-2 text-sm font-medium text-fg">How columns are counted</p>
        <ul className="flex list-disc flex-col gap-1.5 pl-4">
          <li>Width is measured per user-perceived character (grapheme), so <span className="mono text-fg">é</span> written as e + accent is 1 column.</li>
          <li>East Asian wide/fullwidth characters (CJK, Hangul, fullwidth forms) and emoji count as <span className="text-fg">2 columns</span>, like in terminals.</li>
          <li>Zero-width and combining characters count as 0. Ambiguous-width characters count as 1.</li>
          <li>Tabs in indentation advance to the next tab stop. Text is only broken at spaces; long words stay whole unless “Break long words” is on.</li>
          <li>Blank lines separate paragraphs; list items (<span className="mono">-</span>, <span className="mono">*</span>, <span className="mono">1.</span>) and fenced code blocks are kept intact.</li>
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export default function WrapTool() {
  const [input, setInput] = usePersistentState('input', '')
  const [mode, setMode] = usePersistentState<'wrap' | 'unwrap'>('mode', 'wrap')
  const [ui, setUi] = usePersistentState<WrapUi>('options', DEFAULT_UI)
  const [unwrapUi, setUnwrapUi] = usePersistentState<UnwrapOptions>('unwrapOptions', DEFAULT_UNWRAP)
  const [widthText, setWidthText] = useState(String(ui.width))
  const isMobile = useIsMobile()
  const [mobileTab, setMobileTab] = useState<0 | 1>(0)
  const inputRef = useRef<CodeEditorHandle>(null)
  const outputRef = useRef<CodeEditorHandle>(null)

  useIncomingInput(setInput)
  useEffect(() => setWidthText(String(ui.width)), [ui.width])

  const debounced = useDebouncedValue(input, adaptiveDelay(input.length))
  const text = useDeferredValue(debounced)

  const prefix = ui.prefixChoice === 'auto' || ui.prefixChoice === 'none' ? '' : ui.prefixChoice === 'custom' ? ui.customPrefix : ui.prefixChoice
  const wrapOpts: WrapOptions = useMemo(
    () => ({
      width: ui.width,
      breakLongWords: ui.breakLongWords,
      preserveParagraphs: ui.preserveParagraphs,
      preserveIndent: ui.preserveIndent,
      reflow: ui.reflow,
      prefix,
      detectPrefix: ui.prefixChoice === 'auto',
      tabSize: ui.tabSize,
    }),
    [ui, prefix],
  )

  const result = useMemo(() => {
    if (!text) return null
    try {
      if (mode === 'wrap') {
        const r = wrapText(text, wrapOpts)
        return { output: r.text, prefix: r.prefix, detected: r.detected, overflow: r.overflowLines, maxWidth: r.maxWidth, paragraphs: null as number | null, error: null as string | null }
      }
      const r = unwrapText(text, unwrapUi)
      return { output: r.text, prefix: r.prefix, detected: !!r.prefix, overflow: 0, maxWidth: 0, paragraphs: r.paragraphs, error: null }
    } catch (e) {
      return { output: '', prefix: '', detected: false, overflow: 0, maxWidth: 0, paragraphs: null, error: (e as Error).message }
    }
  }, [text, mode, wrapOpts, unwrapUi])

  const output = result?.output ?? ''
  const inStats = useMemo(() => lineWidthStats(text, ui.width, ui.tabSize), [text, ui.width, ui.tabSize])
  const outStats = useMemo(() => lineWidthStats(output, ui.width, ui.tabSize), [output, ui.width, ui.tabSize])

  // Column guide in both editors.
  const rulers = useMemo(() => (mode === 'wrap' ? [ui.width] : []), [mode, ui.width])
  useEffect(() => {
    inputRef.current?.editor?.updateOptions({ rulers })
    outputRef.current?.editor?.updateOptions({ rulers })
  }, [rulers])

  const commitWidth = (v: string) => {
    const n = Math.round(Number(v))
    if (Number.isFinite(n) && n >= 10 && n <= 1000) setUi((u) => ({ ...u, width: n }))
    else setWidthText(String(ui.width))
  }

  const swap = () => {
    if (!output) return
    if (inputRef.current?.editor) inputRef.current.replaceAll(output)
    else setInput(output)
    setMode(mode === 'wrap' ? 'unwrap' : 'wrap')
    toast.message('Output moved to input', { description: 'Undo with Ctrl/⌘+Z in the input editor.' })
  }

  const widthInvalid = !/^\d+$/.test(widthText) || Number(widthText) < 10 || Number(widthText) > 1000

  const toolbar = (
    <Toolbar>
      <Segmented
        aria-label="Mode"
        value={mode}
        onValueChange={setMode}
        options={[
          { value: 'wrap', label: 'Wrap' },
          { value: 'unwrap', label: 'Unwrap' },
        ]}
      />
      <ToolbarSeparator />
      {mode === 'wrap' ? (
        <>
          <ToolbarField label="Column">
            <Input
              type="number"
              min={10}
              max={1000}
              value={widthText}
              aria-invalid={widthInvalid}
              onChange={(e) => {
                setWidthText(e.target.value)
                const n = Number(e.target.value)
                if (Number.isInteger(n) && n >= 10 && n <= 1000) setUi((u) => ({ ...u, width: n }))
              }}
              onBlur={(e) => commitWidth(e.target.value)}
              className="h-7 w-[68px] tabular"
              aria-label="Wrap column"
            />
          </ToolbarField>
          <div className="flex shrink-0 items-center gap-0.5">
            {[72, 80, 100, 120].map((w) => (
              <Button key={w} size="xs" variant={ui.width === w ? 'subtle' : 'ghost'} className={cn('tabular', ui.width === w && 'text-fg')} onClick={() => setUi((u) => ({ ...u, width: w }))}>
                {w}
              </Button>
            ))}
          </div>
          <ToolbarSeparator />
          <ToolbarField label="Prefix">
            <Select aria-label="Line prefix" value={ui.prefixChoice} onValueChange={(v) => setUi((u) => ({ ...u, prefixChoice: v }))} options={PREFIXES.map((p) => ({ ...p, label: <span className={cn(p.value !== 'auto' && p.value !== 'none' && p.value !== 'custom' && 'mono whitespace-pre')}>{p.label}</span> }))} />
          </ToolbarField>
          {ui.prefixChoice === 'custom' && (
            <Input value={ui.customPrefix} onChange={(e) => setUi((u) => ({ ...u, customPrefix: e.target.value }))} placeholder='e.g. "## "' aria-label="Custom prefix" className="mono h-7 w-24" />
          )}
          <Checkbox checked={ui.breakLongWords} onCheckedChange={(v) => setUi((u) => ({ ...u, breakLongWords: v === true }))} label="Break long words" />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className={cn((!ui.reflow || !ui.preserveParagraphs || !ui.preserveIndent || ui.tabSize !== 4) && 'text-accent-text')}>
                <Settings2 /> Options
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80">
              <div className="flex flex-col gap-3">
                <Checkbox checked={ui.reflow} onCheckedChange={(v) => setUi((u) => ({ ...u, reflow: v === true }))} label="Reflow paragraphs" description="Join a paragraph's lines before wrapping. Off: only split lines that are too long." />
                <Checkbox checked={ui.preserveParagraphs} onCheckedChange={(v) => setUi((u) => ({ ...u, preserveParagraphs: v === true }))} label="Preserve paragraphs" description="Keep blank lines between paragraphs. Off: merge all prose into one paragraph." />
                <Checkbox checked={ui.preserveIndent} onCheckedChange={(v) => setUi((u) => ({ ...u, preserveIndent: v === true }))} label="Preserve indentation" description="Repeat a paragraph's leading indentation on wrapped lines." />
                <Field label="Tab width (for indentation)">
                  <Segmented aria-label="Tab width" value={String(ui.tabSize) as '2' | '4' | '8'} onValueChange={(v) => setUi((u) => ({ ...u, tabSize: Number(v) }))} options={[{ value: '2', label: '2' }, { value: '4', label: '4' }, { value: '8', label: '8' }]} />
                </Field>
              </div>
            </PopoverContent>
          </Popover>
        </>
      ) : (
        <>
          <Checkbox checked={unwrapUi.keepListItems} onCheckedChange={(v) => setUnwrapUi((u) => ({ ...u, keepListItems: v === true }))} label="Keep list items" />
          <Checkbox checked={unwrapUi.joinHyphenated} onCheckedChange={(v) => setUnwrapUi((u) => ({ ...u, joinHyphenated: v === true }))} label="Join hyphenated words" />
          <Checkbox checked={unwrapUi.detectPrefix} onCheckedChange={(v) => setUnwrapUi((u) => ({ ...u, detectPrefix: v === true }))} label="Keep comment / quote prefix" />
          <Checkbox checked={unwrapUi.preserveIndent} onCheckedChange={(v) => setUnwrapUi((u) => ({ ...u, preserveIndent: v === true }))} label="Keep indentation" />
        </>
      )}
      <ToolbarSpacer />
      <Button variant="ghost" size="sm" onClick={swap} disabled={!output}>
        <ArrowLeftRight /> Swap
      </Button>
      {mode === 'wrap' && <WidthRules />}
    </Toolbar>
  )

  const prefixMeta = result?.prefix ? (
    <span>
      prefix <span className="mono whitespace-pre rounded-sm bg-surface-2 px-1 text-fg">{result.prefix}</span>
      {result.detected && mode === 'wrap' ? ' detected' : ''}
    </span>
  ) : undefined

  const inputPane = (
    <InputEditorPane
      ref={inputRef}
      title="Input"
      value={input}
      onChange={setInput}
      sample={SAMPLE}
      wordWrap={false}
      placeholder={mode === 'wrap' ? 'Paste text to hard-wrap…' : 'Paste hard-wrapped text to join into paragraphs…'}
      path="wrap-input"
      options={{ rulers }}
      onMount={(ed) => ed.updateOptions({ rulers })}
      footer={
        <>
          <span>{pluralize(inStats.lines, 'line')}</span>
          <span>longest {formatNumber(inStats.longest)} cols</span>
          {mode === 'wrap' && inStats.over > 0 && <span className="text-mod">{formatNumber(inStats.over)} over {ui.width}</span>}
        </>
      }
    />
  )

  const outputPane = (
    <OutputEditorPane
      ref={outputRef}
      title={mode === 'wrap' ? `Wrapped at ${ui.width}` : 'Unwrapped'}
      value={output}
      meta={prefixMeta}
      wordWrap={false}
      filename={mode === 'wrap' ? `wrapped-${ui.width}.txt` : 'unwrapped.txt'}
      path="wrap-output"
      options={{ rulers }}
      onMount={(ed) => ed.updateOptions({ rulers })}
      banner={
        result?.error ? (
          <ErrorDisplay error={result.error} />
        ) : mode === 'wrap' && result && result.overflow > 0 ? (
          <ErrorDisplay
            severity="warning"
            error={`${pluralize(result.overflow, 'line')} still exceed${result.overflow === 1 ? 's' : ''} ${ui.width} columns because ${result.overflow === 1 ? 'it contains a word' : 'they contain words'} longer than the line (URLs, paths). Turn on “Break long words” to split them.`}
          />
        ) : null
      }
      footer={
        <>
          <span>{pluralize(outStats.lines, 'line')}</span>
          <span>longest {formatNumber(outStats.longest)} cols</span>
          {result?.paragraphs != null && <span>{pluralize(result.paragraphs, 'paragraph')}</span>}
        </>
      }
      emptyState={!input ? <EmptyState compact title={mode === 'wrap' ? 'Paste text to wrap it at a fixed column.' : 'Paste hard-wrapped text to join its lines back into paragraphs.'} description={mode === 'wrap' ? 'The guide line shows the target column.' : 'Blank lines, list items and code fences stay as they are.'} /> : undefined}
    />
  )

  return (
    <>
      {toolbar}
      <SplitPane id="wrap" initial={0.42} mobileTabs={['Input', 'Output']} mobileTab={mobileTab} onMobileTabChange={setMobileTab}>
        {inputPane}
        {outputPane}
      </SplitPane>
      <StatusBar>
        <StatusItem label="Mode">{mode === 'wrap' ? `Wrap at ${ui.width}` : 'Unwrap'}</StatusItem>
        <StatusItem label="Lines">
          {formatNumber(inStats.lines)} → {output ? formatNumber(outStats.lines) : '—'}
        </StatusItem>
        <StatusItem label="Longest">
          {formatNumber(inStats.longest)} → {output ? formatNumber(outStats.longest) : '—'} cols
        </StatusItem>
        {mode === 'wrap' && output && <StatusItem label="Over limit" tone={outStats.over ? 'mod' : 'ok'}>{formatNumber(outStats.over)}</StatusItem>}
        <StatusSpacer />
        {!isMobile && <StatusItem label="Widths">CJK & emoji = 2</StatusItem>}
      </StatusBar>
    </>
  )
}
