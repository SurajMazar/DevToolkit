import { useMemo, useState } from 'react'
import { ConverterTool, type ConverterResult } from '@/components/tools/ConverterTool'
import { ToolbarField } from '@/components/tools/Toolbar'
import { StatusItem } from '@/components/tools/StatusBar'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useWorker } from '@/hooks/useWorker'
import type { CssFormatOptions } from '@/engines/css/format'
import { sizeStats, type CssMinifyOptions, type LicenseComments } from '@/engines/css/minify'
import { formatBytes } from '@/utils/format'
import CssWorker from './worker.ts?worker'
import type { Tasks } from './worker'

const MINIFIED_SAMPLE = `/*! Acme UI v2.4.1 | MIT License */:root{--brand:#0f766e;--radius:8px;--shadow:0 1px 2px rgb(0 0 0/.06),0 4px 12px rgb(0 0 0/.08)}*,:after,:before{box-sizing:border-box}body{margin:0;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c1d20;background:#f5f4f1}.card{display:grid;gap:12px;padding:20px;border-radius:var(--radius);background:#fff;box-shadow:var(--shadow)}.card>h2{margin:0;font-size:1.125rem}.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:0;border-radius:6px;background:var(--brand);color:#fff;cursor:pointer}.btn:hover,.btn:focus-visible{background:color-mix(in oklab,var(--brand) 88%,black)}@media (max-width:640px){.card{padding:16px}.btn{width:100%;justify-content:center}}`

const READABLE_SAMPLE = `/*! Acme UI v2.4.1 | MIT License */

/* Design tokens */
:root {
  --brand: #0f766e;
  --radius: 8px;
  --shadow: 0 1px 2px rgb(0 0 0 / 0.06), 0 4px 12px rgb(0 0 0 / 0.08);
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0px;
  font: 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #1c1d20;
  background-color: #f5f4f1;
}

/* Card component */
.card {
  display: grid;
  gap: 12px;
  padding: 20px 20px 20px 20px;
  border-radius: var(--radius);
  background: #ffffff;
  box-shadow: var(--shadow);
}

.card > h2 {
  margin: 0;
  font-size: 1.125rem;
}

.btn {
  display: inline-flex;
  align-items: center;
  padding: 8px 14px;
  border: 0;
  border-radius: 6px;
  background: var(--brand);
  color: #ffffff;
}

.btn:hover {
  background: color-mix(in oklab, var(--brand) 88%, black);
}

.btn:focus-visible {
  background: color-mix(in oklab, var(--brand) 88%, black);
}

@media (max-width: 640px) {
  .card {
    padding: 16px;
  }
}
`

interface Options {
  indent: '2' | '4' | 'tab'
  printWidth: '80' | '100' | '120'
  syntax: 'css' | 'scss' | 'less'
  restructure: boolean
  comments: LicenseComments
}

const DEFAULTS: Options = { indent: '2', printWidth: '80', syntax: 'css', restructure: true, comments: 'all' }

export default function CssFormatter() {
  const [o, setO] = usePersistentState<Options>('options', DEFAULTS)
  const [mode, setMode] = useState('beautify')
  const worker = useWorker<Tasks>(() => new CssWorker({ name: 'devtoolkit-css' }))
  const set = (patch: Partial<Options>) => setO({ ...o, ...patch })

  const formatOptions: CssFormatOptions = useMemo(
    () => ({ indent: o.indent === 'tab' ? 2 : Number(o.indent), useTabs: o.indent === 'tab', printWidth: Number(o.printWidth), parser: o.syntax }),
    [o.indent, o.printWidth, o.syntax],
  )
  const minifyOptions: CssMinifyOptions = useMemo(() => ({ restructure: o.restructure, comments: o.comments }), [o.restructure, o.comments])

  const transform = async (input: string, m: string, signal: AbortSignal): Promise<ConverterResult> => {
    if (m === 'beautify') {
      const r = await worker.run('format', { css: input, options: formatOptions }, signal)
      if (!r.ok) return { output: '', error: r.error, markers: r.error.line ? [{ message: r.error.message, line: r.error.line, column: r.error.column ?? 1 }] : undefined }
      return { output: r.output }
    }
    const r = await worker.run('minify', { css: input, options: minifyOptions }, signal)
    if (r.error) return { output: '', error: r.error, markers: [{ message: r.error.message, line: r.error.line, column: r.error.column }] }
    const s = sizeStats(input, r.output)
    return {
      output: r.output,
      warning: r.fallback
        ? `csso could not parse this stylesheet (“${r.fallback.message}” at line ${r.fallback.line}, column ${r.fallback.column} — often modern syntax such as nesting or range media queries). Used a conservative minifier instead: comments and whitespace removed, nothing restructured or dropped.`
        : null,
      markers: r.fallback ? [{ message: `csso: ${r.fallback.message}`, line: r.fallback.line, column: r.fallback.column, severity: 'warning' }] : undefined,
      meta: `${s.percent >= 0 ? '−' : '+'}${Math.abs(s.percent).toFixed(1)}%`,
      status: (
        <>
          <StatusItem label="Saved" tone={s.saved > 0 ? 'add' : undefined}>
            {formatBytes(Math.max(0, s.saved))} ({s.percent.toFixed(1)}%)
          </StatusItem>
          <StatusItem label="Engine">{r.engine === 'csso' ? `csso${o.restructure ? ' · restructure' : ''}` : 'safe (fallback)'}</StatusItem>
        </>
      ),
    }
  }

  return (
    <ConverterTool
      onModeChange={setMode}
      modes={[
        { value: 'beautify', label: 'Beautify', inputLabel: 'CSS', outputLabel: 'Formatted', inputLanguage: 'css', outputLanguage: 'css', placeholder: 'Paste minified or messy CSS…', sample: MINIFIED_SAMPLE, outputExt: 'css', inverse: 'minify', accept: '.css,.scss,.less,text/css' },
        { value: 'minify', label: 'Minify', inputLabel: 'CSS', outputLabel: 'Minified', inputLanguage: 'css', outputLanguage: 'css', placeholder: 'Paste CSS to minify…', sample: READABLE_SAMPLE, outputExt: 'min.css', inverse: 'beautify', accept: '.css,text/css' },
      ]}
      optionsKey={mode === 'beautify' ? formatOptions : minifyOptions}
      transform={transform}
      outputWordWrap={mode === 'minify'}
      emptyTitle={mode === 'beautify' ? 'Paste CSS to beautify it.' : 'Paste CSS to minify it.'}
      emptyDescription={mode === 'beautify' ? 'Formatted with Prettier. Syntax errors show the exact line and column.' : 'Minified with csso; size savings appear in the status bar. /*! license */ comments can be kept.'}
      options={
        mode === 'beautify' ? (
          <>
            <ToolbarField label="Indent">
              <Select aria-label="Indentation" value={o.indent} onValueChange={(indent) => set({ indent })} options={[{ value: '2', label: '2 spaces' }, { value: '4', label: '4 spaces' }, { value: 'tab', label: 'Tabs' }]} />
            </ToolbarField>
            <ToolbarField label="Width">
              <Select aria-label="Print width" value={o.printWidth} onValueChange={(printWidth) => set({ printWidth })} options={[{ value: '80', label: '80' }, { value: '100', label: '100' }, { value: '120', label: '120' }]} />
            </ToolbarField>
            <ToolbarField label="Syntax">
              <Select aria-label="Syntax" value={o.syntax} onValueChange={(syntax) => set({ syntax })} options={[{ value: 'css', label: 'CSS' }, { value: 'scss', label: 'SCSS' }, { value: 'less', label: 'Less' }]} />
            </ToolbarField>
          </>
        ) : (
          <>
            <Checkbox checked={o.restructure} onCheckedChange={(v) => set({ restructure: v === true })} label="Restructure" />
            <ToolbarField label="Comments">
              <Select
                aria-label="Comments"
                value={o.comments}
                onValueChange={(comments) => set({ comments })}
                options={[
                  { value: 'all', label: 'Keep /*! license */', description: 'Keep every comment that starts with /*!' },
                  { value: 'first', label: 'Keep first /*! only', description: 'Keep only the first license comment' },
                  { value: 'none', label: 'Remove all', description: 'Strip every comment' },
                ]}
              />
            </ToolbarField>
          </>
        )
      }
    />
  )
}
