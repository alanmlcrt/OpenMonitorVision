import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from 'recharts'
import type { TrainingMetric } from '../../types'

const AXIS = { fill: '#55556e', fontSize: 10 }
const GRID = '#1f1f2c'

interface SeriesDef {
  key: string
  label: string
  color: string
  altKeys?: string[]   // fallback key names (YOLO outputs differ across versions)
}

const LOSS_SERIES: SeriesDef[] = [
  { key: 'box_loss', label: 'box',  color: '#5c6bc0' },
  { key: 'cls_loss', label: 'cls',  color: '#22d3ee' },
  { key: 'dfl_loss', label: 'dfl',  color: '#a855f7' },
]

const MAP_SERIES: SeriesDef[] = [
  { key: 'mAP50',     label: 'mAP@.5',     color: '#22c55e', altKeys: ['map50', 'metrics/mAP50'] },
  { key: 'mAP50-95',  label: 'mAP@.5-.95', color: '#f59e0b', altKeys: ['map50-95', 'map5095'] },
]

function rowOf(m: TrainingMetric, series: SeriesDef[]): Record<string, number | undefined> & { epoch: number } {
  const row: Record<string, number | undefined> & { epoch: number } = { epoch: m.epoch }
  for (const s of series) {
    let val: number | undefined = typeof m[s.key] === 'number' ? (m[s.key] as number) : undefined
    if (val === undefined && s.altKeys) {
      for (const k of s.altKeys) {
        if (typeof m[k] === 'number') { val = m[k] as number; break }
      }
    }
    row[s.key] = val
  }
  return row
}

function TinyTooltip({ active, payload, label, suffix }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-bg-overlay border border-border rounded px-3 py-2 text-xs shadow-dropdown">
      <p className="text-text-secondary mb-1">Epoch {label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="text-text-primary tabular-nums">
          <span className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle" style={{ background: p.color }} />
          <span className="text-text-tertiary mr-1">{p.name}</span>
          {typeof p.value === 'number' ? p.value.toFixed(4) : p.value}{suffix ?? ''}
        </p>
      ))}
    </div>
  )
}

function Chart({
  data,
  series,
  height = 180,
  yDomain,
}: {
  data: Array<Record<string, number | undefined> & { epoch: number }>
  series: SeriesDef[]
  height?: number
  yDomain?: [number | 'auto', number | 'auto']
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="epoch" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={36} domain={yDomain ?? ['auto', 'auto']} />
        <Tooltip content={<TinyTooltip />} />
        <Legend
          iconType="square"
          iconSize={8}
          wrapperStyle={{ fontSize: 10, color: '#8888a8' }}
        />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export function MetricsCharts({ metrics }: { metrics: TrainingMetric[] }) {
  if (metrics.length === 0) {
    return (
      <div className="rounded border border-border-subtle px-3 py-6 text-center">
        <p className="text-xs text-text-tertiary">No metrics yet — waiting for the first epoch…</p>
      </div>
    )
  }
  const lossData = metrics.map((m) => rowOf(m, LOSS_SERIES))
  const mapData = metrics.map((m) => rowOf(m, MAP_SERIES))

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="rounded border border-border-subtle bg-bg-base p-3">
        <p className="text-2xs uppercase tracking-wider text-text-disabled mb-1">Training loss</p>
        <Chart data={lossData} series={LOSS_SERIES} />
      </div>
      <div className="rounded border border-border-subtle bg-bg-base p-3">
        <p className="text-2xs uppercase tracking-wider text-text-disabled mb-1">Validation mAP</p>
        <Chart data={mapData} series={MAP_SERIES} yDomain={[0, 1]} />
      </div>
    </div>
  )
}
