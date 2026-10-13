import { forwardRef } from 'react'
import type { MatchResult, RegexMatch } from '@/engines/regex/core'
import { CopyButton } from '@/components/common/CopyButton'
import { VirtualList, type VirtualListHandle } from '../_shared/VirtualList'
import { cn } from '@/utils/cn'
import { formatNumber } from '@/utils/format'

export const GROUP_TEXT = ['text-add', 'text-del', 'text-mod', 'text-accent-text']

/** Shows invisible characters so empty strings and whitespace are explicit. */
export function visible(s: string) {
  if (s === '') return <span className="italic text-subtle">empty</span>
  const parts: React.ReactNode[] = []
  let buf = ''
  const flush = () => {
    if (buf) parts.push(buf)
    buf = ''
  }
  for (const ch of s.length > 400 ? s.slice(0, 400) : s) {
    const sym = ch === '\n' ? '↵' : ch === '\t' ? '⇥' : ch === '\r' ? '␍' : ch === ' ' ? '·' : null
    if (sym) {
      flush()
      parts.push(
        <span key={parts.length} className="text-subtle">
          {sym}
        </span>,
      )
    } else buf += ch
  }
  flush()
  if (s.length > 400) parts.push(<span key="more" className="text-subtle">… (+{formatNumber(s.length - 400)} chars)</span>)
  return parts
}

interface MatchesPanelProps {
  result: MatchResult
  active: number | null
  onActive: (i: number | null) => void
  onGroupHover: (match: number, group: number | null) => void
  onReveal: (m: RegexMatch) => void
  global: boolean
}

export const MatchesPanel = forwardRef<VirtualListHandle, MatchesPanelProps>(function MatchesPanel({ result, active, onActive, onGroupHover, onReveal, global }, ref) {
  return (
    <VirtualList
      ref={ref}
      items={result.matches}
      estimateSize={56}
      getKey={(m) => `${m.index}:${m.end}`}
      aria-label="Matches"
      header={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-1.5 text-2xs text-subtle tabular">
          <span>
            {formatNumber(result.total)} {result.total === 1 ? 'match' : 'matches'}
            {result.capped && ` — listing the first ${formatNumber(result.matches.length)}`}
          </span>
          {!global && result.total > 0 && <span>g flag off: only the first match is returned</span>}
          {result.groupNames.length > 0 && <span>named: {result.groupNames.join(', ')}</span>}
        </div>
      }
      footer={result.matches.length === 0 ? <p className="px-4 py-6 text-sm text-muted">No matches in the test string.</p> : null}
      renderItem={(m, i) => (
        <div
          onMouseEnter={() => onActive(i)}
          onMouseLeave={() => onActive(null)}
          onClick={() => onReveal(m)}
          className={cn('group cursor-default border-b border-border px-4 py-2', active === i && 'bg-accent-soft')}
        >
          <div className="flex items-center gap-2">
            <span className="mono w-10 shrink-0 text-2xs text-subtle tabular">#{i + 1}</span>
            <span className="mono min-w-0 flex-1 truncate text-[12.5px] text-fg" title={m.text}>
              {visible(m.text)}
            </span>
            <span className="mono shrink-0 text-2xs text-subtle tabular">
              {m.index}–{m.end}
            </span>
            <CopyButton value={m.text} label="Copy match" size="icon-xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />
          </div>
          {m.groups.length > 0 && (
            <dl className="mt-1 grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-0.5 pl-12" onMouseLeave={() => onGroupHover(i, null)}>
              {m.groups.map((g) => (
                <div key={g.index} className="contents" onMouseEnter={() => onGroupHover(i, g.index)}>
                  <dt className={cn('mono text-[12px] tabular', GROUP_TEXT[(g.index - 1) % GROUP_TEXT.length])}>
                    {g.index}
                    {g.name && <span className="ml-1 text-muted">{g.name}</span>}
                  </dt>
                  <dd className="mono min-w-0 truncate text-[12px] text-fg">{g.text === undefined ? <span className="italic text-subtle">did not participate</span> : visible(g.text)}</dd>
                  <dd className="mono text-2xs text-subtle tabular">{g.start !== undefined ? `${g.start}–${g.end}` : ''}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    />
  )
})
