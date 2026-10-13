import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, Info, Loader2, Play, Settings2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  CASE_FORMATS,
  caseFormatById,
  convertCase,
  detectStyles,
  renameIdentifiers,
  STYLE_LABELS,
  transliterate,
  type CaseId,
  type CaseOptions,
  type IdentifierCaseId,
} from '@/engines/case'
import { countWords } from '@/engines/text/stats'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { useWorker } from '@/hooks/useWorker'
import { useTask } from '@/hooks/useTask'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { useIsMobile } from '@/hooks/useMediaQuery'
import type { TextTasks } from '@/workers/text.tasks'
import { createTextWorker } from '@/workers/factories'
import type { CodeEditorHandle } from '@/components/editors/CodeEditor'
import { InputEditorPane, OutputEditorPane, useTextMetrics } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarField, ToolbarGroup, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/common/CopyButton'
import { EmptyState } from '@/components/tools/EmptyState'
import { usePrefs } from '@/stores/prefs'
import { cn } from '@/utils/cn'
import { formatBytes, formatDuration, formatNumber, pluralize } from '@/utils/format'

/** Above this size, conversions are previewed on a sample and run in full only on request. */
const LARGE_INPUT = 150_000
/** Previews in the format list are computed from this many leading characters. */
const PREVIEW_CHARS = 1_200

const SAMPLE = `user profile settings
XMLHttpRequest
parseHTTPResponse
get_user_by_id
max-retry-count
The quick brown fox jumps over the lazy dog. it was a sunny day!`

interface UiOptions {
  acronyms: CaseOptions['acronyms']
  acronymList: string
  separateNumbers: boolean
  scope: CaseOptions['scope']
  titleStyle: CaseOptions['titleStyle']
  translit: boolean
  german: boolean
}

const DEFAULT_UI: UiOptions = {
  acronyms: 'words',
  acronymList: '',
  separateNumbers: false,
  scope: 'lines',
  titleStyle: 'smart',
  translit: false,
  german: false,
}

const LOCALES = [
  { value: 'auto', label: 'Default', description: 'Unicode default mapping' },
  { value: 'en', label: 'English' },
  { value: 'tr', label: 'Turkish', description: 'i ↔ İ, ı ↔ I' },
  { value: 'az', label: 'Azerbaijani', description: 'i ↔ İ, ı ↔ I' },
  { value: 'nl', label: 'Dutch', description: 'IJ digraph' },
  { value: 'lt', label: 'Lithuanian', description: 'Dotted i with accents' },
  { value: 'el', label: 'Greek', description: 'Accents dropped in capitals' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
  { value: 'ru', label: 'Russian' },
]

const IDENTIFIER_OPTIONS: { value: IdentifierCaseId; label: string }[] = CASE_FORMATS.filter((f) => f.kind === 'identifier' && f.id !== 'space' && f.id !== 'dot' && f.id !== 'path').map((f) => ({
  value: f.id as IdentifierCaseId,
  label: f.name,
}))

function cutPreview(text: string, max: number) {
  if (text.length <= max) return text
  const nl = text.lastIndexOf('\n', max)
  return text.slice(0, nl > max * 0.5 ? nl : max)
}

function firstLine(s: string) {
  const i = s.search(/\r?\n/)
  return i === -1 ? s : s.slice(0, i)
}

function RulesPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <Info /> Rules
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] text-[13px] leading-[19px] text-muted">
        <p className="mb-2 text-sm font-medium text-fg">How text is split into words</p>
        <ul className="flex list-disc flex-col gap-1.5 pl-4">
          <li><span className="text-fg">Separators:</span> spaces, punctuation, <code className="mono">_ - . /</code> all split words and are dropped by identifier formats. Text formats keep punctuation exactly.</li>
          <li><span className="text-fg">Case boundaries:</span> <code className="mono">fooBar</code> → foo · Bar; an uppercase run ends before a capitalised word: <code className="mono">XMLHttp</code> → XML · Http.</li>
          <li><span className="text-fg">Apostrophes</span> inside words are removed: don't → dont.</li>
          <li><span className="text-fg">Digits</span> stay attached (<code className="mono">v2Api</code> → v2 · Api) unless “Split numbers” is on.</li>
          <li><span className="text-fg">Acronyms:</span> “As words” gives <code className="mono">xmlHttpRequest</code>; “Preserve” keeps capitalised words: <code className="mono">XMLHttpRequest</code>. Lines with no lowercase letters are never treated as acronyms.</li>
          <li><span className="text-fg">Title Case (smart)</span> keeps English minor words (a, of, the, and…) lowercase except first/last; brand-style words like iPhone are kept.</li>
          <li><span className="text-fg">Unicode:</span> accented, Cyrillic and Greek letters are cased correctly; CJK/Thai are segmented with the browser's word segmenter. Pick a locale for Turkish, Dutch and similar rules.</li>
          <li><span className="text-fg">Transliteration</span> (optional, applied first) converts to ASCII: Straße → Strasse, café → cafe.</li>
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export default function CaseConverter() {
  const [input, setInput] = usePersistentState('input', '')
  const [ui, setUi] = usePersistentState<UiOptions>('options', DEFAULT_UI)
  const [selected, setSelected] = usePersistentState<CaseId>('selected', 'camel')
  const [mode, setMode] = usePersistentState<'convert' | 'rename'>('mode', 'convert')
  const [renameFrom, setRenameFrom] = usePersistentState<IdentifierCaseId | 'any'>('renameFrom', 'snake')
  const [renameTo, setRenameTo] = usePersistentState<IdentifierCaseId>('renameTo', 'camel')
  const [skipStrings, setSkipStrings] = usePersistentState('skipStrings', true)
  const locale = usePrefs((s) => s.caseLocale)
  const setPrefs = usePrefs((s) => s.set)
  const inputRef = useRef<CodeEditorHandle>(null)
  const isMobile = useIsMobile()
  const [mobileTab, setMobileTab] = useState<'input' | 'formats' | 'output'>('input')

  const worker = useWorker<TextTasks>(createTextWorker)
  const fullTask = useTask<{ text: string; key: string }>()

  useIncomingInput(setInput)

  const options: Partial<CaseOptions> = useMemo(
    () => ({
      locale: locale === 'auto' ? undefined : locale,
      acronyms: ui.acronyms,
      acronymList: ui.acronymList.split(/[\s,]+/).filter(Boolean),
      separateNumbers: ui.separateNumbers,
      scope: ui.scope,
      titleStyle: ui.titleStyle,
    }),
    [locale, ui],
  )
  const translit = useMemo(() => ({ enabled: ui.translit, german: ui.german }), [ui.translit, ui.german])

  const deferredInput = useDeferredValue(input)
  const isLarge = deferredInput.length > LARGE_INPUT
  const previewSrc = useMemo(() => cutPreview(deferredInput, PREVIEW_CHARS), [deferredInput])

  const convertSync = useCallback(
    (text: string, id: CaseId) => convertCase(translit.enabled ? transliterate(text, { german: translit.german }) : text, id, options),
    [options, translit],
  )

  const previews = useMemo(() => {
    const m = new Map<CaseId, string>()
    if (!previewSrc) return m
    for (const f of CASE_FORMATS) m.set(f.id, convertSync(previewSrc, f.id))
    return m
  }, [previewSrc, convertSync])

  const detection = useMemo(() => detectStyles(deferredInput.slice(0, 50_000), 1000), [deferredInput])

  // Key identifying the current input+settings, used to tell whether a full (worker) result is stale.
  const settingsKey = JSON.stringify([selected, options, translit, mode, renameFrom, renameTo, skipStrings])
  const fullKey = `${deferredInput.length}:${hash(deferredInput)}:${settingsKey}`

  const renameResult = useMemo(() => {
    if (mode !== 'rename' || isLarge) return null
    const src = translit.enabled ? transliterate(deferredInput, { german: translit.german }) : deferredInput
    return renameIdentifiers(src, { ...options, from: renameFrom, to: renameTo, skipStringsAndComments: skipStrings })
  }, [mode, isLarge, deferredInput, options, renameFrom, renameTo, skipStrings, translit])

  const syncOutput = useMemo(() => {
    if (isLarge) return null
    if (mode === 'rename') return renameResult?.text ?? ''
    return deferredInput ? convertSync(deferredInput, selected) : ''
  }, [isLarge, mode, renameResult, deferredInput, convertSync, selected])

  const fullIsCurrent = fullTask.result?.key === fullKey
  const output = syncOutput ?? (fullIsCurrent ? fullTask.result!.text : '')

  const runFull = () =>
    fullTask.run(async (signal) => {
      const key = fullKey
      if (mode === 'rename') {
        const r = await worker.run('caseRename', { text: input, translit, options: { ...options, from: renameFrom, to: renameTo, skipStringsAndComments: skipStrings } }, signal)
        return { text: r.text, key }
      }
      const text = await worker.run('caseConvert', { text: input, id: selected, options, translit }, signal)
      return { text, key }
    })

  /** Full conversion of any format for copying (worker-backed for large input). */
  const fullConversion = async (id: CaseId): Promise<string> => {
    if (!isLarge) return convertSync(input, id)
    const t = toast.loading(`Converting ${formatBytes(input.length)} to ${caseFormatById.get(id)?.name}…`)
    try {
      const text = await worker.run('caseConvert', { text: input, id, options, translit })
      toast.dismiss(t)
      return text
    } catch (e) {
      toast.error(String(e), { id: t })
      throw e
    }
  }

  const swap = () => {
    if (!output) return
    if (inputRef.current?.editor) inputRef.current.replaceAll(output)
    else setInput(output)
    toast.message('Output moved to input', { description: 'Undo with Ctrl/⌘+Z in the input editor.' })
  }

  const metrics = useTextMetrics(input)
  const wordSource = useDebouncedValue(input, adaptiveDelay(input.length) + 100)
  const words = useMemo(() => (wordSource.length <= 3_000_000 ? countWords(wordSource) : null), [wordSource])
  const selectedFormat = caseFormatById.get(selected)!

  const toolbar = (
    <Toolbar>
      <Segmented
        aria-label="Mode"
        value={mode}
        onValueChange={setMode}
        options={[
          { value: 'convert', label: 'Convert', tooltip: 'Convert the whole text to a casing style' },
          { value: 'rename', label: 'Rename in code', tooltip: 'Rename identifiers of one convention inside source code' },
        ]}
      />
      <ToolbarSeparator />
      {mode === 'convert' ? (
        <ToolbarGroup>
          <ToolbarField label="Identifiers">
            <Segmented
              aria-label="Identifier scope"
              value={ui.scope}
              onValueChange={(scope) => setUi({ ...ui, scope })}
              options={[
                { value: 'lines', label: 'Per line', tooltip: 'Each line becomes its own identifier' },
                { value: 'whole', label: 'Whole text', tooltip: 'All text becomes a single identifier' },
              ]}
            />
          </ToolbarField>
        </ToolbarGroup>
      ) : (
        <ToolbarGroup className="gap-2">
          <ToolbarField label="From">
            <Select aria-label="Rename from" value={renameFrom} onValueChange={setRenameFrom} options={[{ value: 'any', label: 'Any convention' }, ...IDENTIFIER_OPTIONS]} />
          </ToolbarField>
          <ToolbarField label="To">
            <Select aria-label="Rename to" value={renameTo} onValueChange={setRenameTo} options={IDENTIFIER_OPTIONS} />
          </ToolbarField>
          <Checkbox checked={skipStrings} onCheckedChange={(v) => setSkipStrings(v === true)} label="Skip strings & comments" />
        </ToolbarGroup>
      )}
      <ToolbarSeparator />
      <ToolbarField label="Acronyms">
        <Select
          aria-label="Acronym handling"
          value={ui.acronyms}
          onValueChange={(acronyms) => setUi({ ...ui, acronyms })}
          options={[
            { value: 'words', label: 'As words', description: 'XMLHttp → xmlHttp' },
            { value: 'preserve', label: 'Preserve', description: 'XMLHttp → XMLHttp' },
          ]}
        />
      </ToolbarField>
      <ToolbarField label="Locale">
        <Select aria-label="Locale" value={locale} onValueChange={(v) => setPrefs({ caseLocale: v })} options={LOCALES} />
      </ToolbarField>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={cn((ui.separateNumbers || ui.acronymList || ui.translit || ui.titleStyle !== 'smart') && 'text-accent-text')}>
            <Settings2 /> Options
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <div className="flex flex-col gap-3.5">
            <Field label="Always-uppercase acronyms" hint="Comma or space separated, e.g. ID, URL, API">
              <Input value={ui.acronymList} onChange={(e) => setUi({ ...ui, acronymList: e.target.value })} placeholder="ID, URL, API" />
            </Field>
            <Checkbox checked={ui.separateNumbers} onCheckedChange={(v) => setUi({ ...ui, separateNumbers: v === true })} label="Split numbers into separate words" description="version2Api → version_2_api" />
            <Field label="Title Case style">
              <Segmented
                aria-label="Title case style"
                value={ui.titleStyle}
                onValueChange={(titleStyle) => setUi({ ...ui, titleStyle })}
                options={[
                  { value: 'smart', label: 'Smart (minor words lowercase)' },
                  { value: 'all', label: 'Every word' },
                ]}
              />
            </Field>
            <div className="h-px bg-border" />
            <Checkbox checked={ui.translit} onCheckedChange={(v) => setUi({ ...ui, translit: v === true })} label="Transliterate to ASCII first" description="Straße → Strasse, café → cafe, Привет → Privet" />
            {ui.translit && (
              <Checkbox checked={ui.german} onCheckedChange={(v) => setUi({ ...ui, german: v === true })} label="German umlauts as ae / oe / ue" className="ml-6" />
            )}
          </div>
        </PopoverContent>
      </Popover>
      <ToolbarSpacer />
      <Button variant="ghost" size="sm" onClick={swap} disabled={!output}>
        <ArrowLeftRight /> Swap
      </Button>
      <RulesPopover />
    </Toolbar>
  )

  const formatList = (
    <aside aria-label="Formats" className="flex min-h-0 flex-col bg-workspace">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <h2 className="eyebrow">Formats</h2>
        {detection.dominant && (
          <span className="truncate text-2xs text-subtle">
            · detected <span className="text-muted">{STYLE_LABELS[detection.dominant]}</span>
            {detection.dominant === 'mixed' ? (detection.lines > 1 ? ' styles' : '') : detection.lines > 1 && ` (${detection.counts[detection.dominant]}/${detection.lines} lines)`}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1" role="listbox" aria-label="Casing formats" aria-activedescendant={`fmt-${selected}`}>
        {(['identifier', 'text'] as const).map((kind) => (
          <div key={kind}>
            <p className="eyebrow px-3 pb-1 pt-2.5">{kind === 'identifier' ? 'Identifiers' : 'Text'}</p>
            {CASE_FORMATS.filter((f) => f.kind === kind).map((f) => {
              const preview = previews.get(f.id)
              const active = selected === f.id && mode === 'convert'
              return (
                <div
                  key={f.id}
                  id={`fmt-${f.id}`}
                  role="option"
                  aria-selected={active}
                  tabIndex={0}
                  onClick={() => {
                    setMode('convert')
                    setSelected(f.id)
                    if (isMobile) setMobileTab('output')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setMode('convert')
                      setSelected(f.id)
                    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault()
                      const items = Array.from(e.currentTarget.closest('[role=listbox]')!.querySelectorAll<HTMLElement>('[role=option]'))
                      const i = items.indexOf(e.currentTarget)
                      items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
                    }
                  }}
                  className={cn(
                    'group relative mx-1.5 flex cursor-default items-center gap-2 rounded-md py-1.5 pl-2.5 pr-1 outline-none transition-colors duration-100 hover:bg-surface-2/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                    active && 'bg-accent-soft hover:bg-accent-soft',
                  )}
                  title={f.description}
                >
                  {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className={cn('mono text-[12px] leading-[18px]', active ? 'text-fg' : 'text-muted')}>{f.name}</span>
                      {f.aliases && <span className="truncate text-2xs text-subtle">{f.aliases[0]}</span>}
                    </div>
                    <p className={cn('mono truncate text-[12.5px] leading-[18px]', preview ? 'text-fg' : 'text-muted')}>
                      {preview ? firstLine(preview) || ' ' : f.example}
                    </p>
                  </div>
                  <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <CopyButton value={() => fullConversion(f.id)} label={`Copy ${f.name}`} disabled={!input} className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100" />
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </aside>
  )

  const outputBanner =
    isLarge && !fullIsCurrent ? (
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-surface px-3 py-2 text-sm">
        <span className="min-w-0 flex-1 text-muted">
          Large input ({formatBytes(metrics.bytes)}). Format previews use the first {formatNumber(PREVIEW_CHARS)} characters.
          {fullTask.result && !fullIsCurrent && ' Input or settings changed since the last run.'}
        </span>
        {fullTask.running ? (
          <>
            <span className="flex items-center gap-1.5 text-muted">
              <Loader2 className="size-3.5 animate-spin" /> Converting…
            </span>
            <Button size="sm" variant="ghost" onClick={fullTask.cancel}>
              <X /> Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" variant="primary" onClick={runFull}>
            <Play /> {mode === 'rename' ? 'Rename in full text' : `Convert full text to ${selectedFormat.name}`}
          </Button>
        )}
      </div>
    ) : fullTask.error ? (
      <div className="border-b border-danger/25 bg-danger-soft px-3 py-2 text-sm">{fullTask.error.message}</div>
    ) : null

  const inputPane = (
    <InputEditorPane
      ref={inputRef}
      value={input}
      onChange={setInput}
      sample={SAMPLE}
      placeholder="Paste text or identifiers — one per line…"
      path="case-input"
      footer={
        <>
          <span>{pluralize(metrics.chars, 'char')}</span>
          <span>{words == null ? '— words' : pluralize(words, 'word')}</span>
          <span>{pluralize(metrics.lines, 'line')}</span>
          <span>{formatBytes(metrics.bytes)}</span>
        </>
      }
    />
  )

  const outputPane = (
    <OutputEditorPane
      value={output}
      title={mode === 'rename' ? 'Renamed' : 'Output'}
      meta={mode === 'convert' ? <span className="mono text-muted">{selectedFormat.name}</span> : renameResult ? `${formatNumber(renameResult.count)} identifiers renamed` : undefined}
      filename={`converted-${selected}.txt`}
      banner={outputBanner}
      path="case-output"
      emptyState={
        !input ? (
          <EmptyState compact title="Paste text to preview different naming conventions." description="Pick a format on the right — the full result appears here." />
        ) : undefined
      }
    />
  )

  const status = (
    <StatusBar>
      <StatusItem label="Mode">{mode === 'convert' ? selectedFormat.name : `Rename ${renameFrom === 'any' ? 'any' : caseFormatById.get(renameFrom)?.name} → ${caseFormatById.get(renameTo)?.name}`}</StatusItem>
      {isLarge && <StatusItem tone="mod">Preview mode — large input</StatusItem>}
      {fullTask.duration != null && fullIsCurrent && <StatusItem label="Full conversion">{formatDuration(fullTask.duration)}</StatusItem>}
      <StatusSpacer />
      <StatusItem label="Locale">{LOCALES.find((l) => l.value === locale)?.label}</StatusItem>
      <Badge tone="neutral">Processed locally</Badge>
    </StatusBar>
  )

  if (isMobile) {
    return (
      <>
        {toolbar}
        <div className="flex shrink-0 items-center border-b border-border bg-bg px-3 py-1.5">
          <Segmented
            aria-label="Visible pane"
            value={mobileTab}
            onValueChange={setMobileTab}
            className="w-full [&>*]:flex-1 [&>*]:justify-center"
            options={[
              { value: 'input', label: 'Input' },
              { value: 'formats', label: 'Formats' },
              { value: 'output', label: 'Output' },
            ]}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{mobileTab === 'input' ? inputPane : mobileTab === 'formats' ? formatList : outputPane}</div>
        {status}
      </>
    )
  }

  return (
    <>
      {toolbar}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <SplitPane direction="vertical" id="case-io" initial={0.5} min={120}>
            {inputPane}
            {outputPane}
          </SplitPane>
        </div>
        <div className={cn('flex w-[300px] shrink-0 flex-col border-l border-border lg:w-[340px] xl:w-[380px]', mode === 'rename' && 'opacity-70')}>{formatList}</div>
      </div>
      {status}
    </>
  )
}

/** Cheap fingerprint of a (possibly huge) string: samples the ends and middle. */
function hash(s: string): number {
  let h = 2166136261
  const step = Math.max(1, Math.floor(s.length / 4096))
  for (let i = 0; i < s.length; i += step) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  for (let i = Math.max(0, s.length - 256); i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
