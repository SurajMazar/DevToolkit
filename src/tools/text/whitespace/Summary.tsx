import { CornerDownRight, TriangleAlert } from 'lucide-react'
import { SPECIAL_CHARS, hexCode, type CharKind, type EolKind, type Occurrence, type WhitespaceSummary } from '@/engines/text-utils/whitespace'
import { formatNumber } from '@/utils/format'
import { cn } from '@/utils/cn'
import { EOL_GLYPH, KIND_CHIP } from './Visualizer'

type Jump = (pos: { line: number; column: number }) => void

const KIND_ROWS: { key: CharKind | 'trailing'; label: string; glyph: React.ReactNode; hint: string }[] = [
  { key: 'space', label: 'Spaces', glyph: '·', hint: 'U+0020' },
  { key: 'tab', label: 'Tabs', glyph: '→', hint: 'U+0009' },
  { key: 'nbsp', label: 'No-break spaces', glyph: '⍽', hint: 'U+00A0 — looks like a space, is not one' },
  { key: 'zero-width', label: 'Zero-width', glyph: 'ZW', hint: 'ZWSP, ZWNJ, ZWJ, word joiner, BOM' },
  { key: 'unicode-space', label: 'Unicode spaces', glyph: 'SP', hint: 'En, em, thin, ideographic…' },
  { key: 'format', label: 'Format & bidi', glyph: 'Cf', hint: 'Direction marks/overrides, soft hyphen…' },
  { key: 'control', label: 'Control chars', glyph: 'Cc', hint: 'NUL, ESC, vertical tab, form feed…' },
  { key: 'line-separator', label: 'Line separators', glyph: 'LS', hint: 'U+2028, U+2029, NEL' },
  { key: 'trailing', label: 'Trailing whitespace', glyph: '·', hint: 'Lines ending in whitespace' },
]

function JumpRow({
  occ,
  onJump,
  glyph,
  glyphClass,
  label,
  hint,
  unit,
}: {
  occ: Occurrence
  onJump: Jump
  glyph: React.ReactNode
  glyphClass: string
  label: React.ReactNode
  hint?: string
  unit?: string
}) {
  const has = occ.count > 0
  return (
    <button
      type="button"
      disabled={!has}
      onClick={() => occ.first && onJump(occ.first)}
      title={has && occ.first ? `${hint ? hint + ' — ' : ''}first at line ${occ.first.line}, column ${occ.first.column}` : hint}
      className={cn(
        'group flex h-7 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm transition-colors duration-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        has ? 'text-fg hover:bg-surface-2' : 'cursor-default text-subtle',
      )}
    >
      <span className={cn('mono flex h-[17px] min-w-[26px] items-center justify-center rounded-[3px] px-1 text-[10px] font-semibold', has ? glyphClass : 'bg-surface text-subtle')}>{glyph}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={cn('tabular text-xs', has ? 'text-muted' : 'text-subtle')}>
        {formatNumber(occ.count)}
        {unit && <span className="text-subtle"> {unit}</span>}
      </span>
      <CornerDownRight className={cn('size-3.5 shrink-0 text-subtle opacity-0', has && 'group-hover:opacity-100 group-focus-visible:opacity-100')} aria-hidden />
    </button>
  )
}

export function WhitespaceSummaryPanel({ summary, onJump }: { summary: WhitespaceSummary; onJump: Jump }) {
  const specials = [...summary.specials.entries()].filter(([cp]) => cp !== 0x20 && cp !== 0x09).sort((a, b) => b[1].count - a[1].count)
  const eols: EolKind[] = ['LF', 'CRLF', 'CR']
  return (
    <>
      <section className="border-b border-border px-2 py-3">
        <h3 className="eyebrow mb-1.5 px-2">Characters</h3>
        {KIND_ROWS.map((r) => (
          <JumpRow
            key={r.key}
            occ={summary.counts[r.key]}
            onJump={onJump}
            glyph={r.glyph}
            glyphClass={r.key === 'trailing' ? 'bg-del-bg text-del' : r.key === 'space' || r.key === 'tab' ? 'bg-surface-2 text-muted' : KIND_CHIP[r.key]}
            label={r.label}
            hint={r.hint}
            unit={r.key === 'trailing' ? 'lines' : undefined}
          />
        ))}
        {summary.mixedIndentLines > 0 && (
          <p className="mx-2 mt-2 flex items-start gap-1.5 text-xs text-warn">
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            {formatNumber(summary.mixedIndentLines)} {summary.mixedIndentLines === 1 ? 'line indents' : 'lines indent'} with both tabs and spaces
          </p>
        )}
      </section>
      {specials.length > 0 && (
        <section className="border-b border-border px-2 py-3">
          <h3 className="eyebrow mb-1.5 px-2">Invisible characters found</h3>
          {specials.map(([cp, occ]) => {
            const info = SPECIAL_CHARS[cp]
            return (
              <JumpRow
                key={cp}
                occ={occ}
                onJump={onJump}
                glyph={info?.abbr ?? hexCode(cp).slice(2)}
                glyphClass={info ? KIND_CHIP[info.kind] : 'bg-mod-bg text-mod'}
                label={
                  <>
                    {info?.name ?? 'Invisible character'} <span className="mono text-2xs text-subtle">{hexCode(cp)}</span>
                  </>
                }
              />
            )
          })}
        </section>
      )}
      <section className="border-b border-border px-2 py-3">
        <h3 className="eyebrow mb-1.5 px-2">Line endings</h3>
        {eols.map((e) => (
          <JumpRow
            key={e}
            occ={summary.counts[e]}
            onJump={onJump}
            glyph={EOL_GLYPH[e]}
            glyphClass={summary.eol.mixed && e !== summary.eol.dominant ? 'bg-warn-soft text-warn' : 'bg-surface-2 text-muted'}
            label={e === 'LF' ? 'LF (Unix, macOS)' : e === 'CRLF' ? 'CRLF (Windows)' : 'CR (classic Mac)'}
          />
        ))}
        {summary.eol.mixed && (
          <p role="alert" className="mx-2 mt-2 flex items-start gap-1.5 rounded-md bg-warn-soft px-2 py-1.5 text-xs text-fg">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-warn" />
            <span>
              Mixed line endings. Most lines use <b className="font-semibold">{summary.eol.dominant}</b>; the others are highlighted. Normalize them below.
            </span>
          </p>
        )}
        <dl className="mx-2 mt-2 grid grid-cols-[1fr_auto] gap-y-1 text-xs">
          <dt className="text-muted">Final newline</dt>
          <dd className="text-right text-fg">{summary.lines === 0 ? '—' : summary.eol.finalNewline ? 'Yes' : 'No'}</dd>
          <dt className="text-muted">Byte order mark</dt>
          <dd className={cn('text-right', summary.hasBom ? 'text-warn' : 'text-fg')}>{summary.hasBom ? 'Present (U+FEFF)' : 'None'}</dd>
        </dl>
      </section>
    </>
  )
}
