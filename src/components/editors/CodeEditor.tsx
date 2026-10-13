import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { editor as MonacoEditor, IDisposable } from 'monaco-esm/editor/editor.api.js'
import { loadMonaco, type Monaco } from './monaco/loader'
import { usePrefs } from '@/stores/prefs'
import { cn } from '@/utils/cn'

export interface EditorMarker {
  message: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
  severity?: 'error' | 'warning' | 'info'
}

export interface CodeEditorHandle {
  editor: MonacoEditor.IStandaloneCodeEditor | null
  monaco: Monaco | null
  getValue: () => string
  /** Replace the whole document as a single undoable edit. */
  replaceAll: (text: string) => void
  focus: () => void
  revealPosition: (line: number, column?: number) => void
  /** Selects a range (1-based) and scrolls it into view. */
  selectRange: (startLine: number, startColumn: number, endLine: number, endColumn: number) => void
}

export interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  language?: string
  readOnly?: boolean
  placeholder?: string
  ariaLabel: string
  className?: string
  lineNumbers?: boolean
  wordWrap?: boolean
  folding?: boolean
  markers?: EditorMarker[]
  options?: MonacoEditor.IStandaloneEditorConstructionOptions
  onMount?: (editor: MonacoEditor.IStandaloneCodeEditor, monaco: Monaco) => void
  /** Model URI path; lets the JSON worker associate schemas, and keeps models distinct. */
  path?: string
}

/** Above this size the editor switches to a lean configuration (no folding, wrapping, etc). */
export const LARGE_DOC_CHARS = 5_000_000

let modelSeq = 0

/**
 * Monaco wrapper tuned for large pasted content:
 * - external value updates are applied as undoable edits (input) or setValue (read-only output)
 * - change events are debounced for very large documents so typing stays responsive
 * - heavy features are switched off automatically for multi-megabyte documents
 */
export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  {
    value,
    onChange,
    language = 'plaintext',
    readOnly = false,
    placeholder,
    ariaLabel,
    className,
    lineNumbers = true,
    wordWrap,
    folding = true,
    markers,
    options,
    onMount,
    path,
  },
  ref,
) {
  const host = useRef<HTMLDivElement>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const lastValue = useRef(value)
  /** Values recently emitted by the editor. A re-render carrying one of these is a stale echo. */
  const emitted = useRef<string[]>([])
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const [ready, setReady] = useState(false)
  const fontSize = usePrefs((s) => s.editorFontSize)
  const prefWrap = usePrefs((s) => s.editorWordWrap)
  const minimap = usePrefs((s) => s.editorMinimap)
  const effectiveWrap = wordWrap ?? prefWrap
  const isLarge = value.length > LARGE_DOC_CHARS

  useImperativeHandle(
    ref,
    () => ({
      get editor() {
        return editorRef.current
      },
      get monaco() {
        return monacoRef.current
      },
      getValue: () => editorRef.current?.getModel()?.getValue() ?? lastValue.current,
      replaceAll: (text: string) => applyUndoable(editorRef.current, text),
      focus: () => editorRef.current?.focus(),
      revealPosition: (line: number, column = 1) => {
        const ed = editorRef.current
        if (!ed) return
        ed.revealPositionInCenter({ lineNumber: line, column })
        ed.setPosition({ lineNumber: line, column })
        ed.focus()
      },
      selectRange: (startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) => {
        const ed = editorRef.current
        if (!ed) return
        ed.setSelection({ startLineNumber, startColumn, endLineNumber, endColumn })
        ed.revealRangeInCenterIfOutsideViewport({ startLineNumber, startColumn, endLineNumber, endColumn })
        ed.focus()
      },
    }),
    [],
  )

  // Create the editor once.
  useEffect(() => {
    let disposed = false
    const disposables: IDisposable[] = []
    let debounce: ReturnType<typeof setTimeout> | undefined
    loadMonaco().then((monaco) => {
      if (disposed || !host.current) return
      monacoRef.current = monaco
      const uri = monaco.Uri.parse(`inmemory://devtoolkit/${path ?? `model-${++modelSeq}`}`)
      monaco.editor.getModel(uri)?.dispose()
      const model = monaco.editor.createModel(value, language, uri)
      lastValue.current = value
      const dark = document.documentElement.classList.contains('dark')
      const large = value.length > LARGE_DOC_CHARS
      const ed = monaco.editor.create(host.current, {
        model,
        theme: dark ? 'devtoolkit-dark' : 'devtoolkit-light',
        automaticLayout: true,
        readOnly,
        domReadOnly: false,
        ariaLabel,
        placeholder,
        fontFamily: "'Geist Mono Variable', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
        fontSize,
        lineHeight: Math.round(fontSize * 1.55),
        fontLigatures: false,
        letterSpacing: 0,
        lineNumbers: lineNumbers ? 'on' : 'off',
        lineNumbersMinChars: 3,
        lineDecorationsWidth: 8,
        glyphMargin: false,
        folding: folding && !large,
        showFoldingControls: 'mouseover',
        wordWrap: effectiveWrap && !large ? 'on' : 'off',
        minimap: { enabled: minimap && !large, renderCharacters: false, scale: 2 },
        scrollBeyondLastLine: false,
        renderLineHighlight: readOnly ? 'none' : 'line',
        renderWhitespace: 'selection',
        smoothScrolling: false,
        cursorBlinking: 'smooth',
        overviewRulerLanes: 2,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        padding: { top: 10, bottom: 10 },
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false, alwaysConsumeMouseWheel: false },
        stickyScroll: { enabled: false },
        unusualLineTerminators: 'off',
        unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: true, nonBasicASCII: false },
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        wordBasedSuggestions: 'off',
        parameterHints: { enabled: false },
        codeLens: false,
        contextmenu: true,
        links: false,
        occurrencesHighlight: large ? 'off' : 'singleFile',
        bracketPairColorization: { enabled: !large },
        guides: { indentation: !large, bracketPairs: false },
        largeFileOptimizations: true,
        maxTokenizationLineLength: 20_000,
        stopRenderingLineAfter: 10_000,
        fixedOverflowWidgets: true,
        tabSize: 2,
        detectIndentation: true,
        ...options,
      })
      editorRef.current = ed

      disposables.push(
        model.onDidChangeContent(() => {
          if (!onChangeRef.current) return
          const size = model.getValueLength()
          clearTimeout(debounce)
          const emit = () => {
            const v = model.getValue()
            lastValue.current = v
            emitted.current.push(v)
            if (emitted.current.length > 2000) emitted.current.splice(0, 1000)
            onChangeRef.current?.(v)
          }
          if (size < 1_000_000) emit()
          else debounce = setTimeout(emit, size < 10_000_000 ? 120 : 300)
        }),
      )
      setReady(true)
      onMount?.(ed, monaco)
    })
    return () => {
      disposed = true
      clearTimeout(debounce)
      disposables.forEach((d) => d.dispose())
      const ed = editorRef.current
      const model = ed?.getModel()
      ed?.dispose()
      model?.dispose()
      editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync external value changes.
  useEffect(() => {
    const ed = editorRef.current
    if (!ed || !ready) return
    if (value === lastValue.current) return
    const model = ed.getModel()
    if (!model) return
    // React may commit an older value after newer keystrokes; never revert the editor to it.
    if (emitted.current.includes(value)) return
    if (model.getValueLength() === value.length && model.getValue() === value) {
      lastValue.current = value
      return
    }
    emitted.current = []
    lastValue.current = value
    if (readOnly) model.setValue(value)
    else applyUndoable(ed, value)
  }, [value, ready, readOnly])

  useEffect(() => {
    const m = editorRef.current?.getModel()
    if (m && monacoRef.current && m.getLanguageId() !== language) monacoRef.current.editor.setModelLanguage(m, language)
  }, [language, ready])

  useEffect(() => {
    editorRef.current?.updateOptions({
      readOnly,
      fontSize,
      lineHeight: Math.round(fontSize * 1.55),
      wordWrap: effectiveWrap && !isLarge ? 'on' : 'off',
      minimap: { enabled: minimap && !isLarge },
      folding: folding && !isLarge,
      placeholder,
      lineNumbers: lineNumbers ? 'on' : 'off',
    })
  }, [readOnly, fontSize, effectiveWrap, minimap, isLarge, folding, placeholder, lineNumbers, ready])

  // Apply caller-provided options that change after mount (e.g. rulers).
  const optionsKey = JSON.stringify(options ?? null)
  useEffect(() => {
    if (ready && options) editorRef.current?.updateOptions(options)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey, ready])

  useEffect(() => {
    const monaco = monacoRef.current
    const model = editorRef.current?.getModel()
    if (!monaco || !model) return
    const sev = { error: monaco.MarkerSeverity.Error, warning: monaco.MarkerSeverity.Warning, info: monaco.MarkerSeverity.Info }
    monaco.editor.setModelMarkers(
      model,
      'devtoolkit',
      (markers ?? []).map((m) => ({
        message: m.message,
        severity: sev[m.severity ?? 'error'],
        startLineNumber: m.line,
        startColumn: m.column,
        endLineNumber: m.endLine ?? m.line,
        endColumn: m.endColumn ?? m.column + 1,
      })),
    )
  }, [markers, ready])

  return (
    <div className={cn('relative h-full min-h-0 w-full overflow-hidden bg-workspace', className)}>
      <div ref={host} className="absolute inset-0" data-testid="code-editor" />
      {!ready && (
        <pre className="mono pointer-events-none absolute inset-0 overflow-hidden whitespace-pre px-[46px] py-2.5 text-[13px] leading-5 text-muted">
          {value ? value.slice(0, 4000) : <span className="text-subtle">{placeholder}</span>}
        </pre>
      )}
    </div>
  )
})

function applyUndoable(ed: MonacoEditor.IStandaloneCodeEditor | null, text: string) {
  const model = ed?.getModel()
  if (!ed || !model) return
  if (model.getValueLength() === text.length && model.getValue() === text) return
  ed.pushUndoStop()
  model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null)
  ed.pushUndoStop()
}
