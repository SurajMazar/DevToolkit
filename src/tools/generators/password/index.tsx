import { useMemo, useState } from 'react'
import { Eye, EyeOff, RefreshCw, RotateCcw } from 'lucide-react'
import {
  AMBIGUOUS,
  DEFAULT_PASSPHRASE,
  DEFAULT_POLICY,
  DEFAULT_SYMBOLS,
  generatePassphrase,
  generatePasswords,
  MAX_COUNT,
  MAX_LENGTH,
  MAX_WORDS,
  MIN_LENGTH,
  MIN_WORDS,
  passphraseEntropy,
  passwordEntropy,
  resolvePolicy,
  validatePassphrase,
  type PassphrasePolicy,
  type PasswordPolicy,
} from '@/engines/generators/password'
import { WORDLIST } from '@/engines/generators/wordlist'
import { usePersistentState } from '@/hooks/usePersistentState'
import { Toolbar, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SettingsLayout, SettingsSection, SettingRow } from '@/components/tools/SettingsLayout'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Segmented } from '@/components/ui/segmented'
import { Checkbox } from '@/components/ui/checkbox'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Kbd } from '@/components/ui/kbd'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/common/CopyButton'
import { formatNumber } from '@/utils/format'
import { modKey } from '@/utils/platform'
import { cn } from '@/utils/cn'
import { NumberInput } from '../_shared/NumberInput'
import { useRegenerateShortcut } from '../_shared/useShortcut'
import { StrengthPanel } from './StrengthPanel'

type Mode = 'password' | 'passphrase'

const SEPARATORS = [
  { value: '-', label: '-' },
  { value: '.', label: '.' },
  { value: '_', label: '_' },
  { value: ' ', label: 'space' },
  { value: '', label: 'none' },
]

/** Colour digits and symbols so passwords are easier to read back. */
function Colorized({ value }: { value: string }) {
  const parts: React.ReactNode[] = []
  let i = 0
  for (const ch of value) {
    const cls = /[0-9]/.test(ch) ? 'text-accent-text' : /[A-Za-z]/.test(ch) ? '' : 'text-mod'
    parts.push(
      <span key={i++} className={cls || undefined}>
        {ch}
      </span>,
    )
  }
  return <>{parts}</>
}

export default function PasswordGenerator() {
  const [mode, setMode] = usePersistentState<Mode>('mode', 'password')
  const [policy, setPolicy] = usePersistentState<PasswordPolicy>('policy', DEFAULT_POLICY)
  const [phrase, setPhrase] = usePersistentState<PassphrasePolicy>('passphrase', DEFAULT_PASSPHRASE)
  const [count, setCount] = usePersistentState('count', 5)
  const [revealed, setRevealed] = useState(true)
  const [nonce, setNonce] = useState(0)

  const patch = (p: Partial<PasswordPolicy>) => setPolicy({ ...policy, ...p })
  const patchPhrase = (p: Partial<PassphrasePolicy>) => setPhrase({ ...phrase, ...p })

  const resolved = useMemo(() => resolvePolicy(policy), [policy])
  const phraseError = useMemo(() => validatePassphrase(phrase), [phrase])

  const result = useMemo(() => {
    void nonce
    if (mode === 'password') {
      if (!resolved.ok) return { error: resolved.error, values: [] as string[], bits: 0 }
      return { error: null, values: generatePasswords(resolved.value, count), bits: passwordEntropy(resolved.value) }
    }
    if (phraseError) return { error: phraseError, values: [] as string[], bits: 0 }
    return { error: null, values: Array.from({ length: count }, () => generatePassphrase(phrase)), bits: passphraseEntropy(phrase).bits }
  }, [mode, resolved, phrase, phraseError, count, nonce])

  const regenerate = () => setNonce((n) => n + 1)
  useRegenerateShortcut(regenerate)

  const breakdown = useMemo(() => {
    if (mode === 'password') {
      if (!resolved.ok) return null
      const r = resolved.value
      return {
        formula: `${r.length} characters from a pool of ${r.poolSize}`,
        parts: r.groups.map((g) => `${g.label} ${Array.from(g.chars).length}`).join(' + '),
        note: r.requireEach
          ? 'Requiring every set slightly shrinks the space; the figure counts only passwords that satisfy the rule (inclusion–exclusion).'
          : 'Every character is drawn independently and uniformly from the pool.',
        caveats: ['Assumes the attacker knows your settings — the estimate holds even then.'],
      }
    }
    const e = passphraseEntropy(phrase)
    return {
      formula: `${phrase.words} words from a ${formatNumber(WORDLIST.length)}-word list`,
      parts: e.parts.map((p) => `${p.label} = ${p.bits.toFixed(1)}`).join(' + '),
      note: 'Capitalisation is applied to every word, so it adds no entropy. The position of the added digit/symbol is not counted.',
      caveats: e.caveats,
    }
  }, [mode, resolved, phrase])

  const passwordSettings = (
    <>
      <SettingsSection title="Length">
        <div className="flex items-center gap-3">
          <Slider aria-label="Length" min={MIN_LENGTH} max={MAX_LENGTH} step={1} value={[policy.length]} onValueChange={([length]) => patch({ length })} />
          <NumberInput aria-label="Length" value={policy.length} onChange={(length) => patch({ length })} min={MIN_LENGTH} max={MAX_LENGTH} className="w-16" />
        </div>
      </SettingsSection>
      <SettingsSection title="Characters">
        <Checkbox checked={policy.upper} onCheckedChange={(v) => patch({ upper: v === true })} label={<>Uppercase <span className="mono ml-1 text-xs text-subtle">A–Z</span></>} />
        <Checkbox checked={policy.lower} onCheckedChange={(v) => patch({ lower: v === true })} label={<>Lowercase <span className="mono ml-1 text-xs text-subtle">a–z</span></>} />
        <Checkbox checked={policy.digits} onCheckedChange={(v) => patch({ digits: v === true })} label={<>Digits <span className="mono ml-1 text-xs text-subtle">0–9</span></>} />
        <Checkbox checked={policy.symbols} onCheckedChange={(v) => patch({ symbols: v === true })} label="Symbols" />
        <div className="ml-6 flex items-center gap-1">
          <Input
            aria-label="Symbol set"
            className="mono h-7 text-[12.5px]"
            value={policy.symbolSet}
            disabled={!policy.symbols}
            onChange={(e) => patch({ symbolSet: e.target.value })}
            placeholder="Symbols to use"
          />
          <IconButton label="Reset symbol set" icon={<RotateCcw />} size="icon-xs" disabled={!policy.symbols || policy.symbolSet === DEFAULT_SYMBOLS} onClick={() => patch({ symbolSet: DEFAULT_SYMBOLS })} />
        </div>
      </SettingsSection>
      <SettingsSection title="Exclude">
        <Checkbox
          checked={policy.excludeAmbiguous}
          onCheckedChange={(v) => patch({ excludeAmbiguous: v === true })}
          label="Look-alike characters"
          description={
            <span className="mono tracking-[0.2em]">
              {AMBIGUOUS.split('').join(' ')}
            </span>
          }
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pw-exclude" className="text-xs text-muted">
            Never use these characters
          </label>
          <Input id="pw-exclude" className="mono h-7 text-[12.5px]" value={policy.exclude} onChange={(e) => patch({ exclude: e.target.value })} placeholder="e.g. {}[]'&quot;\" />
        </div>
      </SettingsSection>
      <SettingsSection title="Rules">
        <Checkbox
          checked={policy.requireEach}
          onCheckedChange={(v) => patch({ requireEach: v === true })}
          label="At least one from each set"
          description="Many sites demand this. Candidates missing a set are redrawn, so output stays uniform."
        />
      </SettingsSection>
    </>
  )

  const phraseSettings = (
    <>
      <SettingsSection title="Words">
        <div className="flex items-center gap-3">
          <Slider aria-label="Word count" min={MIN_WORDS} max={MAX_WORDS} step={1} value={[phrase.words]} onValueChange={([words]) => patchPhrase({ words })} />
          <NumberInput aria-label="Word count" value={phrase.words} onChange={(words) => patchPhrase({ words })} min={MIN_WORDS} max={MAX_WORDS} className="w-16" />
        </div>
        <p className="text-xs text-muted">From an embedded list of {formatNumber(WORDLIST.length)} common English words (≈{Math.log2(WORDLIST.length).toFixed(1)} bits each).</p>
      </SettingsSection>
      <SettingsSection title="Separator">
        <div className="flex items-center gap-2">
          <Segmented aria-label="Separator" value={SEPARATORS.some((s) => s.value === phrase.separator) ? phrase.separator : '__custom'} onValueChange={(separator) => separator !== '__custom' && patchPhrase({ separator })} options={SEPARATORS} />
          <Input aria-label="Custom separator" className="mono h-7 w-14 text-center text-[12.5px]" maxLength={3} value={phrase.separator} onChange={(e) => patchPhrase({ separator: e.target.value })} />
        </div>
      </SettingsSection>
      <SettingsSection title="Options">
        <Checkbox checked={phrase.capitalize} onCheckedChange={(v) => patchPhrase({ capitalize: v === true })} label="Capitalize words" />
        <Checkbox checked={phrase.addNumber} onCheckedChange={(v) => patchPhrase({ addNumber: v === true })} label="Add a number" description="One random digit after a random word" />
        <Checkbox checked={phrase.addSymbol} onCheckedChange={(v) => patchPhrase({ addSymbol: v === true })} label="Add a symbol" description="One of ! @ # $ % & * ? - + =" />
      </SettingsSection>
    </>
  )

  const settings = (
    <>
      {mode === 'password' ? passwordSettings : phraseSettings}
      <SettingsSection title="Quantity">
        <SettingRow label="How many" hint={`1 – ${MAX_COUNT}`} htmlFor="pw-count">
          <NumberInput id="pw-count" value={count} onChange={setCount} min={1} max={MAX_COUNT} className="w-20" />
        </SettingRow>
      </SettingsSection>
    </>
  )

  const values = result.values

  return (
    <>
      <Toolbar>
        <Segmented
          aria-label="Mode"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'password', label: 'Password' },
            { value: 'passphrase', label: 'Passphrase' },
          ]}
        />
        <ToolbarSeparator />
        <Button size="sm" variant="primary" onClick={regenerate} disabled={!!result.error}>
          <RefreshCw /> Regenerate
          <span className="ml-1 hidden items-center gap-0.5 opacity-80 sm:flex">
            <Kbd className="border-white/25 bg-white/10 text-current">{modKey}</Kbd>
            <Kbd className="border-white/25 bg-white/10 text-current">↵</Kbd>
          </span>
        </Button>
        <CopyButton value={() => values.join('\n')} label={values.length > 1 ? 'Copy all' : 'Copy'} showLabel disabled={!values.length} />
        <IconButton label={revealed ? 'Hide passwords' : 'Show passwords'} aria-pressed={!revealed} icon={revealed ? <EyeOff /> : <Eye />} onClick={() => setRevealed(!revealed)} />
        <ToolbarSpacer />
        <Badge tone="neutral" title="Passwords are generated in this tab with crypto.getRandomValues and are never stored or sent anywhere.">
          Never stored
        </Badge>
      </Toolbar>

      <SettingsLayout settings={settings} settingsWidth="md:w-[290px] xl:w-[310px]" className="max-md:[&>aside]:order-last max-md:[&>aside]:border-t max-md:[&>div]:min-h-fit">
        {result.error ? (
          <ErrorDisplay error={result.error} title="Can't generate" />
        ) : (
          <StrengthPanel bits={result.bits} breakdown={breakdown} />
        )}
        <div className="min-h-0 flex-1 overflow-y-auto py-1.5" role="list" aria-label={mode === 'password' ? 'Passwords' : 'Passphrases'}>
          {values.map((v, i) => (
            <div key={`${nonce}-${i}`} role="listitem" className="group flex items-start gap-3 px-3 py-0.5 md:px-4">
              <span className="w-5 shrink-0 pt-[7px] text-right text-2xs text-subtle tabular select-none">{i + 1}</span>
              <div className={cn('mono min-w-0 flex-1 break-all rounded-md px-2 py-1 text-[14px] leading-[22px] text-fg', 'hover:bg-surface-2/60')}>
                {revealed ? <Colorized value={v} /> : <span className="text-muted">{'•'.repeat(Math.min(Array.from(v).length, 64))}</span>}
              </div>
              <CopyButton value={v} label={`Copy ${mode} ${i + 1}`} className="mt-0.5 opacity-60 group-hover:opacity-100 focus-visible:opacity-100" />
            </div>
          ))}
        </div>
      </SettingsLayout>

      <StatusBar>
        <StatusItem label="Mode">{mode === 'password' ? 'Password' : 'Passphrase'}</StatusItem>
        {mode === 'password' && resolved.ok && <StatusItem label="Pool">{resolved.value.poolSize} chars</StatusItem>}
        {mode === 'password' ? <StatusItem label="Length">{policy.length}</StatusItem> : <StatusItem label="Words">{phrase.words}</StatusItem>}
        {!result.error && <StatusItem label="Entropy">{result.bits.toFixed(1)} bits each</StatusItem>}
        <StatusItem label="Count">{values.length}</StatusItem>
        <StatusSpacer />
        <span className="hidden text-subtle md:inline">crypto.getRandomValues · rejection sampling · not saved</span>
      </StatusBar>
    </>
  )
}
