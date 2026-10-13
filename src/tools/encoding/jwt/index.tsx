import { useEffect, useMemo, useState } from 'react'
import { ClipboardPaste, Clock, Eraser, KeyRound, Lock, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Toolbar, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { Pane, PaneBody, PaneHeader } from '@/components/tools/Pane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { EmptyState } from '@/components/tools/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { ALG_DESCRIPTIONS, SAMPLE_SECRET, parseJwt, samplePayload, signHmacJwt, tokenStatus, type KeyFormat, type SegmentRange } from '@/engines/encoding/jwt'
import { readClipboardText } from '@/utils/clipboard'
import { formatBytes } from '@/utils/format'
import { cn } from '@/utils/cn'
import { SEGMENT_CLASS, TokenInput } from './TokenInput'
import { JsonBlock } from './JsonBlock'
import { ClaimsTable, HeaderParams } from './ClaimsTable'
import { VerifyPanel, useVerification } from './VerifyPanel'

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const nowSeconds = () => Math.floor(Date.now() / 1000)

function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(nowSeconds)
  useEffect(() => {
    const t = setInterval(() => setNow(nowSeconds()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

const STATUS_TONE = {
  valid: 'text-ok',
  expired: 'text-danger',
  'not-yet-valid': 'text-warn',
  'no-expiry': 'text-muted',
  'invalid-claims': 'text-danger',
} as const

export default function JwtDecoder() {
  // Deliberately plain state: tokens and keys are never persisted (tool is flagged sensitive).
  const [input, setInput] = useState('')
  const [keyText, setKeyText] = useState('')
  const [keyFormat, setKeyFormat] = useState<KeyFormat>('text')
  const [sample, setSample] = useState<string | null>(null)
  const now = useNow()
  useIncomingInput(setInput)

  // The sample is signed on load (exp = now + 2h) so its status and verification are real.
  useEffect(() => {
    if (!globalThis.crypto?.subtle) return
    const t = nowSeconds()
    signHmacJwt({ alg: 'HS256', typ: 'JWT' }, samplePayload(t), SAMPLE_SECRET).then(setSample, () => setSample(null))
  }, [])

  const parsed = useMemo(() => (input.trim() ? parseJwt(input) : null), [input])
  const jws = parsed?.ok && parsed.value.kind === 'jws' ? parsed.value : null
  const jwe = parsed?.ok && parsed.value.kind === 'jwe' ? parsed.value : null
  const ranges: SegmentRange[] = parsed ? (parsed.ok ? parsed.value.ranges : parsed.ranges) : []
  const segments = useMemo(() => ranges.map((r) => r.segment), [ranges])
  const errorOffset = parsed && !parsed.ok ? (parsed.error.offset ?? null) : null
  const verification = useVerification(jws ? jws.token : null, keyText, keyFormat)
  const status = jws?.payload ? tokenStatus(jws.payload, now) : null
  const isSample = !!sample && jws?.token === sample

  const paste = async () => {
    const t = await readClipboardText()
    if (t == null) toast.message('Clipboard read was blocked — click into the token box and paste')
    else setInput(t)
  }

  const loadSample = () => {
    if (!sample) {
      toast.error('Web Crypto is unavailable, so the sample token cannot be signed (needs HTTPS or localhost)')
      return
    }
    setInput(sample)
    setKeyText('')
  }

  const toolbar = (
    <Toolbar>
      {jws ? (
        <>
          <Badge tone={jws.alg?.toLowerCase() === 'none' ? 'danger' : 'neutral'} title={jws.alg ? ALG_DESCRIPTIONS[jws.alg] : undefined}>
            {jws.alg ?? 'no alg'}
          </Badge>
          {verification.state === 'valid' ? (
            <Badge tone="ok">
              <ShieldCheck className="size-3" /> Signature verified
            </Badge>
          ) : verification.state === 'invalid' ? (
            <Badge tone="danger">Signature invalid</Badge>
          ) : jws.alg?.toLowerCase() !== 'none' ? (
            <span className="shrink-0 text-xs text-subtle">Signature not verified</span>
          ) : null}
        </>
      ) : jwe ? (
        <Badge tone="accent">JWE · encrypted</Badge>
      ) : (
        <span className="shrink-0 text-xs text-subtle">Decodes locally — the token never leaves this tab and is never saved.</span>
      )}
      <ToolbarSpacer />
      <Button size="sm" variant="ghost" onClick={loadSample}>
        <Sparkles /> Sample
      </Button>
    </Toolbar>
  )

  const tokenPane = (
    <Pane aria-label="Token">
      <PaneHeader
        title="Encoded token"
        meta={jws?.scheme ? `“${jws.scheme}” prefix removed` : undefined}
        actions={
          <>
            <IconButton label="Paste from clipboard" icon={<ClipboardPaste />} onClick={paste} />
            <IconButton label="Clear" icon={<Eraser />} onClick={() => setInput('')} disabled={!input} />
          </>
        }
      />
      <PaneBody className="flex flex-col">
        <TokenInput value={input} onChange={setInput} segments={segments} errorOffset={errorOffset} placeholder={'Paste a JWT — eyJhbGciOi…\n\n“Bearer …” prefixes, quotes and line breaks are fine.'} />
        {ranges.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 text-2xs">
            {ranges.map((r, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className={cn('font-medium', SEGMENT_CLASS[r.segment])}>{SEGMENT_LABEL[r.segment]}</span>
                <span className="text-subtle tabular">{r.end - r.start} chars</span>
              </span>
            ))}
          </div>
        )}
      </PaneBody>
      {jws && (
        <section aria-label="Verify signature" className="shrink-0 border-t border-border bg-bg/40">
          <h3 className="eyebrow flex h-8 items-center gap-1.5 px-4">
            <KeyRound className="size-3" /> Verify signature
            <span className="font-normal normal-case tracking-normal text-subtle">— optional</span>
          </h3>
          <VerifyPanel alg={jws.alg} keyText={keyText} setKeyText={setKeyText} format={keyFormat} setFormat={setKeyFormat} result={verification} isSample={isSample} />
        </section>
      )}
    </Pane>
  )

  const verified = verification.state === 'valid'
  const decodedPane = (
    <Pane aria-label="Decoded">
      <PaneHeader title="Decoded" meta={jws?.payloadIsJson ? `${Object.keys(jws.payload ?? {}).length} claims` : undefined} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!parsed && (
          <EmptyState
            icon={<KeyRound />}
            title="Paste a JSON Web Token to inspect it"
            description="See the header, the claims with their dates and expiry, and optionally verify the signature with a secret or public key. Nothing is uploaded or stored."
            actions={
              <Button size="sm" onClick={loadSample}>
                <Sparkles /> Load a signed sample
              </Button>
            }
          />
        )}
        {parsed && !parsed.ok && <ErrorDisplay error={parsed.error.message} title={parsed.error.segment === 'token' ? 'Malformed token' : undefined} />}
        {(jws || jwe) && (
          <div
            role="note"
            className={cn('flex items-start gap-2.5 border-b px-4 py-2.5 text-sm', verified ? 'border-ok/25 bg-ok-soft' : 'border-warn/25 bg-warn-soft')}
          >
            {verified ? <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" /> : <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" />}
            <p className="text-fg">
              {jwe ? (
                <>
                  <span className="font-medium">Encrypted token (JWE).</span> Only the header is readable; the claims are encrypted and can’t be decoded without the recipient’s private key — which should never be pasted into a web page.
                </>
              ) : verified ? (
                <>
                  <span className="font-medium">Signature verified</span> with the key you provided. The token is authentic for that key — its claims (exp, aud, iss) still need to be checked by your server.
                </>
              ) : jws?.alg?.toLowerCase() === 'none' ? (
                <>
                  <span className="font-medium">This token is unsigned.</span> Anyone can create or change it; its contents prove nothing.
                </>
              ) : (
                <>
                  <span className="font-medium">Decoding does not verify the signature.</span> Anyone can create a token with these claims — its authenticity is unknown until it is verified with the issuer’s key.
                </>
              )}
            </p>
          </div>
        )}
        {jws?.warnings.map((w) => <ErrorDisplay key={w} severity="warning" error={w} />)}
        {jws && (
          <>
            {status && (
              <div className="flex flex-wrap items-baseline gap-x-2 border-b border-border px-4 py-2.5">
                <Clock className={cn('size-3.5 self-center', STATUS_TONE[status.state])} />
                <span className={cn('text-base font-medium', STATUS_TONE[status.state])}>{status.label}</span>
                {status.detail && <span className="text-xs text-muted">{status.detail}</span>}
                {typeof jws.payload?.exp === 'number' && status.state !== 'invalid-claims' && (
                  <span className="text-xs text-subtle">
                    {status.state === 'expired' ? 'expired' : 'expires'} {dateFmt.format(new Date((jws.payload.exp as number) * 1000))}
                  </span>
                )}
              </div>
            )}
            <JsonBlock title="Header" value={jws.headerJson} meta={jws.alg ? ALG_DESCRIPTIONS[jws.alg] : undefined} path="jwt-header.json" />
            <div className="border-b border-border pt-2 empty:hidden">
              <HeaderParams header={jws.header} />
            </div>
            <JsonBlock title="Payload" value={jws.payloadText} language={jws.payloadIsJson ? 'json' : 'plaintext'} path="jwt-payload.json" />
            {jws.payload && (
              <section aria-label="Claims" className="border-b border-border">
                <h3 className="eyebrow flex h-8 items-center px-4">Claims</h3>
                <ClaimsTable payload={jws.payload} now={now} />
              </section>
            )}
          </>
        )}
        {jwe && (
          <>
            <JsonBlock title="Protected header" value={jwe.headerJson} path="jwe-header.json" meta={typeof jwe.header.enc === 'string' ? `alg ${String(jwe.header.alg)} · enc ${jwe.header.enc}` : undefined} />
            <div className="border-b border-border pt-2 empty:hidden">
              <HeaderParams header={jwe.header} />
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-xs">
              {jwe.ranges.map((r) => (
                <div key={r.segment} className="contents">
                  <dt className={cn('font-medium', SEGMENT_CLASS[r.segment])}>{SEGMENT_LABEL[r.segment]}</dt>
                  <dd className="text-muted tabular">{r.end - r.start === 0 ? 'empty (direct key agreement / dir)' : `${r.end - r.start} chars`}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </Pane>
  )

  const sizes = jws ? jws.parts.map((p) => Math.floor((p.replace(/=+$/, '').length * 3) / 4)) : null
  return (
    <>
      {toolbar}
      <SplitPane id="jwt" initial={0.42} mobileTabs={['Token', 'Decoded']}>
        {tokenPane}
        {decodedPane}
      </SplitPane>
      <StatusBar>
        {sizes ? (
          <>
            <StatusItem label="Token">{formatBytes(jws!.token.length)}</StatusItem>
            <StatusItem label="Header">{formatBytes(sizes[0])}</StatusItem>
            <StatusItem label="Payload">{formatBytes(sizes[1])}</StatusItem>
            <StatusItem label="Signature">{sizes[2] ? `${sizes[2] * 8} bits` : 'none'}</StatusItem>
          </>
        ) : jwe ? (
          <StatusItem label="Token">{formatBytes(jwe.token.length)} · 5 segments</StatusItem>
        ) : (
          <StatusItem label="Token">—</StatusItem>
        )}
        {parsed && !parsed.ok && <StatusItem tone="danger">Malformed</StatusItem>}
        {verification.state === 'valid' && <StatusItem tone="ok">Signature verified</StatusItem>}
        {verification.state === 'invalid' && <StatusItem tone="danger">Signature invalid</StatusItem>}
        {jws && verification.state === 'idle' && jws.alg?.toLowerCase() !== 'none' && <StatusItem>Signature not checked</StatusItem>}
        <StatusSpacer />
        <span className="flex items-center gap-1 text-subtle">
          <Lock className="size-3" /> Never stored
        </span>
      </StatusBar>
    </>
  )
}

const SEGMENT_LABEL: Record<SegmentRange['segment'], string> = {
  header: 'Header',
  payload: 'Payload',
  signature: 'Signature',
  encryptedKey: 'Encrypted key',
  iv: 'IV',
  ciphertext: 'Ciphertext',
  tag: 'Auth tag',
}

