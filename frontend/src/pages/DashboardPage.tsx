import { useEffect, useState } from 'react'
import { eventsApi } from '../api/events'
import { sourcesApi } from '../api/sources'
import { workflowsApi } from '../api/workflows'
import type { EventStats, Source, Workflow } from '../types'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Stat } from '../components/ui/Stat'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

export function DashboardPage() {
  const [stats, setStats] = useState<EventStats | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [workflows, setWorkflows] = useState<Workflow[]>([])

  useEffect(() => {
    eventsApi.stats().then(setStats).catch(() => {})
    sourcesApi.list().then(setSources).catch(() => {})
    workflowsApi.list().then(setWorkflows).catch(() => {})
  }, [])

  const classData = stats
    ? Object.entries(stats.by_class)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, count]) => ({ name, count }))
    : []

  const hourData = Array.from({ length: 24 }, (_, h) => ({
    hour: `${h}`,
    count: stats?.by_hour[String(h).padStart(2, '0')] ?? 0,
  }))

  const activeSources   = sources.filter((s) => s.enabled).length
  const runningWorkflows = workflows.filter((w) => w.enabled).length

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      {/* Page header */}
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Overview</h1>
        <p className="text-sm text-text-secondary mt-0.5">Platform status and detection summary</p>
      </div>

      {/* KPI row */}
      <Card>
        <div className="grid grid-cols-4 divide-x divide-border-subtle">
          <div className="px-5 py-4">
            <Stat label="Total events" value={stats?.total ?? '—'} />
          </div>
          <div className="px-5 py-4">
            <Stat
              label="Sources"
              value={sources.length}
              sub={`${activeSources} active`}
            />
          </div>
          <div className="px-5 py-4">
            <Stat
              label="Workflows"
              value={workflows.length}
              sub={`${runningWorkflows} running`}
            />
          </div>
          <div className="px-5 py-4">
            <Stat
              label="Classes detected"
              value={Object.keys(stats?.by_class ?? {}).length}
            />
          </div>
        </div>
      </Card>

      {/* Charts */}
      <div className="grid grid-cols-5 gap-4">
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Events by hour</CardTitle>
          </CardHeader>
          {hourData.some((d) => d.count > 0) ? (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={hourData} barCategoryGap="25%">
                <XAxis
                  dataKey="hour"
                  tick={{ fill: '#55556e', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  interval={2}
                />
                <YAxis
                  tick={{ fill: '#55556e', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip
                  cursor={{ fill: '#1a1a24' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    return (
                      <div className="bg-bg-overlay border border-border rounded px-3 py-2 text-xs shadow-dropdown">
                        <p className="text-text-secondary">{payload[0].payload.hour}h00</p>
                        <p className="text-text-primary font-medium mt-0.5">{payload[0].value} events</p>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="count" fill="#5c6bc0" radius={[2, 2, 0, 0]}>
                  {hourData.map((_, i) => (
                    <Cell key={i} fill={hourData[i].count > 0 ? '#5c6bc0' : '#1a1a24'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-40 flex items-center justify-center">
              <p className="text-sm text-text-tertiary">No event data</p>
            </div>
          )}
        </Card>

        <Card className="col-span-2">
          <CardHeader>
            <CardTitle>By class</CardTitle>
          </CardHeader>
          {classData.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={classData} layout="vertical" barCategoryGap="20%">
                <XAxis type="number" tick={{ fill: '#55556e', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: '#8888a8', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />
                <Tooltip
                  cursor={{ fill: '#1a1a24' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    return (
                      <div className="bg-bg-overlay border border-border rounded px-3 py-2 text-xs shadow-dropdown">
                        <p className="text-text-primary font-medium">{payload[0].payload.name}</p>
                        <p className="text-text-secondary mt-0.5">{payload[0].value} events</p>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="count" fill="#5c6bc0" radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-40 flex items-center justify-center">
              <p className="text-sm text-text-tertiary">No detections yet</p>
            </div>
          )}
        </Card>
      </div>

      {/* Sources table */}
      <div className="grid grid-cols-2 gap-4">
        <Card padding="none">
          <div className="px-5 py-3 border-b border-border-subtle">
            <h3 className="text-sm font-medium text-text-primary">Sources</h3>
          </div>
          {sources.length === 0 ? (
            <div className="px-5 py-6 text-sm text-text-tertiary">No sources configured</div>
          ) : (
            <table className="w-full">
              <tbody>
                {sources.map((s, i) => (
                  <tr
                    key={s.id}
                    className={i < sources.length - 1 ? 'border-b border-border-subtle' : ''}
                  >
                    <td className="px-5 py-3">
                      <p className="text-sm text-text-primary">{s.name}</p>
                      <p className="text-xs text-text-tertiary mt-0.5 font-mono">{s.uri}</p>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Badge variant={s.enabled ? 'success' : 'neutral'} dot>
                        {s.enabled ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card padding="none">
          <div className="px-5 py-3 border-b border-border-subtle">
            <h3 className="text-sm font-medium text-text-primary">Workflows</h3>
          </div>
          {workflows.length === 0 ? (
            <div className="px-5 py-6 text-sm text-text-tertiary">No workflows configured</div>
          ) : (
            <table className="w-full">
              <tbody>
                {workflows.map((w, i) => (
                  <tr
                    key={w.id}
                    className={i < workflows.length - 1 ? 'border-b border-border-subtle' : ''}
                  >
                    <td className="px-5 py-3">
                      <p className="text-sm text-text-primary">{w.name}</p>
                      <p className="text-xs text-text-tertiary mt-0.5">
                        {w.nodes?.length ?? 0} nodes
                      </p>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Badge variant={w.enabled ? 'success' : 'neutral'} dot>
                        {w.enabled ? 'Running' : 'Stopped'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  )
}
