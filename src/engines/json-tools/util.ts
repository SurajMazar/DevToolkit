/**
 * Assigns an own property, including the key "__proto__" (which plain assignment would turn
 * into a prototype change — losing the key and, on shared objects, polluting prototypes).
 */
export function setKey(obj: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true })
  else obj[key] = value
}

/** Own-property read (never walks the prototype chain). */
export function getOwn(obj: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined
}
