import { ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

export function LocalBadge({ children = 'Generated locally' }: { children?: React.ReactNode }) {
  return (
    <Badge tone="neutral">
      <ShieldCheck className="size-3" /> {children}
    </Badge>
  )
}
