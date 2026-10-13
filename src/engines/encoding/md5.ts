/**
 * MD5 (RFC 1321). Web Crypto does not provide MD5, so it is implemented here.
 *
 * MD5 is a legacy checksum: collisions can be produced in seconds. Use it only to compare
 * against existing published checksums — never for passwords, signatures or integrity
 * against an adversary.
 */

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21]

const K = new Int32Array(64)
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0

/** Incremental MD5: feed any number of chunks, then call digest(). */
export class Md5 {
  private h = new Int32Array([0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476])
  private block = new Uint8Array(64)
  private blockView = new DataView(this.block.buffer)
  private blockLen = 0
  private total = 0
  private x = new Int32Array(16)
  private done = false

  update(data: Uint8Array): this {
    if (this.done) throw new Error('MD5: update() after digest()')
    let i = 0
    this.total += data.length
    if (this.blockLen) {
      const take = Math.min(64 - this.blockLen, data.length)
      this.block.set(data.subarray(0, take), this.blockLen)
      this.blockLen += take
      i = take
      if (this.blockLen === 64) {
        this.compress(this.blockView, 0)
        this.blockLen = 0
      }
    }
    if (i + 64 <= data.length) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      for (; i + 64 <= data.length; i += 64) this.compress(view, i)
    }
    if (i < data.length) {
      this.block.set(data.subarray(i), 0)
      this.blockLen = data.length - i
    }
    return this
  }

  digest(): Uint8Array {
    if (!this.done) {
      const bitLen = this.total * 8
      const pad = new Uint8Array((this.blockLen < 56 ? 56 : 120) - this.blockLen + 8)
      pad[0] = 0x80
      const dv = new DataView(pad.buffer)
      dv.setUint32(pad.length - 8, bitLen >>> 0, true)
      dv.setUint32(pad.length - 4, Math.floor(bitLen / 2 ** 32), true)
      this.total -= pad.length // update() adds it back; the length is already encoded
      this.update(pad)
      this.done = true
    }
    const out = new Uint8Array(16)
    const dv = new DataView(out.buffer)
    for (let i = 0; i < 4; i++) dv.setInt32(i * 4, this.h[i], true)
    return out
  }

  private compress(view: DataView, off: number) {
    const x = this.x
    for (let i = 0; i < 16; i++) x[i] = view.getInt32(off + i * 4, true)
    let a = this.h[0]
    let b = this.h[1]
    let c = this.h[2]
    let d = this.h[3]
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) & 15
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) & 15
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) & 15
      }
      const tmp = d
      d = c
      c = b
      const sum = (a + f + K[i] + x[g]) | 0
      b = (b + ((sum << S[i]) | (sum >>> (32 - S[i])))) | 0
      a = tmp
    }
    this.h[0] = (this.h[0] + a) | 0
    this.h[1] = (this.h[1] + b) | 0
    this.h[2] = (this.h[2] + c) | 0
    this.h[3] = (this.h[3] + d) | 0
  }
}

export function md5(data: Uint8Array | string): Uint8Array {
  return new Md5().update(typeof data === 'string' ? new TextEncoder().encode(data) : data).digest()
}

/** HMAC-MD5 (RFC 2104). Legacy — provided for compatibility with old APIs only. */
export function hmacMd5(key: Uint8Array, data: Uint8Array): Uint8Array {
  let k = key
  if (k.length > 64) k = md5(k)
  const ipad = new Uint8Array(64)
  const opad = new Uint8Array(64)
  ipad.set(k)
  opad.set(k)
  for (let i = 0; i < 64; i++) {
    ipad[i] ^= 0x36
    opad[i] ^= 0x5c
  }
  const inner = new Md5().update(ipad).update(data).digest()
  return new Md5().update(opad).update(inner).digest()
}

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
