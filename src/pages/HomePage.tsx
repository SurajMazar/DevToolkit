import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowRight, Clock, ClipboardPaste, Fingerprint, Search, ShieldCheck, WifiOff, X } from 'lucide-react'
import { toast } from 'sonner'
import { categories, getTool, tools, toolsInCategory, type Tool } from '@/registry'
import { searchTools } from '@/registry/search'
import { usePrefs } from '@/stores/prefs'
import { ToolCard, ToolRow } from '@/components/common/ToolCard'
import { CopyButton } from '@/components/common/CopyButton'
import { Kbd } from '@/components/ui/kbd'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { readClipboardText } from '@/utils/clipboard'
import { timeAgo } from '@/utils/time'
import { cn } from '@/utils/cn'

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <h2 className="text-[13px] font-semibold text-fg">{children}</h2>
      {action}
    </div>
  )
}

function newUuid() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16))
}

function QuickActions() {
  const [uuid, setUuid] = useState(newUuid)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const navigate = useNavigate()
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(t)
  }, [])

  const pasteInto = async (path: string, kind: string) => {
    const text = await readClipboardText()
    if (!text) {
      toast.message('Clipboard is empty or access was blocked', { description: `Opening ${kind} — paste with Ctrl/⌘+V.` })
      navigate(path)
      return
    }
    navigate(path, { state: { input: text } })
  }

  const tile =
    'group flex min-w-0 items-center gap-3 rounded-lg border border-border bg-workspace px-3 py-2.5 text-left outline-none transition-colors duration-120 hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring'
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <div className={tile}>
        <Fingerprint className="size-4 shrink-0 text-subtle" />
        <div className="min-w-0 flex-1">
          <p className="text-2xs text-subtle">UUID v4</p>
          <p className="mono truncate text-[12.5px] text-fg" title={uuid}>{uuid}</p>
        </div>
        <CopyButton value={() => { const v = uuid; setUuid(newUuid()); return v }} label="Copy UUID and generate another" />
      </div>
      <div className={tile}>
        <Clock className="size-4 shrink-0 text-subtle" />
        <div className="min-w-0 flex-1">
          <p className="text-2xs text-subtle">Unix time (seconds)</p>
          <p className="mono truncate text-[12.5px] text-fg tabular">{now}</p>
        </div>
        <CopyButton value={() => String(Math.floor(Date.now() / 1000))} label="Copy current Unix timestamp" />
      </div>
      <button type="button" className={tile} onClick={() => pasteInto('/json/formatter', 'JSON Formatter')}>
        <ClipboardPaste className="size-4 shrink-0 text-subtle" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">Paste & format JSON</p>
          <p className="truncate text-2xs text-subtle">Clipboard → JSON Formatter</p>
        </div>
        <ArrowRight className="size-3.5 text-subtle transition-transform group-hover:translate-x-0.5" />
      </button>
      <button type="button" className={tile} onClick={() => pasteInto('/text/case-converter', 'Case Converter')}>
        <ClipboardPaste className="size-4 shrink-0 text-subtle" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">Paste & convert case</p>
          <p className="truncate text-2xs text-subtle">Clipboard → Case Converter</p>
        </div>
        <ArrowRight className="size-3.5 text-subtle transition-transform group-hover:translate-x-0.5" />
      </button>
    </div>
  )
}

export function HomePage() {
  useDocumentMeta(null)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const favorites = usePrefs((s) => s.favorites)
  const recents = usePrefs((s) => s.recents)
  const favTools = favorites.map(getTool).filter(Boolean) as Tool[]
  const recentTools = recents.map((r) => ({ tool: getTool(r.id), at: r.at })).filter((r) => r.tool) as { tool: Tool; at: number }[]
  const featured = tools.filter((t) => t.featured)
  const results = useMemo(() => (query.trim() ? searchTools(tools, categories, query) : null), [query])
  const navigate = useNavigate()

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 pt-8 md:px-8 md:pt-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-[24px] font-semibold leading-8 tracking-[-0.02em] text-fg">DevToolkit</h1>
        <p className="text-sm text-muted">Your everyday developer workspace.</p>
      </div>

      <div className="relative mt-5">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results?.[0]) navigate(results[0].tool.path)
            if (e.key === 'Escape') setQuery('')
          }}
          placeholder={`Search ${tools.length} developer tools…`}
          aria-label="Search tools"
          spellCheck={false}
          className="h-10 w-full rounded-lg border border-border bg-workspace pl-9 pr-24 text-[14px] text-fg outline-none transition-[border-color,box-shadow] duration-120 placeholder:text-subtle hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {query ? (
            <button type="button" onClick={() => setQuery('')} className="rounded-sm p-1 text-subtle hover:text-fg" aria-label="Clear search">
              <X className="size-3.5" />
            </button>
          ) : (
            <span className="hidden items-center gap-1 text-2xs text-subtle sm:flex">
              <Kbd>/</Kbd> anywhere
            </span>
          )}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-subtle">
        <span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5" /> Everything runs in your browser — nothing you paste is uploaded</span>
        <span className="flex items-center gap-1.5"><WifiOff className="size-3.5" /> Works offline once installed</span>
      </div>

      {results ? (
        <section className="mt-6" aria-label="Search results">
          <SectionTitle>
            {results.length} {results.length === 1 ? 'result' : 'results'} for “{query.trim()}”
          </SectionTitle>
          {results.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted">
              No tool matches that search. Try a format (“yaml”), an action (“minify”) or a concept (“epoch”).
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 md:grid-cols-2">
              {results.map(({ tool }) => (
                <ToolRow key={tool.id} tool={tool} meta={categories.find((c) => c.id === tool.category)?.short} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="mt-7" aria-label="Quick actions">
            <SectionTitle>Quick actions</SectionTitle>
            <QuickActions />
          </section>

          {(favTools.length > 0 || recentTools.length > 0) && (
          <div className={cn('mt-8 grid gap-8', favTools.length && recentTools.length ? 'lg:grid-cols-2' : '')}>
            {favTools.length > 0 && (
              <section aria-label="Pinned tools">
                <SectionTitle action={<Link to="/favorites" className="text-xs text-subtle hover:text-fg">Manage</Link>}>Pinned</SectionTitle>
                <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                  {favTools.map((t) => (
                    <ToolRow key={t.id} tool={t} />
                  ))}
                </div>
              </section>
            )}
            {recentTools.length > 0 && (
              <section aria-label="Recently used">
                <SectionTitle action={<Link to="/recent" className="text-xs text-subtle hover:text-fg">View all</Link>}>Recently used</SectionTitle>
                <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                  {recentTools.slice(0, 6).map(({ tool, at }) => (
                    <ToolRow key={tool.id} tool={tool} meta={timeAgo(at)} />
                  ))}
                </div>
              </section>
            )}
          </div>
          )}

          <section className="mt-8" aria-label="Popular tools">
            <SectionTitle>Popular tools</SectionTitle>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {featured.map((t) => (
                <ToolCard key={t.id} tool={t} />
              ))}
            </div>
          </section>

          <section className="mt-10" aria-label="All categories">
            <SectionTitle>All tools</SectionTitle>
            <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-workspace">
              {categories.map((c) => {
                const list = toolsInCategory(c.id).filter((t) => t.category === c.id)
                if (!list.length) return null
                return (
                  <div key={c.id} className="grid gap-x-6 gap-y-2 p-4 md:grid-cols-[200px_1fr]">
                    <div className="min-w-0">
                      <Link to={c.path} className="group flex items-center gap-2 text-sm font-medium text-fg hover:text-accent-text">
                        <c.Icon className="size-4 text-subtle group-hover:text-accent-text" />
                        {c.name}
                      </Link>
                      <p className="mt-1 text-xs leading-[17px] text-subtle">{c.description}</p>
                    </div>
                    <div className="-mx-2.5 grid grid-cols-1 gap-x-2 sm:grid-cols-2 xl:grid-cols-3">
                      {list.map((t) => (
                        <Link
                          key={t.id}
                          to={t.path}
                          className="group flex min-w-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-muted outline-none transition-colors hover:bg-surface-2/70 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                          title={t.description}
                        >
                          <t.Icon className="size-3.5 shrink-0 text-subtle group-hover:text-accent-text" />
                          <span className="truncate">{t.name}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
