import { Link } from 'react-router'
import { ArrowDown, ArrowUp, Star, X } from 'lucide-react'
import { getTool, type Tool } from '@/registry'
import { usePrefs } from '@/stores/prefs'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { IconButton } from '@/components/ui/icon-button'
import { EmptyState } from '@/components/tools/EmptyState'
import { Button } from '@/components/ui/button'

export function FavoritesPage() {
  useDocumentMeta('Favorites')
  const favorites = usePrefs((s) => s.favorites)
  const toggle = usePrefs((s) => s.toggleFavorite)
  const move = usePrefs((s) => s.moveFavorite)
  const list = favorites.map(getTool).filter(Boolean) as Tool[]
  return (
    <div className="mx-auto w-full max-w-[860px] px-4 pb-16 pt-8 md:px-8">
      <h1 className="text-[24px] font-semibold leading-8 tracking-[-0.02em]">Favorites</h1>
      <p className="text-sm text-muted">Pinned tools appear at the top of the sidebar and the home page, in this order.</p>
      <div className="mt-6 rounded-lg border border-border bg-workspace">
        {list.length === 0 ? (
          <EmptyState
            icon={<Star />}
            title="No pinned tools yet"
            description="Use the star in any tool's header — or on a tool card — to pin it here."
            actions={
              <Button asChild>
                <Link to="/">Browse tools</Link>
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((t, i) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                <t.Icon className="size-4 shrink-0 text-subtle" />
                <Link to={t.path} className="min-w-0 flex-1 hover:underline">
                  <span className="block truncate text-sm font-medium">{t.name}</span>
                  <span className="block truncate text-xs text-muted">{t.description}</span>
                </Link>
                <IconButton label="Move up" icon={<ArrowUp />} disabled={i === 0} onClick={() => move(t.id, -1)} />
                <IconButton label="Move down" icon={<ArrowDown />} disabled={i === list.length - 1} onClick={() => move(t.id, 1)} />
                <IconButton label="Unpin" icon={<X />} onClick={() => toggle(t.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
