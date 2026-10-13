import { CornerDownRight } from 'lucide-react'
import { NODE_TYPE_NAMES, pathOf, subtreeToJson, type TreeIndex } from '@/engines/json-tools/tree'
import { toJsonPath, toJsonPointer, toJsPath } from '@/engines/json-tools/paths'
import { CopyButton } from '@/components/common/CopyButton'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/utils/format'
import { TypeBadge } from './values'

/** Bottom inspector for the selected node: its path in three notations plus copy actions. */
export function NodeDetails({ tree, node, onReveal }: { tree: TreeIndex; node: number; onReveal?: () => void }) {
  const segs = pathOf(tree, node)
  const paths = [
    { label: 'JSONPath', value: toJsonPath(segs) },
    { label: 'JS', value: toJsPath(segs) },
    { label: 'Pointer', value: toJsonPointer(segs) || '""' },
  ]
  const type = NODE_TYPE_NAMES[tree.type[node]]
  const isKey = node > 0 && !tree.isIndex[node]
  const subtree = tree.end[node] - node
  return (
    <div className="shrink-0 border-t border-border bg-bg/60 px-3 py-2" aria-label="Selected node">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex min-w-0 flex-1 basis-56 items-center gap-2">
          <TypeBadge type={type} />
          <span className="mono min-w-0 truncate text-xs text-fg">{node === 0 ? '(root)' : tree.keys[node]}</span>
          {subtree > 1 && <span className="shrink-0 text-2xs text-subtle tabular">{formatNumber(subtree - 1)} descendants</span>}
        </span>
        <span className="-mr-1 ml-auto flex shrink-0 items-center gap-0.5">
          {onReveal && (
            <Button size="xs" variant="ghost" onClick={onReveal}>
              <CornerDownRight /> Reveal in editor
            </Button>
          )}
          <CopyButton size="xs" showLabel label="Copy value" value={() => subtreeToJson(tree, node, 2)} />
          {isKey && <CopyButton size="xs" showLabel label="Copy key" value={tree.keys[node]} />}
        </span>
      </div>
      <dl className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-x-2">
        {paths.map((p) => (
          <div key={p.label} className="contents">
            <dt className="text-2xs text-subtle">{p.label}</dt>
            <dd className="mono truncate text-xs text-muted" title={p.value}>
              {p.value}
            </dd>
            <CopyButton size="icon-xs" label={`Copy ${p.label}`} value={p.value === '""' ? '' : p.value} />
          </div>
        ))}
      </dl>
    </div>
  )
}
