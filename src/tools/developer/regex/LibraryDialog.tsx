import { useMemo, useState } from 'react'
import { BookOpen, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { LIBRARY_CATEGORIES, REGEX_LIBRARY, type LibraryPattern } from '@/engines/dev/regex-library'
import { cn } from '@/utils/cn'

export function LibraryDialog({ onUse }: { onUse: (p: LibraryPattern, withSample: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(REGEX_LIBRARY[0].id)
  const [withSample, setWithSample] = useState(true)
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? REGEX_LIBRARY.filter((p) => `${p.name} ${p.description} ${p.category} ${p.id}`.toLowerCase().includes(s)) : REGEX_LIBRARY
  }, [q])
  const current = list.find((p) => p.id === selected) ?? list[0]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <BookOpen /> Library
        </Button>
      </DialogTrigger>
      <DialogContent title="Pattern library" description="Common patterns with what they deliberately do not handle." className="max-w-3xl">
        <div className="grid h-[min(560px,64vh)] grid-cols-1 sm:grid-cols-[240px_1fr]">
          <div className="flex min-h-0 flex-col border-b border-border sm:border-b-0 sm:border-r">
            <div className="relative p-2">
              <Search className="pointer-events-none absolute left-4.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" aria-label="Filter patterns" className="pl-8" />
            </div>
            <div className="max-h-48 min-h-0 flex-1 overflow-y-auto pb-2 sm:max-h-none" role="listbox" aria-label="Patterns">
              {LIBRARY_CATEGORIES.map((cat) => {
                const items = list.filter((p) => p.category === cat)
                if (!items.length) return null
                return (
                  <div key={cat}>
                    <p className="eyebrow px-3 pb-1 pt-2">{cat}</p>
                    {items.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        role="option"
                        aria-selected={current?.id === p.id}
                        onClick={() => setSelected(p.id)}
                        onDoubleClick={() => {
                          onUse(p, withSample)
                          setOpen(false)
                        }}
                        className={cn('mx-1.5 block w-[calc(100%-12px)] truncate rounded-md px-2.5 py-1 text-left text-sm text-muted hover:bg-surface-2/70 hover:text-fg', current?.id === p.id && 'bg-accent-soft text-fg hover:bg-accent-soft')}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )
              })}
              {!list.length && <p className="px-3 py-4 text-sm text-muted">No pattern matches “{q}”.</p>}
            </div>
          </div>
          {current ? (
            <div className="flex min-h-0 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                <h3 className="text-base font-semibold text-fg">{current.name}</h3>
                <p className="mt-1 text-sm text-muted">{current.description}</p>
                <pre className="mono mt-3 whitespace-pre-wrap break-all rounded-md bg-surface px-3 py-2 text-[12.5px] leading-5 text-fg">
                  <span className="text-subtle">/</span>
                  {current.pattern}
                  <span className="text-subtle">/</span>
                  <span className="text-accent-text">{current.flags}</span>
                </pre>
                <p className="eyebrow mb-1 mt-4">Caveats</p>
                <p className="text-sm text-fg">{current.caveats}</p>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <p className="eyebrow mb-1">Matches</p>
                    <ul className="flex flex-col gap-0.5">
                      {current.matches.map((m) => (
                        <li key={m} className="mono truncate text-[12px] text-add">
                          {m}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="eyebrow mb-1">Rejects</p>
                    <ul className="flex flex-col gap-0.5">
                      {current.rejects.map((m) => (
                        <li key={m} className="mono truncate text-[12px] text-del">
                          {m === '' ? '(empty)' : m}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 border-t border-border px-4 py-2.5">
                <Checkbox checked={withSample} onCheckedChange={(v) => setWithSample(v === true)} label="Replace test string with sample text" />
                <Button
                  size="sm"
                  variant="primary"
                  className="ml-auto"
                  onClick={() => {
                    onUse(current, withSample)
                    setOpen(false)
                  }}
                >
                  Use pattern
                </Button>
              </div>
            </div>
          ) : (
            <div />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
