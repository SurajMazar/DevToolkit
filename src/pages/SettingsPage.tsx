import { useEffect, useState } from 'react'
import { Download, HardDrive, Monitor, Moon, Sun, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { usePrefs } from '@/stores/prefs'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { Switch } from '@/components/ui/switch'
import { Segmented } from '@/components/ui/segmented'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { clearAllDrafts, clearAllLocalData, draftSummary } from '@/services/persistence/db'
import { promptInstall, useInstall } from '@/services/install'
import { formatBytes } from '@/utils/format'

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-x-10 gap-y-3 border-b border-border py-7 last:border-0 md:grid-cols-[220px_1fr]">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-1 text-xs leading-[17px] text-subtle">{description}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="min-w-0">
        <p className="text-sm text-fg">{label}</p>
        {hint && <p className="text-xs text-subtle">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function SettingsPage() {
  useDocumentMeta('Settings')
  const p = usePrefs()
  const [summary, setSummary] = useState<{ count: number; bytes: number; tools: number } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const installEvent = useInstall((s) => s.event)
  const installed = useInstall((s) => s.installed)
  const [swActive, setSwActive] = useState<boolean | null>(null)

  const refresh = () => draftSummary().then(setSummary).catch(() => setSummary(null))
  useEffect(() => {
    void refresh()
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then((r) => setSwActive(!!r?.active))
    else setSwActive(false)
  }, [])

  return (
    <div className="mx-auto w-full max-w-[920px] px-4 pb-16 pt-8 md:px-8">
      <h1 className="text-[24px] font-semibold leading-8 tracking-[-0.02em]">Settings</h1>
      <p className="text-sm text-muted">Preferences are stored only in this browser.</p>

      <Section title="Appearance">
        <Row label="Theme">
          <Segmented
            aria-label="Theme"
            value={p.theme}
            onValueChange={p.setTheme}
            options={[
              { value: 'system', label: 'System', icon: <Monitor /> },
              { value: 'light', label: 'Light', icon: <Sun /> },
              { value: 'dark', label: 'Dark', icon: <Moon /> },
            ]}
          />
        </Row>
        <Row label="Collapse sidebar" hint="Also available with Ctrl/⌘ + \">
          <Switch checked={p.sidebarCollapsed} onCheckedChange={p.setSidebarCollapsed} aria-label="Collapse sidebar" />
        </Row>
      </Section>

      <Section title="Editor" description="Applies to every code and text editor in the app.">
        <Row label="Font size">
          <Segmented
            aria-label="Editor font size"
            value={String(p.editorFontSize)}
            onValueChange={(v) => p.set({ editorFontSize: Number(v) })}
            options={['12', '13', '14', '15', '16'].map((v) => ({ value: v, label: v }))}
          />
        </Row>
        <Row label="Wrap long lines" hint="Disabled automatically for documents over 5 MB.">
          <Switch checked={p.editorWordWrap} onCheckedChange={(v) => p.set({ editorWordWrap: v })} aria-label="Wrap long lines" />
        </Row>
        <Row label="Show minimap">
          <Switch checked={p.editorMinimap} onCheckedChange={(v) => p.set({ editorMinimap: v })} aria-label="Show minimap" />
        </Row>
      </Section>

      <Section
        title="Privacy & local data"
        description="DevToolkit has no backend. Content you paste is processed in this tab and never sent anywhere."
      >
        <Row label="Private mode" hint="Nothing about your content or tool usage is written to this device while on.">
          <Switch checked={p.privateMode} onCheckedChange={(v) => p.set({ privateMode: v })} aria-label="Private mode" />
        </Row>
        <Row
          label="Remember tool inputs"
          hint="Restores what you last pasted into each tool (stored in IndexedDB). Never applies to tokens, passwords, hashes or .env files."
        >
          <Switch checked={p.rememberInputs} onCheckedChange={(v) => p.set({ rememberInputs: v })} aria-label="Remember tool inputs" />
        </Row>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-workspace px-3 py-2.5">
          <HardDrive className="size-4 text-subtle" />
          <p className="min-w-0 flex-1 text-sm text-muted">
            {summary
              ? summary.count
                ? `${summary.count} saved inputs across ${summary.tools} tools · ${formatBytes(summary.bytes)}`
                : 'No saved inputs on this device'
              : 'Local storage is unavailable in this browser context'}
          </p>
          <Button
            size="sm"
            disabled={!summary?.count}
            onClick={async () => {
              await clearAllDrafts()
              await refresh()
              toast.success('Saved inputs cleared')
            }}
          >
            Clear saved inputs
          </Button>
        </div>
        <Row label="Recent tools" hint={`${p.recents.length} entries`}>
          <Button size="sm" disabled={!p.recents.length} onClick={p.clearRecents}>
            Clear
          </Button>
        </Row>
        <Row label="Clear all local data" hint="Removes saved inputs, favorites, history and preferences.">
          <Button size="sm" variant="danger" onClick={() => setConfirmOpen(true)}>
            <Trash2 /> Clear everything
          </Button>
        </Row>
      </Section>

      <Section title="Offline & install" description="After the first visit every tool is cached, so the app keeps working without a connection.">
        <Row label="Offline cache" hint={swActive == null ? 'Checking…' : swActive ? 'Service worker active — all tools are available offline.' : 'Not active (development builds and some private windows disable it).'}>
          <span className={`text-xs ${swActive ? 'text-ok' : 'text-subtle'}`}>{swActive ? 'Ready' : 'Inactive'}</span>
        </Row>
        <Row label="Install as an app" hint={installed ? 'Installed on this device.' : installEvent ? 'Opens in its own window, launches from your dock.' : 'Use your browser menu → “Install DevToolkit” (or Add to Home Screen) when available.'}>
          <Button size="sm" disabled={!installEvent} onClick={() => void promptInstall()}>
            <Download /> Install
          </Button>
        </Row>
      </Section>

      <Section title="Browser features" description="Some capabilities depend on a secure context (HTTPS or localhost).">
        <ul className="flex flex-col gap-1.5 text-sm text-muted">
          <li><span className="text-fg">Clipboard read/write</span> — requires HTTPS; reading also needs your permission.</li>
          <li><span className="text-fg">Hashing, HMAC and JWT verification</span> — Web Crypto (crypto.subtle) requires HTTPS.</li>
          <li><span className="text-fg">Offline mode & install</span> — service workers require HTTPS.</li>
          <li><span className="text-fg">Random values</span> — crypto.getRandomValues works everywhere and is used for every generator.</li>
        </ul>
        <p className="text-xs text-subtle">This context is {window.isSecureContext ? 'secure — everything above is available.' : 'not secure — some features are unavailable.'}</p>
      </Section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent title="Clear all local data?" description="Saved inputs, favorites, recent history and preferences will be removed from this browser. This can't be undone.">
          <div className="flex justify-end gap-2 px-4 py-3">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="primary"
              className="bg-danger hover:bg-danger/90 text-white"
              onClick={async () => {
                await clearAllLocalData()
                location.reload()
              }}
            >
              Clear everything
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
