import { useMemo, useState } from 'react'
import { Code2, FileInput, ImageOff, RotateCcw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import {
  breadcrumbUrl,
  charLength,
  EMPTY_META,
  formFromTags,
  generateHead,
  SAMPLE_META,
  truncateChars,
  validateMeta,
  type ExtractedTag,
  type MetaForm,
  type MetaIssue,
  type OgType,
  type TwitterCard,
} from '@/engines/html/meta'
import { usePersistentState } from '@/hooks/usePersistentState'
import { Toolbar, ToolbarSpacer } from '@/components/tools/Toolbar'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { SplitPane } from '@/components/tools/SplitPane'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { OutputEditorPane } from '@/components/tools/EditorPane'
import { Input, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { CopyButton } from '@/components/common/CopyButton'
import { cn } from '@/utils/cn'

/** Parses pasted markup into an inert document (DOMParser never runs scripts or loads resources). */
function extractTags(markup: string): ExtractedTag[] {
  const doc = new DOMParser().parseFromString(markup, 'text/html')
  const out: ExtractedTag[] = []
  for (const el of Array.from(doc.querySelectorAll('title, meta, link'))) {
    const attrs: Record<string, string> = {}
    for (const a of Array.from(el.attributes)) attrs[a.name.toLowerCase()] = a.value
    const tag = el.tagName.toLowerCase() as ExtractedTag['tag']
    out.push({ tag, attrs, text: tag === 'title' ? (el.textContent ?? '') : undefined })
  }
  return out
}

const OG_TYPES: { value: OgType; label: string }[] = [
  { value: 'website', label: 'website' },
  { value: 'article', label: 'article' },
  { value: 'profile', label: 'profile' },
  { value: 'book', label: 'book' },
  { value: 'video.other', label: 'video.other' },
  { value: 'music.song', label: 'music.song' },
]

const ROBOTS = [
  { value: '', label: 'Not set (index, follow)' },
  { value: 'index, follow', label: 'index, follow' },
  { value: 'noindex, follow', label: 'noindex, follow' },
  { value: 'index, nofollow', label: 'index, nofollow' },
  { value: 'noindex, nofollow', label: 'noindex, nofollow' },
  { value: 'max-image-preview:large', label: 'max-image-preview:large' },
]

export default function MetaTagsTool() {
  const [form, setForm] = usePersistentState<MetaForm>('form', SAMPLE_META)
  const [importOpen, setImportOpen] = useState(false)
  const [previewTab, setPreviewTab] = useState<'search' | 'social'>('search')
  const set = <K extends keyof MetaForm>(k: K, v: MetaForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  const html = useMemo(() => generateHead(form), [form])
  const issues = useMemo(() => validateMeta(form), [form])
  const issuesFor = (k: keyof MetaForm) => issues.filter((i) => i.field === k)
  const errors = issues.filter((i) => i.level === 'error').length
  const warnings = issues.filter((i) => i.level === 'warning').length

  const formColumn = (
    <div className="flex flex-col">
      <FormSection title="Search">
        <TextField label="Title" value={form.title} onChange={(v) => set('title', v)} issues={issuesFor('title')} counter={{ ideal: [50, 60], max: 60 }} placeholder="Page title — Brand" />
        <TextField label="Description" multiline value={form.description} onChange={(v) => set('description', v)} issues={issuesFor('description')} counter={{ ideal: [150, 160], max: 160 }} placeholder="One or two sentences that sell the click." />
        <TextField label="Canonical URL" value={form.canonical} onChange={(v) => set('canonical', v)} issues={issuesFor('canonical')} placeholder="https://example.com/page" mono />
        <div className="grid grid-cols-2 gap-3">
          <FieldShell label="Robots">
            <Select aria-label="Robots" value={form.robots || '__none'} onValueChange={(v) => set('robots', v === '__none' ? '' : v)} options={ROBOTS.map((r) => ({ ...r, value: r.value || '__none' }))} className="w-full" size="md" />
          </FieldShell>
          <TextField label="Theme color" value={form.themeColor} onChange={(v) => set('themeColor', v)} issues={issuesFor('themeColor')} placeholder="#0f766e" mono swatch />
        </div>
      </FormSection>
      <FormSection title="Open Graph">
        <TextField label="Image URL" value={form.image} onChange={(v) => set('image', v)} issues={issuesFor('image')} placeholder="https://example.com/og.png (1200×630)" mono />
        <TextField label="Image alt text" value={form.imageAlt} onChange={(v) => set('imageAlt', v)} issues={issuesFor('imageAlt')} placeholder="What the image shows" />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Site name" value={form.siteName} onChange={(v) => set('siteName', v)} issues={[]} placeholder="Brand" />
          <FieldShell label="Type">
            <Select aria-label="og:type" value={form.type} onValueChange={(v: OgType) => set('type', v)} options={OG_TYPES} className="w-full" size="md" />
          </FieldShell>
        </div>
        <TextField label="Locale" value={form.locale} onChange={(v) => set('locale', v)} issues={issuesFor('locale')} placeholder="en_US" mono />
      </FormSection>
      <FormSection title="Twitter / X">
        <FieldShell label="Card">
          <Segmented
            aria-label="Twitter card type"
            value={form.twitterCard}
            onValueChange={(v: TwitterCard) => set('twitterCard', v)}
            options={[
              { value: 'summary_large_image', label: 'Large image' },
              { value: 'summary', label: 'Summary' },
            ]}
            className="h-8 w-full [&>*]:flex-1 [&>*]:justify-center"
          />
        </FieldShell>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Site @handle" value={form.twitterSite} onChange={(v) => set('twitterSite', v)} issues={issuesFor('twitterSite')} placeholder="@brand" mono />
          <TextField label="Creator @handle" value={form.twitterCreator} onChange={(v) => set('twitterCreator', v)} issues={issuesFor('twitterCreator')} placeholder="@author" mono />
        </div>
        <Checkbox checked={form.twitterDuplicates} onCheckedChange={(v) => set('twitterDuplicates', v === true)} label="Also emit twitter:title, description and image" description="Optional — X falls back to the og:* tags." />
      </FormSection>
      <FormSection title="Other">
        <TextField label="Author" value={form.author} onChange={(v) => set('author', v)} issues={[]} placeholder="Jane Doe" />
        <TextField label="Keywords" value={form.keywords} onChange={(v) => set('keywords', v)} issues={[]} placeholder="Optional — ignored by Google" />
      </FormSection>
    </div>
  )

  const previews = (
    <Pane aria-label="Previews">
      <PaneHeader title="Preview">
        <Segmented
          size="xs"
          aria-label="Preview type"
          value={previewTab}
          onValueChange={setPreviewTab}
          options={[
            { value: 'search', label: 'Search result' },
            { value: 'social', label: 'Social card' },
          ]}
        />
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-y-auto bg-surface/40 p-4 md:p-6">
        {previewTab === 'search' ? <SearchPreview form={form} /> : <SocialPreview form={form} />}
        <p className="mx-auto mt-4 max-w-[600px] text-2xs leading-4 text-subtle">
          Mockups for orientation only — search engines and social apps decide truncation and layout themselves. Images are never fetched: DevToolkit makes no network requests.
        </p>
      </div>
    </Pane>
  )

  const code = <OutputEditorPane title="<head> tags" value={html} language="html" filename="meta-tags.html" mime="text/html" wordWrap />

  return (
    <>
      <Toolbar>
        <Button size="sm" variant="ghost" onClick={() => setImportOpen(true)}>
          <FileInput /> Import from HTML
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setForm(SAMPLE_META)}>
          <Sparkles /> Sample
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setForm(EMPTY_META)}>
          <RotateCcw /> Clear
        </Button>
        <ToolbarSpacer />
        <CopyButton value={html} label="Copy tags" showLabel variant="secondary" />
      </Toolbar>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <aside aria-label="Tag fields" className="shrink-0 border-b border-border bg-bg md:min-h-0 md:w-[400px] md:overflow-y-auto md:border-b-0 md:border-r lg:w-[440px]">
          {formColumn}
        </aside>
        <div className="flex min-h-[560px] min-w-0 flex-1 flex-col bg-workspace md:min-h-0">
          <SplitPane id="meta-tags" direction="vertical" initial={0.55} mobileTabs={['Preview', 'Code']}>
            {previews}
            {code}
          </SplitPane>
        </div>
      </div>
      <StatusBar>
        <StatusItem label="Title">{charLength(form.title.trim())} chars</StatusItem>
        <StatusItem label="Description">{charLength(form.description.trim())} chars</StatusItem>
        <StatusItem label="Tags">{html.split('\n').filter((l) => l.startsWith('<')).length}</StatusItem>
        <StatusSpacer />
        {errors > 0 ? <StatusItem tone="danger">{errors} {errors === 1 ? 'error' : 'errors'}</StatusItem> : warnings > 0 ? <StatusItem tone="mod">{warnings} {warnings === 1 ? 'suggestion' : 'suggestions'}</StatusItem> : <StatusItem tone="ok">Looks good</StatusItem>}
      </StatusBar>
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={(tags) => {
          const r = formFromTags(tags, EMPTY_META)
          if (r.recognized === 0) {
            toast.error('No recognizable tags found', { description: 'Paste markup containing <title>, <meta> or <link rel="canonical"> tags.' })
            return false
          }
          setForm(r.form)
          toast.success(`Imported ${r.recognized} ${r.recognized === 1 ? 'tag' : 'tags'}`, { description: r.ignored.length ? `Not supported here: ${r.ignored.slice(0, 6).join(', ')}${r.ignored.length > 6 ? '…' : ''}` : undefined })
          return true
        }}
      />
    </>
  )
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-border px-4 py-4 last:border-b-0">
      <h3 className="eyebrow">{title}</h3>
      {children}
    </section>
  )
}

function FieldShell({ label, children, right }: { label: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        {right}
      </div>
      {children}
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  issues,
  placeholder,
  multiline,
  mono,
  counter,
  swatch,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  issues: MetaIssue[]
  placeholder?: string
  multiline?: boolean
  mono?: boolean
  counter?: { ideal: [number, number]; max: number }
  swatch?: boolean
}) {
  const n = charLength(value.trim())
  const error = issues.find((i) => i.level === 'error')
  const counterTone = !counter || n === 0 ? 'text-subtle' : n > counter.max ? 'text-warn' : n >= counter.ideal[0] ? 'text-ok' : 'text-subtle'
  const props = {
    value,
    'aria-label': label,
    'aria-invalid': !!error,
    placeholder,
    className: cn(mono && 'mono text-[12.5px]', swatch && value && 'pl-8'),
  }
  return (
    <FieldShell
      label={label}
      right={
        counter && (
          <span className={cn('tabular text-2xs', counterTone)} title={`Ideal ${counter.ideal[0]}–${counter.ideal[1]} characters`}>
            {n} / {counter.ideal[0]}–{counter.ideal[1]}
          </span>
        )
      }
    >
      <div className="relative">
        {multiline ? (
          <Textarea {...props} rows={3} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <Input {...props} onChange={(e) => onChange(e.target.value)} />
        )}
        {swatch && value && !error && <span className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 rounded-[3px] border border-border-strong" style={{ background: value }} />}
      </div>
      {issues.map((i) => (
        <p key={i.message} className={cn('text-2xs leading-4', i.level === 'error' ? 'text-danger' : i.level === 'warning' ? 'text-warn' : 'text-subtle')}>
          {i.message}
        </p>
      ))}
    </FieldShell>
  )
}

function ImagePlaceholder({ url, className, compact }: { url: string; className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-1.5 bg-surface-2 px-4 text-center text-subtle', className)}>
      <ImageOff className={compact ? 'size-4' : 'size-5'} />
      {!compact && (
        <>
          <p className="text-xs text-muted">{url ? 'Image not loaded — no network requests' : 'No og:image'}</p>
          {url && <p className="mono max-w-full truncate text-2xs">{url}</p>}
        </>
      )}
    </div>
  )
}

function SearchPreview({ form }: { form: MetaForm }) {
  const title = form.title.trim() || 'Untitled page'
  const url = form.canonical.trim()
  const site = form.siteName.trim() || (url ? breadcrumbUrl(url).split(' › ')[0] : 'example.com')
  return (
    <article aria-label="Search result mockup" className="mx-auto max-w-[600px] rounded-lg border border-border bg-workspace p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-2xs font-semibold text-muted">{site.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0">
          <p className="truncate text-sm leading-4 text-fg">{site}</p>
          <p className="truncate text-xs text-muted">{url ? breadcrumbUrl(url) : 'Set a canonical URL'}</p>
        </div>
      </div>
      <h4 className="mt-2 text-[19px] leading-6 text-accent-text">{truncateChars(title, 61)}</h4>
      <p className="mt-1 text-sm leading-[21px] text-muted">{form.description.trim() ? truncateChars(form.description.trim(), 158) : <span className="italic text-subtle">No description — search engines will pick text from the page.</span>}</p>
    </article>
  )
}

function SocialPreview({ form }: { form: MetaForm }) {
  const url = form.canonical.trim()
  const domain = url ? breadcrumbUrl(url).split(' › ')[0] : 'example.com'
  const title = form.title.trim() || 'Untitled page'
  const large = form.twitterCard === 'summary_large_image'
  return (
    <article aria-label="Social link card mockup" className="mx-auto max-w-[520px]">
      {large ? (
        <div className="overflow-hidden rounded-xl border border-border bg-workspace">
          <ImagePlaceholder url={form.image.trim()} className="aspect-[1.91/1] border-b border-border" />
          <div className="px-3.5 py-3">
            <p className="text-xs uppercase tracking-wide text-subtle">{domain}</p>
            <p className="mt-0.5 truncate text-[15px] font-semibold text-fg">{truncateChars(title, 70)}</p>
            <p className="mt-0.5 line-clamp-2 text-sm text-muted">{form.description.trim() || 'No description'}</p>
          </div>
        </div>
      ) : (
        <div className="flex overflow-hidden rounded-xl border border-border bg-workspace">
          <ImagePlaceholder url={form.image.trim()} compact className="w-[120px] shrink-0 border-r border-border" />
          <div className="min-w-0 px-3.5 py-3">
            <p className="text-xs uppercase tracking-wide text-subtle">{domain}</p>
            <p className="mt-0.5 truncate text-[15px] font-semibold text-fg">{truncateChars(title, 70)}</p>
            <p className="mt-0.5 line-clamp-2 text-sm text-muted">{form.description.trim() || 'No description'}</p>
          </div>
        </div>
      )}
      <p className="mt-2 text-2xs text-subtle">
        {large ? 'summary_large_image' : 'summary'} card{form.twitterSite.trim() ? ` · ${form.twitterSite.trim().startsWith('@') ? '' : '@'}${form.twitterSite.trim()}` : ''}
        {form.image.trim() && !form.image.trim().startsWith('http') ? ' · image URL must be absolute' : ''}
      </p>
    </article>
  )
}

function ImportDialog({ open, onOpenChange, onImport }: { open: boolean; onOpenChange: (o: boolean) => void; onImport: (tags: ExtractedTag[]) => boolean }) {
  const [text, setText] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Import existing tags" description="Paste a page's <head> (or the whole HTML). It is parsed into an inert document — nothing is executed or loaded." className="max-w-xl">
        <form
          className="flex flex-col gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (onImport(extractTags(text))) {
              onOpenChange(false)
              setText('')
            }
          }}
        >
          <Textarea
            autoFocus
            rows={12}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'<title>My page</title>\n<meta name="description" content="…">\n<meta property="og:image" content="https://…">'}
            className="mono text-xs"
            aria-label="HTML to import"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-2xs text-subtle">
              <Code2 className="size-3.5" /> Replaces the current form.
            </p>
            <Button type="submit" size="sm" variant="primary" disabled={!text.trim()}>
              Import tags
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
