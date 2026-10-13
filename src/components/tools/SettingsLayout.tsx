import { cn } from '@/utils/cn'

/**
 * Layout for generator/calculator tools: a compact settings column and a results area.
 * On small screens the settings stack above the results.
 */
export function SettingsLayout({
  settings,
  children,
  className,
  settingsWidth = 'md:w-[300px] lg:w-[320px]',
  resultsFirstOnMobile = false,
}: {
  settings: React.ReactNode
  children: React.ReactNode
  className?: string
  settingsWidth?: string
  /** On phones, show the results above the settings. */
  resultsFirstOnMobile?: boolean
}) {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden', className)}>
      <aside
        aria-label="Settings"
        className={cn('shrink-0 border-b border-border bg-bg md:min-h-0 md:overflow-y-auto md:border-b-0 md:border-r', resultsFirstOnMobile && 'max-md:order-last max-md:border-b-0 max-md:border-t', settingsWidth)}
      >
        <div className="flex flex-col">{settings}</div>
      </aside>
      <div className="flex min-h-[320px] min-w-0 flex-1 flex-col bg-workspace md:min-h-0">{children}</div>
    </div>
  )
}

export function SettingsSection({ title, children, className, action }: { title?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section className={cn('flex flex-col gap-3 border-b border-border px-4 py-4 last:border-b-0', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between">
          {title && <h3 className="eyebrow">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/** Label on the left, control on the right — for dense settings rows. */
export function SettingRow({ label, hint, children, htmlFor }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={htmlFor} className="min-w-0 text-sm text-fg">
        {label}
        {hint && <span className="block text-2xs text-subtle">{hint}</span>}
      </label>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  )
}

/** Key/value table for inspector-style output (URL parts, JWT claims, color values…). */
export function KeyValueTable({
  rows,
  className,
  mono = true,
  keyWidth = 'w-[34%]',
}: {
  rows: { key: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode; action?: React.ReactNode; tone?: 'danger' | 'ok' | 'warn' | 'muted' }[]
  className?: string
  mono?: boolean
  /** Tailwind width class for the key column (default w-[34%]). */
  keyWidth?: string
}) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-border', className)}>
      <table className="w-full table-fixed border-collapse text-sm">
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={i} className="group align-top">
              <th scope="row" className={cn(keyWidth, 'max-w-56 bg-surface/60 px-3 py-2 text-left text-xs font-medium text-muted')}>
                {r.key}
                {r.hint && <span className="mt-0.5 block text-2xs font-normal text-subtle">{r.hint}</span>}
              </th>
              <td className="px-3 py-2">
                <div className="flex items-start gap-2">
                  <div
                    className={cn(
                      'min-w-0 flex-1 [overflow-wrap:anywhere]',
                      mono && 'mono text-[12.5px] leading-5',
                      r.tone === 'danger' && 'text-danger',
                      r.tone === 'ok' && 'text-ok',
                      r.tone === 'warn' && 'text-warn',
                      r.tone === 'muted' && 'text-subtle',
                    )}
                  >
                    {r.value}
                  </div>
                  {r.action && <div className="-my-1 shrink-0 opacity-70 group-hover:opacity-100">{r.action}</div>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
