import { useDeferredValue, useEffect, useMemo } from 'react'
import { Dices, RefreshCw } from 'lucide-react'
import { DEFAULT_LOREM, generateLorem, LOREM_LIMITS, loremCounts, validateLorem, type LoremFormat, type LoremOptions, type LoremUnit } from '@/engines/generators/lorem'
import { randomSeed } from '@/engines/generators/random'
import { usePersistentState } from '@/hooks/usePersistentState'
import { Toolbar, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SettingsLayout, SettingsSection, SettingRow } from '@/components/tools/SettingsLayout'
import { OutputEditorPane } from '@/components/tools/EditorPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Segmented } from '@/components/ui/segmented'
import { Checkbox } from '@/components/ui/checkbox'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Kbd } from '@/components/ui/kbd'
import { formatBytes, formatNumber, utf8Length } from '@/utils/format'
import { modKey } from '@/utils/platform'
import { NumberInput } from '../_shared/NumberInput'
import { useRegenerateShortcut } from '../_shared/useShortcut'
import { LocalBadge } from '../_shared/LocalBadge'

const FORMATS: { value: LoremFormat; label: string; ext: string; language: string; mime: string }[] = [
  { value: 'text', label: 'Text', ext: 'txt', language: 'plaintext', mime: 'text/plain;charset=utf-8' },
  { value: 'html', label: 'HTML', ext: 'html', language: 'html', mime: 'text/html;charset=utf-8' },
  { value: 'markdown', label: 'Markdown', ext: 'md', language: 'markdown', mime: 'text/markdown;charset=utf-8' },
  { value: 'json', label: 'JSON', ext: 'json', language: 'json', mime: 'application/json' },
]

const UNIT_DEFAULT_COUNT: Record<LoremUnit, number> = { words: 50, sentences: 5, paragraphs: 4 }

export default function LoremIpsum() {
  const [opts, setOpts, restored] = usePersistentState<LoremOptions>('options', DEFAULT_LOREM)
  const patch = (p: Partial<LoremOptions>) => setOpts({ ...opts, ...p })

  // Default seeds come from the CSPRNG; a seed reproduces the exact same text.
  useEffect(() => {
    if (restored && !opts.seed) setOpts((o) => ({ ...o, seed: randomSeed() }))
  }, [restored, opts.seed, setOpts])

  const deferred = useDeferredValue(opts)
  const error = validateLorem(deferred)
  const result = useMemo(() => (error || !deferred.seed ? null : generateLorem(deferred)), [deferred, error])
  const counts = useMemo(() => (result ? loremCounts(result, deferred.unit) : null), [result, deferred.unit])

  const regenerate = () => patch({ seed: randomSeed() })
  useRegenerateShortcut(regenerate)

  const fmt = FORMATS.find((f) => f.value === opts.format)!
  const limit = LOREM_LIMITS[opts.unit]
  const output = result?.output ?? ''

  const settings = (
    <>
      <SettingsSection title="Generate">
        <Segmented
          aria-label="Unit"
          value={opts.unit}
          onValueChange={(unit) => patch({ unit, count: Math.min(LOREM_LIMITS[unit], opts.unit === unit ? opts.count : UNIT_DEFAULT_COUNT[unit]) })}
          className="w-full [&>*]:flex-1 [&>*]:justify-center"
          options={[
            { value: 'words', label: 'Words' },
            { value: 'sentences', label: 'Sentences' },
            { value: 'paragraphs', label: 'Paragraphs' },
          ]}
        />
        <SettingRow label="Count" hint={`1 – ${formatNumber(limit)}`} htmlFor="lorem-count">
          <NumberInput id="lorem-count" value={opts.count} onChange={(count) => patch({ count })} min={1} max={limit} className="w-24" />
        </SettingRow>
        <Checkbox checked={opts.startWithLorem} onCheckedChange={(v) => patch({ startWithLorem: v === true })} label="Start with “Lorem ipsum dolor sit amet…”" />
      </SettingsSection>

      <SettingsSection title="Lengths">
        <div className="flex flex-col gap-2" aria-disabled={opts.unit === 'words'}>
          <div className="flex items-baseline justify-between text-sm">
            <span className={opts.unit === 'words' ? 'text-subtle' : ''}>Words per sentence</span>
            <span className="text-xs text-muted tabular">
              {opts.sentenceWords[0]}–{opts.sentenceWords[1]}
            </span>
          </div>
          <Slider aria-label="Words per sentence" min={3} max={40} step={1} minStepsBetweenThumbs={0} disabled={opts.unit === 'words'} value={opts.sentenceWords} onValueChange={(v) => patch({ sentenceWords: [v[0], v[1]] })} />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className={opts.unit !== 'paragraphs' ? 'text-subtle' : ''}>Sentences per paragraph</span>
            <span className="text-xs text-muted tabular">
              {opts.paragraphSentences[0]}–{opts.paragraphSentences[1]}
            </span>
          </div>
          <Slider aria-label="Sentences per paragraph" min={1} max={20} step={1} disabled={opts.unit !== 'paragraphs'} value={opts.paragraphSentences} onValueChange={(v) => patch({ paragraphSentences: [v[0], v[1]] })} />
        </div>
      </SettingsSection>

      <SettingsSection title="Output">
        <Segmented aria-label="Output format" value={opts.format} onValueChange={(format) => patch({ format })} className="w-full [&>*]:flex-1 [&>*]:justify-center" options={FORMATS.map(({ value, label }) => ({ value, label }))} />
        {(opts.format === 'html' || opts.format === 'markdown') && (
          <Checkbox
            checked={opts.headings}
            disabled={opts.unit !== 'paragraphs'}
            onCheckedChange={(v) => patch({ headings: v === true })}
            label="Heading before each paragraph"
            description={opts.unit === 'paragraphs' ? (opts.format === 'html' ? '<h2> elements' : '## headings') : 'Paragraphs only'}
          />
        )}
        <p className="text-xs text-muted">
          {opts.format === 'text' && 'Paragraphs separated by a blank line.'}
          {opts.format === 'html' && (opts.unit === 'paragraphs' ? 'Each paragraph wrapped in <p>.' : 'Wrapped in a single <p>.')}
          {opts.format === 'markdown' && 'Paragraphs separated by blank lines.'}
          {opts.format === 'json' && `Array of ${opts.unit}.`}
        </p>
      </SettingsSection>

      <SettingsSection title="Seed">
        <div className="flex items-center gap-1">
          <Input aria-label="Seed" className="mono h-7 text-[12.5px]" value={opts.seed} onChange={(e) => patch({ seed: e.target.value })} placeholder="any text" />
          <IconButton label="New random seed" icon={<Dices />} onClick={regenerate} />
        </div>
        <p className="text-xs text-muted">The same seed and settings always produce the same text — share it to reproduce a layout.</p>
      </SettingsSection>
    </>
  )

  return (
    <>
      <Toolbar>
        <Button size="sm" variant="primary" onClick={regenerate}>
          <RefreshCw /> Regenerate
          <span className="ml-1 hidden items-center gap-0.5 opacity-80 sm:flex">
            <Kbd className="border-white/25 bg-white/10 text-current">{modKey}</Kbd>
            <Kbd className="border-white/25 bg-white/10 text-current">↵</Kbd>
          </span>
        </Button>
        <ToolbarSpacer />
        <span className="shrink-0 text-xs text-subtle">Placeholder text — not real content</span>
      </Toolbar>
      <SettingsLayout settings={settings} settingsWidth="md:w-[290px] xl:w-[310px]" className="max-md:[&>aside]:order-last max-md:[&>aside]:border-t">
        <OutputEditorPane
          value={output}
          title="Lorem ipsum"
          meta={counts ? `${formatNumber(counts.words)} words` : undefined}
          language={fmt.language}
          filename={`lorem-ipsum.${fmt.ext}`}
          mime={fmt.mime}
          wordWrap
          path="lorem-output"
          banner={error ? <ErrorDisplay error={error} /> : undefined}
          footer={false}
        />
      </SettingsLayout>
      <StatusBar>
        {counts && (
          <>
            <StatusItem label="Words">{formatNumber(counts.words)}</StatusItem>
            {deferred.unit !== 'words' && <StatusItem label="Sentences">{formatNumber(counts.sentences)}</StatusItem>}
            {deferred.unit === 'paragraphs' && <StatusItem label="Paragraphs">{formatNumber(counts.paragraphs)}</StatusItem>}
            <StatusItem label="Characters">{formatNumber(counts.chars)}</StatusItem>
            <StatusItem label="Size">{formatBytes(utf8Length(output))}</StatusItem>
          </>
        )}
        <StatusSpacer />
        <StatusItem label="Seed">
          <span className="mono">{opts.seed || '—'}</span>
        </StatusItem>
        <LocalBadge />
      </StatusBar>
    </>
  )
}
