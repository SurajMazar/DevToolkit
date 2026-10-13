import { Check, Minus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { maskSecret, type Structured } from '@/engines/dev/http-headers'
import { cn } from '@/utils/cn'

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', on ? 'text-fg' : 'text-subtle')}>
      {on ? <Check className="size-3.5 text-ok" /> : <Minus className="size-3.5" />}
      {label}
    </span>
  )
}

function Row({ k, children }: { k: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <dt className="mono truncate text-[12px] text-muted">{k}</dt>
      <dd className="min-w-0 text-xs text-fg">{children}</dd>
    </>
  )
}

const Grid = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <dl className={cn('grid grid-cols-[minmax(80px,max-content)_1fr] gap-x-3 gap-y-1', className)}>{children}</dl>
)

/** Masks cookie values in a Cookie request header: a=1; b=2 → a=••••; b=•••• */
export function maskCookieHeader(v: string) {
  return v
    .split(';')
    .map((p) => {
      const i = p.indexOf('=')
      return i === -1 ? p : `${p.slice(0, i)}=${maskSecret(p.slice(i + 1).trim())}`
    })
    .join(';')
}

export function StructuredView({ s, reveal }: { s: Structured; reveal: boolean }) {
  switch (s.kind) {
    case 'cache-control':
      return (
        <Grid>
          {s.directives.map((d, i) => (
            <Row key={i} k={d.value !== undefined ? `${d.name}=${d.value}` : d.name}>
              <span className="text-muted">{d.description}</span>
            </Row>
          ))}
        </Grid>
      )
    case 'content-type':
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="accent" className="mono">{s.media.type || '(none)'}</Badge>
          {Object.entries(s.media.params).map(([k, v]) => (
            <Badge key={k} className="mono">
              {k}={v}
            </Badge>
          ))}
        </div>
      )
    case 'set-cookie': {
      const c = s.cookie
      return (
        <div className="flex flex-col gap-2">
          <Grid>
            <Row k="name">
              <span className="mono">{c.name || '(empty)'}</span>
            </Row>
            <Row k="value">
              <span className="mono break-all">{reveal ? c.value : maskSecret(c.value)}</span>
            </Row>
            {c.expires && <Row k="Expires">{c.expires}</Row>}
            {c.maxAge !== undefined && <Row k="Max-Age">{Number.isFinite(c.maxAge) ? `${c.maxAge} s${c.maxAge <= 0 ? ' (deletes the cookie)' : ''}` : 'invalid'}</Row>}
            {c.domain && <Row k="Domain">{c.domain}</Row>}
            {c.path && <Row k="Path">{c.path}</Row>}
            {Object.entries(c.other).map(([k, v]) => (
              <Row key={k} k={k}>
                {v === true ? 'set' : v}
              </Row>
            ))}
          </Grid>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <Flag on={c.secure} label="Secure" />
            <Flag on={c.httpOnly} label="HttpOnly" />
            <Flag on={!!c.sameSite} label={`SameSite${c.sameSite ? `=${c.sameSite}` : ''}`} />
            <Flag on={c.partitioned} label="Partitioned" />
          </div>
          {c.issues.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {c.issues.map((i, n) => (
                <li key={n} className={cn('text-xs', i.severity === 'fail' ? 'text-danger' : 'text-warn')}>
                  {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    }
    case 'hsts':
      return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-xs text-fg">
            max-age <span className="mono">{s.hsts.maxAge ?? 'missing'}</span>
            {s.hsts.maxAge != null && <span className="text-muted"> ({+(s.hsts.maxAge / 86400).toFixed(1)} days)</span>}
          </span>
          <Flag on={s.hsts.includeSubDomains} label="includeSubDomains" />
          <Flag on={s.hsts.preload} label="preload" />
        </div>
      )
    case 'csp':
      return (
        <div className="flex flex-col gap-2">
          <dl className="flex flex-col gap-1.5">
            {s.directives.map((d, i) => (
              <div key={i} className="grid grid-cols-1 gap-1 sm:grid-cols-[150px_1fr] sm:gap-3">
                <dt className="mono text-[12px] text-fg" title={d.description}>
                  {d.name}
                </dt>
                <dd className="flex min-w-0 flex-wrap gap-1">
                  {d.sources.length === 0 && <span className="text-xs text-subtle">(no sources)</span>}
                  {d.sources.map((src, j) => (
                    <Badge key={j} tone={src.risk === 'unsafe-inline' || src.risk === 'unsafe-eval' || src.risk === 'wildcard' ? 'warn' : src.risk ? 'mod' : 'neutral'} className="mono" title={src.risk ? `Risk: ${src.risk}` : undefined}>
                      {src.value}
                    </Badge>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
          <ul className="flex flex-col gap-0.5 border-t border-border pt-1.5">
            {s.assessment.findings.map((f, i) => (
              <li key={i} className={cn('text-xs', s.assessment.status === 'warn' || s.assessment.status === 'fail' ? 'text-warn' : 'text-muted')}>
                {f}
              </li>
            ))}
          </ul>
        </div>
      )
    case 'permissions-policy':
      return (
        <Grid>
          {s.entries.map((e, i) => (
            <Row key={i} k={e.feature}>
              <span className={cn(e.allowlist.length === 0 ? 'text-muted' : e.allowlist.includes('*') ? 'text-warn' : 'text-fg')}>{e.description}</span>
            </Row>
          ))}
        </Grid>
      )
    case 'quality':
      return (
        <ol className="flex flex-col gap-0.5">
          {s.items.map((q, i) => (
            <li key={i} className="flex items-center gap-2 text-xs">
              <span className="w-4 text-right text-subtle tabular">{i + 1}.</span>
              <span className="mono text-fg">{q.value}</span>
              <span className="mono text-subtle">q={q.q}</span>
              {Object.entries(q.params).map(([k, v]) => (
                <span key={k} className="mono text-subtle">
                  {k}={v}
                </span>
              ))}
            </li>
          ))}
        </ol>
      )
    case 'authorization':
      return (
        <Grid>
          <Row k="scheme">
            <span className="mono">{s.auth.scheme}</span>
          </Row>
          <Row k="credentials">
            <span className="mono break-all">{reveal ? s.auth.credentials : s.auth.masked}</span>
          </Row>
          {s.auth.details.map((d, i) => (
            <Row key={i} k={d.label}>
              <span className="mono break-all">{d.sensitive && !reveal ? maskSecret(d.value) : d.value}</span>
            </Row>
          ))}
        </Grid>
      )
    case 'link':
      return (
        <ul className="flex flex-col gap-1">
          {s.links.map((l, i) => (
            <li key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="mono break-all text-fg">{l.uri}</span>
              {Object.entries(l.params).map(([k, v]) => (
                <Badge key={k} className="mono">
                  {k}
                  {v ? `=${v}` : ''}
                </Badge>
              ))}
            </li>
          ))}
        </ul>
      )
    case 'list':
      return (
        <div className="flex flex-wrap gap-1">
          {s.items.map((x, i) => (
            <Badge key={i} className="mono">
              {x}
            </Badge>
          ))}
        </div>
      )
    case 'date':
      return (
        <span className="text-xs text-muted">
          <span className="mono text-fg">{s.iso}</span> · {s.relative}
        </span>
      )
  }
}
