import { createContext, useContext } from 'react'
import type { ToolMeta } from '@/registry/tools.data'

export interface ToolContextValue {
  tool: ToolMeta
}

export const ToolContext = createContext<ToolContextValue | null>(null)

export function useToolContext(): ToolContextValue {
  const ctx = useContext(ToolContext)
  if (!ctx) throw new Error('useToolContext must be used inside a tool page')
  return ctx
}
