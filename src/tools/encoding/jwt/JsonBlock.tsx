import { useState } from 'react'
import { CodeEditor } from '@/components/editors/CodeEditor'
import { CopyButton } from '@/components/common/CopyButton'
import { usePrefs } from '@/stores/prefs'
import { countLines } from '@/utils/format'

/** Read-only JSON editor that grows with its content (wrapped lines included), capped at `maxHeight`. */
export function JsonBlock({ title, value, language = 'json', meta, path, maxHeight = 520 }: { title: string; value: string; language?: string; meta?: React.ReactNode; path: string; maxHeight?: number }) {
  const fontSize = usePrefs((s) => s.editorFontSize)
  const estimate = Math.min(maxHeight, Math.max(2, countLines(value)) * Math.round(fontSize * 1.55) + 20)
  const [height, setHeight] = useState<number | null>(null)
  return (
    <section aria-label={title} className="border-b border-border">
      <div className="flex h-8 items-center gap-2 pl-4 pr-2">
        <h3 className="eyebrow">{title}</h3>
        {meta && <span className="min-w-0 truncate text-2xs text-subtle">{meta}</span>}
        <CopyButton value={value} label={`Copy ${title.toLowerCase()}`} className="ml-auto" />
      </div>
      <div style={{ height: Math.min(maxHeight, height ?? estimate) }} className="pl-1">
        <CodeEditor
          value={value}
          language={language}
          readOnly
          ariaLabel={`${title} (read-only)`}
          path={path}
          lineNumbers={false}
          folding={false}
          wordWrap
          options={{ scrollBeyondLastLine: false, renderLineHighlight: 'none', padding: { top: 6, bottom: 10 } }}
          onMount={(ed) => {
            setHeight(ed.getContentHeight())
            ed.onDidContentSizeChange((e) => e.contentHeightChanged && setHeight(e.contentHeight))
          }}
        />
      </div>
    </section>
  )
}
