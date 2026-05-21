import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { DashboardPage } from './pages/DashboardPage'
import { SourcesPage } from './pages/SourcesPage'
import { WorkflowBuilderPage } from './pages/WorkflowBuilderPage'
import { LiveViewPage } from './pages/LiveViewPage'
import { EventsPage } from './pages/EventsPage'
import { ModelsPage } from './pages/ModelsPage'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="/workflows" element={<WorkflowBuilderPage />} />
          <Route path="/live" element={<LiveViewPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/models" element={<ModelsPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
