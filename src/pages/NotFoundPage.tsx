import { Link } from 'react-router'
import { Compass } from 'lucide-react'
import { EmptyState } from '@/components/tools/EmptyState'
import { Button } from '@/components/ui/button'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { useUI } from '@/stores/ui'

export function NotFoundPage() {
  useDocumentMeta('Not found')
  const open = useUI((s) => s.setPaletteOpen)
  return (
    <EmptyState
      icon={<Compass />}
      title="There's no tool at this address"
      description="The link may be outdated. Search for the tool you need instead."
      actions={
        <>
          <Button variant="primary" onClick={() => open(true)}>Search tools</Button>
          <Button asChild variant="ghost">
            <Link to="/">Go home</Link>
          </Button>
        </>
      }
    />
  )
}
