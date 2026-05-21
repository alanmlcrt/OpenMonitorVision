import { useEffect, useState } from 'react'
import { eventsApi } from '../api/events'
import type { Event } from '../types'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'

const LIMIT = 50

export function EventsPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [page, setPage] = useState(0)
  const [classFilter, setClassFilter] = useState('')

  const load = () =>
    eventsApi.list({ limit: LIMIT, offset: page * LIMIT, class_name: classFilter || undefined })
      .then(setEvents)
      .catch(() => {})

  useEffect(() => { load() }, [page, classFilter])

  const remove = async (id: number) => {
    await eventsApi.delete(id)
    load()
  }

  const exportCsv = () => {
    const rows = [
      ['ID', 'Timestamp', 'Class', 'Confidence', 'Source ID', 'Zone', 'Tracker ID'],
      ...events.map((e) => [
        e.id,
        e.timestamp,
        e.class_name,
        e.confidence != null ? e.confidence.toFixed(3) : '',
        e.source_id ?? '',
        e.zone_name ?? '',
        e.tracker_id ?? '',
      ]),
    ]
    const csv = rows.map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `events_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const fmt = (ts: string) => {
    const d = new Date(ts)
    return d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' })
  }

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Events</h1>
          <p className="text-sm text-text-secondary mt-0.5">Detection history</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={classFilter}
            onChange={(e) => { setClassFilter(e.target.value); setPage(0) }}
            placeholder="Filter by class..."
            className="w-44"
          />
          <Button variant="secondary" size="sm" onClick={exportCsv}>
            Export CSV
          </Button>
        </div>
      </div>

      <Card padding="none">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border-subtle">
              {['Time', 'Class', 'Confidence', 'Source', 'Zone', 'Tracker', ''].map((h) => (
                <th
                  key={h}
                  className="px-5 py-2.5 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-sm text-text-tertiary">
                  {classFilter ? `No events matching "${classFilter}"` : 'No events recorded'}
                </td>
              </tr>
            )}
            {events.map((e, i) => (
              <tr
                key={e.id}
                className={[
                  'group transition-colors hover:bg-bg-overlay',
                  i < events.length - 1 ? 'border-b border-border-subtle' : '',
                ].join(' ')}
              >
                <td className="px-5 py-2.5 text-xs font-mono text-text-secondary whitespace-nowrap">
                  {fmt(e.timestamp)}
                </td>
                <td className="px-5 py-2.5">
                  <Badge variant="accent">{e.class_name}</Badge>
                </td>
                <td className="px-5 py-2.5 text-sm text-text-secondary">
                  {e.confidence != null
                    ? <span className="font-mono">{(e.confidence * 100).toFixed(1)}%</span>
                    : <span className="text-text-tertiary">—</span>
                  }
                </td>
                <td className="px-5 py-2.5 text-sm text-text-tertiary">
                  {e.source_id ?? <span className="text-text-disabled">—</span>}
                </td>
                <td className="px-5 py-2.5 text-sm text-text-tertiary">
                  {e.zone_name ?? <span className="text-text-disabled">—</span>}
                </td>
                <td className="px-5 py-2.5 text-sm font-mono text-text-tertiary">
                  {e.tracker_id != null ? `#${e.tracker_id}` : <span className="text-text-disabled">—</span>}
                </td>
                <td className="px-3 py-2.5">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => remove(e.id)}
                    className="opacity-0 group-hover:opacity-100"
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {(events.length > 0 || page > 0) && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border-subtle">
            <p className="text-xs text-text-tertiary">
              Showing {page * LIMIT + 1}–{page * LIMIT + events.length}
            </p>
            <div className="flex gap-1">
              <Button
                size="xs"
                variant="secondary"
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
              >
                Previous
              </Button>
              <Button
                size="xs"
                variant="secondary"
                onClick={() => setPage(page + 1)}
                disabled={events.length < LIMIT}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
