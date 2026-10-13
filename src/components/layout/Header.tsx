import { Link } from 'react-router'
import { EyeOff, Menu, Monitor, Moon, PanelLeft, Search, Settings, Sun } from 'lucide-react'
import { usePrefs, type ThemePref } from '@/stores/prefs'
import { useUI } from '@/stores/ui'
import { Wordmark } from './Logo'
import { IconButton } from '@/components/ui/icon-button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { modKey } from '@/utils/platform'
import { cn } from '@/utils/cn'
import { tools } from '@/registry'

const themeIcon: Record<ThemePref, React.ReactNode> = { system: <Monitor />, dark: <Moon />, light: <Sun /> }

export function Header() {
  const collapsed = usePrefs((s) => s.sidebarCollapsed)
  const toggleSidebar = usePrefs((s) => s.toggleSidebar)
  const theme = usePrefs((s) => s.theme)
  const setTheme = usePrefs((s) => s.setTheme)
  const privateMode = usePrefs((s) => s.privateMode)
  const setPrefs = usePrefs((s) => s.set)
  const openPalette = useUI((s) => s.setPaletteOpen)
  const openMobileNav = useUI((s) => s.setMobileNavOpen)

  return (
    <header className="flex h-12 shrink-0 items-center border-b border-border bg-bg">
      <div className={cn('flex h-full shrink-0 items-center gap-1 pl-2 pr-3 md:transition-[width] md:duration-200', collapsed ? 'md:w-[52px] md:justify-center md:px-0' : 'md:w-[232px]')}>
        <IconButton className="md:hidden" label="Open navigation" icon={<Menu />} onClick={() => openMobileNav(true)} />
        <IconButton
          className="hidden md:inline-flex"
          label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          shortcut={[modKey, '\\']}
          icon={<PanelLeft />}
          onClick={toggleSidebar}
        />
        {!collapsed && (
          <Link to="/" className="ml-1 rounded-md px-1 py-1 outline-none focus-visible:outline-2 focus-visible:outline-ring" aria-label="DevToolkit home">
            <Wordmark />
          </Link>
        )}
        {collapsed && (
          <Link to="/" className="ml-1 md:hidden" aria-label="DevToolkit home">
            <Wordmark />
          </Link>
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2 px-2 md:px-4">
        <button
          type="button"
          onClick={() => openPalette(true)}
          className="group flex h-8 w-full max-w-[420px] items-center gap-2 rounded-md border border-border bg-workspace pl-2.5 pr-1.5 text-left text-sm text-subtle transition-colors duration-120 hover:border-border-strong hover:text-muted focus-visible:outline-2 focus-visible:outline-ring"
          aria-label="Search tools"
          aria-keyshortcuts="Meta+K Control+K"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="truncate">Search {tools.length} developer tools…</span>
          <span className="ml-auto hidden items-center gap-0.5 sm:flex">
            <Kbd>{modKey}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 pr-2 md:pr-3">
        {privateMode && (
          <Tooltip content="Private mode — nothing is saved on this device. Click to turn off.">
            <Button variant="ghost" size="sm" className="text-accent-text" onClick={() => setPrefs({ privateMode: false })}>
              <EyeOff />
              <span className="hidden sm:inline">Private</span>
            </Button>
          </Tooltip>
        )}
        <DropdownMenu>
          <Tooltip content="Theme">
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Change theme">
                {themeIcon[theme]}
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent className="min-w-40">
            <DropdownMenuLabel>Appearance</DropdownMenuLabel>
            {(['system', 'light', 'dark'] as const).map((t) => (
              <DropdownMenuItem key={t} onSelect={() => setTheme(t)} className={cn(theme === t && 'text-accent-text [&_svg]:!text-accent-text')}>
                {themeIcon[t]}
                {t === 'system' ? 'Match system' : t === 'light' ? 'Light' : 'Dark'}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip content="Settings">
          <Button asChild variant="ghost" size="icon-sm">
            <Link to="/settings" aria-label="Settings">
              <Settings />
            </Link>
          </Button>
        </Tooltip>
      </div>
    </header>
  )
}
