import { expose } from '@/workers/rpc'
import { findMatches, replaceAll } from './core'

export const regexTasks = {
  ping: () => true,
  match: (p: { pattern: string; flags: string; text: string; cap?: number }) => findMatches(p.pattern, p.flags, p.text, p.cap),
  replace: (p: { pattern: string; flags: string; text: string; replacement: string }) => replaceAll(p.pattern, p.flags, p.text, p.replacement),
}
export type RegexTasks = typeof regexTasks

expose(regexTasks)
