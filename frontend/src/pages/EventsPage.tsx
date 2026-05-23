import { useEffect, useMemo, useState } from 'react'
import { eventsApi } from '../api/events'
import { sourcesApi } from '../api/sources'
import { workflowsApi } from '../api/workflows'
import type { Event, Source, Workflow } from '../types'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Input, Select } from '../components/ui/Input'

const LIMIT = 50

interface Filters {
  class_name: string
  source_id: number | ''
  workflow_id: number | ''
  min_confidence: number | ''
  since: string  // datetime-local format (yyyy-MM-ddTHH:mm)
  until: string
}

const EMPTY_FILTERS: Filters = {
  class_name: '',
  source_id: '',
  workflow_id: '',
  min_confidence: '',
  since: '',
  until: '',
}

function localDateToIso(value: string): string | undefined {
  if (!value) return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function fmt(ts: string): string {
  return new Date(ts).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' })
}

export function EventsPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [page, setPage] = useState(0)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [selected, setSelected] = useState<Event | null>(null)

  const load = () =>
    eventsApi.list({
      limit: LIMIT,
      offset: page * LIMIT,
      class_name: filters.class_name || undefined,
      source_id: filters.source_id === '' ? undefined : Number(filters.source_id),
      workflow_id: filters.workflow_id === '' ? undefined : Number(filters.workflow_id),
      min_confidence: filters.min_confidence === '' ? undefined : Number(filters.min_confidence),
      since: localDateToIso(filters.since),
      until: localDateToIso(filters.until),
    }).then(setEvents).catch(() => {})

  useEffect(() => { load() }, [page, filters])
  useEffect(() => {
    sourcesApi.list().then(setSources).catch(() => {})
    workflowsApi.list().then(setWorkflows).catch(() => {})
  }, [])

  const sourceMap = useMemo(() => new Map(sources.map((s) => [s.id, s.name])), [sources])
  const workflowMap = useMemo(() => new Map(workflows.map((w) => [w.id, w.name])), [workflows])

  const activeFilterCount = useMemo(() =>
    Object.values(filters).filter((v) => v !== '' && v !== undefined).length,
    [filters],
  )

  const reset = () => { setFilters(EMPTY_FILTERS); setPage(0) }

  const remove = async (id: number) => {
    await eventsApi.delete(id)
    if (selected?.id === id) setSelected(null)
    load()
  }

  const clearAll = async () => {
    if (!confirm('Delete all events matching the current filters? This cannot be undone.')) return
    await eventsApi.clearAll({
      source_id: filters.source_id === '' ? undefined : Number(filters.source_id),
      workflow_id: filters.workflow_id === '' ? undefined : Number(filters.workflow_id),
    })
    setPage(0)
    load()
  }

  const exportCsv = () => {
    const rows = [
      ['ID', 'Timestamp', 'Class', 'Confidence', 'Source', 'Workflow', 'Zone', 'Tracker ID'],
      ...events.map((e) => [
        e.id,
        e.timestamp,
        e.class_name,
        e.confidence != null ? e.confidence.toFixed(3) : '',
        sourceMap.get(e.source_id ?? -1) ?? e.source_id ?? '',
        workflowMap.get(e.workflow_id ?? -1) ?? e.workflow_id ?? '',
        e.zone_name ?? '',
        e.tracker_id ?? '',
      ]),
    ]
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `events_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="w-full p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Events</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Detection history{activeFilterCount > 0 && <> · <span className="text-accent">{activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''} active</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={exportCsv}>Export CSV</Button>
          <Button variant="danger" size="sm" onClick={clearAll}>Clear filtered</Button>
        </div>
      </div>

      {/* Filter bar */}
      <Card>
        <div className="grid grid-cols-6 gap-3">
          <Input
            label="Class"
            value={filters.class_name}
            onChange={(e) => { setFilters({ ...filters, class_name: e.target.value }); setPage(0) }}
            placeholder="person"
          />
          <Select
            label="Source"
            value={filters.source_id}
            onChange={(e) => { setFilters({ ...filters, source_id: e.target.value === '' ? '' : Number(e.target.value) }); setPage(0) }}
          >
            <option value="">Any</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
          <Select
            label="Workflow"
            value={filters.workflow_id}
            onChange={(e) => { setFilters({ ...filters, workflow_id: e.target.value === '' ? '' : Number(e.target.value) }); setPage(0) }}
          >
            <option value="">Any</option>
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </Select>
          <Input
            label="Min confidence"
            type="number"
            min={0} max={1} step={0.05}
            value={filters.min_confidence}
            onChange={(e) => { setFilters({ ...filters, min_confidence: e.target.value === '' ? '' : Number(e.target.value) }); setPage(0) }}
            placeholder="0.50"
          />
          <Input
            label="From"
            type="datetime-local"
            value={filters.since}
            onChange={(e) => { setFilters({ ...filters, since: e.target.value }); setPage(0) }}
          />
          <Input
            label="To"
            type="datetime-local"
            value={filters.until}
            onChange={(e) => { setFilters({ ...filters, until: e.target.value }); setPage(0) }}
          />
        </div>
        {activeFilterCount > 0 && (
          <div className="mt-3 flex justify-end">
            <Button size="xs" variant="ghost" onClick={reset}>Reset filters</Button>
          </div>
        )}
      </Card>

      {/* Table */}
      <Card padding="none">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border-subtle">
              {['Time', 'Class', 'Confidence', 'Source', 'Workflow', 'Zone', 'Tracker', ''].map((h) => (
                <th key={h} className="px-5 py-2.5 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-sm text-text-tertiary">
                  No events match the current filters
                </td>
              </tr>
            )}
            {events.map((e, i) => (
              <tr
                key={e.id}
                onClick={() => setSelected(e)}
                className={[
                  'group cursor-pointer transition-colors hover:bg-bg-overlay',
                  i < events.length - 1 ? 'border-b border-border-subtle' : '',
                ].join(' ')}
              >
                <td className="px-5 py-2.5 text-xs font-mono text-text-secondary whitespace-nowrap">{fmt(e.timestamp)}</td>
                <td className="px-5 py-2.5"><Badge variant="accent">{e.class_name}</Badge></td>
                <td className="px-5 py-2.5 text-sm text-text-secondary">
                  {e.confidence != null
                    ? <span className="font-mono">{(e.confidence * 100).toFixed(1)}%</span>
                    : <span className="text-text-tertiary">—</span>}
                </td>
                <td className="px-5 py-2.5 text-sm text-text-tertiary truncate max-w-[140px]">
                  {sourceMap.get(e.source_id ?? -1) ?? <span className="text-text-disabled">—</span>}
                </td>
                <td className="px-5 py-2.5 text-sm text-text-tertiary truncate max-w-[140px]">
                  {workflowMap.get(e.workflow_id ?? -1) ?? <span className="text-text-disabled">—</span>}
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
                    onClick={(ev) => { ev.stopPropagation(); remove(e.id) }}
                    className="opacity-0 group-hover:opacity-100"
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {(events.length > 0 || page > 0) && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border-subtle">
            <p className="text-xs text-text-tertiary">
              Showing {page * LIMIT + 1}–{page * LIMIT + events.length}
            </p>
            <div className="flex gap-1">
              <Button size="xs" variant="secondary" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>Previous</Button>
              <Button size="xs" variant="secondary" onClick={() => setPage(page + 1)} disabled={events.length < LIMIT}>Next</Button>
            </div>
          </div>
        )}
      </Card>

      {selected && (
        <EventDetailModal
          event={selected}
          sourceName={sourceMap.get(selected.source_id ?? -1)}
          workflowName={workflowMap.get(selected.workflow_id ?? -1)}
          onClose={() => setSelected(null)}
          onDelete={() => remove(selected.id)}
        />
      )}
    </div>
  )
}

// ── Detail modal ────────────────────────────────────────────────────────────

function EventDetailModal({
  event,
  sourceName,
  workflowName,
  onClose,
  onDelete,
}: {
  event: Event
  sourceName?: string
  workflowName?: string
  onClose: () => void
  onDelete: () => void
}) {
  const [frameAvailable, setFrameAvailable] = useState<boolean | null>(null)

  // HEAD-probe the frame URL once
  useEffect(() => {
    let cancelled = false
    fetch(eventsApi.frameUrl(event.id), { method: 'HEAD' })
      .then((r) => { if (!cancelled) setFrameAvailable(r.ok) })
      .catch(() => { if (!cancelled) setFrameAvailable(false) })
    return () => { cancelled = true }
  }, [event.id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6" onClick={onClose}>
      <div
        className="w-full max-w-4xl rounded-lg border border-border bg-bg-base shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge variant="accent">{event.class_name}</Badge>
              {event.confidence != null && (
                <span className="text-xs text-text-secondary tabular-nums">
                  {(event.confidence * 100).toFixed(1)}% confidence
                </span>
              )}
            </div>
            <p className="text-2xs text-text-tertiary mt-0.5">
              Event #{event.id} · {fmt(event.timestamp)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="xs" variant="danger" onClick={onDelete}>Delete</Button>
            <Button size="xs" variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 p-5">
          {/* Frame */}
          <div className="col-span-2 rounded border border-border-subtle bg-black flex items-center justify-center min-h-[300px] overflow-hidden">
            {frameAvailable === null ? (
              <p className="text-xs text-text-tertiary">Loading…</p>
            ) : frameAvailable ? (
              <img
                src={eventsApi.frameUrl(event.id)}
                alt="Event snapshot"
                className="max-w-full max-h-[60vh] object-contain"
              />
            ) : (
              <div className="p-6 text-center">
                <p className="text-sm text-text-secondary">No frame snapshot was saved</p>
                <p className="text-2xs text-text-tertiary mt-1">
                  Enable <code>save_frame</code> on the Save Event node to keep snapshots
                </p>
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="space-y-3 text-xs">
            <DetailRow label="Source" value={sourceName ?? (event.source_id != null ? `#${event.source_id}` : '—')} />
            <DetailRow label="Workflow" value={workflowName ?? (event.workflow_id != null ? `#${event.workflow_id}` : '—')} />
            <DetailRow label="Class ID" value={event.class_id != null ? String(event.class_id) : '—'} />
            <DetailRow label="Tracker ID" value={event.tracker_id != null ? `#${event.tracker_id}` : '—'} />
            <DetailRow label="Zone" value={event.zone_name ?? '—'} />
            {event.metadata && Object.keys(event.metadata).length > 0 && (
              <div>
                <p className="text-2xs uppercase tracking-wider text-text-disabled">Metadata</p>
                <code className="block mt-0.5 max-h-32 overflow-auto rounded bg-bg-overlay px-2 py-1 font-mono text-2xs text-text-secondary">
                  {JSON.stringify(event.metadata, null, 2)}
                </code>
              </div>
            )}
            {event.bbox && (
              <div>
                <p className="text-2xs uppercase tracking-wider text-text-disabled">Bounding box</p>
                <code className="block mt-0.5 rounded bg-bg-overlay px-2 py-1 font-mono text-2xs text-text-secondary">
                  ({event.bbox.x1.toFixed(0)}, {event.bbox.y1.toFixed(0)}) →
                  ({event.bbox.x2.toFixed(0)}, {event.bbox.y2.toFixed(0)})
                </code>
              </div>
            )}
            {event.frame_path && (
              <div>
                <p className="text-2xs uppercase tracking-wider text-text-disabled">Frame path</p>
                <code className="block mt-0.5 rounded bg-bg-overlay px-2 py-1 font-mono text-2xs text-text-secondary break-all">
                  {event.frame_path}
                </code>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-2xs uppercase tracking-wider text-text-disabled">{label}</p>
      <p className="mt-0.5 text-sm text-text-primary">{value}</p>
    </div>
  )
}
