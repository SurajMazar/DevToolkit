import { BrowserRouter } from 'react-router'
import { Toaster } from 'sonner'
import { AppRoutes } from './router/AppRoutes'
import { ThemeSync } from './providers/ThemeProvider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PwaPrompt } from '@/components/layout/PwaPrompt'
import { useResolvedTheme } from '@/hooks/useResolvedTheme'

export function App() {
  const theme = useResolvedTheme()
  return (
    <BrowserRouter>
      <TooltipProvider delayDuration={350} skipDelayDuration={150}>
        <ThemeSync />
        <AppRoutes />
        <Toaster
          theme={theme}
          position="bottom-right"
          offset={16}
          toastOptions={{
            classNames: {
              toast: '!rounded-lg !border !border-border-strong !bg-raised !text-fg !shadow-pop !text-sm !font-sans',
              description: '!text-muted',
              actionButton: '!bg-accent !text-accent-fg',
              cancelButton: '!bg-surface-2 !text-fg',
            },
          }}
        />
        {import.meta.env.PROD && <PwaPrompt />}
      </TooltipProvider>
    </BrowserRouter>
  )
}
