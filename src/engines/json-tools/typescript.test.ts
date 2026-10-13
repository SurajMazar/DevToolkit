import { describe, expect, it } from 'vitest'
import { parseJson } from '@/engines/json/parse'
import { itemTypeName, jsonToTypeScript, jsonToZod, singularize, typeNameFromKey } from './typescript'
import { generateTypes } from './tasks'

const ts = (v: unknown, o = {}) => jsonToTypeScript(v, o).code
const parse = (t: string) => {
  const r = parseJson(t)
  if (!r.ok) throw new Error(r.error.message)
  return r.value
}

describe('singularize', () => {
  it.each([
    ['users', 'user'],
    ['categories', 'category'],
    ['addresses', 'address'],
    ['boxes', 'box'],
    ['matches', 'match'],
    ['dishes', 'dish'],
    ['people', 'person'],
    ['children', 'child'],
    ['statuses', 'status'],
    ['analyses', 'analysis'],
    ['movies', 'movie'],
    ['leaves', 'leaf'],
    ['heroes', 'hero'],
    ['shoes', 'shoe'],
    ['indices', 'index'],
    ['keys', 'key'],
    ['days', 'day'],
    ['Users', 'User'],
    ['status', 'status'],
    ['data', 'data'],
    ['address', 'address'],
    ['bus', 'bus'],
    ['caches', 'cache'],
    ['responses', 'response'],
  ])('%s → %s', (a, b) => expect(singularize(a)).toBe(b))
})

describe('naming', () => {
  it('type names from keys', () => {
    expect(typeNameFromKey('user_profile')).toBe('UserProfile')
    expect(typeNameFromKey('2fa')).toBe('Type2fa')
    expect(typeNameFromKey('@@')).toBe('Type')
    expect(typeNameFromKey('名前')).toBe('名前')
    expect(typeNameFromKey('string')).toBe('StringType')
  })
  it('array item names', () => {
    expect(itemTypeName('users')).toBe('User')
    expect(itemTypeName('user_accounts')).toBe('UserAccount')
    expect(itemTypeName('lineItems')).toBe('LineItem')
    expect(itemTypeName('data')).toBe('DataItem')
    expect(itemTypeName('matrix')).toBe('MatrixItem')
  })
})

describe('jsonToTypeScript', () => {
  it('nested objects become named interfaces', () => {
    expect(ts({ id: 1, name: 'Ada', active: true, address: { city: 'Oslo', geo: { lat: 1.5 } } })).toBe(
      `export interface Root {
  id: number;
  name: string;
  active: boolean;
  address: Address;
}

export interface Address {
  city: string;
  geo: Geo;
}

export interface Geo {
  lat: number;
}
`,
    )
  })
  it('array items are singularized and merged; missing keys become optional', () => {
    const code = ts({ users: [{ id: 1, email: 'a@x', role: 'admin' }, { id: 2, email: null }] })
    expect(code).toContain('users: User[];')
    expect(code).toContain(`export interface User {
  id: number;
  email: string | null;
  role?: string;
}`)
  })
  it('null strategy: optional', () => {
    const code = ts({ items: [{ a: 1, b: null }, { a: null, b: null }] }, { nulls: 'optional' })
    expect(code).toContain('a?: number;')
    expect(code).toContain('b: null;')
  })
  it('unions, empty arrays, nested arrays and mixed arrays', () => {
    const code = ts({ mixed: [1, 'a', true], empty: [], grid: [[1, 2], [3]], val: 'x', any: [{ a: 1 }, 'x'] })
    expect(code).toContain('mixed: (string | number | boolean)[];')
    expect(code).toContain('empty: unknown[];')
    expect(code).toContain('grid: number[][];')
    expect(code).toContain('any: (string | AnyItem)[];')
  })
  it('empty arrays merge with non-empty ones', () => {
    expect(ts({ list: [{ tags: [] }, { tags: ['x'] }] })).toContain('tags: string[];')
  })
  it('quotes invalid identifiers and keeps unicode keys', () => {
    const code = ts({ 'first-name': 'a', '2x': 1, 名前: 'x', $ref: 'y', 'a b': { c: 1 } })
    expect(code).toContain('"first-name": string;')
    expect(code).toContain('"2x": number;')
    expect(code).toContain('名前: string;')
    expect(code).toContain('$ref: string;')
    expect(code).toContain('"a b": AB;')
  })
  it('camelCase property names with original-key comments', () => {
    const code = ts({ first_name: 'a', lastName: 'b', last_name: 'c', 'x-id': 1 }, { propertyNames: 'camel' })
    expect(code).toContain('/** Original key: "first_name" */\n  firstName: string;')
    expect(code).toContain('  lastName: string;')
    // Collision with an existing camelCase key: keep the original
    expect(code).toContain('  last_name: string;')
    expect(code).toContain('/** Original key: "x-id" */\n  xId: number;')
  })
  it('type aliases, readonly, no export', () => {
    expect(ts({ a: 1 }, { declaration: 'type', readonly: true, export: false })).toBe('type Root = {\n  readonly a: number;\n};\n')
    expect(ts({}, { declaration: 'type' })).toBe('export type Root = Record<string, never>;\n')
    expect(ts({})).toBe('export interface Root {}\n')
  })
  it('dedupes structurally identical types', () => {
    const v = { billing: { street: 's', city: 'c' }, shipping: { street: 's', city: 'c' } }
    const deduped = ts(v)
    expect(deduped).toContain('billing: Billing;')
    expect(deduped).toContain('shipping: Billing;')
    expect(deduped.match(/interface/g)!.length).toBe(2)
    const plain = ts(v, { dedupe: false })
    expect(plain).toContain('shipping: Shipping;')
    expect(plain.match(/interface/g)!.length).toBe(3)
  })
  it('resolves name collisions', () => {
    const code = ts({ item: { a: 1 }, other: { item: { b: 2 } } })
    expect(code).toContain('export interface Item {')
    expect(code).toContain('item: OtherItem;')
  })
  it('root arrays and primitives', () => {
    expect(ts([{ id: 1 }], { rootName: 'Users' })).toBe('export type Users = User[];\n\nexport interface User {\n  id: number;\n}\n')
    expect(ts([1, 2])).toBe('export type Root = number[];\n')
    expect(ts('x')).toBe('export type Root = string;\n')
    expect(ts(null)).toBe('export type Root = null;\n')
    expect(ts([{ a: 1 }])).toContain('export type Root = RootItem[];')
  })
  it('big numbers', () => {
    const v = parse('{"id": 12345678901234567890, "small": 1, "dec": 1.00000000000000000001}')
    expect(ts(v)).toContain('/** Integer beyond Number.MAX_SAFE_INTEGER — JSON.parse will lose precision. */\n  id: number;')
    expect(ts(v)).toContain('  dec: number;')
    expect(ts(v, { bigNumbers: 'string-number' })).toContain('id: string | number;')
    expect(ts(v, { bigNumbers: 'bigint' })).toContain('id: bigint;')
    const mixed = parse('{"ids": [1, 12345678901234567890]}')
    expect(ts(mixed)).toContain('ids: number[];')
    expect(ts(mixed, { bigNumbers: 'bigint' })).toContain('ids: (number | bigint)[];')
  })
  it('generic array syntax', () => {
    expect(ts({ a: [1, 'x'] }, { arraySyntax: 'generic' })).toContain('a: Array<string | number>;')
  })
  it('deep nesting and large arrays', () => {
    let v: Record<string, unknown> = { leaf: true }
    for (let i = 0; i < 200; i++) v = { level: v }
    const code = ts(v)
    expect(code.match(/interface/g)!.length).toBe(201)
    const big = { rows: Array.from({ length: 50_000 }, (_, i) => (i % 2 ? { id: i, name: 'x' } : { id: i, extra: [i] })) }
    const t0 = performance.now()
    const out = ts(big)
    expect(out).toContain('name?: string;')
    expect(out).toContain('extra?: number[];')
    expect(performance.now() - t0).toBeLessThan(2000)
  })
})

describe('jsonToZod', () => {
  it('emits schemas in dependency order with inferred types', () => {
    const code = jsonToZod({ id: 1, user: { name: 'a', email: null }, tags: ['x'], items: [{ sku: 'A', qty: 1 }, { sku: 'B' }] }).code
    expect(code).toBe(`import { z } from 'zod';

export const userSchema = z.object({
  name: z.string(),
  email: z.null(),
});
export type User = z.infer<typeof userSchema>;

export const itemSchema = z.object({
  sku: z.string(),
  qty: z.number().optional(),
});
export type Item = z.infer<typeof itemSchema>;

export const rootSchema = z.object({
  id: z.number(),
  user: userSchema,
  tags: z.array(z.string()),
  items: z.array(itemSchema),
});
export type Root = z.infer<typeof rootSchema>;
`)
  })
  it('deduped types referenced before their first parent are still declared first', () => {
    const code = jsonToZod({ a: { x: 1 }, b: { c: { x: 1 } } }).code
    expect(code.indexOf('const aSchema')).toBeLessThan(code.indexOf('const bSchema'))
    expect(code).toContain('c: aSchema,')
  })
  it('nullable, unions, empty arrays, quoted keys, root arrays', () => {
    const code = jsonToZod([{ 'a-b': 'x', n: null }, { 'a-b': 1, n: 2, e: [] }]).code
    expect(code).toContain('"a-b": z.union([z.string(), z.number()]),')
    expect(code).toContain('n: z.number().nullable(),')
    expect(code).toContain('e: z.array(z.unknown()).optional(),')
    expect(code).toContain('export const rootSchema = z.array(rootItemSchema);')
    expect(jsonToZod({ n: [{ v: null }, { v: 1 }] }, { nulls: 'optional' }).code).toContain('v: z.number().nullish(),')
  })
  it('generateTypes task', () => {
    const r = generateTypes({ text: '{"a":1}', format: 'zod', options: {} })
    expect(r.ok && r.value.declarations).toBe(1)
    const e = generateTypes({ text: '{"a":', format: 'typescript', options: {} })
    expect(e.ok).toBe(false)
  })
})

describe('tool sample', () => {
  it('generates the expected declarations for the sample API response', async () => {
    const { TS_SAMPLE } = await import('@/tools/json/to-typescript/sample')
    const r = generateTypes({ text: TS_SAMPLE, format: 'typescript', options: {} })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.hasBigNumbers).toBe(true)
    expect(r.value.code).toContain('items: Item[];')
    expect(r.value.code).toContain('license: License | null;')
    expect(r.value.code).toContain('permissions?: Permissions;')
    expect(r.value.code).toContain('"default-branch": string;')
    const z = generateTypes({ text: TS_SAMPLE, format: 'zod', options: {} })
    expect(z.ok && z.value.code).toContain('license: licenseSchema.nullable(),')
  })
})
