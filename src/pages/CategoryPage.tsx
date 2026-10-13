import type { Category } from '@/registry'
import { toolsInCategory } from '@/registry'
import { ToolRow } from '@/components/common/ToolCard'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'

export function CategoryPage({ category }: { category: Category }) {
  useDocumentMeta(category.name, category.description)
  const list = toolsInCategory(category.id)
  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 pt-8 md:px-8">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted">
          <category.Icon className="size-[18px]" />
        </div>
        <div>
          <h1 className="text-[24px] font-semibold leading-8 tracking-[-0.02em]">{category.name}</h1>
          <p className="text-sm text-muted">{category.description}</p>
        </div>
      </div>
      <p className="mb-2 mt-7 text-xs text-subtle">{list.length} tools</p>
      <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 rounded-lg border border-border bg-workspace p-2 md:grid-cols-2">
        {list.map((t) => (
          <ToolRow key={t.id} tool={t} meta={t.category !== category.id ? 'also listed here' : undefined} />
        ))}
      </div>
    </div>
  )
}
