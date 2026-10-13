import { useEffect } from 'react'
import { NavLink, useLocation } from 'react-router'
import { ChevronRight, History, LayoutGrid, Settings, Star } from 'lucide-react'
import { categories, getTool, tools, toolsInCategory, type Category, type Tool } from '@/registry'
import { usePrefs } from '@/stores/prefs'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/utils/cn'

const itemBase =
  'group/item flex h-8 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-[13px] text-muted outline-none transition-colors duration-100 hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
const itemActive = 'bg-surface-2 text-fg font-medium'

function onNavKeyDown(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-nav-item]'))
  const i = items.indexOf(document.activeElement as HTMLElement)
  if (i === -1) return
  e.preventDefault()
  items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
}

function NavItem({ to, icon, label, collapsed, end, count, onNavigate }: { to: string; icon: React.ReactNode; label: string; collapsed: boolean; end?: boolean; count?: number; onNavigate?: () => void }) {
  const link = (
    <NavLink
      to={to}
      end={end}
      data-nav-item
      onClick={onNavigate}
      className={({ isActive }) => cn(itemBase, isActive && itemActive, collapsed && 'justify-center px-0')}
      aria-label={collapsed ? label : undefined}
    >
      <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && count != null && count > 0 && <span className="ml-auto text-2xs text-subtle tabular">{count}</span>}
    </NavLink>
  )
  return collapsed ? (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  )
}

function ToolLink({ tool, onNavigate }: { tool: Tool; onNavigate?: () => void }) {
  return (
    <NavLink
      to={tool.path}
      data-nav-item
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'relative flex h-7 min-w-0 items-center rounded-md pl-[34px] pr-2 text-[13px] text-muted outline-none transition-colors duration-100 hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
          isActive && 'bg-accent-soft font-medium text-fg before:absolute before:left-[17px] before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-accent',
        )
      }
    >
      <span className="truncate">{tool.short ?? tool.name}</span>
    </NavLink>
  )
}

function CategoryGroup({ category, collapsed, onNavigate }: { category: Category; collapsed: boolean; onNavigate?: () => void }) {
  const open = usePrefs((s) => s.expandedCategories.includes(category.id))
  const toggle = usePrefs((s) => s.toggleCategory)
  const { pathname } = useLocation()
  const list = toolsInCategory(category.id).filter((t) => t.category === category.id)
  const containsActive = pathname.startsWith(category.path + '/') || list.some((t) => t.path === pathname)

  if (collapsed) {
    return <NavItem to={category.path} icon={<category.Icon />} label={category.name} collapsed onNavigate={onNavigate} />
  }
  const regionId = `nav-${category.id}`
  return (
    <div>
      <button
        type="button"
        data-nav-item
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => toggle(category.id)}
        className={cn(itemBase, containsActive && !open && 'text-fg')}
      >
        <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
          <category.Icon />
        </span>
        <span className="truncate">{category.short}</span>
        <ChevronRight className={cn('ml-auto size-3.5 text-subtle transition-transform duration-150', open && 'rotate-90')} />
      </button>
      {open && (
        <div id={regionId} className="mb-1 mt-px flex flex-col gap-px">
          {list.map((t) => (
            <ToolLink key={t.id} tool={t} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  )
}

export function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation()
  const toggleCategory = usePrefs((s) => s.toggleCategory)
  // Reveal the active tool: expand its category when navigating to it.
  useEffect(() => {
    const t = tools.find((x) => x.path === pathname)
    if (t) toggleCategory(t.category, true)
  }, [pathname, toggleCategory])
  const favorites = usePrefs((s) => s.favorites)
  const recents = usePrefs((s) => s.recents)
  const favTools = favorites.map(getTool).filter(Boolean) as Tool[]

  return (
    <nav aria-label="Tools" onKeyDown={onNavKeyDown} className="flex min-h-0 flex-1 flex-col">
      <div className={cn('flex flex-col gap-px p-2', collapsed && 'items-stretch px-1.5')}>
        <NavItem to="/" end icon={<LayoutGrid />} label="All tools" collapsed={collapsed} onNavigate={onNavigate} />
        <NavItem to="/favorites" icon={<Star />} label="Favorites" collapsed={collapsed} count={favorites.length} onNavigate={onNavigate} />
        <NavItem to="/recent" icon={<History />} label="Recent" collapsed={collapsed} count={recents.length} onNavigate={onNavigate} />
      </div>

      <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2', collapsed && 'px-1.5')}>
        {!collapsed && favTools.length > 0 && (
          <div className="mb-2">
            <p className="eyebrow px-2 pb-1 pt-2">Pinned</p>
            <div className="flex flex-col gap-px">
              {favTools.map((t) => (
                <NavLink
                  key={t.id}
                  to={t.path}
                  data-nav-item
                  onClick={onNavigate}
                  className={({ isActive }) => cn(itemBase, 'h-7', isActive && itemActive)}
                >
                  <t.Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{t.short ?? t.name}</span>
                </NavLink>
              ))}
            </div>
          </div>
        )}
        {!collapsed && <p className="eyebrow px-2 pb-1 pt-2">Categories</p>}
        {collapsed && <div className="mx-2 my-1.5 h-px bg-border" />}
        <div className="flex flex-col gap-px">
          {categories.map((c) => (
            <CategoryGroup key={c.id} category={c} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
        </div>
      </div>

      <div className={cn('border-t border-border p-2', collapsed && 'px-1.5')}>
        <NavItem to="/settings" icon={<Settings />} label="Settings" collapsed={collapsed} onNavigate={onNavigate} />
      </div>
    </nav>
  )
}

export function Sidebar() {
  const collapsed = usePrefs((s) => s.sidebarCollapsed)
  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col border-r border-border bg-bg transition-[width] duration-200 ease-out md:flex',
        collapsed ? 'w-[52px]' : 'w-[232px]',
      )}
    >
      <SidebarContent collapsed={collapsed} />
    </aside>
  )
}
