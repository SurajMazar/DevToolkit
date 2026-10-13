import { describe, expect, it } from 'vitest'
import { formatUuid, generateUuids, inspectUuid, joinUuids, MAX_UUID, NIL_UUID, uuidsToCsv } from './uuid'

const CANON = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('generateUuids', () => {
  it('v4: canonical form, version 4 nibble, RFC variant, unique', () => {
    const ids = generateUuids('v4', 2000)
    expect(new Set(ids).size).toBe(2000)
    for (const id of ids) {
      expect(id).toMatch(CANON)
      expect(id[14]).toBe('4')
      expect('89ab').toContain(id[19])
    }
  })

  it('v7: version 7 nibble, RFC variant, timestamp near now', () => {
    const before = Date.now()
    const ids = generateUuids('v7', 50)
    const after = Date.now()
    for (const id of ids) {
      expect(id).toMatch(CANON)
      expect(id[14]).toBe('7')
      expect('89ab').toContain(id[19])
      const r = inspectUuid(id)
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.value.version).toBe(7)
        expect(r.value.timestampMs).toBeGreaterThanOrEqual(before)
        expect(r.value.timestampMs).toBeLessThanOrEqual(after + 1)
      }
    }
  })

  it('v7: 10,000 values are strictly increasing (monotonic within the same millisecond)', () => {
    const ids = generateUuids('v7', 10_000)
    for (let i = 1; i < ids.length; i++) expect(ids[i] > ids[i - 1]).toBe(true)
    expect(new Set(ids).size).toBe(10_000)
    // Successive batches continue the order.
    const next = generateUuids('v7', 10)
    expect(next[0] > ids[ids.length - 1]).toBe(true)
  })

  it('nil and max', () => {
    expect(generateUuids('nil', 3)).toEqual([NIL_UUID, NIL_UUID, NIL_UUID])
    expect(generateUuids('max', 1)).toEqual([MAX_UUID])
  })

  it('rejects out-of-range counts', () => {
    expect(() => generateUuids('v4', 0)).toThrow()
    expect(() => generateUuids('v4', 10_001)).toThrow()
    expect(() => generateUuids('v4', 1.5)).toThrow()
  })
})

describe('formatUuid / joinUuids', () => {
  const id = '017f22e2-79b0-7cc3-98c4-dc0c0c07398f'
  it('applies case, hyphens and wrapping', () => {
    expect(formatUuid(id, { case: 'upper', hyphens: true, wrap: 'none' })).toBe('017F22E2-79B0-7CC3-98C4-DC0C0C07398F')
    expect(formatUuid(id, { case: 'lower', hyphens: false, wrap: 'none' })).toBe('017f22e279b07cc398c4dc0c0c07398f')
    expect(formatUuid(id, { case: 'lower', hyphens: true, wrap: 'braces' })).toBe(`{${id}}`)
    expect(formatUuid(id, { case: 'lower', hyphens: true, wrap: 'urn' })).toBe(`urn:uuid:${id}`)
  })
  it('joins in every list mode', () => {
    const v = ['a', 'b']
    expect(joinUuids(v, 'lines')).toBe('a\nb')
    expect(joinUuids(v, 'quoted')).toBe('"a",\n"b"')
    expect(JSON.parse(joinUuids(v, 'json'))).toEqual(v)
    expect(joinUuids(v, 'sql')).toBe("('a'),\n('b')")
    expect(uuidsToCsv(v)).toBe('uuid\r\na\r\nb\r\n')
  })
})

describe('inspectUuid', () => {
  // RFC 9562 Appendix A test vectors: all encode 2022-02-22T19:22:22Z.
  const T = Date.UTC(2022, 1, 22, 19, 22, 22)

  it('decodes the RFC 9562 v1 example', () => {
    const r = inspectUuid('C232AB00-9414-11EC-B3C8-9F6BDECED846')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.version).toBe(1)
    expect(r.value.variant).toBe('RFC 9562')
    expect(r.value.timestampMs).toBe(T)
    expect(r.value.clockSeq).toBe(0x33c8)
    expect(r.value.node).toBe('9f:6b:de:ce:d8:46')
    expect(r.value.canonical).toBe('c232ab00-9414-11ec-b3c8-9f6bdeced846')
  })

  it('decodes the RFC 9562 v6 example', () => {
    const r = inspectUuid('1EC9414C-232A-6B00-B3C8-9F6BDECED846')
    expect(r.ok && r.value.version).toBe(6)
    expect(r.ok && r.value.timestampMs).toBe(T)
  })

  it('decodes the RFC 9562 v7 example in any input form', () => {
    for (const s of ['017F22E2-79B0-7CC3-98C4-DC0C0C07398F', '{017f22e2-79b0-7cc3-98c4-dc0c0c07398f}', 'urn:uuid:017f22e2-79b0-7cc3-98c4-dc0c0c07398f', '017f22e279b07cc398c4dc0c0c07398f', '  017f22e2-79b0-7cc3-98c4-dc0c0c07398f\n']) {
      const r = inspectUuid(s)
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      expect(r.value.version).toBe(7)
      expect(r.value.timestampMs).toBe(T)
      expect(r.value.canonical).toBe('017f22e2-79b0-7cc3-98c4-dc0c0c07398f')
    }
    expect(inspectUuid('{017f22e2-79b0-7cc3-98c4-dc0c0c07398f}').ok && (inspectUuid('{017f22e2-79b0-7cc3-98c4-dc0c0c07398f}') as { value: { inputForm: string } }).value.inputForm).toBe('braces')
  })

  it('identifies v4, nil, max and variants', () => {
    const v4 = inspectUuid('919108f7-52d1-4320-9bac-f847db4148a8')
    expect(v4.ok && v4.value.version).toBe(4)
    expect(v4.ok && v4.value.timestampMs).toBeUndefined()
    expect(inspectUuid(NIL_UUID).ok && (inspectUuid(NIL_UUID) as { value: { special?: string } }).value.special).toBe('nil')
    expect(inspectUuid(MAX_UUID.toUpperCase()).ok && (inspectUuid(MAX_UUID) as { value: { special?: string } }).value.special).toBe('max')
    const ms = inspectUuid('919108f7-52d1-4320-cbac-f847db4148a8')
    expect(ms.ok && ms.value.variant).toBe('Microsoft (reserved)')
  })

  it('explains invalid input', () => {
    const r1 = inspectUuid('hello')
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.error).toMatch(/unexpected character “h”/)
    const r2 = inspectUuid('017f22e2-79b0-7cc3-98c4-dc0c0c07398')
    expect(!r2.ok && r2.error).toMatch(/31 hex digits/)
    const r3 = inspectUuid('017f22e279b0-7cc3-98c4-dc0c-0c07398f')
    expect(!r3.ok && r3.error).toMatch(/8-4-4-4-12/)
    expect(inspectUuid('').ok).toBe(false)
  })
})
