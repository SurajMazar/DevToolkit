import { useMemo, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { ConverterTool, type ConverterResult } from '@/components/tools/ConverterTool'
import { ToolbarField } from '@/components/tools/Toolbar'
import { StatusItem } from '@/components/tools/StatusBar'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useWorker } from '@/hooks/useWorker'
import type { HtmlFormatOptions, HtmlWhitespaceSensitivity } from '@/engines/html/format'
import type { HtmlMinifyOptions, WhitespaceMode } from '@/engines/html/minify'
import { sizeStats } from '@/engines/css/minify'
import { formatBytes, pluralize } from '@/utils/format'
import { cn } from '@/utils/cn'
import HtmlWorker from './worker.ts?worker'
import type { Tasks } from './worker'

const MINIFIED_SAMPLE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Release notes — Acme</title><style>body{font:15px/1.6 system-ui,sans-serif;margin:0}main{max-width:720px;margin:0 auto;padding:32px 20px}pre{background:#f4f4f5;padding:12px;border-radius:6px}</style></head><body><header class="site-header"><nav aria-label="Primary"><a href="/">Home</a> <a href="/docs">Docs</a> <a href="/changelog" aria-current="page">Changelog</a></nav></header><main><h1>Version 2.4</h1><p>This release adds <strong>offline mode</strong>, faster search and <em>many</em> small fixes.</p><ul><li>Search is 3× faster on large workspaces</li><li>New <code>--offline</code> flag</li></ul><pre><code>$ acme sync --offline
  Synced 1,204 notes
  Done in 0.8s</code></pre><form action="/subscribe" method="post"><label for="email">Get updates</label> <input id="email" name="email" type="email" placeholder="you@example.com" required> <button type="submit">Subscribe</button></form></main><script>document.querySelector('form').addEventListener('submit', (e) => { console.log('submitted') })</script></body></html>`

const READABLE_SAMPLE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Release notes — Acme</title>
    <!-- Critical CSS -->
    <style>
      body {
        font: 15px/1.6 system-ui, sans-serif;
        margin: 0;
      }
      pre {
        background: #f4f4f5;
        padding: 12px;
      }
    </style>
    <!--[if lt IE 9]><script src="/legacy/html5shiv.js"></script><![endif]-->
  </head>
  <body>
    <!--! build 2024-06-01 #4821 -->
    <header class="site-header">
      <nav aria-label="Primary">
        <a href="/">Home</a>
        <a href="/docs">Docs</a>
        <a href="/changelog" aria-current="page">Changelog</a>
      </nav>
    </header>

    <main>
      <h1>Version 2.4</h1>
      <p>
        This release adds <strong>offline mode</strong>, faster search and
        <em>many</em> small fixes.
      </p>
      <!-- TODO: link to the migration guide -->
      <pre><code>$ acme sync --offline
  Synced 1,204 notes
  Done in 0.8s</code></pre>
      <textarea name="feedback" rows="3">  Indentation inside
  a textarea is kept.</textarea>
    </main>

    <script>
      // Scripts are left exactly as written.
      const year = new Date().getFullYear();
      document.title += " · " + year;
    </script>
  </body>
</html>
`

interface Options {
  indent: '2' | '4' | 'tab'
  printWidth: '80' | '100' | '120'
  sensitivity: HtmlWhitespaceSensitivity
  bracketSameLine: boolean
  whitespace: WhitespaceMode
  removeComments: boolean
  keepConditionalComments: boolean
  keepBangComments: boolean
  minifyCss: boolean
}

const DEFAULTS: Options = {
  indent: '2',
  printWidth: '100',
  sensitivity: 'css',
  bracketSameLine: false,
  whitespace: 'smart',
  removeComments: true,
  keepConditionalComments: true,
  keepBangComments: true,
  minifyCss: false,
}

export default function HtmlFormatter() {
  const [o, setO] = usePersistentState<Options>('options', DEFAULTS)
  const [mode, setMode] = useState('beautify')
  const worker = useWorker<Tasks>(() => new HtmlWorker({ name: 'devtoolkit-html' }))
  const set = (patch: Partial<Options>) => setO({ ...o, ...patch })

  const formatOptions: HtmlFormatOptions = useMemo(
    () => ({ indent: o.indent === 'tab' ? 2 : Number(o.indent), useTabs: o.indent === 'tab', printWidth: Number(o.printWidth), whitespaceSensitivity: o.sensitivity, bracketSameLine: o.bracketSameLine }),
    [o.indent, o.printWidth, o.sensitivity, o.bracketSameLine],
  )
  const minifyOptions: HtmlMinifyOptions = useMemo(
    () => ({ whitespace: o.whitespace, removeComments: o.removeComments, keepConditionalComments: o.keepConditionalComments, keepBangComments: o.keepBangComments, minifyCss: o.minifyCss }),
    [o.whitespace, o.removeComments, o.keepConditionalComments, o.keepBangComments, o.minifyCss],
  )

  const transform = async (input: string, m: string, signal: AbortSignal): Promise<ConverterResult> => {
    if (m === 'beautify') {
      const r = await worker.run('format', { html: input, options: formatOptions }, signal)
      if (!r.ok) return { output: '', error: r.error, markers: r.error.line ? [{ message: r.error.message, line: r.error.line, column: r.error.column ?? 1 }] : undefined }
      return { output: r.output }
    }
    const r = await worker.run('minify', { html: input, options: minifyOptions }, signal)
    if (r.error) return { output: '', error: r.error, markers: [{ message: r.error.message, line: r.error.line, column: r.error.column }] }
    const s = sizeStats(input, r.output)
    return {
      output: r.output,
      warning: r.warnings.length ? r.warnings.join(' ') : null,
      meta: `${s.percent >= 0 ? '−' : '+'}${Math.abs(s.percent).toFixed(1)}%`,
      status: (
        <>
          <StatusItem label="Saved" tone={s.saved > 0 ? 'add' : undefined}>
            {formatBytes(Math.max(0, s.saved))} ({s.percent.toFixed(1)}%)
          </StatusItem>
          <StatusItem label="Removed">{pluralize(r.stats.commentsRemoved, 'comment')}</StatusItem>
          <StatusItem label="Whitespace">−{formatBytes(r.stats.whitespaceRemoved)}</StatusItem>
          {o.minifyCss && <StatusItem label="Styles minified">{r.stats.stylesMinified}</StatusItem>}
        </>
      ),
    }
  }

  const advancedActive = !o.keepConditionalComments || !o.keepBangComments || o.minifyCss

  return (
    <ConverterTool
      onModeChange={setMode}
      modes={[
        { value: 'beautify', label: 'Beautify', inputLabel: 'HTML', outputLabel: 'Formatted', inputLanguage: 'html', outputLanguage: 'html', placeholder: 'Paste HTML to format…', sample: MINIFIED_SAMPLE, outputExt: 'html', inverse: 'minify', accept: '.html,.htm,text/html' },
        { value: 'minify', label: 'Minify', inputLabel: 'HTML', outputLabel: 'Minified', inputLanguage: 'html', outputLanguage: 'html', placeholder: 'Paste HTML to minify…', sample: READABLE_SAMPLE, outputExt: 'min.html', inverse: 'beautify', accept: '.html,.htm,text/html' },
      ]}
      optionsKey={mode === 'beautify' ? formatOptions : minifyOptions}
      transform={transform}
      outputWordWrap={mode === 'minify'}
      emptyTitle={mode === 'beautify' ? 'Paste HTML to beautify it.' : 'Paste HTML to minify it.'}
      emptyDescription={
        mode === 'beautify'
          ? 'Formatted with Prettier, including embedded <script> and <style>. Nothing is rendered or executed.'
          : 'Removes comments and insignificant whitespace. <pre>, <textarea>, <script> and <style> content and attribute values are kept exactly.'
      }
      options={
        mode === 'beautify' ? (
          <>
            <ToolbarField label="Indent">
              <Select aria-label="Indentation" value={o.indent} onValueChange={(indent) => set({ indent })} options={[{ value: '2', label: '2 spaces' }, { value: '4', label: '4 spaces' }, { value: 'tab', label: 'Tabs' }]} />
            </ToolbarField>
            <ToolbarField label="Width">
              <Select aria-label="Print width" value={o.printWidth} onValueChange={(printWidth) => set({ printWidth })} options={[{ value: '80', label: '80' }, { value: '100', label: '100' }, { value: '120', label: '120' }]} />
            </ToolbarField>
            <ToolbarField label="Whitespace">
              <Select
                aria-label="Whitespace sensitivity"
                value={o.sensitivity}
                onValueChange={(sensitivity) => set({ sensitivity })}
                options={[
                  { value: 'css', label: 'CSS display', description: 'Respect each element’s default display (Prettier default)' },
                  { value: 'strict', label: 'Strict', description: 'Treat all whitespace as significant — never changes rendering' },
                  { value: 'ignore', label: 'Ignore', description: 'Treat whitespace as insignificant — prettiest, may change inline spacing' },
                ]}
              />
            </ToolbarField>
            <Checkbox checked={o.bracketSameLine} onCheckedChange={(v) => set({ bracketSameLine: v === true })} label="Bracket on same line" />
          </>
        ) : (
          <>
            <ToolbarField label="Whitespace">
              <Select
                aria-label="Whitespace handling"
                value={o.whitespace}
                onValueChange={(whitespace) => set({ whitespace })}
                options={[
                  { value: 'smart', label: 'Collapse & trim', description: 'Collapse runs; drop whitespace next to block tags and in <head>' },
                  { value: 'conservative', label: 'Collapse only', description: 'Collapse runs to one space; never remove it entirely' },
                  { value: 'keep', label: 'Keep', description: 'Leave text whitespace untouched' },
                ]}
              />
            </ToolbarField>
            <Checkbox checked={o.removeComments} onCheckedChange={(v) => set({ removeComments: v === true })} label="Remove comments" />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className={cn(advancedActive && 'text-accent-text')}>
                  <Settings2 /> Options
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80">
                <div className="flex flex-col gap-3">
                  <Checkbox
                    checked={o.keepConditionalComments}
                    disabled={!o.removeComments}
                    onCheckedChange={(v) => set({ keepConditionalComments: v === true })}
                    label="Keep conditional comments"
                    description="<!--[if IE]> … <![endif]-->"
                  />
                  <Checkbox checked={o.keepBangComments} disabled={!o.removeComments} onCheckedChange={(v) => set({ keepBangComments: v === true })} label="Keep <!--! … --> comments" description="Build stamps, licenses" />
                  <div className="h-px bg-border" />
                  <Checkbox checked={o.minifyCss} onCheckedChange={(v) => set({ minifyCss: v === true })} label="Minify inline CSS" description="<style> blocks and style attributes, via csso. Blocks that fail to parse are left unchanged." />
                  <p className="text-2xs text-subtle">Scripts are never modified. Attribute values and quotes are kept exactly as written.</p>
                </div>
              </PopoverContent>
            </Popover>
          </>
        )
      }
    />
  )
}
