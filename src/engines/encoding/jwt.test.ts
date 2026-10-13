import { describe, expect, it } from 'vitest'
import {
  SAMPLE_SECRET,
  base64UrlDecode,
  base64UrlEncode,
  describeClaims,
  humanizeSeconds,
  inspectSpki,
  normalizeToken,
  parseJwt,
  parsePem,
  pkcs1ToSpki,
  samplePayload,
  signHmacJwt,
  tokenStatus,
  verifyJwt,
} from './jwt'

// RFC 7515 Appendix A.1 (HS256)
const RFC_TOKEN =
  'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const RFC_JWK = '{"kty":"oct","k":"AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow"}'

const enc = (o: unknown) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(o)))

function toPem(label: string, der: ArrayBuffer | Uint8Array) {
  const b64 = Buffer.from(der instanceof Uint8Array ? der : new Uint8Array(der)).toString('base64')
  return `-----BEGIN ${label}-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END ${label}-----`
}

async function signWith(alg: string, key: CryptoKey, params: AlgorithmIdentifier | RsaPssParams | EcdsaParams, payload = { sub: '1' }) {
  const h = enc({ alg, typ: 'JWT' })
  const p = enc(payload)
  const sig = await crypto.subtle.sign(params, key, new TextEncoder().encode(`${h}.${p}`))
  return `${h}.${p}.${base64UrlEncode(new Uint8Array(sig))}`
}

const tamper = (t: string) => {
  const [h, , s] = t.split('.')
  return `${h}.${enc({ sub: '2' })}.${s}`
}

describe('base64url', () => {
  it('round-trips arbitrary bytes', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = crypto.getRandomValues(new Uint8Array(n))
      expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes)
    }
  })
  it('reports invalid characters with position', () => {
    expect(() => base64UrlDecode('ab$d')).toThrow(/Invalid character "\$" at position 3/)
    expect(() => base64UrlDecode('abcde')).toThrow(/Invalid length/)
  })
})

describe('parseJwt', () => {
  it('decodes the RFC 7515 example', () => {
    const r = parseJwt(RFC_TOKEN)
    expect(r.ok).toBe(true)
    if (!r.ok || r.value.kind !== 'jws') return
    expect(r.value.alg).toBe('HS256')
    expect(r.value.payload).toEqual({ iss: 'joe', exp: 1300819380, 'http://example.com/is_root': true })
    expect(r.value.ranges.map((x) => x.segment)).toEqual(['header', 'payload', 'signature'])
    expect(r.value.signature.length).toBe(32)
  })
  it('tolerates Bearer prefix, header name, quotes and whitespace', () => {
    expect(normalizeToken('  Authorization: Bearer abc.def.ghi ')).toMatchObject({ token: 'abc.def.ghi', scheme: 'Bearer' })
    const wrapped = `"${RFC_TOKEN.slice(0, 50)}\n  ${RFC_TOKEN.slice(50)}"`
    const r = parseJwt(`bearer ${wrapped}`)
    expect(r.ok).toBe(true)
  })
  it('explains JWE tokens', () => {
    const h = enc({ alg: 'RSA-OAEP', enc: 'A256GCM' })
    const r = parseJwt(`${h}.a.b.c.d`)
    expect(r.ok && r.value.kind).toBe('jwe')
  })
  it('reports malformed tokens', () => {
    const one = parseJwt('notatoken')
    expect(!one.ok && one.error.message).toMatch(/three base64url segments/)
    const badB64 = parseJwt('eyJ$.e30.')
    expect(!badB64.ok && badB64.error).toMatchObject({ segment: 'header', offset: 3 })
    const notJson = parseJwt(`${base64UrlEncode(new TextEncoder().encode('{alg:'))}.e30.`)
    expect(!notJson.ok && notJson.error.message).toMatch(/header is not valid JSON/)
    const emptyHeader = parseJwt('.e30.')
    expect(!emptyHeader.ok && emptyHeader.error.segment).toBe('header')
  })
  it('handles non-JSON payloads and unicode claims', () => {
    const r = parseJwt(`${enc({ alg: 'HS256' })}.${base64UrlEncode(new TextEncoder().encode('hello'))}.`)
    expect(r.ok && r.value.kind === 'jws' && r.value.payloadIsJson).toBe(false)
    const u = parseJwt(`${enc({ alg: 'none' })}.${enc({ name: 'Zoë 😀' })}.`)
    expect(u.ok && u.value.kind === 'jws' && u.value.payload?.name).toBe('Zoë 😀')
  })
  it('keeps big numbers exact in the JSON view', () => {
    const p = base64UrlEncode(new TextEncoder().encode('{"id":12345678901234567890}'))
    const r = parseJwt(`${enc({ alg: 'none' })}.${p}.`)
    expect(r.ok && r.value.kind === 'jws' && r.value.payloadText).toContain('12345678901234567890')
  })
})

describe('claims', () => {
  const now = 1_700_000_000
  it('computes status', () => {
    expect(tokenStatus({ exp: now - 3 * 86400 }, now).label).toBe('Expired 3 days ago')
    expect(tokenStatus({ exp: now + 2 * 3600 }, now).label).toBe('Valid for 2 more hours')
    expect(tokenStatus({ exp: now + 2 * 3600, nbf: now + 300 }, now)).toMatchObject({ state: 'not-yet-valid', detail: 'Becomes valid in 5 minutes' })
    expect(tokenStatus({ sub: 'x' }, now).state).toBe('no-expiry')
    expect(tokenStatus({ exp: '2024-01-01' }, now).state).toBe('invalid-claims')
  })
  it('humanizes durations with two units', () => {
    expect(humanizeSeconds(3600 + 120)).toBe('1 hour 2 minutes')
    expect(humanizeSeconds(86400 * 400)).toBe('1 year 35 days')
    expect(humanizeSeconds(1)).toBe('1 second')
  })
  it('describes registered claims and flags millisecond timestamps', () => {
    const rows = describeClaims({ custom: 1, exp: now * 1000, iss: 'a', aud: ['x', 'y'] }, now)
    expect(rows.map((r) => r.key)).toEqual(['iss', 'aud', 'exp', 'custom'])
    expect(rows[1].display).toBe('x, y')
    expect(rows[2].tone).toBe('warn')
    expect(rows[3].info).toBeUndefined()
  })
})

describe('verifyJwt', () => {
  it('verifies the RFC 7515 HS256 example with its JWK', async () => {
    expect((await verifyJwt(RFC_TOKEN, RFC_JWK)).valid).toBe(true)
  })
  it('verifies the built-in sample with the documented secret', async () => {
    const t = await signHmacJwt({ alg: 'HS256', typ: 'JWT' }, samplePayload(now()), SAMPLE_SECRET)
    expect((await verifyJwt(t, SAMPLE_SECRET)).valid).toBe(true)
    expect((await verifyJwt(t, 'wrong-secret-wrong-secret-wrong-secret')).valid).toBe(false)
    expect((await verifyJwt(tamper(t), SAMPLE_SECRET)).valid).toBe(false)
    const b64 = Buffer.from(SAMPLE_SECRET).toString('base64')
    expect((await verifyJwt(t, b64, { format: 'base64' })).valid).toBe(true)
  })
  it('HS384/HS512 and weak-secret warnings', async () => {
    for (const alg of ['HS384', 'HS512']) {
      const t = await signHmacJwt({ alg }, { a: 1 }, 'short')
      const r = await verifyJwt(t, 'short')
      expect(r.valid).toBe(true)
      expect(r.warnings[0]).toMatch(/RFC 7518 requires at least/)
    }
  })

  for (const [alg, hash] of [['RS256', 'SHA-256'], ['RS384', 'SHA-384'], ['RS512', 'SHA-512']] as const) {
    it(`${alg} with SPKI PEM, PKCS#1 PEM and JWK`, async () => {
      const kp = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash }, true, ['sign', 'verify'])) as CryptoKeyPair
      const t = await signWith(alg, kp.privateKey, { name: 'RSASSA-PKCS1-v1_5' })
      const spki = new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey))
      const pem = toPem('PUBLIC KEY', spki)
      const r = await verifyJwt(t, pem)
      expect(r).toMatchObject({ valid: true, keyDescription: 'RSA public key · 2048 bits' })
      expect((await verifyJwt(tamper(t), pem)).valid).toBe(false)
      const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey)
      expect((await verifyJwt(t, JSON.stringify(jwk))).valid).toBe(true)
      // PKCS#1: strip the SPKI wrapper and re-wrap it.
      const parsed = parsePem(pem)!
      expect(inspectSpki(parsed.der).type).toBe('RSA')
      const pkcs1 = spki.slice(spki.length - 270) // 2048-bit RSAPublicKey is 270 bytes
      expect(pkcs1ToSpki(pkcs1)).toEqual(spki)
      expect((await verifyJwt(t, toPem('RSA PUBLIC KEY', pkcs1))).valid).toBe(true)
    })
  }

  for (const [alg, hash] of [['PS256', 'SHA-256'], ['PS512', 'SHA-512']] as const) {
    it(`${alg}`, async () => {
      const kp = (await crypto.subtle.generateKey({ name: 'RSA-PSS', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash }, true, ['sign', 'verify'])) as CryptoKeyPair
      const t = await signWith(alg, kp.privateKey, { name: 'RSA-PSS', saltLength: Number(alg.slice(2)) / 8 })
      const pem = toPem('PUBLIC KEY', await crypto.subtle.exportKey('spki', kp.publicKey))
      expect((await verifyJwt(t, pem)).valid).toBe(true)
      expect((await verifyJwt(tamper(t), pem)).valid).toBe(false)
    })
  }

  for (const [alg, curve, hash] of [['ES256', 'P-256', 'SHA-256'], ['ES384', 'P-384', 'SHA-384'], ['ES512', 'P-521', 'SHA-512']] as const) {
    it(`${alg} with PEM and JWKS (kid selection)`, async () => {
      const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: curve }, true, ['sign', 'verify'])) as CryptoKeyPair
      const h = enc({ alg, kid: 'k2' })
      const p = enc({ sub: '1' })
      const sig = await crypto.subtle.sign({ name: 'ECDSA', hash }, kp.privateKey, new TextEncoder().encode(`${h}.${p}`))
      const t = `${h}.${p}.${base64UrlEncode(new Uint8Array(sig))}`
      const pem = toPem('PUBLIC KEY', await crypto.subtle.exportKey('spki', kp.publicKey))
      expect(await verifyJwt(t, pem)).toMatchObject({ valid: true, keyDescription: `EC public key · ${curve}` })
      const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey)
      const other = await crypto.subtle.exportKey('jwk', ((await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: curve }, true, ['sign', 'verify'])) as CryptoKeyPair).publicKey)
      const jwks = JSON.stringify({ keys: [{ ...other, kid: 'k1' }, { ...jwk, kid: 'k2' }] })
      expect((await verifyJwt(t, jwks)).valid).toBe(true)
      expect((await verifyJwt(tamper(t), jwks)).valid).toBe(false)
    })
  }

  it('EdDSA (Ed25519)', async () => {
    const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const t = await signWith('EdDSA', kp.privateKey, { name: 'Ed25519' })
    const pem = toPem('PUBLIC KEY', await crypto.subtle.exportKey('spki', kp.publicKey))
    expect((await verifyJwt(t, pem)).valid).toBe(true)
  })

  it('rejects wrong key types, curves, private keys and alg none', async () => {
    const ec = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const ecPem = toPem('PUBLIC KEY', await crypto.subtle.exportKey('spki', ec.publicKey))
    const es256 = `${enc({ alg: 'ES256' })}.${enc({})}.${base64UrlEncode(new Uint8Array(64))}`
    await expect(verifyJwt(es256, ecPem)).rejects.toThrow(/requires curve P-256/)
    const rs = `${enc({ alg: 'RS256' })}.${enc({})}.${base64UrlEncode(new Uint8Array(256))}`
    await expect(verifyJwt(rs, ecPem)).rejects.toThrow(/needs an RSA key/)
    await expect(verifyJwt(rs, '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----')).rejects.toThrow(/private key/)
    await expect(verifyJwt(rs, 'not a key')).rejects.toThrow(/PEM public key/)
    await expect(verifyJwt(`${enc({ alg: 'none' })}.${enc({})}.`, 'x')).rejects.toThrow(/unsigned/)
    const hs = await signHmacJwt({ alg: 'HS256' }, {}, 'secret')
    await expect(verifyJwt(hs, ecPem)).rejects.toThrow(/shared secret/)
    // DER-encoded ECDSA signatures are the wrong length for JWS.
    const bad = await verifyJwt(`${enc({ alg: 'ES256' })}.${enc({})}.${base64UrlEncode(new Uint8Array(70))}`, ecPem)
    expect(bad.valid).toBe(false)
    expect(bad.warnings[0]).toMatch(/must be 64 bytes/)
  })
})

function now() {
  return Math.floor(Date.now() / 1000)
}
