import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import type { CodeEditorHandle } from '@/components/editors/CodeEditor'
import { InputEditorPane, OutputEditorPane } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { EmptyState } from '@/components/tools/EmptyState'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { useWorker } from '@/hooks/useWorker'
import { useTask } from '@/hooks/useTask'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import {
  CODE_LANGUAGES,
  codeLanguageById,
  DEFAULT_CODE_FORMAT,
  detectLanguageFromFilename,
  sniffLanguage,
  type CodeFormatOptions,
  type CodeFormatResult,
  type CodeLanguageId,
} from '@/engines/dev/code-format'
import { formatDuration, pluralize } from '@/utils/format'
import { cn } from '@/utils/cn'
import FormatWorker from './worker.ts?worker'
import type { Tasks } from './worker'

type LangChoice = CodeLanguageId | 'auto'

const LANGUAGE_OPTIONS = [
  { label: 'Detect', options: [{ value: 'auto' as LangChoice, label: 'Auto-detect', description: 'Guess from the content' }] },
  { label: 'Script', options: CODE_LANGUAGES.filter((l) => ['javascript', 'jsx', 'typescript', 'tsx'].includes(l.id)).map((l) => ({ value: l.id as LangChoice, label: l.label })) },
  { label: 'Data', options: CODE_LANGUAGES.filter((l) => ['json', 'json5', 'yaml', 'graphql'].includes(l.id)).map((l) => ({ value: l.id as LangChoice, label: l.label })) },
  { label: 'Styles', options: CODE_LANGUAGES.filter((l) => ['css', 'scss', 'less'].includes(l.id)).map((l) => ({ value: l.id as LangChoice, label: l.label })) },
  { label: 'Markup', options: CODE_LANGUAGES.filter((l) => ['html', 'vue', 'angular', 'markdown', 'mdx'].includes(l.id)).map((l) => ({ value: l.id as LangChoice, label: l.label })) },
]

const ACCEPT = CODE_LANGUAGES.flatMap((l) => l.extensions.map((e) => `.${e.split('.').pop()}`)).join(',')

export default function CodeFormatter() {
  const [input, setInput] = usePersistentState('input', '')
  const [choice, setChoice] = usePersistentState<LangChoice>('language', 'auto')
  const [opts, setOpts] = usePersistentState<CodeFormatOptions>('options', DEFAULT_CODE_FORMAT)
  const [mobileTab, setMobileTab] = useState<0 | 1>(0)
  const inputRef = useRef<CodeEditorHandle>(null)
  const worker = useWorker<Tasks>(() => new FormatWorker({ name: 'code-formatter' }))
  const task = useTask<{ result: CodeFormatResult; language: CodeLanguageId; source: string }>()
  useIncomingInput(setInput)

  const debounced = useDebouncedValue(input, Math.max(250, adaptiveDelay(input.length)))
  const detected = useMemo(() => (choice === 'auto' ? sniffLanguage(debounced) : null), [choice, debounced])
  const language: CodeLanguageId | null = choice === 'auto' ? detected : choice
  const lang = language ? codeLanguageById.get(language)! : null
  const set = <K extends keyof CodeFormatOptions>(k: K, v: CodeFormatOptions[K]) => setOpts({ ...opts, [k]: v })
  const optsKey = JSON.stringify(opts)

  useEffect(() => {
    if (!debounced.trim() || !language) {
      task.reset()
      return
    }
    void task.run(async (signal) => ({ result: await worker.run('format', { code: debounced, language, options: opts }, signal), language, source: debounced }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, language, optsKey])

  const res = task.result?.result
  const output = res && res.ok && input ? res.output : ''
  const error = res && !res.ok ? res.error : null
  const stale = input !== debounced || task.running

  const onFileLoaded = (name: string) => {
    const l = detectLanguageFromFilename(name)
    if (l) {
      setChoice(l)
      toast.message(`Language set to ${codeLanguageById.get(l)!.label}`, { description: `Detected from ${name}` })
    }
  }

  const sampleLang = lang ?? codeLanguageById.get('typescript')!
  const relevant = new Set(lang?.options ?? ['js', 'quotes', 'prose', 'html'])
  const changedLines = useMemo(() => {
    if (!output || !task.result) return null
    const a = task.result.source.split('\n')
    const b = output.split('\n')
    return { before: a.length, after: b.length }
  }, [output, task.result])

  const toolbar = (
    <Toolbar>
      <ToolbarField label="Language">
        <Select
          aria-label="Language"
          value={choice}
          onValueChange={setChoice}
          options={LANGUAGE_OPTIONS}
        />
      </ToolbarField>
      {choice === 'auto' && (
        <span className="shrink-0 text-xs text-subtle">
          {detected ? (
            <>
              detected <span className="text-muted">{codeLanguageById.get(detected)!.label}</span>
            </>
          ) : input.trim() ? (
            'could not detect — pick one'
          ) : (
            'paste code or open a file'
          )}
        </span>
      )}
      <ToolbarSeparator />
      <ToolbarField label="Width">
        <Input
          aria-label="Print width"
          type="number"
          min={20}
          max={400}
          value={opts.printWidth}
          onChange={(e) => set('printWidth', Number(e.target.value) || 80)}
          className="mono h-7 w-16 tabular"
        />
      </ToolbarField>
      <ToolbarField label="Indent">
        <Select
          aria-label="Indentation"
          value={opts.useTabs ? 'tab' : String(opts.tabWidth)}
          onValueChange={(v) => setOpts({ ...opts, useTabs: v === 'tab', tabWidth: v === 'tab' ? opts.tabWidth : Number(v) })}
          options={[
            { value: '2', label: '2 spaces' },
            { value: '4', label: '4 spaces' },
            { value: '8', label: '8 spaces' },
            { value: 'tab', label: 'Tabs' },
          ]}
        />
      </ToolbarField>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={cn(JSON.stringify({ ...opts, printWidth: 80, tabWidth: 2, useTabs: false }) !== JSON.stringify(DEFAULT_CODE_FORMAT) && 'text-accent-text')}>
            <Settings2 /> Options
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[340px]" align="start">
          <div className="flex flex-col gap-3.5">
            {relevant.has('js') && (
              <>
                <p className="eyebrow">JavaScript & TypeScript</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                  <Checkbox checked={opts.semi} onCheckedChange={(v) => set('semi', v === true)} label="Semicolons" />
                  <Checkbox checked={opts.bracketSpacing} onCheckedChange={(v) => set('bracketSpacing', v === true)} label="Bracket spacing" />
                  <Checkbox checked={opts.jsxSingleQuote} onCheckedChange={(v) => set('jsxSingleQuote', v === true)} label="JSX single quotes" />
                  <Checkbox checked={opts.bracketSameLine} onCheckedChange={(v) => set('bracketSameLine', v === true)} label="> on last line" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Trailing commas">
                    <Select aria-label="Trailing commas" value={opts.trailingComma} onValueChange={(v) => set('trailingComma', v)} options={[{ value: 'all', label: 'All' }, { value: 'es5', label: 'ES5' }, { value: 'none', label: 'None' }]} />
                  </Field>
                  <Field label="Arrow parens">
                    <Select aria-label="Arrow function parentheses" value={opts.arrowParens} onValueChange={(v) => set('arrowParens', v)} options={[{ value: 'always', label: '(x) => x' }, { value: 'avoid', label: 'x => x' }]} />
                  </Field>
                </div>
              </>
            )}
            {relevant.has('quotes') && <Checkbox checked={opts.singleQuote} onCheckedChange={(v) => set('singleQuote', v === true)} label="Prefer single quotes" />}
            {relevant.has('prose') && (
              <Field label="Prose wrap" hint="Markdown / YAML text wrapping at the print width">
                <Segmented aria-label="Prose wrap" value={opts.proseWrap} onValueChange={(v) => set('proseWrap', v)} options={[{ value: 'preserve', label: 'Preserve' }, { value: 'always', label: 'Always' }, { value: 'never', label: 'Never' }]} />
              </Field>
            )}
            {relevant.has('html') && (
              <Field label="HTML whitespace" hint="“css” follows display rules; “ignore” may change rendering">
                <Segmented aria-label="HTML whitespace sensitivity" value={opts.htmlWhitespaceSensitivity} onValueChange={(v) => set('htmlWhitespaceSensitivity', v)} options={[{ value: 'css', label: 'CSS' }, { value: 'strict', label: 'Strict' }, { value: 'ignore', label: 'Ignore' }]} />
              </Field>
            )}
            <Field label="Line endings">
              <Segmented aria-label="Line endings" value={opts.endOfLine} onValueChange={(v) => set('endOfLine', v)} options={[{ value: 'lf', label: 'LF' }, { value: 'crlf', label: 'CRLF' }]} />
            </Field>
            <Button size="sm" variant="ghost" className="self-start" onClick={() => setOpts(DEFAULT_CODE_FORMAT)}>
              Reset to Prettier defaults
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <ToolbarSpacer />
      {task.running && (
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
          <Loader2 className="size-3.5 animate-spin" /> Formatting…
        </span>
      )}
    </Toolbar>
  )

  const banner = error ? (
    <ErrorDisplay
      title="Syntax error"
      error={{ message: error.message, line: error.line, column: error.column, detail: error.frame }}
      onLocate={(l, c) => {
        setMobileTab(0)
        requestAnimationFrame(() => inputRef.current?.revealPosition(l, c))
      }}
    />
  ) : task.error ? (
    <ErrorDisplay error={task.error.message} />
  ) : null

  return (
    <>
      {toolbar}
      <SplitPane id="code-formatter" initial={0.5} mobileTabs={['Input', 'Formatted']} mobileTab={mobileTab} onMobileTabChange={setMobileTab}>
        <InputEditorPane
          ref={inputRef}
          value={input}
          onChange={setInput}
          language={lang?.monaco ?? 'plaintext'}
          sample={() => {
            if (choice === 'auto') setChoice(sampleLang.id)
            return sampleLang.sample
          }}
          sampleLabel={`Load ${sampleLang.label} sample`}
          accept={ACCEPT}
          onFileLoaded={onFileLoaded}
          markers={error?.line ? [{ line: error.line, column: error.column ?? 1, message: error.message }] : undefined}
          placeholder="Paste code or drop a file — the language is detected from its extension…"
          path="code-formatter-input"
        />
        <OutputEditorPane
          title="Formatted"
          value={output}
          language={lang?.monaco ?? 'plaintext'}
          filename={() => `formatted.${lang?.extensions[0] ?? 'txt'}`}
          meta={
            <span className="flex items-center gap-2">
              {stale && input && <Loader2 className="size-3 animate-spin" aria-label="Updating" />}
              {lang && <span className="text-muted">{lang.label}</span>}
              {res?.ok && !res.changed && <span>already formatted</span>}
            </span>
          }
          banner={banner}
          path="code-formatter-output"
          emptyState={
            !input ? (
              <EmptyState compact title="Paste code to format it with Prettier." description="JavaScript, TypeScript, CSS, HTML, Vue, JSON, Markdown, YAML and GraphQL. Code is parsed, never run." />
            ) : error ? (
              <EmptyState compact title="Nothing to show until the input parses." description="Fix the syntax error above — use “Go to” to jump to it." />
            ) : !language ? (
              <EmptyState compact title="Couldn't detect the language." description="Choose one in the toolbar to format this input." />
            ) : undefined
          }
        />
      </SplitPane>
      <StatusBar>
        <StatusItem label="Language">{lang ? lang.label : '—'}</StatusItem>
        <StatusItem label="Parser">{lang ? lang.parser : '—'}</StatusItem>
        {changedLines && <StatusItem label="Lines">{`${changedLines.before} → ${changedLines.after}`}</StatusItem>}
        {error && <StatusItem tone="danger">Syntax error{error.line ? ` at ${error.line}:${error.column ?? 1}` : ''}</StatusItem>}
        <StatusSpacer />
        {task.duration != null && output && <StatusItem label="Took">{formatDuration(task.duration)}</StatusItem>}
        <StatusItem label="Prettier">{lang ? `${pluralize(lang.plugins.length, 'plugin')}, loaded on demand` : 'plugins load on demand'}</StatusItem>
      </StatusBar>
    </>
  )
}
