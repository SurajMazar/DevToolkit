import { Info } from 'lucide-react'
import { GUESS_RATE, strengthFor } from '@/engines/generators/password'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/utils/cn'

const TONE = ['text-danger', 'text-warn', 'text-ok', 'text-ok'] as const
const BAR = ['bg-danger', 'bg-warn', 'bg-ok', 'bg-ok'] as const

export function StrengthPanel({
  bits,
  breakdown,
}: {
  bits: number
  breakdown: { formula: string; parts: string; note: string; caveats: string[] } | null
}) {
  const s = strengthFor(bits)
  return (
    <section aria-label="Strength" className="shrink-0 border-b border-border px-3 py-3 md:px-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[22px] font-semibold leading-7 tracking-[-0.01em] text-fg tabular">{bits.toFixed(1)}</span>
          <span className="text-sm text-muted">bits of entropy</span>
        </div>
        <div className="flex min-w-40 flex-1 items-center gap-3">
          <div className="flex flex-1 gap-1" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={cn('h-1.5 flex-1 rounded-sm', i <= s.level ? BAR[s.level] : 'bg-surface-2')} />
            ))}
          </div>
          <span className={cn('shrink-0 text-sm font-medium', TONE[s.level])}>{s.label[0].toUpperCase() + s.label.slice(1)}</span>
        </div>
      </div>
      <p className="mt-2 text-sm text-muted">
        {s.explanation}{' '}
        <span className="text-fg">
          Average time to crack offline: {s.crackTime}
        </span>{' '}
        <span className="text-subtle">at 10¹⁰ guesses/s.</span>
      </p>
      {breakdown && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-subtle">
          <span>
            {breakdown.formula} <span className="mono">({breakdown.parts})</span>
          </span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="link" size="xs" className="h-auto text-xs">
                <Info className="size-3" /> How this is estimated
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[380px] text-[13px] leading-[19px] text-muted">
              <p className="mb-2 text-sm font-medium text-fg">How strength is estimated</p>
              <ul className="flex list-disc flex-col gap-1.5 pl-4">
                <li>
                  Entropy is computed from the <span className="text-fg">generation policy</span>, not by pattern-matching the result: {breakdown.formula.toLowerCase()}. {breakdown.note}
                </li>
                <li>
                  Crack time assumes an offline attacker making {GUESS_RATE.toExponential(0).replace('e+', '×10^')} guesses per second against a fast, unsalted hash, and finding it after searching half the space on average. Slow hashes (bcrypt, scrypt, Argon2) push this out by many orders of magnitude; online attacks with rate limits are far slower.
                </li>
                {breakdown.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
                <li>The estimate only holds if the password stays secret: reuse across sites or a phishing page defeats any length.</li>
              </ul>
            </PopoverContent>
          </Popover>
        </div>
      )}
    </section>
  )
}
