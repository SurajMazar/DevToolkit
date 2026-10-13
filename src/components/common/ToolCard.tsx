import { Link } from 'react-router'
import { Star } from 'lucide-react'
import type { Tool } from '@/registry'
import { categoryMap } from '@/registry'
import { usePrefs } from '@/stores/prefs'
import { cn } from '@/utils/cn'

function PinButton({ tool, className }: { tool: Tool; className?: string }) {
  const isFav = usePrefs((s) => s.favorites.includes(tool.id))
  const toggle = usePrefs((s) => s.toggleFavorite)
  return (
    <button
      type="button"
      aria-label={isFav ? `Unpin ${tool.name}` : `Pin ${tool.name}`}
      aria-pressed={isFav}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        toggle(tool.id)
      }}
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-sm text-subtle outline-none transition-opacity duration-100 hover:bg-surface-2 hover:text-fg focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring',
        isFav ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        className,
      )}
    >
      <Star className={cn('size-3.5', isFav && 'fill-current text-accent-text')} />
    </button>
  )
}

/** Featured tool tile: icon, name, description, category. */
export function ToolCard({ tool }: { tool: Tool }) {
  const cat = categoryMap.get(tool.category)
  return (
    <Link
      to={tool.path}
      className="group relative flex min-h-[112px] flex-col gap-2 rounded-lg border border-border bg-workspace p-3.5 outline-none transition-colors duration-120 hover:border-border-strong hover:bg-raised focus-visible:outline-2 focus-visible:outline-ring dark:hover:bg-surface"
    >
      <div className="flex items-center gap-2.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted transition-colors group-hover:text-accent-text">
          <tool.Icon className="size-[15px]" />
        </div>
        <span className="min-w-0 truncate text-sm font-medium text-fg">{tool.name}</span>
        <PinButton tool={tool} className="ml-auto -mr-1" />
      </div>
      <p className="line-clamp-2 text-[13px] leading-[19px] text-muted">{tool.description}</p>
      <span className="mt-auto text-2xs text-subtle">{cat?.name}</span>
    </Link>
  )
}

/** Dense list row used in category listings and search results. */
export function ToolRow({ tool, meta }: { tool: Tool; meta?: React.ReactNode }) {
  return (
    <Link
      to={tool.path}
      className="group flex min-w-0 items-start gap-3 rounded-md px-2.5 py-2 outline-none transition-colors duration-100 hover:bg-surface-2/70 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <tool.Icon className="mt-[3px] size-[15px] shrink-0 text-subtle transition-colors group-hover:text-accent-text" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-fg">{tool.name}</span>
          {meta && <span className="shrink-0 text-2xs text-subtle">{meta}</span>}
        </span>
        <span className="line-clamp-1 text-[13px] text-muted">{tool.description}</span>
      </span>
      <PinButton tool={tool} />
    </Link>
  )
}
