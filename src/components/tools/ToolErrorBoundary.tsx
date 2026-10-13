import { Component, type ReactNode } from 'react'
import { RotateCcw, Bug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from './EmptyState'

interface State {
  error: Error | null
}

export class ToolErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    const chunkError = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
      this.state.error.message,
    )
    return (
      <EmptyState
        icon={<Bug />}
        title={chunkError ? 'This tool could not be loaded' : 'This tool hit an unexpected error'}
        description={
          chunkError
            ? 'You may be offline before the app finished caching, or a new version was deployed. Reload to try again.'
            : this.state.error.message
        }
        actions={
          <>
            <Button onClick={() => this.setState({ error: null })}>
              <RotateCcw /> Try again
            </Button>
            <Button variant="ghost" onClick={() => location.reload()}>
              Reload page
            </Button>
          </>
        }
      />
    )
  }
}
