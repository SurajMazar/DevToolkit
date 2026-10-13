import { CopyButton } from '@/components/common/CopyButton'
import { HEADER_PARAMS, describeClaims, relativeTime, type ClaimRow } from '@/engines/encoding/jwt'
import { cn } from '@/utils/cn'

const localFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'long' })

function TimeCell({ row, now }: { row: ClaimRow; now: number }) {
  const t = row.time!
  const valid = !Number.isNaN(t.date.getTime())
  return (
    <div className="flex flex-col gap-0.5">
      <span className="mono text-[12.5px] text-fg">{row.display}</span>
      {valid ? (
        <>
          <span className="text-xs text-fg">{localFmt.format(t.date)}</span>
          <span className="mono text-2xs text-subtle">{t.date.toISOString().replace('.000Z', 'Z')}</span>
          <span className={cn('text-xs', row.tone === 'danger' ? 'text-danger' : row.tone === 'ok' ? 'text-ok' : row.tone === 'warn' ? 'text-warn' : 'text-muted')}>{relativeTime(t.seconds, now)}</span>
        </>
      ) : (
        <span className="text-xs text-danger">Out of the representable date range</span>
      )}
    </div>
  )
}

export function ClaimsTable({ payload, now }: { payload: Record<string, unknown>; now: number }) {
  const rows = describeClaims(payload, now)
  if (!rows.length) return <p className="px-4 py-3 text-sm text-muted">The payload is an empty object — there are no claims.</p>
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <colgroup>
        <col className="w-[34%] sm:w-[30%]" />
        <col />
      </colgroup>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="group border-t border-border align-top first:border-t-0">
            <th scope="row" className="px-4 py-2 text-left font-normal">
              <span className="mono block truncate text-[12.5px] text-fg" title={r.key}>
                {r.key}
              </span>
              {r.info ? (
                <span className="block text-2xs leading-4 text-subtle" title={r.info.description}>
                  {r.info.name}
                  {r.info.registered && <span className="ml-1 text-subtle/80">· RFC 7519</span>}
                </span>
              ) : (
                <span className="block text-2xs text-subtle">Custom claim</span>
              )}
            </th>
            <td className="py-2 pr-2">
              <div className="flex items-start gap-1">
                <div className="min-w-0 flex-1">
                  {r.time ? (
                    <TimeCell row={r} now={now} />
                  ) : (
                    <span className={cn('mono break-words text-[12.5px]', typeof payload[r.key] === 'string' ? 'text-fg' : 'text-accent-text', r.tone === 'danger' && 'text-danger')}>{r.display}</span>
                  )}
                  {r.info && <p className="mt-0.5 text-2xs leading-4 text-subtle">{r.info.description}</p>}
                  {r.note && <p className={cn('mt-0.5 text-xs', r.tone === 'danger' ? 'text-danger' : 'text-warn')}>{r.note}</p>}
                </div>
                <CopyButton value={r.display} label={`Copy ${r.key}`} size="icon-xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function HeaderParams({ header }: { header: Record<string, unknown> }) {
  const known = Object.keys(header).filter((k) => HEADER_PARAMS[k])
  if (!known.length) return null
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-4 pb-3 text-xs">
      {known.map((k) => (
        <div key={k} className="contents">
          <dt className="mono text-muted">{k}</dt>
          <dd className={cn('text-subtle', (k === 'jku' || k === 'jwk' || k === 'x5u') && 'text-warn')}>{HEADER_PARAMS[k]}</dd>
        </div>
      ))}
    </dl>
  )
}
