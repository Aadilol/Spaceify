import { Component, lazy, StrictMode, Suspense } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, AlertCircle } from 'lucide-react'
import './styles.css'

const App = lazy(() => import('./ui/App.tsx'))

function Startup({ failed = false }: { failed?: boolean }) {
  return (
    <main className="map-window startup">
      <div role={failed ? 'alert' : 'status'}>
        {failed ? <AlertCircle size={29} /> : <Activity size={29} />}
        <h2>{failed ? 'The map couldn’t load' : 'Loading listening map'}</h2>
        {failed && <button className="retry" type="button" onClick={() => window.location.reload()}>Reload map</button>}
      </div>
    </main>
  )
}

class StartupBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  render() { return this.state.failed ? <Startup failed /> : this.props.children }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StartupBoundary>
      <Suspense fallback={<Startup />}><App /></Suspense>
    </StartupBoundary>
  </StrictMode>,
)
