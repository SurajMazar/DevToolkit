import { useEffect, useState } from 'react'
import { CircleCheck, CircleX, KeyRound, Loader2, ShieldAlert, ShieldQuestion } from 'lucide-react'
import { Segmented } from '@/components/ui/segmented'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { useDebouncedValue } from '@/hooks/useDebounced'
import { ALG_DESCRIPTIONS, JwtVerifyError, SAMPLE_SECRET, algFamily, verifyJwt, type KeyFormat } from '@/engines/encoding/jwt'
import { cn } from '@/utils/cn'

export type VerifyState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'valid'; keyDescription: string; warnings: string[] }
  | { state: 'invalid'; keyDescription: string; warnings: string[] }
  | { state: 'error'; message: string }

/** Verifies whenever token or key changes; reports "valid" only after a real crypto.subtle.verify success. */
export function useVerification(token: string | null, key: string, format: KeyFormat): VerifyState {
  const dKey = useDebouncedValue(key, 250)
  const [result, setResult] = useState<{ for: string; value: VerifyState }>({ for: '', value: { state: 'idle' } })
  const id = `${token}\u0000${dKey}\u0000${format}`
  useEffect(() => {
    if (!token || !dKey.trim()) return
    let cancelled = false
    setResult({ for: id, value: { state: 'checking' } })
    verifyJwt(token, dKey, { format })
      .then((r) => !cancelled && setResult({ for: id, value: { state: r.valid ? 'valid' : 'invalid', keyDescription: r.keyDescription, warnings: r.warnings } }))
      .catch((e) => !cancelled && setResult({ for: id, value: { state: 'error', message: e instanceof JwtVerifyError ? e.message : `Verification failed: ${(e as Error).message}` } }))
    return () => {
      cancelled = true
    }
  }, [id, token, dKey, format])
  if (!token || !key.trim()) return { state: 'idle' }
  if (key !== dKey || result.for !== id) return { state: 'checking' }
  return result.value
}

export function VerifyPanel({
  alg,
  keyText,
  setKeyText,
  format,
  setFormat,
  result,
  isSample,
}: {
  alg: string | null
  keyText: string
  setKeyText: (v: string) => void
  format: KeyFormat
  setFormat: (f: KeyFormat) => void
  result: VerifyState
  isSample: boolean
}) {
  const fam = alg ? algFamily(alg) : null
  const unsigned = alg?.toLowerCase() === 'none'

  if (unsigned)
    return (
      <div className="flex gap-2.5 px-4 py-3 text-sm">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" />
        <p className="text-muted">
          <span className="font-medium text-fg">Unsigned token (“alg”: “none”).</span> There is no signature to verify — anyone can create or edit it. Servers must
          never accept unsigned tokens.
        </p>
      </div>
    )
  if (!fam)
    return (
      <div className="flex gap-2.5 px-4 py-3 text-sm text-muted">
        <ShieldQuestion className="mt-0.5 size-4 shrink-0 text-subtle" />
        <p>{alg ? `Verification of “${alg}” isn’t supported in the browser. Supported: HS256/384/512, RS256/384/512, PS256/384/512, ES256/384/512 and EdDSA (Ed25519).` : 'The header has no “alg”, so the signature can’t be checked.'}</p>
      </div>
    )

  const hmac = fam === 'hmac'
  return (
    <div className="flex flex-col gap-2 px-4 pb-3 pt-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="jwt-key" className="text-xs font-medium text-muted">
          {hmac ? 'Shared secret' : 'Public key'}
        </label>
        <span className="text-2xs text-subtle">{ALG_DESCRIPTIONS[alg!]}</span>
        {hmac && (
          <Segmented
            size="xs"
            className="ml-auto"
            aria-label="Secret encoding"
            value={format}
            onValueChange={setFormat}
            options={[
              { value: 'text', label: 'Text' },
              { value: 'base64', label: 'Base64' },
            ]}
          />
        )}
      </div>
      <Textarea
        id="jwt-key"
        value={keyText}
        onChange={(e) => setKeyText(e.target.value)}
        rows={hmac ? 2 : 4}
        autoComplete="off"
        className="mono text-[12.5px]"
        placeholder={hmac ? (format === 'base64' ? 'Base64 or base64url-encoded secret' : 'The HMAC secret the issuer signs with') : '-----BEGIN PUBLIC KEY-----  ·  X.509 certificate  ·  JWK or JWK Set (selected by kid)'}
      />
      {isSample && hmac && keyText !== SAMPLE_SECRET && (
        <p className="flex flex-wrap items-center gap-x-2 text-2xs text-subtle">
          The sample is signed with the demo secret <code className="mono text-muted">{SAMPLE_SECRET}</code>
          <Button
            size="xs"
            variant="ghost"
            className="-ml-1 text-accent-text"
            onClick={() => {
              setFormat('text')
              setKeyText(SAMPLE_SECRET)
            }}
          >
            <KeyRound /> Use it
          </Button>
        </p>
      )}
      <VerifyOutcome result={result} />
    </div>
  )
}

function VerifyOutcome({ result }: { result: VerifyState }) {
  if (result.state === 'idle') return <p className="text-2xs text-subtle">The key stays in this tab: it is used by Web Crypto locally and never stored.</p>
  if (result.state === 'checking')
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Loader2 className="size-3.5 animate-spin" /> Verifying…
      </p>
    )
  if (result.state === 'error')
    return (
      <p className="flex gap-1.5 text-xs text-danger">
        <CircleX className="mt-px size-3.5 shrink-0" /> {result.message}
      </p>
    )
  const ok = result.state === 'valid'
  return (
    <div className={cn('flex flex-col gap-1 rounded-md border px-2.5 py-2', ok ? 'border-ok/30 bg-ok-soft' : 'border-danger/30 bg-danger-soft')}>
      <p className={cn('flex items-center gap-1.5 text-sm font-medium', ok ? 'text-ok' : 'text-danger')}>
        {ok ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}
        {ok ? 'Signature verified' : 'Signature invalid'}
        {result.keyDescription && <span className="text-2xs font-normal text-muted">· {result.keyDescription}</span>}
      </p>
      <p className="text-xs text-muted">
        {ok
          ? 'The token was signed with this key and has not been modified. Still check exp, aud and iss before trusting it.'
          : 'The signature does not match this key — the token was signed with a different key or has been tampered with.'}
      </p>
      {result.warnings.map((w) => (
        <p key={w} className="text-xs text-warn">
          {w}
        </p>
      ))}
    </div>
  )
}
