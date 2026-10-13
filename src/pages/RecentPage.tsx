import { Link } from 'react-router'
import { History } from 'lucide-react'
import { getTool, type Tool } from '@/registry'
import { usePrefs } from '@/stores/prefs'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { ToolRow } from '@/components/common/ToolCard'
import { EmptyState } from '@/components/tools/EmptyState'
import { Button } from '@/components/ui/button'
import { timeAgo } from '@/utils/time'

export function RecentPage() {
  useDocumentMeta('Recent tools')
  const recents = usePrefs((s) => s.recents)
  const clear = usePrefs((s) => s.clearRecents)
  const privateMode = usePrefs((s) => s.privateMode)
  const list = recents.map((r) => ({ tool: getTool(r.id), at: r.at })).filter((r) => r.tool) as { tool: Tool; at: number }[]
  return (
    <div className="mx-auto w-full max-w-[860px] px-4 pb-16 pt-8 md:px-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-semibold leading-8 tracking-[-0.02em]">Recent</h1>
          <p className="text-sm text-muted">
            The last {list.length || 12} tools you opened. {privateMode && 'Private mode is on, so new visits are not recorded.'}
          </p>
        </div>
        {list.length > 0 && (
          <Button variant="ghost" onClick={clear}>
            Clear history
          </Button>
        )}
      </div>
      <div className="mt-6 rounded-lg border border-border bg-workspace p-2">
        {list.length === 0 ? (
          <EmptyState
            icon={<History />}
            title="Nothing here yet"
            description="Tools you open will be listed here so you can jump back quickly."
            actions={
              <Button asChild>
                <Link to="/">Browse tools</Link>
              </Button>
            }
          />
        ) : (
          list.map(({ tool, at }) => <ToolRow key={tool.id} tool={tool} meta={timeAgo(at)} />)
        )}
      </div>
    </div>
  )
}
