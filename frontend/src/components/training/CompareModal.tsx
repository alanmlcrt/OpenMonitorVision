import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts'
import type { TrainingJob, TrainingMetric } from '../../types'
import { Button } from '../ui/Button'

const AXIS = { fill: '#55556e', fontSize: 10 }
const GRID = '#1f1f2c'

// Distinct palette for overlaid runs
const PALETTE = ['#5c6bc0', '#22c55e', '#f59e0b', '#ec4899', '#22d3ee', '#a855f7', '#ef4444', '#94a3b8']

interface Props {
  jobs: TrainingJob[]            // ALL jobs (we filter the selection)
  selectedIds: number[]
  onClose: () => void
}

function pick(m: TrainingMetric, keys: string[]): number | undefined {
  for (const k of keys) {
    if (typeof m[k] === 'number' && Number.isFinite(m[k] as number)) return m[k] as number
  }
  return undefined
}

/** Merge multiple runs into one dataset keyed by epoch.
 *  Each run contributes a column named after its job id (e.g. "j7"). */
function mergeRuns(jobs: TrainingJob[], pickKeys: string[]) {
  const byEpoch = new Map<number, Record<string, number | undefined> & { epoch: number }>()
  for (const j of jobs) {
    for (const m of j.metrics) {
      const row = byEpoch.get(m.epoch) ?? { epoch: m.epoch }
      row[`j${j.id}`] = pick(m, pickKeys)
      byEpoch.set(m.epoch, row)
    }
  }
  return Array.from(byEpoch.values()).sort((a, b) => a.epoch - b.epoch)
}

function CompareChart({
  jobs, pickKeys, title, yDomain,
}: {
  jobs: TrainingJob[]
  pickKeys: string[]
  title: string
  yDomain?: [number | 'auto', number | 'auto']
}) {
  const data = useMemo(() => mergeRuns(jobs, pickKeys), [jobs, pickKeys])
  if (jobs.length === 0) return null

  return (
    <div className="rounded border border-border-subtle bg-bg-base p-3">
      <p className="text-2xs uppercase tracking-wider text-text-disabled mb-1">{title}</p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="epoch" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={36} domain={yDomain ?? ['auto', 'auto']} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              return (
                <div className="bg-bg-overlay border border-border rounded px-3 py-2 text-xs shadow-dropdown">
                  <p className="text-text-secondary mb-1">Epoch {label}</p>
                  {payload.map((p: any) => (
                    <p key={p.dataKey} className="text-text-primary tabular-nums">
                      <span className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle" style={{ background: p.color }} />
                      <span className="text-text-tertiary mr-1">{p.name}</span>
                      {typeof p.value === 'number' ? p.value.toFixed(4) : '—'}
                    </p>
                  ))}
                </div>
              )
            }}
          />
          <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 10, color: '#8888a8' }} />
          {jobs.map((j, i) => (
            <Line
              key={j.id}
              type="monotone"
              dataKey={`j${j.id}`}
              name={j.name}
              stroke={PALETTE[i % PALETTE.length]}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function CompareModal({ jobs, selectedIds, onClose }: Props) {
  const picked = jobs.filter((j) => selectedIds.includes(j.id) && j.metrics.length > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
         onClick={onClose}>
      <div
        className="w-full max-w-5xl rounded-lg border border-border bg-bg-base shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle">
          <div>
            <h2 className="text-sm font-medium text-text-primary">Compare runs</h2>
            <p className="text-2xs text-text-tertiary mt-0.5">
              {picked.length} run{picked.length !== 1 ? 's' : ''} overlaid
            </p>
          </div>
          <Button size="xs" variant="ghost" onClick={onClose}>Close</Button>
        </div>

        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {picked.length === 0 ? (
            <p className="text-sm text-text-tertiary text-center py-8">
              Select at least one job with recorded metrics to compare.
            </p>
          ) : (
            <>
              <CompareChart
                jobs={picked}
                pickKeys={['box_loss']}
                title="Box loss"
              />
              <CompareChart
                jobs={picked}
                pickKeys={['cls_loss']}
                title="Classification loss"
              />
              <CompareChart
                jobs={picked}
                pickKeys={['mAP50', 'map50']}
                title="mAP@.5"
                yDomain={[0, 1]}
              />
              <CompareChart
                jobs={picked}
                pickKeys={['mAP50-95', 'map50-95', 'map5095']}
                title="mAP@.5-.95"
                yDomain={[0, 1]}
              />

              {/* Final-metric summary table */}
              <div className="rounded border border-border-subtle">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border-subtle text-text-tertiary">
                      <th className="text-left px-3 py-2 font-medium">Run</th>
                      <th className="text-right px-3 py-2 font-medium">Epochs</th>
                      <th className="text-right px-3 py-2 font-medium">Final box_loss</th>
                      <th className="text-right px-3 py-2 font-medium">Best mAP@.5</th>
                      <th className="text-right px-3 py-2 font-medium">Best mAP@.5-.95</th>
                    </tr>
                  </thead>
                  <tbody>
                    {picked.map((j, i) => {
                      const last = j.metrics[j.metrics.length - 1] ?? {}
                      const bestMap50 = Math.max(0, ...j.metrics.map((m) => Number(m['mAP50'] ?? m['map50'] ?? 0)))
                      const bestMap5095 = Math.max(0, ...j.metrics.map((m) => Number(m['mAP50-95'] ?? m['map50-95'] ?? m['map5095'] ?? 0)))
                      return (
                        <tr key={j.id} className="border-b border-border-subtle last:border-0">
                          <td className="px-3 py-2 text-text-primary">
                            <span className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle"
                                  style={{ background: PALETTE[i % PALETTE.length] }} />
                            {j.name}
                          </td>
                          <td className="text-right px-3 py-2 tabular-nums">{j.metrics.length}</td>
                          <td className="text-right px-3 py-2 tabular-nums">
                            {typeof last['box_loss'] === 'number' ? (last['box_loss'] as number).toFixed(4) : '—'}
                          </td>
                          <td className="text-right px-3 py-2 tabular-nums">{bestMap50.toFixed(4)}</td>
                          <td className="text-right px-3 py-2 tabular-nums">{bestMap5095.toFixed(4)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
