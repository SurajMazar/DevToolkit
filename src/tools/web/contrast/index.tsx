import { useMemo } from 'react'
import { ArrowLeftRight, Check, Info, Search, X } from 'lucide-react'
import { formatHex, type Color } from 'culori'
import { parseColor } from '@/engines/color/convert'
import { apcaContrast, contrast, formatRatio, passes, suggestForeground, WCAG_LEVELS, type Suggestion } from '@/engines/color/contrast'
import { usePersistentState } from '@/hooks/usePersistentState'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Badge } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/tooltip'
import { CopyButton } from '@/components/common/CopyButton'
import { cn } from '@/utils/cn'
import { ColorField } from '../_shared/ColorField'
import { CHECKER } from '../_shared/checker'

const FALLBACK_FG = '#5b6b7f'
const FALLBACK_BG = '#ffffff'

function colorOr(s: string, fallback: string): Color {
  const p = parseColor(s)
  return p.ok ? p.color : (parseColor(fallback) as { ok: true; color: Color }).color
}

export default function ContrastChecker() {
  const [fg, setFg] = usePersistentState('fg', FALLBACK_FG)
  const [bg, setBg] = usePersistentState('bg', FALLBACK_BG)
  const [showApca, setShowApca] = usePersistentState('apca', false)

  const fgColor = useMemo(() => colorOr(fg, FALLBACK_FG), [fg])
  const bgColor = useMemo(() => colorOr(bg, FALLBACK_BG), [bg])
  const result = useMemo(() => contrast(fgColor, bgColor), [fgColor, bgColor])
  const ratio = result.ratio
  const apca = useMemo(() => apcaContrast(result.fg, result.bg), [result])
  const failing = WCAG_LEVELS.filter((l) => !passes(ratio, l.min))
  // Most useful goal first: AA body text, then AAA, then large text / UI.
  const targets = [4.5, 7, 3].filter((t) => failing.some((l) => l.min === t))
  const suggestions = useMemo(() => targets.map((t) => ({ target: t, ...suggestForeground(fgColor, bgColor, t) })), [fgColor, bgColor, targets.join()])

  const swap = () => {
    setFg(bg)
    setBg(fg)
  }

  const verdict = passes(ratio, 7) ? { tone: 'ok' as const, text: 'Excellent — passes AAA' } : passes(ratio, 4.5) ? { tone: 'ok' as const, text: 'Passes AA for all text' } : passes(ratio, 3) ? { tone: 'warn' as const, text: 'Large text and UI only' } : { tone: 'danger' as const, text: 'Fails all WCAG levels' }

  return (
    <>
      <Toolbar>
        <ToolbarField label="Text">
          <ColorField value={fg} onChange={setFg} label="Text (foreground) color" className="w-[180px]" />
        </ToolbarField>
        <IconButton label="Swap colors" icon={<ArrowLeftRight />} onClick={swap} />
        <ToolbarField label="Background">
          <ColorField value={bg} onChange={setBg} label="Background color" className="w-[180px]" />
        </ToolbarField>
        <ToolbarSeparator />
        <Checkbox checked={showApca} onCheckedChange={(v) => setShowApca(v === true)} label="Show APCA (draft)" />
        <ToolbarSpacer />
      </Toolbar>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <section aria-label="Preview" data-user-colors className="relative min-h-[320px] min-w-0 flex-1 overflow-y-auto md:min-h-0" style={{ background: CHECKER }}>
          <div className="min-h-full px-6 py-6 md:px-10 md:py-8" style={{ background: bg, color: fg }}>
            <p className="mb-6 text-[11px] font-medium uppercase tracking-[0.08em] opacity-80">Live preview</p>
            <h2 className="text-[32px] font-semibold leading-tight tracking-[-0.01em]">Readable by everyone</h2>
            <p className="mt-3 text-[24px] leading-snug">Large text — 24px regular</p>
            <p className="mt-2 text-[18.66px] font-bold leading-snug">Large text — 18.66px (14pt) bold</p>
            <p className="mt-4 max-w-[62ch] text-[16px] leading-relaxed">
              Body text at 16px. Good contrast helps people with low vision, older screens, glare from sunlight and tired eyes. WCAG asks for at least 4.5:1 for text like this.
            </p>
            <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed">Small text at 14px — captions, labels and secondary information need the same 4.5:1 ratio.</p>
            <p className="mt-2 text-[12px] font-medium">Fine print · 12px medium</p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <span className="inline-flex h-9 items-center gap-2 rounded-md border-2 px-3 text-[14px] font-medium" style={{ borderColor: fg }}>
                <Search className="size-4" /> Outline button
              </span>
              <span className="inline-flex h-9 items-center rounded-md px-3 text-[14px] font-medium" style={{ background: fg, color: bg }}>
                Filled button
              </span>
              <span className="inline-flex h-9 w-48 items-center rounded-md border px-3 text-[14px] opacity-100" style={{ borderColor: fg }}>
                Input border
              </span>
              <span className="inline-flex size-9 items-center justify-center rounded-full border-2" style={{ borderColor: fg }} role="img" aria-label="Icon in a circle">
                <Check className="size-4" />
              </span>
            </div>
            <p className="mt-3 text-[12px] opacity-90">Borders, icons and focus indicators need 3:1 against adjacent colors (WCAG 1.4.11).</p>
          </div>
        </section>
        <aside aria-label="Results" className="shrink-0 border-t border-border bg-bg md:w-[360px] md:overflow-y-auto md:border-l md:border-t-0">
          <div className="border-b border-border px-4 py-4">
            <p className="eyebrow">Contrast ratio</p>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="tabular text-[40px] font-semibold leading-none tracking-[-0.02em] text-fg">{formatRatio(ratio)}</span>
              <span className="text-lg text-muted">:1</span>
              <CopyButton value={`${formatRatio(ratio)}:1`} label="Copy ratio" size="icon-xs" className="ml-1 self-center" />
            </div>
            <Badge tone={verdict.tone} className="mt-2">
              {verdict.text}
            </Badge>
            {result.usedAlpha && (
              <p className="mt-3 flex gap-1.5 text-2xs leading-4 text-subtle">
                <Info className="mt-px size-3 shrink-0" />
                Transparent colors are composited first: the text over the background, and a translucent background over white. Measured text color: {formatHex(result.fg)}.
              </p>
            )}
          </div>

          <div className="border-b border-border px-4 py-3">
            <h3 className="eyebrow mb-2">WCAG 2.2</h3>
            <ul className="flex flex-col">
              {WCAG_LEVELS.map((l) => {
                const ok = passes(ratio, l.min)
                return (
                  <li key={l.id} className="flex h-9 items-center gap-3 border-b border-border/70 last:border-b-0">
                    <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full', ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger')}>
                      {ok ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
                    </span>
                    <span className="w-9 shrink-0 text-sm font-medium">{l.label}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted">{l.detail}</span>
                    <Tooltip content={`Success criterion ${l.criterion}`}>
                      <span className="tabular text-xs text-subtle">≥ {l.min}:1</span>
                    </Tooltip>
                  </li>
                )
              })}
            </ul>
            <p className="mt-2 text-2xs leading-4 text-subtle">Large text = at least 24px regular or 18.66px (14pt) bold. Ratios are not rounded when judging: 4.499:1 fails AA.</p>
          </div>

          <div className="border-b border-border px-4 py-3">
            <h3 className="eyebrow mb-2">Suggested text colors</h3>
            {suggestions.length === 0 ? (
              <p className="text-sm text-muted">This pair already passes every level.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {suggestions.map((s) => (
                  <div key={s.target}>
                    <p className="mb-1.5 text-xs text-muted">
                      To reach <span className="tabular text-fg">{s.target}:1</span> ({WCAG_LEVELS.filter((l) => l.min === s.target).map((l) => `${l.label} ${l.detail.toLowerCase()}`).join(', ')})
                    </p>
                    {!s.lighter && !s.darker ? (
                      <p className="text-xs text-danger">No color with this hue reaches {s.target}:1 on this background — change the background.</p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {[s.darker, s.lighter].filter((x): x is Suggestion => !!x).map((sg) => (
                          <SuggestionRow key={sg.direction} s={sg} best={s.best?.direction === sg.direction} onApply={() => setFg(sg.color)} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <p className="text-2xs leading-4 text-subtle">Found by changing OKLCH lightness only — hue stays the same, chroma is reduced only where sRGB requires it.</p>
              </div>
            )}
          </div>

          {showApca && (
            <div className="px-4 py-3">
              <h3 className="eyebrow mb-1">APCA · informational</h3>
              <div className="flex items-baseline gap-2">
                <span className="tabular text-2xl font-semibold">Lc {apca.toFixed(1)}</span>
                <span className="text-xs text-muted">{apca >= 0 ? 'dark text on light' : 'light text on dark'}</span>
              </div>
              <p className="mt-1.5 text-2xs leading-4 text-subtle">
                APCA (0.0.98G) is a draft candidate for WCAG 3 — non-normative and not a conformance requirement. Roughly: |Lc| 75+ for body text, 60+ for large text, 45+ for headlines, 30+ for non-text.
              </p>
            </div>
          )}
        </aside>
      </div>
      <StatusBar>
        <StatusItem label="Ratio">{formatRatio(ratio)}:1</StatusItem>
        <StatusItem label="L text">{result.fgLuminance.toFixed(4)}</StatusItem>
        <StatusItem label="L background">{result.bgLuminance.toFixed(4)}</StatusItem>
        {showApca && <StatusItem label="APCA">Lc {apca.toFixed(1)}</StatusItem>}
        <StatusSpacer />
        <StatusItem tone={failing.length ? (passes(ratio, 3) ? 'mod' : 'danger') : 'ok'}>
          {WCAG_LEVELS.length - failing.length}/{WCAG_LEVELS.length} checks pass
        </StatusItem>
      </StatusBar>
    </>
  )
}

function SuggestionRow({ s, best, onApply }: { s: Suggestion; best: boolean; onApply: () => void }) {
  return (
    <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-workspace pl-1.5 pr-1">
      <span className="relative size-5 shrink-0 overflow-hidden rounded-[4px] border border-border-strong" style={{ background: CHECKER }}>
        <span className="absolute inset-0" style={{ background: s.color }} />
      </span>
      <span className="mono text-[12.5px]">{s.color}</span>
      <span className="tabular text-2xs text-subtle">
        {formatRatio(s.ratio)}:1 · {s.direction}
      </span>
      {best && <Badge tone="accent">nearest</Badge>}
      <span className="ml-auto flex items-center">
        <CopyButton value={s.color} label={`Copy ${s.color}`} size="icon-xs" />
        <Button size="xs" variant="ghost" onClick={onApply}>
          Apply
        </Button>
      </span>
    </div>
  )
}
