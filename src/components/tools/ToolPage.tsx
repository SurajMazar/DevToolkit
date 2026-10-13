import { Suspense, useEffect } from 'react'
import { Link as LinkIcon, MoreHorizontal, RotateCcw, Star } from 'lucide-react'
import { toast } from 'sonner'
import { Link } from 'react-router'
import type { Tool } from '@/registry'
import { categoryMap } from '@/registry'
import { ToolContext } from './tool-context'
import { ToolErrorBoundary } from './ToolErrorBoundary'
import { usePrefs } from '@/stores/prefs'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { IconButton } from '@/components/ui/icon-button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { copyText } from '@/utils/clipboard'
import { clearToolDrafts } from '@/services/persistence/db'
import { cn } from '@/utils/cn'

function ToolHeader({ tool }: { tool: Tool }) {
  const isFav = usePrefs((s) => s.favorites.includes(tool.id))
  const toggleFavorite = usePrefs((s) => s.toggleFavorite)
  const category = categoryMap.get(tool.category)
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-bg px-3 md:px-4">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted">
        <tool.Icon className="size-[15px]" />
      </div>
      <div className="flex min-w-0 flex-1 items-baseline gap-3">
        <h1 className="shrink-0 text-[15px] font-semibold tracking-[-0.01em] text-fg">{tool.name}</h1>
        <p className="hidden min-w-0 truncate text-sm text-muted lg:block">{tool.description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {category && (
          <Link to={category.path} className="mr-2 hidden rounded-sm text-xs text-subtle hover:text-fg sm:block">
            {category.name}
          </Link>
        )}
        <IconButton
          label={isFav ? 'Unpin from favorites' : 'Pin to favorites'}
          aria-pressed={isFav}
          icon={<Star className={cn(isFav && 'fill-current text-accent-text')} />}
          onClick={() => toggleFavorite(tool.id)}
        />
        <DropdownMenu>
          <Tooltip content="More">
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More options">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent>
            <DropdownMenuItem
              onSelect={async () => {
                await copyText(location.origin + tool.path)
                toast.success('Link copied')
              }}
            >
              <LinkIcon /> Copy link to tool
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                await clearToolDrafts(tool.id)
                toast.success('Saved input cleared for this tool', { description: 'Reloading the tool…' })
                setTimeout(() => location.reload(), 600)
              }}
            >
              <RotateCcw /> Clear saved input
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function ToolFallback() {
  return <div className="flex-1 bg-workspace" aria-busy="true" />
}

export function ToolPage({ tool }: { tool: Tool }) {
  const pushRecent = usePrefs((s) => s.pushRecent)
  useDocumentMeta(tool.name, tool.description)
  useEffect(() => {
    pushRecent(tool.id)
  }, [tool.id, pushRecent])

  return (
    <ToolContext.Provider value={{ tool }}>
      <div className="flex min-h-0 flex-1 flex-col" data-tool={tool.id}>
        <ToolHeader tool={tool} />
        <ToolErrorBoundary resetKey={tool.id}>
          <Suspense fallback={<ToolFallback />}>
            <div className="flex min-h-0 flex-1 flex-col">
              <tool.Component />
            </div>
          </Suspense>
        </ToolErrorBoundary>
      </div>
    </ToolContext.Provider>
  )
}

/** Scrollable body for form-style tools (generators, calculators). */
export function ToolScrollBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto bg-workspace', className)}>{children}</div>
}
