import { jsonTypeOf } from './parse'

export interface JsonShapeStats {
  objects: number
  arrays: number
  strings: number
  numbers: number
  booleans: number
  nulls: number
  keys: number
  maxDepth: number
}

/** Counts node types and depth iteratively (no recursion limits on deep documents). */
export function analyzeJson(value: unknown): JsonShapeStats {
  const s: JsonShapeStats = { objects: 0, arrays: 0, strings: 0, numbers: 0, booleans: 0, nulls: 0, keys: 0, maxDepth: 0 }
  const stack: [unknown, number][] = [[value, 1]]
  while (stack.length) {
    const [v, d] = stack.pop()!
    if (d > s.maxDepth) s.maxDepth = d
    switch (jsonTypeOf(v)) {
      case 'object': {
        s.objects++
        const vals = Object.values(v as object)
        s.keys += vals.length
        for (const x of vals) stack.push([x, d + 1])
        break
      }
      case 'array':
        s.arrays++
        for (const x of v as unknown[]) stack.push([x, d + 1])
        break
      case 'string':
        s.strings++
        break
      case 'number':
        s.numbers++
        break
      case 'boolean':
        s.booleans++
        break
      default:
        s.nulls++
    }
  }
  return s
}
