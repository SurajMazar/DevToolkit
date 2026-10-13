import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Wrench } from 'lucide-react'
import { CATEGORIES, TOOLS, type CategoryId, type CategoryMeta, type ToolMeta } from './tools.data'
import { ICONS } from './icons'

export type { CategoryId, CategoryMeta, ToolMeta }

export interface Tool extends ToolMeta {
  Icon: LucideIcon
  Component: LazyExoticComponent<ComponentType>
  load: () => Promise<unknown>
}

export interface Category extends CategoryMeta {
  Icon: LucideIcon
}

// Each tool is a separate dynamic import → its own chunk. Loading one tool never
// downloads the rest of the platform.
const modules = import.meta.glob<{ default: ComponentType }>('../tools/*/*/index.tsx')

export const tools: Tool[] = TOOLS.flatMap((meta) => {
  const loader = modules[`../tools/${meta.module}/index.tsx`]
  if (!loader) return []
  return [{ ...meta, Icon: ICONS[meta.icon] ?? Wrench, Component: lazy(loader), load: loader }]
})

export const toolMap = new Map(tools.map((t) => [t.id, t]))

export const categories: Category[] = CATEGORIES.map((c) => ({ ...c, Icon: ICONS[c.icon] ?? Wrench }))
export const categoryMap = new Map(categories.map((c) => [c.id, c]))

export function toolsInCategory(id: CategoryId): Tool[] {
  return tools.filter((t) => t.category === id || t.alsoIn?.includes(id))
}

export function getTool(id: string): Tool | undefined {
  return toolMap.get(id)
}
