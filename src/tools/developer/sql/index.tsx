import { useMemo } from 'react'
import { Settings2 } from 'lucide-react'
import { ConverterTool, type ConverterResult } from '@/components/tools/ConverterTool'
import { ToolbarField, ToolbarSeparator } from '@/components/tools/Toolbar'
import { StatusItem } from '@/components/tools/StatusBar'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip } from '@/components/ui/tooltip'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useWorker } from '@/hooks/useWorker'
import { DEFAULT_SQL_FORMAT, formatSql, lexOptionsFor, minifySql, SQL_DIALECTS, SqlLexError, type SqlFormatOptions } from '@/engines/dev/sql'
import { offsetToLineColumn } from '@/engines/json/parse'
import { pluralize } from '@/utils/format'
import { cn } from '@/utils/cn'
import SqlWorker from './worker.ts?worker'
import type { Tasks } from './worker'

/** Inputs above this size are processed in a worker so typing stays smooth. */
const WORKER_THRESHOLD = 100_000

const SAMPLE = `-- Monthly revenue per active customer, with running totals
with active_customers as (
  select c.id, c.name, c.country from customers c
  where c.status = 'active' and c.created_at >= date '2024-01-01' -- not a comment inside: 'a -- b'
), monthly as (
  select o.customer_id, date_trunc('month', o.placed_at) as month, sum(oi.quantity*oi.unit_price) as revenue, count(distinct o.id) as orders
  from orders o join order_items oi on oi.order_id=o.id
  where o.status in ('paid','shipped') group by 1,2
)
select ac.name as "Customer Name", ac.country, m.month, m.revenue, m.orders,
  sum(m.revenue) over (partition by ac.id order by m.month rows between unbounded preceding and current row) as running_revenue,
  rank() over (partition by m.month order by m.revenue desc) as month_rank
from active_customers ac inner join monthly m on m.customer_id = ac.id
where m.revenue > 0 /* ignore refunds-only months */
order by m.month desc, month_rank limit 100;

update customers set last_seen_at = now(), notes = 'it''s fine' where id = $1;`

const CASES = [
  { value: 'preserve', label: 'Preserve' },
  { value: 'upper', label: 'UPPER' },
  { value: 'lower', label: 'lower' },
] as const

interface MinifyOpts {
  keepHints: boolean
  statementPerLine: boolean
}

export default function SqlFormatter() {
  const [opts, setOpts] = usePersistentState<SqlFormatOptions>('options', DEFAULT_SQL_FORMAT)
  const [minOpts, setMinOpts] = usePersistentState<MinifyOpts>('minify', { keepHints: true, statementPerLine: false })
  const [mode, setMode] = usePersistentState<string>('ui-mode', 'format')
  const worker = useWorker<Tasks>(() => new SqlWorker({ name: 'sql-formatter' }))
  const set = <K extends keyof SqlFormatOptions>(k: K, v: SqlFormatOptions[K]) => setOpts({ ...opts, [k]: v })
  const key = useMemo(() => ({ opts, minOpts }), [opts, minOpts])
  const advancedChanged =
    opts.identifierCase !== 'preserve' || opts.functionCase !== 'preserve' || opts.dataTypeCase !== 'preserve' || opts.denseOperators || opts.expressionWidth !== 50 || opts.linesBetweenQueries !== 1 || opts.logicalOperatorNewline !== 'before' || opts.newlineBeforeSemicolon

  const transform = async (input: string, m: string, signal: AbortSignal): Promise<ConverterResult> => {
    const big = input.length > WORKER_THRESHOLD
    const neverRuns = (
      <Tooltip content="This tool only reformats text. Nothing is sent to or executed on a database.">
        <span>
          <StatusItem label="Execution">never</StatusItem>
        </span>
      </Tooltip>
    )
    if (m === 'minify') {
      const r = big
        ? await worker.run('minify', { sql: input, language: opts.language, ...minOpts }, signal)
        : (() => {
            try {
              return { ok: true as const, ...minifySql(input, { ...lexOptionsFor(opts.language), ...minOpts }) }
            } catch (e) {
              if (e instanceof SqlLexError) return { ok: false as const, message: e.message, offset: e.offset }
              throw e
            }
          })()
      if (!r.ok) {
        const { line, column } = offsetToLineColumn(input, r.offset)
        return { output: '', error: { message: r.message, line, column }, markers: [{ line, column, message: r.message }] }
      }
      return {
        output: r.output,
        meta: `${pluralize(r.removedComments, 'comment')} removed${r.keptHints ? ` · ${pluralize(r.keptHints, 'hint')} kept` : ''}`,
        status: (
          <>
            <StatusItem label="Comments removed">{r.removedComments}</StatusItem>
            {neverRuns}
          </>
        ),
      }
    }
    const r = big ? await worker.run('format', { sql: input, options: opts }, signal) : formatSql(input, opts)
    if (!r.ok) {
      const { message, line, column } = r.error
      return { output: '', error: { message, line, column }, markers: line ? [{ line, column: column ?? 1, message }] : undefined }
    }
    const statements = r.output.split(/;\s*(?:\n|$)/).filter((s) => s.trim()).length
    return { output: r.output, meta: SQL_DIALECTS.find((d) => d.value === opts.language)?.label, status: (
      <>
        <StatusItem label="Statements">{statements}</StatusItem>
        {neverRuns}
      </>
    ) }
  }

  const options = (
    <>
      <ToolbarField label="Dialect">
        <Select aria-label="SQL dialect" value={opts.language} onValueChange={(v) => set('language', v)} options={SQL_DIALECTS} />
      </ToolbarField>
      {mode === 'format' ? (
        <>
          <ToolbarField label="Keywords">
            <Select aria-label="Keyword case" value={opts.keywordCase} onValueChange={(v) => set('keywordCase', v)} options={CASES.map((c) => ({ ...c }))} />
          </ToolbarField>
          <ToolbarField label="Indent">
            <Select
              aria-label="Indentation"
              value={opts.indent}
              onValueChange={(v) => set('indent', v)}
              options={[
                { value: '2', label: '2 spaces' },
                { value: '4', label: '4 spaces' },
                { value: 'tab', label: 'Tabs' },
              ]}
            />
          </ToolbarField>
          <ToolbarSeparator />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className={cn(advancedChanged && 'text-accent-text')}>
                <Settings2 /> Options
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px]" align="end">
              <div className="flex flex-col gap-3.5">
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Identifiers">
                    <Select aria-label="Identifier case" value={opts.identifierCase} onValueChange={(v) => set('identifierCase', v)} options={CASES.map((c) => ({ ...c }))} />
                  </Field>
                  <Field label="Functions">
                    <Select aria-label="Function case" value={opts.functionCase} onValueChange={(v) => set('functionCase', v)} options={CASES.map((c) => ({ ...c }))} />
                  </Field>
                  <Field label="Data types">
                    <Select aria-label="Data type case" value={opts.dataTypeCase} onValueChange={(v) => set('dataTypeCase', v)} options={CASES.map((c) => ({ ...c }))} />
                  </Field>
                </div>
                <p className="-mt-2 text-2xs text-subtle">Identifier casing never touches quoted identifiers.</p>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Lines between queries">
                    <Input type="number" min={0} max={5} value={opts.linesBetweenQueries} onChange={(e) => set('linesBetweenQueries', Number(e.target.value) || 0)} className="mono tabular" />
                  </Field>
                  <Field label="Expression width" hint="Max chars before parentheses break">
                    <Input type="number" min={10} max={500} value={opts.expressionWidth} onChange={(e) => set('expressionWidth', Number(e.target.value) || 50)} className="mono tabular" />
                  </Field>
                </div>
                <Field label="AND / OR placement">
                  <Segmented
                    aria-label="Logical operator newline"
                    value={opts.logicalOperatorNewline}
                    onValueChange={(v) => set('logicalOperatorNewline', v)}
                    options={[
                      { value: 'before', label: 'Start of line' },
                      { value: 'after', label: 'End of line' },
                    ]}
                  />
                </Field>
                <Checkbox checked={opts.denseOperators} onCheckedChange={(v) => set('denseOperators', v === true)} label="Dense operators" description="a+b instead of a + b" />
                <Checkbox checked={opts.newlineBeforeSemicolon} onCheckedChange={(v) => set('newlineBeforeSemicolon', v === true)} label="Semicolon on its own line" />
                <Button size="sm" variant="ghost" className="self-start" onClick={() => setOpts({ ...DEFAULT_SQL_FORMAT, language: opts.language })}>
                  Reset to defaults
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </>
      ) : (
        <>
          <Checkbox checked={minOpts.keepHints} onCheckedChange={(v) => setMinOpts({ ...minOpts, keepHints: v === true })} label="Keep /*+ hints */ and /*! … */" />
          <Checkbox checked={minOpts.statementPerLine} onCheckedChange={(v) => setMinOpts({ ...minOpts, statementPerLine: v === true })} label="One statement per line" />
        </>
      )}
    </>
  )

  return (
    <ConverterTool
      modes={[
        { value: 'format', label: 'Format', inputLabel: 'SQL', outputLabel: 'Formatted', inputLanguage: 'sql', outputLanguage: 'sql', sample: SAMPLE, outputExt: 'sql', inverse: 'minify', accept: '.sql,.txt,.ddl,.pgsql', placeholder: 'Paste SQL — it is only reformatted, never executed…' },
        { value: 'minify', label: 'Minify', inputLabel: 'SQL', outputLabel: 'Minified', inputLanguage: 'sql', outputLanguage: 'sql', sample: SAMPLE, outputExt: 'sql', inverse: 'format', accept: '.sql,.txt,.ddl,.pgsql', placeholder: 'Paste SQL to minify — strings, quoted identifiers and $$ bodies are kept byte-for-byte…' },
      ]}
      defaultMode="format"
      onModeChange={setMode}
      transform={transform}
      options={options}
      optionsKey={key}
      emptyTitle="Paste a query to format it."
      emptyDescription="Pick the dialect you use — PostgreSQL, MySQL, BigQuery, T-SQL and more. Nothing is executed."
    />
  )
}
