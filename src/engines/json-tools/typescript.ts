/**
 * JSON → TypeScript declarations (and Zod schemas).
 *
 * 1. `inferShape` folds every value into a Shape: the set of primitive types seen plus at most
 *    one merged object shape and one merged array shape. Objects merged from several samples
 *    (array elements, repeated keys) remember how often each key occurred → optional keys.
 * 2. Object shapes are named (from their key, singularized for array items), deduplicated by
 *    structure and emitted as interfaces / type aliases or Zod schemas.
 */
import { convertCase } from '@/engines/case'
import { isLosslessNumber } from '@/engines/json/parse'
import { isIdentifier } from './paths'

type Prim = 'string' | 'number' | 'boolean' | 'null' | 'big'

interface Shape {
  prims: Set<Prim>
  obj?: ObjShape
  arr?: ArrShape
}

interface FieldInfo {
  shape: Shape
  /** Number of object samples that contained this key. */
  count: number
}

interface ObjShape {
  fields: Map<string, FieldInfo>
  samples: number
  /** Assigned during naming. */
  name?: string
  /** Name hint from the key that holds this object. */
  hint: string
}

interface ArrShape {
  el: Shape
  /** Number of non-empty arrays observed (0 → only empty arrays → unknown[]). */
  nonEmpty: number
}

const newShape = (): Shape => ({ prims: new Set() })

function observe(shape: Shape, v: unknown, hint: string) {
  if (v === null) shape.prims.add('null')
  else if (typeof v === 'string') shape.prims.add('string')
  else if (typeof v === 'number') shape.prims.add('number')
  else if (typeof v === 'boolean') shape.prims.add('boolean')
  else if (isLosslessNumber(v)) {
    // Only integers beyond the safe range are "big"; long decimals are ordinary numbers.
    shape.prims.add(/^-?\d+$/.test((v as { value: string }).value) ? 'big' : 'number')
  } else if (Array.isArray(v)) {
    shape.arr ??= { el: newShape(), nonEmpty: 0 }
    if (v.length) shape.arr.nonEmpty++
    for (const x of v) observe(shape.arr.el, x, hint)
  } else if (typeof v === 'object') {
    shape.obj ??= { fields: new Map(), samples: 0, hint }
    const o = shape.obj
    o.samples++
    for (const k of Object.keys(v as object)) {
      let f = o.fields.get(k)
      if (!f) o.fields.set(k, (f = { shape: newShape(), count: 0 }))
      f.count++
      observe(f.shape, (v as Record<string, unknown>)[k], k)
    }
  }
}

// ── Naming ──────────────────────────────────────────────────────────────────

const IRREGULAR: Record<string, string> = {
  people: 'person', children: 'child', men: 'man', women: 'woman', mice: 'mouse', geese: 'goose', teeth: 'tooth', feet: 'foot',
  criteria: 'criterion', phenomena: 'phenomenon', indices: 'index', matrices: 'matrix', vertices: 'vertex', appendices: 'appendix',
  analyses: 'analysis', theses: 'thesis', crises: 'crisis', diagnoses: 'diagnosis', axes: 'axis',
  leaves: 'leaf', knives: 'knife', lives: 'life', wives: 'wife', wolves: 'wolf', halves: 'half', shelves: 'shelf', selves: 'self', thieves: 'thief', loaves: 'loaf',
  movies: 'movie', cookies: 'cookie', zombies: 'zombie', ties: 'tie', pies: 'pie', lies: 'lie', species: 'species', series: 'series',
  shoes: 'shoe', toes: 'toe', canoes: 'canoe', oboes: 'oboe', quizzes: 'quiz', buses: 'bus', aliases: 'alias', statuses: 'status',
  viruses: 'virus', campuses: 'campus', bonuses: 'bonus', lenses: 'lens', gases: 'gas', octopi: 'octopus', cacti: 'cactus',
  radii: 'radius', alumni: 'alumnus', databases: 'database', responses: 'response', courses: 'course', horses: 'horse',
  houses: 'house', purchases: 'purchase', releases: 'release', licenses: 'license', cases: 'case', bases: 'base', phases: 'phase',
  ...{ caches: 'cache', niches: 'niche', avalanches: 'avalanche', moustaches: 'moustache', headaches: 'headache' },
}

/** Words that are their own plural (or mass nouns) — array items get an "Item" suffix instead. */
const UNCOUNTABLE = new Set(['data', 'info', 'information', 'metadata', 'news', 'equipment', 'sheep', 'fish', 'deer', 'media', 'feedback', 'software', 'hardware', 'staff', 'traffic', 'content', 'evidence', 'luggage', 'advice', 'audio', 'music', 'money', 'rice', 'series', 'species'])

/**
 * Singular form of an English plural noun (lowercase in, lowercase out).
 * Returns the word unchanged when it does not look plural.
 */
export function singularize(word: string): string {
  const w = word.toLowerCase()
  if (!w) return word
  if (UNCOUNTABLE.has(w)) return word
  if (IRREGULAR[w]) return matchCase(word, IRREGULAR[w])
  if (/(ss|us|is|os)$/.test(w) && !/(ies|oes)$/.test(w)) return word
  let s: string | null = null
  if (/[^aeiou]ies$/.test(w) && w.length > 4) s = w.slice(0, -3) + 'y'
  else if (/(ss|x|z|ch|sh)es$/.test(w)) s = w.slice(0, -2)
  else if (/[^aeiou]oes$/.test(w)) s = w.slice(0, -2)
  else if (/s$/.test(w) && w.length > 1) s = w.slice(0, -1)
  return s === null ? word : matchCase(word, s)
}

function matchCase(original: string, lower: string): string {
  if (original === original.toUpperCase() && original !== original.toLowerCase()) return lower.toUpperCase()
  if (original[0] && original[0] === original[0].toUpperCase()) return lower[0].toUpperCase() + lower.slice(1)
  return lower
}

function pascal(key: string): string {
  return convertCase(key, 'pascal').replace(/[^\p{L}\p{N}_$]/gu, '')
}

/** Makes a PascalCase candidate a valid, non-clashing identifier. */
function fixTypeName(n: string, fallback: string): string {
  if (!n) n = fallback
  if (/^\p{N}/u.test(n)) n = fallback + n
  if (RESERVED_TYPE_NAMES.has(n)) n = n + fallback
  return n
}

/** PascalCase type name from an arbitrary key; always a valid identifier. */
export function typeNameFromKey(key: string, fallback = 'Type'): string {
  return fixTypeName(pascal(key), fallback)
}

const RESERVED_TYPE_NAMES = new Set(['String', 'Number', 'Boolean', 'Object', 'Array', 'Date', 'Function', 'Symbol', 'Promise', 'Record', 'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'Map', 'Set', 'Error', 'JSON', 'Math', 'Any', 'Unknown', 'Never', 'Null', 'Undefined', 'Void', 'BigInt'])

/** Singular PascalCase name for the items of an array held under `key`. */
export function itemTypeName(key: string): string {
  const base = pascal(key)
  // Singularize only the last word: UserAccounts → UserAccount.
  const m = base.match(/^(.*?)(\p{Lu}\P{Lu}*|\P{Lu}+)$/u)
  const head = m ? m[1] : ''
  const last = m ? m[2] : base
  const single = singularize(last)
  if (single !== last && single) return fixTypeName(head + single[0].toUpperCase() + single.slice(1), 'Type')
  return fixTypeName(base ? base + 'Item' : '', 'Item')
}

// ── Options ─────────────────────────────────────────────────────────────────

export interface TsOptions {
  rootName?: string
  declaration?: 'interface' | 'type'
  export?: boolean
  readonly?: boolean
  /** How a key that is sometimes null is typed: `T | null` (union) or `key?: T` (optional). */
  nulls?: 'union' | 'optional'
  propertyNames?: 'keep' | 'camel'
  /** Reuse one declaration for structurally identical object types. */
  dedupe?: boolean
  /** Integers beyond Number.MAX_SAFE_INTEGER. */
  bigNumbers?: 'number' | 'string-number' | 'bigint'
  /** Use `T[]` (default) or `Array<T>`. */
  arraySyntax?: 'brackets' | 'generic'
}

const DEFAULTS: Required<TsOptions> = {
  rootName: 'Root',
  declaration: 'interface',
  export: true,
  readonly: false,
  nulls: 'union',
  propertyNames: 'keep',
  dedupe: true,
  bigNumbers: 'number',
  arraySyntax: 'brackets',
}

interface Model {
  root: Shape
  /** Object shapes in emission order (root-first, breadth-first). */
  objects: ObjShape[]
  /** For root arrays/primitives: the alias that names the root. */
  rootAlias: string | null
  rootObj: ObjShape | null
}

/** Structural signature of a shape (names of nested objects don't matter, structure does). */
function signature(s: Shape, memo: Map<ObjShape, string>, o: Required<TsOptions>): string {
  const parts: string[] = [...s.prims].sort()
  if (s.arr) parts.push(`[${s.arr.nonEmpty ? signature(s.arr.el, memo, o) : '?'}]`)
  if (s.obj) parts.push(objSignature(s.obj, memo, o))
  return parts.join('|')
}

function objSignature(obj: ObjShape, memo: Map<ObjShape, string>, o: Required<TsOptions>): string {
  let sig = memo.get(obj)
  if (sig) return sig
  sig = '{' + [...obj.fields].map(([k, f]) => `${JSON.stringify(k)}${f.count < obj.samples ? '?' : ''}:${signature(f.shape, memo, o)}`).join(',') + '}'
  memo.set(obj, sig)
  return sig
}

function buildModel(value: unknown, o: Required<TsOptions>): Model {
  const root = newShape()
  observe(root, value, o.rootName)
  const rootName = typeNameFromKey(o.rootName, 'Root')
  const used = new Set<string>()
  const bySig = new Map<string, string>()
  const memo = new Map<ObjShape, string>()
  const objects: ObjShape[] = []

  const claim = (want: string, parent: string | null): string => {
    if (!used.has(want)) return want
    if (parent && !used.has(parent + want)) return parent + want
    let i = 2
    while (used.has(`${want}${i}`)) i++
    return `${want}${i}`
  }

  // Breadth-first so that top-level types claim the nicest names.
  const queue: { shape: Shape; name: string; parent: string | null }[] = []
  let rootAlias: string | null = null
  let rootObj: ObjShape | null = null
  const isPureObject = root.obj && !root.arr && root.prims.size === 0
  if (isPureObject) {
    rootObj = root.obj!
    queue.push({ shape: root, name: rootName, parent: null })
  } else {
    // Arrays / primitives / mixed roots get a type alias named after the root.
    rootAlias = rootName
    used.add(rootName)
    if (root.obj) queue.push({ shape: { prims: new Set(), obj: root.obj }, name: rootName + 'Object', parent: null })
  }
  if (!isPureObject && root.arr) enqueueArray(root.arr, itemNameForRoot(rootName), null)

  while (queue.length) {
    const { shape, name, parent } = queue.shift()!
    if (!shape.obj || shape.obj.name) continue
    const sig = o.dedupe ? objSignature(shape.obj, memo, o) : ''
    const existing = o.dedupe ? bySig.get(sig) : undefined
    if (existing) {
      shape.obj.name = existing
      continue
    }
    const n = claim(name, parent)
    used.add(n)
    shape.obj.name = n
    if (o.dedupe) bySig.set(sig, n)
    objects.push(shape.obj)
    for (const [k, f] of shape.obj.fields) enqueueChildren(f.shape, k, n)
  }

  function enqueueChildren(s: Shape, key: string, parent: string) {
    if (s.obj) queue.push({ shape: { prims: new Set(), obj: s.obj }, name: typeNameFromKey(key), parent })
    if (s.arr) enqueueArray(s.arr, key, parent, true)
  }
  function enqueueArray(a: ArrShape, key: string, parent: string | null, fromKey = false) {
    const itemName = fromKey ? itemTypeName(key) : key
    if (a.el.obj) queue.push({ shape: { prims: new Set(), obj: a.el.obj }, name: itemName, parent })
    if (a.el.arr) enqueueArray(a.el.arr, itemName, parent)
  }

  return { root, objects, rootAlias, rootObj }
}

function itemNameForRoot(rootName: string): string {
  const n = itemTypeName(rootName)
  return n === rootName ? rootName + 'Item' : n
}

// ── TypeScript emission ─────────────────────────────────────────────────────

function primTs(p: Prim, o: Required<TsOptions>): string {
  if (p === 'big') return o.bigNumbers === 'bigint' ? 'bigint' : o.bigNumbers === 'string-number' ? 'string | number' : 'number'
  return p
}

const PRIM_ORDER: Prim[] = ['string', 'number', 'big', 'boolean']

function typeExpr(s: Shape, o: Required<TsOptions>, dropNull = false): string {
  const parts: string[] = []
  const prims = new Set(s.prims)
  // `number` already covers safe-range big numbers when typed as number.
  if (prims.has('big') && prims.has('number') && o.bigNumbers === 'number') prims.delete('big')
  for (const p of PRIM_ORDER) if (prims.has(p)) for (const t of primTs(p, o).split(' | ')) if (!parts.includes(t)) parts.push(t)
  if (s.obj) parts.push(s.obj.name!)
  if (s.arr) {
    const el = s.arr.nonEmpty && (s.arr.el.prims.size || s.arr.el.obj || s.arr.el.arr) ? typeExpr(s.arr.el, o) : 'unknown'
    if (o.arraySyntax === 'generic') parts.push(`Array<${el}>`)
    else parts.push(el.includes(' ') ? `(${el})[]` : `${el}[]`)
  }
  if (prims.has('null') && !dropNull) parts.push('null')
  if (!parts.length) return prims.has('null') ? 'null' : 'unknown'
  return parts.join(' | ')
}

function propertyName(key: string, o: Required<TsOptions>, taken: Set<string>): { name: string; renamed: boolean } {
  if (o.propertyNames === 'camel') {
    const c = convertCase(key, 'camel')
    if (c && c !== key && isIdentifier(c) && !taken.has(c)) return { name: c, renamed: true }
  }
  return { name: isIdentifier(key) ? key : JSON.stringify(key), renamed: false }
}

function hasBig(s: Shape): boolean {
  return s.prims.has('big') || (!!s.arr && hasBig(s.arr.el))
}

function emitObjectBody(obj: ObjShape, o: Required<TsOptions>, indent: string): string[] {
  const lines: string[] = []
  const taken = new Set<string>()
  // Keys that are already camelCase claim their names first so renames never collide with them.
  if (o.propertyNames === 'camel') for (const k of obj.fields.keys()) if (isIdentifier(k) && convertCase(k, 'camel') === k) taken.add(k)
  for (const [key, f] of obj.fields) {
    let optional = f.count < obj.samples
    const nullable = f.shape.prims.has('null')
    const onlyNull = nullable && f.shape.prims.size === 1 && !f.shape.obj && !f.shape.arr
    let dropNull = false
    if (o.nulls === 'optional' && nullable && !onlyNull) {
      optional = true
      dropNull = true
    }
    const { name, renamed } = propertyName(key, o, taken)
    taken.add(name)
    const docs: string[] = []
    if (renamed) docs.push(`Original key: ${JSON.stringify(key)}`)
    if (hasBig(f.shape)) {
      docs.push(
        o.bigNumbers === 'bigint'
          ? 'Integer beyond Number.MAX_SAFE_INTEGER — parse with a BigInt-aware JSON parser.'
          : o.bigNumbers === 'string-number'
            ? 'Integer beyond Number.MAX_SAFE_INTEGER — keep as a string to avoid precision loss.'
            : 'Integer beyond Number.MAX_SAFE_INTEGER — JSON.parse will lose precision.',
      )
    }
    if (docs.length === 1) lines.push(`${indent}/** ${docs[0]} */`)
    else if (docs.length > 1) lines.push(`${indent}/**`, ...docs.map((d) => `${indent} * ${d}`), `${indent} */`)
    lines.push(`${indent}${o.readonly ? 'readonly ' : ''}${name}${optional ? '?' : ''}: ${typeExpr(f.shape, o, dropNull)};`)
  }
  return lines
}

export interface GenerateResult {
  code: string
  /** Number of declarations emitted. */
  declarations: number
}

export function jsonToTypeScript(value: unknown, options: TsOptions = {}): GenerateResult {
  const o = { ...DEFAULTS, ...options }
  const model = buildModel(value, o)
  const exp = o.export ? 'export ' : ''
  const blocks: string[] = []
  if (model.rootAlias) blocks.push(`${exp}type ${model.rootAlias} = ${typeExpr(model.root, o)};`)
  for (const obj of model.objects) {
    const body = emitObjectBody(obj, o, '  ')
    if (o.declaration === 'interface') blocks.push(body.length ? `${exp}interface ${obj.name} {\n${body.join('\n')}\n}` : `${exp}interface ${obj.name} {}`)
    else blocks.push(body.length ? `${exp}type ${obj.name} = {\n${body.join('\n')}\n};` : `${exp}type ${obj.name} = Record<string, never>;`)
  }
  return { code: blocks.join('\n\n') + '\n', declarations: blocks.length }
}

// ── Zod emission ────────────────────────────────────────────────────────────

function primZod(p: Prim, o: Required<TsOptions>): string {
  switch (p) {
    case 'string':
      return 'z.string()'
    case 'number':
      return 'z.number()'
    case 'boolean':
      return 'z.boolean()'
    case 'null':
      return 'z.null()'
    case 'big':
      return o.bigNumbers === 'bigint' ? 'z.coerce.bigint()' : o.bigNumbers === 'string-number' ? 'z.union([z.string(), z.number()])' : 'z.number()'
  }
}

const schemaName = (typeName: string) => `${typeName[0].toLowerCase()}${typeName.slice(1)}Schema`

function zodExpr(s: Shape, o: Required<TsOptions>): string {
  const members: string[] = []
  const prims = new Set(s.prims)
  if (prims.has('big') && prims.has('number') && o.bigNumbers === 'number') prims.delete('big')
  for (const p of PRIM_ORDER) if (prims.has(p)) members.push(primZod(p, o))
  if (s.obj) members.push(schemaName(s.obj.name!))
  if (s.arr) {
    const el = s.arr.nonEmpty && (s.arr.el.prims.size || s.arr.el.obj || s.arr.el.arr) ? zodExpr(s.arr.el, o) : 'z.unknown()'
    members.push(`z.array(${el})`)
  }
  const nullable = prims.has('null')
  if (!members.length) return nullable ? 'z.null()' : 'z.unknown()'
  const base = members.length === 1 ? members[0] : `z.union([${members.join(', ')}])`
  return nullable ? `${base}.nullable()` : base
}

/** Zod (v3/v4-compatible API) schemas plus inferred types. Property names are always kept as-is. */
export function jsonToZod(value: unknown, options: TsOptions = {}): GenerateResult {
  const o = { ...DEFAULTS, ...options }
  const model = buildModel(value, o)
  const exp = o.export ? 'export ' : ''
  const blocks: string[] = ["import { z } from 'zod';"]
  // `const` schemas must be declared before use: emit dependencies first (post-order).
  for (const obj of dependencyOrder(model.objects)) {
    const lines: string[] = []
    for (const [key, f] of obj.fields) {
      let expr = zodExpr(f.shape, o)
      const optional = f.count < obj.samples
      const nullable = f.shape.prims.has('null')
      const onlyNull = nullable && f.shape.prims.size === 1 && !f.shape.obj && !f.shape.arr
      if (o.nulls === 'optional' && nullable && !onlyNull) expr = expr.replace(/\.nullable\(\)$/, '') + '.nullish()'
      else if (optional) expr += '.optional()'
      lines.push(`  ${isIdentifier(key) ? key : JSON.stringify(key)}: ${expr},`)
    }
    blocks.push(`${exp}const ${schemaName(obj.name!)} = z.object({\n${lines.join('\n')}\n});\n${exp}type ${obj.name} = z.infer<typeof ${schemaName(obj.name!)}>;`)
  }
  if (model.rootAlias) blocks.push(`${exp}const ${schemaName(model.rootAlias)} = ${zodExpr(model.root, o)};\n${exp}type ${model.rootAlias} = z.infer<typeof ${schemaName(model.rootAlias)}>;`)
  return { code: blocks.join('\n\n') + '\n', declarations: blocks.length - 1 }
}

/** Object shapes ordered so that every object comes after the objects it references. */
function dependencyOrder(objects: ObjShape[]): ObjShape[] {
  const byName = new Map(objects.map((o) => [o.name!, o]))
  const out: ObjShape[] = []
  const state = new Map<ObjShape, 1 | 2>()
  const refs = (s: Shape, acc: ObjShape[]) => {
    if (s.obj) {
      const target = byName.get(s.obj.name!)
      if (target) acc.push(target)
    }
    if (s.arr) refs(s.arr.el, acc)
  }
  const visit = (o: ObjShape) => {
    if (state.get(o)) return
    state.set(o, 1)
    const deps: ObjShape[] = []
    for (const f of o.fields.values()) refs(f.shape, deps)
    for (const d of deps) visit(d)
    state.set(o, 2)
    out.push(o)
  }
  for (const o of objects) visit(o)
  return out
}
