import { useMemo } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { flattenExplain, type ExplainNode, type ExplainResult } from '@/engines/dev/regex-explain'
import { cn } from '@/utils/cn'

const CHIP: Partial<Record<ExplainNode['kind'], string>> = {
  literal: 'text-fg',
  escape: 'text-add',
  unicodeProperty: 'text-add',
  charClass: 'text-mod',
  classItem: 'text-mod',
  any: 'text-accent-text',
  anchor: 'text-del',
  boundary: 'text-del',
  group: 'text-accent-text',
  lookaround: 'text-accent-text',
  backreference: 'text-accent-text',
  alternation: 'text-accent-text',
  alternative: 'text-muted',
  error: 'text-danger',
}

function chipText(n: ExplainNode) {
  if (n.kind === 'alternative') return n.text || '(empty)'
  const t = n.text
  return t.length > 48 ? t.slice(0, 47) + '…' : t
}

export function ExplainPanel({
  explain,
  onHover,
  onSelect,
}: {
  explain: ExplainResult
  onHover: (range: { start: number; end: number } | null) => void
  onSelect: (start: number, end: number) => void
}) {
  const rows = useMemo(() => flattenExplain(explain.nodes), [explain])
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" onMouseLeave={() => onHover(null)}>
      {explain.warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-2 border-b border-warn/25 bg-warn-soft px-4 py-2 text-xs text-fg" onMouseEnter={() => onHover(w)}>
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-warn" />
          <span>{w.message}</span>
        </div>
      ))}
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">An empty pattern matches the empty string at every position.</p>
      ) : (
        <ol aria-label="Pattern tokens">
          {rows.map(({ node: n, depth }, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseEnter={() => onHover({ start: n.start, end: n.end })}
                onFocus={() => onHover({ start: n.start, end: n.end })}
                onClick={() => onSelect(n.start, n.end)}
                className="grid w-full grid-cols-[140px_1fr] items-baseline gap-x-3 border-b border-border/60 py-1.5 pr-4 text-left hover:bg-surface-2/50 focus-visible:bg-surface-2/50 focus-visible:outline-none"
                style={{ paddingLeft: 16 + depth * 18 }}
              >
                <code className={cn('mono justify-self-start max-w-full truncate rounded-sm bg-surface px-1.5 py-px text-[12.5px]', CHIP[n.kind])}>{chipText(n)}</code>
                <span className="min-w-0">
                  <span className="text-sm font-medium text-fg">{n.label}</span>
                  <span className="block text-xs text-muted">{n.description}</span>
                  {n.quantifier && <span className="block text-xs text-muted"><code className="mono text-del">{n.quantifier.text}</code> {n.quantifier.description}</span>}
                  {n.note && <span className="mt-0.5 block text-xs text-accent-text">{n.note}</span>}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {explain.flags.length > 0 && (
        <div className="px-4 py-3">
          <p className="eyebrow mb-1.5">Flags</p>
          <dl className="grid grid-cols-[24px_1fr] gap-x-2 gap-y-1">
            {explain.flags.map((f) => (
              <div key={f.flag} className="contents">
                <dt className={cn('mono text-[12.5px]', f.name === 'unknown' ? 'text-danger' : 'text-accent-text')}>{f.flag}</dt>
                <dd className="text-xs text-muted">
                  <span className="text-fg">{f.name}</span> — {f.description}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <p className="flex items-start gap-1.5 px-4 pb-4 pt-1 text-2xs text-subtle">
        <Info className="mt-px size-3 shrink-0" /> Hover a row to highlight it in the pattern; click to select it.
      </p>
    </div>
  )
}
