import { Fragment } from 'react'
import type { JsonType } from '@/engines/json/parse'
import { cn } from '@/utils/cn'
import { utf8Length } from '@/utils/format'

/** Token-based colours for JSON value types (kept in line with the editor theme). */
export const TYPE_CLASS: Record<JsonType, string> = {
  string: 'text-add',
  number: 'text-mod',
  boolean: 'text-accent-text',
  null: 'text-subtle italic',
  object: 'text-subtle',
  array: 'text-subtle',
}

/** Highlights case-insensitive occurrences of `query` inside `text`. */
export function Highlight({ text, query, active }: { text: string; query: string; active?: boolean }) {
  if (!query) return <>{text}</>
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const parts: React.ReactNode[] = []
  let from = 0
  let i = lower.indexOf(q)
  if (i < 0) return <>{text}</>
  let n = 0
  while (i >= 0 && n < 50) {
    if (i > from) parts.push(<Fragment key={`t${n}`}>{text.slice(from, i)}</Fragment>)
    parts.push(
      <mark key={`m${n}`} className={cn('rounded-[2px] text-fg', active ? 'bg-mod/45' : 'bg-mod-bg outline outline-1 outline-mod/40')}>
        {text.slice(i, i + q.length)}
      </mark>,
    )
    from = i + q.length
    i = lower.indexOf(q, from)
    n++
  }
  if (from < text.length) parts.push(<Fragment key="rest">{text.slice(from)}</Fragment>)
  return <>{parts}</>
}

/** Truncates long strings for single-line display (the full value is available via copy). */
export function clip(s: string, max = 300): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

export function TypeBadge({ type, className }: { type: JsonType; className?: string }) {
  return <span className={cn('mono inline-flex h-[18px] shrink-0 items-center rounded-sm bg-surface-2 px-1.5 text-2xs', TYPE_CLASS[type].replace('italic', ''), className)}>{type}</span>
}

/** UTF-8 size of a string for status bars (character count for very large strings, to stay cheap). */
export function byteSize(s: string): number {
  return s.length > 5_000_000 ? s.length : utf8Length(s)
}
