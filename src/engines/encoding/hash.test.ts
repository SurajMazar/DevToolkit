import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Md5, hmacMd5, md5, toHex } from './md5'
import { digest, encodeDigest, guessDigestShape, hashAll, hmac, matchExpected, normalizeExpected, parseKey } from './hash'

const te = new TextEncoder()

describe('md5 (RFC 1321 test suite)', () => {
  const vectors: [string, string][] = [
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
    ['12345678901234567890123456789012345678901234567890123456789012345678901234567890', '57edf4a22be3c955ac49da2e2107b67a'],
  ]
  for (const [input, hex] of vectors) it(`md5("${input.slice(0, 20)}")`, () => expect(toHex(md5(input))).toBe(hex))

  it('gives the same result when fed in arbitrary chunks', () => {
    const data = crypto.getRandomValues(new Uint8Array(10_000))
    const whole = toHex(md5(data))
    for (const size of [1, 7, 63, 64, 65, 1000]) {
      const h = new Md5()
      for (let i = 0; i < data.length; i += size) h.update(data.subarray(i, i + size))
      expect(toHex(h.digest())).toBe(whole)
    }
  })
  it('matches node:crypto for unicode, random and large buffers', () => {
    const ref = (b: Uint8Array) => createHash('md5').update(b).digest('hex')
    expect(toHex(md5('héllo 😀 東京'))).toBe(ref(te.encode('héllo 😀 東京')))
    for (const n of [55, 56, 63, 64, 65, 119, 120, 1000]) {
      const b = crypto.getRandomValues(new Uint8Array(n))
      expect(toHex(md5(b))).toBe(ref(b))
    }
    const big = new Uint8Array(8 * 1024 * 1024).fill(0x61)
    expect(toHex(md5(big))).toBe(ref(big))
  })
  it('HMAC-MD5 (RFC 2104 / 2202 test cases)', () => {
    expect(toHex(hmacMd5(new Uint8Array(16).fill(0x0b), te.encode('Hi There')))).toBe('9294727a3638bb1c13f48ef8158bfc9d')
    expect(toHex(hmacMd5(te.encode('Jefe'), te.encode('what do ya want for nothing?')))).toBe('750c783e6ab0b503eaa86e310a5db738')
    expect(toHex(hmacMd5(new Uint8Array(80).fill(0xaa), te.encode('Test Using Larger Than Block-Size Key - Hash Key First')))).toBe('6b1ab7fe4bd7bf8f0b62e6ce61b9d0cd')
  })
})

describe('SHA via Web Crypto (FIPS 180 vectors)', () => {
  it('abc', async () => {
    const abc = te.encode('abc')
    expect(encodeDigest(await digest('SHA-1', abc), 'hex')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(encodeDigest(await digest('SHA-256', abc), 'hex')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(encodeDigest(await digest('SHA-384', abc), 'hex')).toBe('cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7')
    expect(encodeDigest(await digest('SHA-512', abc), 'hex')).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    )
  })
  it('empty input', async () => {
    expect(encodeDigest(await digest('SHA-256', new Uint8Array()), 'hex')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
  it('HMAC-SHA256 (RFC 4231 case 2)', async () => {
    const r = await hmac('SHA-256', te.encode('Jefe'), te.encode('what do ya want for nothing?'))
    expect(encodeDigest(r, 'hex')).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
  })
  it('hashAll computes several algorithms', async () => {
    const r = await hashAll(te.encode('abc'), ['MD5', 'SHA-256'])
    expect(r.map((x) => x.algo)).toEqual(['MD5', 'SHA-256'])
  })
})

describe('encodings, keys and verification', () => {
  const bytes = Uint8Array.from([0xfb, 0xff, 0x00])
  it('encodes digests', () => {
    expect(encodeDigest(bytes, 'hex')).toBe('fbff00')
    expect(encodeDigest(bytes, 'HEX')).toBe('FBFF00')
    expect(encodeDigest(bytes, 'base64')).toBe('+/8A')
    expect(encodeDigest(bytes, 'base64url')).toBe('-_8A')
  })
  it('parses keys', () => {
    expect(parseKey('0xDEAD beef', 'hex')).toEqual(Uint8Array.from([0xde, 0xad, 0xbe, 0xef]))
    expect(() => parseKey('abz', 'hex')).toThrow(/"z" at position 3/)
    expect(() => parseKey('abc', 'hex')).toThrow(/odd number/)
    expect(parseKey('3q2-7w', 'base64')).toEqual(Uint8Array.from([0xde, 0xad, 0xbe, 0xef]))
    expect(parseKey('é', 'text')).toEqual(Uint8Array.from([0xc3, 0xa9]))
  })
  it('matches expected digests in any encoding, case-insensitive hex', async () => {
    const results = await hashAll(te.encode('abc'), ['MD5', 'SHA-1', 'SHA-256'])
    expect(matchExpected('BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD', results)).toEqual([{ algo: 'SHA-256', encoding: 'hex' }])
    expect(matchExpected('sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', results)[0].algo).toBe('SHA-256')
    expect(matchExpected('900150983cd24fb0d6963f7d28e17f72  file.txt', results)).toEqual([{ algo: 'MD5', encoding: 'hex' }])
    expect(matchExpected(encodeDigest(results[1].bytes, 'base64'), results)).toEqual([{ algo: 'SHA-1', encoding: 'base64' }])
    expect(matchExpected(encodeDigest(results[2].bytes, 'base64url'), results)).toEqual([{ algo: 'SHA-256', encoding: 'base64url' }])
    expect(matchExpected('deadbeef', results)).toEqual([])
  })
  it('guesses digest shape', () => {
    expect(guessDigestShape('a'.repeat(64))).toMatch(/SHA-256 hex/)
    expect(guessDigestShape('a'.repeat(40))).toMatch(/SHA-1 hex/)
    expect(normalizeExpected('  0xABC ')).toBe('ABC')
  })
})
