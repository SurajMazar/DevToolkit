import { useMemo, useState } from 'react'
import { Command } from 'cmdk'
import { Dialog as D } from 'radix-ui'
import { useLocation, useNavigate } from 'react-router'
import { ArrowRight, EyeOff, History, LayoutGrid, Monitor, Moon, PanelLeft, Search, Settings, Star, StarOff, Sun } from 'lucide-react'
import { categories, categoryMap, getTool, tools, type Tool } from '@/registry'
import { searchTools } from '@/registry/search'
import { usePrefs } from '@/stores/prefs'
import { useUI } from '@/stores/ui'
import { Kbd } from '@/components/ui/kbd'

const itemClass =
  'group flex h-9 cursor-default select-none items-center gap-3 rounded-md px-2.5 text-sm text-fg outline-none data-[selected=true]:bg-surface-2 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-subtle'

function ToolItem({ tool, onSelect, hint }: { tool: Tool; onSelect: () => void; hint?: string }) {
  const cat = categoryMap.get(tool.category)
  return (
    <Command.Item value={`tool:${tool.id}`} onSelect={onSelect} className={itemClass}>
      <tool.Icon />
      <span className="truncate">{tool.name}</span>
      <span className="hidden min-w-0 flex-1 truncate text-xs text-subtle sm:block">{tool.description}</span>
      <span className="ml-auto shrink-0 text-2xs text-subtle">{hint ?? cat?.short}</span>
    </Command.Item>
  )
}

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen)
  const setOpen = useUI((s) => s.setPaletteOpen)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const prefs = usePrefs()
  const currentTool = tools.find((t) => t.path === pathname)

  const results = useMemo(() => (query.trim() ? searchTools(tools, categories, query).slice(0, 12) : []), [query])
  const recent = prefs.recents.map((r) => getTool(r.id)).filter(Boolean).slice(0, 5) as Tool[]

  const go = (path: string) => {
    setOpen(false)
    setQuery('')
    navigate(path)
  }
  const run = (fn: () => void) => () => {
    fn()
    setOpen(false)
    setQuery('')
  }

  const q = query.trim().toLowerCase()
  const actions = [
    { id: 'theme-dark', label: 'Theme: Dark', icon: <Moon />, run: () => prefs.setTheme('dark'), keywords: 'theme dark mode' },
    { id: 'theme-light', label: 'Theme: Light', icon: <Sun />, run: () => prefs.setTheme('light'), keywords: 'theme light mode' },
    { id: 'theme-system', label: 'Theme: Match system', icon: <Monitor />, run: () => prefs.setTheme('system'), keywords: 'theme system auto' },
    { id: 'sidebar', label: prefs.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar', icon: <PanelLeft />, run: prefs.toggleSidebar, keywords: 'sidebar toggle collapse expand' },
    { id: 'private', label: prefs.privateMode ? 'Turn off private mode' : 'Turn on private mode', icon: <EyeOff />, run: () => prefs.set({ privateMode: !prefs.privateMode }), keywords: 'private incognito history persistence' },
    ...(currentTool
      ? [{
          id: 'fav',
          label: prefs.favorites.includes(currentTool.id) ? `Unpin ${currentTool.name}` : `Pin ${currentTool.name} to favorites`,
          icon: prefs.favorites.includes(currentTool.id) ? <StarOff /> : <Star />,
          run: () => prefs.toggleFavorite(currentTool.id),
          keywords: 'favorite pin star',
        }]
      : []),
  ].filter((a) => !q || `${a.label} ${a.keywords}`.toLowerCase().includes(q))

  const nav = [
    { label: 'All tools', path: '/', icon: <LayoutGrid /> },
    { label: 'Favorites', path: '/favorites', icon: <Star /> },
    { label: 'Recent', path: '/recent', icon: <History /> },
    { label: 'Settings', path: '/settings', icon: <Settings /> },
    ...categories.map((c) => ({ label: c.name, path: c.path, icon: <c.Icon /> })),
  ].filter((n) => !q || n.label.toLowerCase().includes(q))

  return (
    <D.Root open={open} onOpenChange={(v) => { setOpen(v); if (!v) setQuery('') }}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/35 animate-fade-in dark:bg-black/55" />
        <D.Content
          aria-label="Command palette"
          className="fixed left-1/2 top-[10vh] z-50 w-[calc(100vw-24px)] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-xl border border-border-strong bg-raised shadow-pop outline-none animate-pop-in"
        >
          <D.Title className="sr-only">Command palette</D.Title>
          <D.Description className="sr-only">Search tools and run commands</D.Description>
          <Command shouldFilter={false} loop label="Command palette">
            <div className="flex items-center gap-2.5 border-b border-border px-3.5">
              <Search className="size-4 shrink-0 text-subtle" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search tools, pages and commands…"
                className="h-12 w-full bg-transparent text-[15px] text-fg outline-none placeholder:text-subtle"
              />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-[min(60vh,440px)] overflow-y-auto overscroll-contain p-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-subtle">
              <Command.Empty className="px-3 py-8 text-center text-sm text-muted">
                No tools match “{query}”.
              </Command.Empty>
              {q ? (
                results.length > 0 && (
                  <Command.Group heading="Tools">
                    {results.map(({ tool }) => (
                      <ToolItem key={tool.id} tool={tool} onSelect={() => go(tool.path)} />
                    ))}
                  </Command.Group>
                )
              ) : (
                <>
                  {recent.length > 0 && (
                    <Command.Group heading="Recent">
                      {recent.map((t) => (
                        <ToolItem key={t.id} tool={t} onSelect={() => go(t.path)} />
                      ))}
                    </Command.Group>
                  )}
                  <Command.Group heading="Popular">
                    {tools
                      .filter((t) => t.popular && !recent.includes(t))
                      .slice(0, 8)
                      .map((t) => (
                        <ToolItem key={t.id} tool={t} onSelect={() => go(t.path)} />
                      ))}
                  </Command.Group>
                </>
              )}
              {actions.length > 0 && (
                <Command.Group heading="Commands">
                  {actions.map((a) => (
                    <Command.Item key={a.id} value={`action:${a.id}`} onSelect={run(a.run)} className={itemClass}>
                      {a.icon}
                      <span>{a.label}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {nav.length > 0 && (
                <Command.Group heading="Go to">
                  {nav.map((n) => (
                    <Command.Item key={n.path} value={`nav:${n.path}`} onSelect={() => go(n.path)} className={itemClass}>
                      {n.icon}
                      <span>{n.label}</span>
                      <ArrowRight className="ml-auto !size-3.5 opacity-0 group-data-[selected=true]:opacity-100" />
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
            <div className="flex items-center gap-4 border-t border-border bg-bg/50 px-3.5 py-2 text-2xs text-subtle">
              <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
              <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
              <span className="ml-auto">{tools.length} tools · all processing stays on this device</span>
            </div>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
