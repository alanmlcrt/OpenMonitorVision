import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'

// Pages are loaded on first visit only so ReactFlow/Recharts stay out of the initial shell.
const DashboardPage       = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })))
const SourcesPage         = lazy(() => import('./pages/SourcesPage').then(m => ({ default: m.SourcesPage })))
const WorkflowBuilderPage = lazy(() => import('./pages/WorkflowBuilderPage').then(m => ({ default: m.WorkflowBuilderPage })))
const LiveViewPage        = lazy(() => import('./pages/LiveViewPage').then(m => ({ default: m.LiveViewPage })))
const EventsPage          = lazy(() => import('./pages/EventsPage').then(m => ({ default: m.EventsPage })))
const ModelsPage          = lazy(() => import('./pages/ModelsPage').then(m => ({ default: m.ModelsPage })))
const TrainingPage        = lazy(() => import('./pages/TrainingPage').then(m => ({ default: m.TrainingPage })))
const SatellitePage       = lazy(() => import('./pages/SatellitePage').then(m => ({ default: m.SatellitePage })))

function PageFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex items-center gap-2.5 text-text-tertiary">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        <span className="text-sm">Loading…</span>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/sources" element={<SourcesPage />} />
            <Route path="/workflows" element={<WorkflowBuilderPage />} />
            <Route path="/live" element={<LiveViewPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/training" element={<TrainingPage />} />
            <Route path="/satellite" element={<SatellitePage />} />
          </Routes>
        </Suspense>
      </Layout>
    </BrowserRouter>
  )
}
