/**
 * Tailwind arbitrary values: `utility-[value]`. Inside the brackets spaces must be written
 * as `_`, and literal underscores escaped as `\_` (Tailwind v3.3+ / v4).
 */
export function tailwindArbitrary(utility: string, value: string): string {
  const v = value
    .trim()
    .replace(/_/g, '\\_')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, '_')
  return `${utility}-[${v}]`
}

/** Tailwind arbitrary property: `[property:value]` — for properties without a utility. */
export function tailwindArbitraryProperty(property: string, value: string): string {
  return `[${property}:${tailwindArbitrary('x', value).slice(3, -1)}]`
}
