import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  addEdge,
  useEdges,
  useEdgesState,
  useNodeId,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { api } from '../api/client'
import { sourcesApi } from '../api/sources'
import { datasetsApi } from '../api/datasets'
import { mqttApi } from '../api/mqtt'
import { workflowsApi } from '../api/workflows'
import type { Dataset, MqttBroker, Source, Workflow, YoloModel } from '../types'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Input'

type NodeConfig = Record<string, unknown>

interface NodeDefinition {
  type: string
  label: string
  group: string
  color: string
  defaultConfig: NodeConfig
  summary: (config: NodeConfig) => string
}

const NODE_DEFINITIONS: NodeDefinition[] = [
  {
    type: 'source',
    label: 'Source',
    group: 'Input',
    color: '#14b8a6',
    defaultConfig: { source_id: 1 },
    summary: (c) => `Source #${c.source_id ?? '—'}`,
  },
  {
    type: 'satellite_scene',
    label: 'Satellite Scene',
    group: 'Input',
    color: '#0ea5e9',
    defaultConfig: { scene_id: null },
    summary: (c) => c.scene_id ? `Scene #${c.scene_id}` : 'No scene selected',
  },
  {
    type: 'yolo_detect',
    label: 'YOLO Detect',
    group: 'Vision',
    color: '#3b82f6',
    defaultConfig: { model_path: 'yolov8n.pt', confidence: 0.25, iou: 0.7, device: 'auto' },
    summary: (c) => `${c.model_path ?? 'model'} · conf ${c.confidence ?? 0.25}`,
  },
  {
    type: 'tracker',
    label: 'Tracker',
    group: 'Vision',
    color: '#06b6d4',
    defaultConfig: { enabled: true, tracker: 'bytetrack' },
    summary: (c) => (c.enabled === false ? 'Disabled' : 'ByteTrack'),
  },
  {
    type: 'class_filter',
    label: 'Class Filter',
    group: 'Filter',
    color: '#f59e0b',
    defaultConfig: { classes: ['person', 'car'] },
    summary: (c) => (Array.isArray(c.classes) && c.classes.length > 0 ? (c.classes as string[]).join(', ') : 'All classes'),
  },
  {
    type: 'confidence_filter',
    label: 'Confidence Filter',
    group: 'Filter',
    color: '#fb923c',
    defaultConfig: { min_confidence: 0.5 },
    summary: (c) => `Min confidence ${c.min_confidence ?? 0.5}`,
  },
  {
    type: 'color_filter',
    label: 'Color Filter',
    group: 'Filter',
    color: '#22c55e',
    defaultConfig: {
      target_color: 'green',
      min_color_ratio: 0.12,
      min_saturation: 40,
      min_value: 40,
      bbox_padding_px: 0,
    },
    summary: (c) => `${c.target_color ?? 'green'} >= ${Math.round(Number(c.min_color_ratio ?? 0.12) * 100)}%`,
  },
  {
    type: 'zone_filter',
    label: 'Zone Filter',
    group: 'Filter',
    color: '#a78bfa',
    defaultConfig: { zones: [] },
    summary: (c) => {
      const z = c.zones as unknown[]
      return Array.isArray(z) && z.length > 0 ? `${z.length} zone(s)` : 'No zones defined'
    },
  },
  {
    type: 'event_trigger',
    label: 'Event Trigger',
    group: 'Event',
    color: '#ef4444',
    defaultConfig: { cooldown_seconds: 5, trigger_once_per_object: false },
    summary: (c) => `Cooldown: ${c.cooldown_seconds ?? 5}s`,
  },
  {
    type: 'zone_sequence_trigger',
    label: 'Zone Sequence',
    group: 'Event',
    color: '#38bdf8',
    defaultConfig: {
      zones: [],
      sequence: ['Zone 1', 'Zone 2'],
      max_seconds_between_zones: 30,
      cooldown_seconds: 0,
      trigger_once_per_object: true,
      anchor: 'bottom_center',
    },
    summary: (c) => Array.isArray(c.sequence) && c.sequence.length >= 2
      ? (c.sequence as string[]).join(' -> ')
      : 'Zone 1 -> Zone 2',
  },
  {
    type: 'geo_zone_trigger',
    label: 'Geo Zone Trigger',
    group: 'Event',
    color: '#14b8a6',
    defaultConfig: {
      max_cloud_cover: 30,
      event_class_name: 'satellite_scene',
      areas: [],
    },
    summary: (c) => {
      const areas = Array.isArray(c.areas) ? c.areas.length : 0
      return `${areas} geo area(s), clouds <= ${c.max_cloud_cover ?? 30}%`
    },
  },
  {
    type: 'save_event',
    label: 'Save Event',
    group: 'Event',
    color: '#22c55e',
    defaultConfig: { save_frame: false, save_metadata: true, custom_columns: [] },
    summary: (c) => (c.save_frame ? 'SQLite + frame snapshot' : 'SQLite metadata only'),
  },
  {
    type: 'overlay',
    label: 'Overlay',
    group: 'Output',
    color: '#c084fc',
    defaultConfig: {
      show_boxes: true,
      box_style: 'box',
      box_thickness: 2,
      show_mask: false,
      show_labels: true,
      show_confidence: true,
      show_tracker_id: true,
      label_position: 'top_left',
    },
    summary: (c) => {
      const parts: string[] = []
      if (c.show_boxes !== false) parts.push(String(c.box_style ?? 'box'))
      if (c.show_mask) parts.push('mask')
      if (c.show_labels !== false) parts.push('labels')
      return parts.length > 0 ? parts.join(', ') : 'Hidden'
    },
  },
  {
    type: 'harvest',
    label: 'Harvest to dataset',
    group: 'Output',
    color: '#facc15',
    defaultConfig: {
      dataset_id: null,
      mode: 'every_n',
      n: 30,
      interval_seconds: 5,
      max_frames: 200,
      save_annotated: false,
    },
    summary: (c) => {
      const m = String(c.mode ?? 'every_n')
      if (m === 'every_n')        return `Every ${c.n ?? 30} frames`
      if (m === 'every_seconds')  return `Every ${c.interval_seconds ?? 5}s`
      if (m === 'on_detection')   return 'On detection'
      return m
    },
  },
  {
    type: 'schedule_trigger',
    label: 'Schedule Trigger',
    group: 'Control',
    color: '#818cf8',
    defaultConfig: {
      mode: 'time_window',
      windows: [{ start: '08:00', end: '20:00' }],
      interval_minutes: 60,
      duration_minutes: 10,
      start_at: '',
    },
    summary: (c) => {
      const m = String(c.mode ?? 'time_window')
      if (m === 'time_window') {
        const w = Array.isArray(c.windows) && c.windows.length > 0 ? c.windows[0] as Record<string,string> : null
        return w ? `${w.start}–${w.end}` : 'Plage horaire'
      }
      if (m === 'periodic') return `Toutes les ${c.interval_minutes ?? 60} min, ${c.duration_minutes ?? 10} min`
      if (m === 'once') return c.start_at ? `Une fois le ${String(c.start_at).slice(0, 16)}` : 'Une fois (non configuré)'
      return m
    },
  },
  {
    type: 'line_crossing',
    label: 'Line Crossing',
    group: 'Event',
    color: '#ec4899',
    defaultConfig: {
      line: { start_x: 100, start_y: 360, end_x: 1180, end_y: 360 },
      direction: 'both',
      anchor: 'bottom_center',
    },
    summary: (c) => {
      const dir = String(c.direction ?? 'both')
      const arrow = dir === 'in' ? '→ entrées' : dir === 'out' ? '→ sorties' : '↔ in/out'
      return `Ligne · ${arrow}`
    },
  },
  {
    type: 'crop_save',
    label: 'Crop & Save',
    group: 'Output',
    color: '#10b981',
    defaultConfig: {
      output_subdir: 'crops',
      filter_classes: [],
      min_confidence: 0,
      padding_px: 0,
      max_per_frame: 0,
      only_with_event: false,
    },
    summary: (c) => {
      const cls = Array.isArray(c.filter_classes) && c.filter_classes.length > 0
        ? (c.filter_classes as string[]).join(', ')
        : 'toutes classes'
      return `→ ${c.output_subdir ?? 'crops'}/ · ${cls}`
    },
  },
  {
    type: 'notify',
    label: 'Notify',
    group: 'Event',
    color: '#f97316',
    defaultConfig: {
      channel: 'webhook',
      // webhook
      webhook_url: '',
      webhook_method: 'POST',
      webhook_headers: '',
      // email
      smtp_host: '',
      smtp_port: 587,
      smtp_user: '',
      smtp_password: '',
      smtp_use_tls: true,
      smtp_use_ssl: false,
      from_addr: '',
      to_addrs: '',
      subject_template: 'OpenMonitorVision: {class_name}',
      body_template: '',
      // mqtt
      broker_id: null,
      topic_template: 'omv/workflow/{workflow_id}/events',
      payload_template: '',
      qos: 0,
      retain: false,
      // telegram
      telegram_bot_token: '',
      telegram_chat_id: '',
      telegram_message_template: '',
      telegram_parse_mode: '',
    },
    summary: (c) => {
      const ch = String(c.channel ?? 'webhook')
      if (ch === 'webhook') return c.webhook_url ? `→ ${String(c.webhook_url).slice(0, 32)}…` : 'Webhook (no URL)'
      if (ch === 'email')   return c.to_addrs ? `📧 ${String(c.to_addrs).slice(0, 32)}` : 'Email (no recipient)'
      if (ch === 'mqtt')    return c.broker_id ? `MQTT → ${String(c.topic_template ?? '').slice(0, 28)}` : 'MQTT (no broker)'
      return ch
    },
  },
]

const nodeMap = new Map(NODE_DEFINITIONS.map((item) => [item.type, item]))
const NODE_GROUPS = ['Control', 'Input', 'Vision', 'Filter', 'Event', 'Output']
let nodeCounter = 1

function makeNode(type: string, position = { x: 160, y: 100 }): Node {
  const def = nodeMap.get(type)
  const id = `${type}_${Date.now()}_${nodeCounter++}`
  return {
    id,
    type: 'workflowNode',
    position,
    data: { type, label: def?.label ?? type, config: { ...(def?.defaultConfig ?? {}) } },
  }
}

// ─── Inline SVG icons ────────────────────────────────────────────────────────

function NodeIcon({ type, color }: { type: string; color: string }) {
  const s = {
    stroke: color,
    strokeWidth: 1.5,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (type) {
    case 'source':
      return (
        <svg viewBox="0 0 16 16" width={11} height={11}>
          <rect x="1" y="3.5" width="10" height="9" rx="1" {...s} />
          <circle cx="6" cy="8" r="2" {...s} />
          <path d="M13 6l2-1.5v7L13 10" {...s} />
        </svg>
      )
    case 'satellite_scene':
      return (
        <svg viewBox="0 0 16 16" width={11} height={11}>
          <path d="M2 10l12-5M4 13l8-10" {...s} />
          <rect x="4" y="5" width="8" height="6" rx="1" transform="rotate(-22 8 8)" {...s} />
          <circle cx="3" cy="12.5" r="1" fill={color} stroke="none" />
        </svg>
      )
    case 'yolo_detect':
      return (
        <svg viewBox="0 0 16 16" width={11} height={11}>
          <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" {...s} />
          <circle cx="8" cy="8" r="2" {...s} />
          <circle cx="8" cy="8" r="0.75" fill={color} stroke="none" />
        </svg>
      )
    case 'tracker':
      return (
        <svg viewBox="0 0 16 16" width={11} height={11}>
          <circle cx="8" cy="8" r="5.5" {...s} />
          <circle cx="8" cy="8" r="2.5" {...s} />
          <line x1="8" y1="1" x2="8" y2="3" {...s} />
          <line x1="8" y1="13" x2="8" y2="15" {...s} />
          <line x1="1" y1="8" x2="3" y2="8" {...s} />
          <line x1="13" y1="8" x2="15" y2="8" {...s} />
        </svg>
      )
    case 'class_filter':
      return (
        <svg viewBox="0 0 16 16" width={11} height={11}>
          <path d="M1.5 1.5h7l5.5 5.5-7 7-5.5-5.5v-7z" {...s} />
          <circle cx="5" cy="5" r="1" fill={color} stroke="none" />
        </svg>
      )
    case 'confidence_filter':
      return (
        <svg viewBox="0 0 16 16" width={11} height={11}>
          <path d="M2 2h12l-4.5 5v5.5l-3-1.5V7z" {...s} />
        </svg>
      )
    case 'color_filter':
      return (
        <svg viewBox="0 0 16 16" width={11} height={11}>
          <path d="M8 1.5s4 4.5 4 7.5a4 4 0 0 1-8 0c0-3 4-7.5 4-7.5z" {...s} />
          <circle cx="8" cy="9" r="1.5" fill={color} stroke="none" />
        </svg>
      )
    case 'zone_filter':
      return (
        <svg viewBox="0 0 16 16" width={11} height={11}>
          <path d="M8 1.5L14 5v6L8 14.5 2 11V5z" {...s} />
          <path d="M8 5.5l3 2v3L8 12.5 5 10.5v-3z" {...s} />
        </svg>
      )
    case 'event_trigger':
      return (
        <svg viewBox="0 0 16 16" width={11} height={11}>
          <path d="M9 1.5L3 8h5l-1 6.5 9-8h-6z" {...s} />
        </svg>
      )
    case 'zone_sequence_trigger':
      return (
        <svg viewBox="0 0 16 16" width={11} height={11}>
          <circle cx="4" cy="4" r="2" {...s} />
          <circle cx="12" cy="12" r="2" {...s} />
          <path d="M5.5 5.5l5 5M9 10.5h1.5V9" {...s} />
        </svg>
      )
    case 'geo_zone_trigger':
      return (
        <svg viewBox="0 0 16 16" width={11} height={11}>
          <path d="M8 1.5c2.5 2 4 4 4 6.5a4 4 0 1 1-8 0c0-2.5 1.5-4.5 4-6.5z" {...s} />
          <path d="M5 8h6M8 5v6" {...s} />
        </svg>
      )
    case 'save_event':
      return (
        <svg viewBox="0 0 16 16" width={11} height={11}>
          <ellipse cx="8" cy="4" rx="5.5" ry="2" {...s} />
          <path d="M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4" {...s} />
          <path d="M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" {...s} />
        </svg>
      )
    case 'overlay':
      return (
        <svg viewBox="0 0 16 16" width={11} height={11}>
          <rect x="1" y="4.5" width="9" height="8" rx="1" {...s} />
          <rect x="6" y="3.5" width="9" height="8" rx="1" {...s} />
        </svg>
      )
    case 'harvest':
      return (
        <svg viewBox="0 0 16 16" width={11} height={11}>
          <path d="M2 14l4-4 3 3 5-5" {...s} />
          <path d="M2 14h12" {...s} />
          <circle cx="13" cy="4" r="1.5" {...s} />
        </svg>
      )
    case 'schedule_trigger':
      return (
        <svg viewBox="0 0 16 16" width={11} height={11}>
          <circle cx="8" cy="8" r="6" {...s} />
          <path d="M8 5v3l2 2" {...s} />
        </svg>
      )
    case 'line_crossing':
      return (
        <svg viewBox="0 0 16 16" width={11} height={11}>
          <path d="M1 12L15 4" {...s} />
          <path d="M5 9l2 -2M11 7l-2 2" {...s} />
        </svg>
      )
    case 'crop_save':
      return (
        <svg viewBox="0 0 16 16" width={11} height={11}>
          <path d="M4 1v11h11M1 4h11v11" {...s} />
        </svg>
      )
    case 'notify':
      return (
        <svg viewBox="0 0 16 16" width={11} height={11}>
          <path d="M3 6a5 5 0 0 1 10 0v3l1.5 2H1.5L3 9z" {...s} />
          <path d="M6 13a2 2 0 0 0 4 0" {...s} />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 16 16" width={11} height={11}>
          <rect x="2" y="2" width="12" height="12" rx="1.5" {...s} />
        </svg>
      )
  }
}

// ─── Node card ───────────────────────────────────────────────────────────────

const WorkflowNodeCard = memo(({ data, selected }: NodeProps) => {
  const definition = nodeMap.get(data.type as string)
  const color = definition?.color ?? '#64748b'
  const summary = definition?.summary((data.config as NodeConfig) ?? {}) ?? data.type

  const nodeId = useNodeId()
  const allEdges = useEdges()
  const { deleteElements } = useReactFlow()
  const inCount = allEdges.filter((e) => e.target === nodeId).length
  const outCount = allEdges.filter((e) => e.source === nodeId).length

  const deleteNode = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (nodeId) deleteElements({ nodes: [{ id: nodeId }] })
  }

  const sourceId = data.type === 'source' ? (data.config as NodeConfig)?.source_id : null
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!sourceId) { setPreview(null); return }
    let cancelled = false
    sourcesApi.preview(sourceId as number)
      .then((d) => { if (!cancelled) setPreview(d.frame ?? null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [sourceId])

  return (
    <div
      className="relative w-52 overflow-hidden rounded-lg border bg-bg-surface transition-all duration-150"
      style={{
        borderColor: selected ? color : '#252533',
        boxShadow: selected
          ? `0 0 0 2px ${color}25, 0 4px 20px rgba(0,0,0,0.6)`
          : '0 1px 4px rgba(0,0,0,0.45)',
      }}
    >
      {/* Left color stripe */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-[3px]"
        style={{ background: `linear-gradient(180deg, ${color} 0%, ${color}60 100%)` }}
      />

      {/* Target handle + input count badge */}
      {data.type !== 'source' && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2" style={{ left: -6 }}>
          <Handle
            type="target"
            position={Position.Left}
            title="Input — multiple connections supported"
            style={{
              position: 'relative',
              left: 0,
              top: 0,
              transform: 'none',
              width: 12,
              height: 12,
              background: '#0f0f15',
              border: `2px solid ${color}`,
              borderRadius: '50%',
            }}
          />
          {inCount > 1 && (
            <span
              className="pointer-events-none absolute -right-3 -top-2 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold"
              style={{ background: color, color: '#000' }}
            >
              {inCount}
            </span>
          )}
        </div>
      )}

      {/* Source handle + output count badge */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2" style={{ right: -6 }}>
        <Handle
          type="source"
          position={Position.Right}
          title="Output — multiple connections supported"
          style={{
            position: 'relative',
            right: 0,
            top: 0,
            transform: 'none',
            width: 12,
            height: 12,
            background: color,
            border: `2px solid ${color}60`,
            borderRadius: '50%',
          }}
        />
        {outCount > 1 && (
          <span
            className="pointer-events-none absolute -left-3 -top-2 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold"
            style={{ background: color, color: '#000' }}
          >
            {outCount}
          </span>
        )}
      </div>

      {/* Card content */}
      <div className="pl-3 pr-2.5">
        {/* Header */}
        <div className="flex items-center gap-1.5 pb-1.5 pt-2">
          <div
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm"
            style={{ background: `${color}20` }}
          >
            <NodeIcon type={data.type as string} color={color} />
          </div>
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text-primary">
            {data.label as string}
          </span>
          <span
            className="shrink-0 rounded px-1 py-0.5 text-2xs font-medium tracking-wide"
            style={{ background: `${color}15`, color }}
          >
            {definition?.group ?? 'Node'}
          </span>
          {/* Delete button — visible when selected */}
          {selected && (
            <button
              title="Delete node (Del)"
              onMouseDown={deleteNode}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-disabled opacity-60 hover:bg-danger/20 hover:text-danger hover:opacity-100"
            >
              <svg viewBox="0 0 10 10" width={8} height={8} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
                <path d="M1 1l8 8M9 1L1 9" />
              </svg>
            </button>
          )}
        </div>

        {/* Divider + summary */}
        <div className="border-t border-border-subtle" />
        <p className={`truncate text-2xs text-text-tertiary pt-1.5 ${data.type === 'source' ? 'pb-1' : 'pb-2'}`}>
          {summary}
        </p>
      </div>

      {/* Source preview thumbnail */}
      {data.type === 'source' && (
        <div className="mx-2.5 mb-2 overflow-hidden rounded-sm bg-bg-overlay" style={{ height: 64 }}>
          {preview ? (
            <img
              src={`data:image/jpeg;base64,${preview}`}
              className="h-full w-full object-cover"
              draggable={false}
              alt=""
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <span className="text-2xs text-text-disabled">
                {sourceId ? '…' : 'No source'}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
})
WorkflowNodeCard.displayName = 'WorkflowNodeCard'

const nodeTypes = { workflowNode: WorkflowNodeCard }

function boolValue(v: unknown) {
  return v === true
}
function numericValue(v: unknown, fallback: number) {
  return typeof v === 'number' ? v : Number(v ?? fallback)
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function WorkflowBuilderPage() {
  const [leftTab, setLeftTab] = useState<'workflows' | 'nodes'>('workflows')
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [models, setModels] = useState<YoloModel[]>([])
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [brokers, setBrokers] = useState<MqttBroker[]>([])
  const [selectedWf, setSelectedWf] = useState<Workflow | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [wfName, setWfName] = useState('')
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState<{ msg: string; ok: boolean } | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [runningIds, setRunningIds] = useState<Set<number>>(new Set())
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null)
  const wsStatusRef = useRef<WebSocket | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )

  const showNotice = (msg: string, ok: boolean) => {
    setNotice({ msg, ok })
    setTimeout(() => setNotice(null), 2800)
  }

  const loadWorkflows = () => workflowsApi.list().then(setWorkflows).catch(() => {})

  const loadBrokers = () => mqttApi.list().then(setBrokers).catch(() => {})

  useEffect(() => {
    loadWorkflows()
    sourcesApi.list().then(setSources).catch(() => {})
    api.get<YoloModel[]>('/models').then(setModels).catch(() => {})
    datasetsApi.list().then(setDatasets).catch(() => {})
    loadBrokers()
  }, [])

  // Poll running workflow IDs every 3 s
  useEffect(() => {
    const poll = () =>
      workflowsApi.runningIds().then((r) => setRunningIds(new Set(r.ids))).catch(() => {})
    poll()
    const id = setInterval(poll, 3000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    setEdges((eds) => eds.map((e) => ({ ...e, animated: running })))
  }, [running, setEdges])

  useEffect(() => {
    wsStatusRef.current?.close()
    if (!selectedWf) { setRunning(false); return }
    workflowsApi.status(selectedWf.id).then((r) => setRunning(r.running)).catch(() => {})
    const ws = new WebSocket(`ws://${location.host}/ws/workflow/${selectedWf.id}`)
    ws.onmessage = (e) => {
      try { if (JSON.parse(e.data as string).type === 'frame') setRunning(true) } catch {}
    }
    ws.onclose = () => setRunning(false)
    wsStatusRef.current = ws
    return () => ws.close()
  }, [selectedWf?.id])

  const loadWorkflow = (wf: Workflow) => {
    setSelectedWf(wf)
    setWfName(wf.name)
    setNodes((wf.nodes as Node[]) ?? [])
    setEdges((wf.edges as Edge[]) ?? [])
    setSelectedNodeId(null)
  }

  const newWorkflow = () => {
    setSelectedWf(null)
    setWfName('New workflow')
    setNodes([])
    setEdges([])
    setSelectedNodeId(null)
    setRunning(false)
  }

  const addMvpWorkflow = () => {
    const chain = ['source', 'yolo_detect', 'tracker', 'confidence_filter', 'event_trigger', 'save_event', 'overlay']
    const nextNodes = chain.map((type, i) => makeNode(type, { x: 80 + i * 230, y: 160 }))
    const nextEdges = nextNodes.slice(0, -1).map((node, i) => ({
      id: `edge_${node.id}_${nextNodes[i + 1].id}`,
      source: node.id,
      target: nextNodes[i + 1].id,
      animated: false,
    }))
    setWfName(wfName.trim() || 'MVP detection workflow')
    setNodes(nextNodes)
    setEdges(nextEdges)
    setSelectedNodeId(nextNodes[0]?.id ?? null)
  }

  const addZoneSequenceWorkflow = () => {
    const chain = [
      'source',
      'yolo_detect',
      'tracker',
      'class_filter',
      'confidence_filter',
      'color_filter',
      'zone_sequence_trigger',
      'save_event',
      'overlay',
    ]
    const nextNodes = chain.map((type, i) => {
      const node = makeNode(type, { x: 80 + i * 230, y: i % 2 === 0 ? 130 : 250 })
      if (type === 'class_filter') {
        node.data.config = { ...node.data.config, classes: ['car'] }
      }
      if (type === 'color_filter') {
        node.data.config = { ...node.data.config, target_color: 'green', min_color_ratio: 0.12 }
      }
      if (type === 'save_event') {
        node.data.config = { ...node.data.config, save_frame: true, save_metadata: true }
      }
      return node
    })
    const nextEdges = nextNodes.slice(0, -1).map((node, i) => ({
      id: `edge_${node.id}_${nextNodes[i + 1].id}`,
      source: node.id,
      target: nextNodes[i + 1].id,
      animated: false,
    }))
    setWfName(wfName.trim() || 'Green car Zone 1 to Zone 2')
    setNodes(nextNodes)
    setEdges(nextEdges)
    setSelectedNodeId(nextNodes.find((node) => node.data.type === 'zone_sequence_trigger')?.id ?? nextNodes[0]?.id ?? null)
  }

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) => addEdge({ ...connection, animated: running }, eds)),
    [setEdges, running],
  )

  const addNode = (type: string) => {
    const node = makeNode(type, { x: 160 + Math.random() * 60, y: 80 + nodes.length * 90 })
    setNodes((items) => [...items, node])
    setSelectedNodeId(node.id)
  }

  // ── Drag-and-drop from palette ──────────────────────────────────────────────
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const type = event.dataTransfer.getData('application/reactflow-node')
      if (!type || !rfInstance) return
      const position = rfInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const node = makeNode(type, position)
      setNodes((nds) => [...nds, node])
      setSelectedNodeId(node.id)
    },
    [rfInstance, setNodes],
  )

  const updateSelectedConfig = (patch: NodeConfig) => {
    if (!selectedNodeId) return
    setNodes((items) =>
      items.map((node) =>
        node.id !== selectedNodeId
          ? node
          : { ...node, data: { ...node.data, config: { ...(node.data?.config ?? {}), ...patch } } },
      ),
    )
  }

  // Update (or create) the Overlay node's config — used by the Display Settings panel
  const updateOverlayConfig = useCallback((patch: NodeConfig) => {
    setNodes((items) => {
      const overlayIdx = items.findIndex((n) => n.data?.type === 'overlay')
      if (overlayIdx !== -1) {
        return items.map((n, i) =>
          i !== overlayIdx
            ? n
            : { ...n, data: { ...n.data, config: { ...(n.data?.config ?? {}), ...patch } } },
        )
      }
      // Auto-add overlay node at the end of the chain
      const newNode = makeNode('overlay', { x: 160 + items.length * 220, y: 200 })
      newNode.data.config = { ...newNode.data.config, ...patch }
      return [...items, newNode]
    })
  }, [setNodes])

  const save = async () => {
    if (!wfName.trim()) return
    setSaving(true)
    setValidationErrors([])
    try {
      const validation = await workflowsApi.validate({ nodes, edges })
      if (!validation.valid) {
        setValidationErrors(validation.errors)
        setSaving(false)
        return
      }
      const payload = { name: wfName.trim(), nodes, edges }
      if (selectedWf) {
        const updated = await workflowsApi.update(selectedWf.id, payload as Partial<Workflow>)
        setSelectedWf(updated)
      } else {
        const created = await workflowsApi.create(payload)
        setSelectedWf(created)
      }
      showNotice('Saved', true)
      loadWorkflows()
    } catch (e: unknown) {
      showNotice((e as Error).message ?? 'Save failed', false)
    } finally {
      setSaving(false)
    }
  }

  const startWorkflow = async () => {
    if (!selectedWf) return
    try {
      await workflowsApi.start(selectedWf.id)
      setRunning(true)
      showNotice('Workflow started', true)
    } catch (e: unknown) {
      showNotice((e as Error).message ?? 'Start failed', false)
    }
  }

  const stopWorkflow = async () => {
    if (!selectedWf) return
    try {
      await workflowsApi.stop(selectedWf.id)
      setRunning(false)
      showNotice('Workflow stopped', true)
    } catch (e: unknown) {
      showNotice((e as Error).message ?? 'Stop failed', false)
    }
  }

  const exportWorkflow = async () => {
    if (!selectedWf) return
    try {
      const payload = await workflowsApi.exportJson(selectedWf.id)
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const safeName = (payload.name || `workflow_${selectedWf.id}`).replace(/[^a-z0-9_-]+/gi, '_')
      a.download = `${safeName}.json`
      a.click()
      URL.revokeObjectURL(url)
      showNotice('Workflow exported', true)
    } catch (e) {
      showNotice((e as Error).message ?? 'Export failed', false)
    }
  }

  const importWorkflow = async (file: File) => {
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
        throw new Error('Invalid file: missing nodes/edges')
      }
      const created = await workflowsApi.importJson({
        name: parsed.name || file.name.replace(/\.json$/i, ''),
        nodes: parsed.nodes,
        edges: parsed.edges,
      })
      loadWorkflows()
      setSelectedWf(created)
      showNotice(`Imported "${created.name}"`, true)
    } catch (e) {
      showNotice((e as Error).message ?? 'Import failed', false)
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left sidebar ── */}
      <div className="w-56 shrink-0 overflow-hidden border-r border-border-subtle bg-bg-surface">
        <div className="flex h-full flex-col">
          {/* Tab toggle */}
          <div className="flex border-b border-border-subtle">
            <button
              onClick={() => setLeftTab('workflows')}
              className={[
                'flex-1 py-2 text-2xs font-semibold uppercase tracking-widest transition-colors',
                leftTab === 'workflows'
                  ? 'border-b-2 border-accent text-accent'
                  : 'text-text-disabled hover:text-text-secondary',
              ].join(' ')}
            >
              Workflows
            </button>
            <button
              onClick={() => setLeftTab('nodes')}
              className={[
                'flex-1 py-2 text-2xs font-semibold uppercase tracking-widest transition-colors',
                leftTab === 'nodes'
                  ? 'border-b-2 border-accent text-accent'
                  : 'text-text-disabled hover:text-text-secondary',
              ].join(' ')}
            >
              Nodes
            </button>
          </div>

          {/* ── Workflows tab ── */}
          {leftTab === 'workflows' && (
            <>
              <div className="border-b border-border-subtle px-3 pb-2 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-2xs font-semibold uppercase tracking-widest text-text-disabled">
                    Workflows
                  </span>
                  <Button size="xs" variant="ghost" onClick={newWorkflow}>New</Button>
                </div>
                <Button size="sm" variant="secondary" className="mt-2.5 w-full" onClick={addMvpWorkflow}>
                  Build MVP chain
                </Button>
                <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={addZoneSequenceWorkflow}>
                  Build zone sequence
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto py-1">
                {workflows.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-text-tertiary">No workflows yet</p>
                ) : (
                  workflows.map((wf) => {
                    const isWfRunning = runningIds.has(wf.id)
                    return (
                      <button
                        key={wf.id}
                        onClick={() => loadWorkflow(wf)}
                        className={[
                          'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
                          selectedWf?.id === wf.id
                            ? 'bg-accent-subtle text-accent'
                            : 'text-text-secondary hover:bg-bg-overlay hover:text-text-primary',
                        ].join(' ')}
                      >
                        {isWfRunning ? (
                          <span className="relative flex h-2 w-2 shrink-0">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                          </span>
                        ) : wf.enabled ? (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-text-disabled" />
                        ) : null}
                        <span className="flex-1 truncate">{wf.name}</span>
                      </button>
                    )
                  })
                )}
              </div>
            </>
          )}

          {/* ── Nodes tab ── */}
          {leftTab === 'nodes' && (
            <>
              <div className="px-3 pb-1 pt-3">
                <p className="text-2xs text-text-disabled opacity-60">
                  Drag onto canvas or click to add
                </p>
              </div>

              <div className="flex-1 overflow-y-auto pb-2">
                {NODE_GROUPS.map((group) => {
                  const groupNodes = NODE_DEFINITIONS.filter((n) => n.group === group)
                  if (!groupNodes.length) return null
                  return (
                    <div key={group}>
                      <p className="px-3 pb-0.5 pt-2 text-2xs font-medium uppercase tracking-widest text-text-disabled opacity-50">
                        {group}
                      </p>
                      {groupNodes.map((item) => (
                        <button
                          key={item.type}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('application/reactflow-node', item.type)
                            e.dataTransfer.effectAllowed = 'move'
                          }}
                          onClick={() => addNode(item.type)}
                          className="flex w-full cursor-grab items-center gap-2 px-3 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-bg-overlay hover:text-text-primary active:cursor-grabbing"
                        >
                          <span
                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm"
                            style={{ background: `${item.color}20` }}
                          >
                            <NodeIcon type={item.type} color={item.color} />
                          </span>
                          <span className="flex-1 truncate">{item.label}</span>
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Save + Run controls */}
          <div className="space-y-2 border-t border-border-subtle p-3">
            <Input
              value={wfName}
              onChange={(e) => setWfName(e.target.value)}
              placeholder="Workflow name"
            />
            {validationErrors.length > 0 && (
              <ul className="space-y-0.5 rounded border border-danger/30 bg-danger-subtle px-3 py-2">
                {validationErrors.map((err, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-2xs text-danger-text">
                    <span className="mt-px shrink-0">•</span>
                    <span>{err}</span>
                  </li>
                ))}
              </ul>
            )}
            <Button className="w-full" onClick={save} disabled={saving || !wfName.trim()}>
              {saving ? 'Saving…' : 'Save workflow'}
            </Button>
            {selectedWf && (
              <Button
                className="w-full"
                variant={running ? 'danger' : 'secondary'}
                onClick={running ? stopWorkflow : startWorkflow}
              >
                {running ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-75" />
                    Stop workflow
                  </>
                ) : (
                  <>
                    <RunIcon />
                    Run workflow
                  </>
                )}
              </Button>
            )}
            <div className="flex gap-1.5 pt-1.5 border-t border-border-subtle">
              <Button
                className="flex-1"
                size="xs"
                variant="ghost"
                onClick={exportWorkflow}
                disabled={!selectedWf}
                title="Download the current workflow as JSON"
              >
                Export
              </Button>
              <Button
                className="flex-1"
                size="xs"
                variant="ghost"
                onClick={() => importInputRef.current?.click()}
                title="Restore a workflow from a JSON file"
              >
                Import
              </Button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) importWorkflow(f)
                }}
              />
            </div>
            {notice && (
              <p className={`text-center text-xs ${notice.ok ? 'text-success-text' : 'text-danger-text'}`}>
                {notice.msg}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Canvas ── */}
      <div
        className="relative min-w-0 flex-1 bg-[#09090d]"
        onDrop={onDrop}
        onDragOver={onDragOver}
      >
        {/* Canvas toolbar */}
        <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-surface/90 px-3 py-1.5 shadow-lg backdrop-blur">
            <span className="max-w-[160px] truncate text-xs font-medium text-text-secondary">
              {wfName || 'Untitled workflow'}
            </span>
            {selectedWf && (
              <>
                <span className="mx-0.5 h-3.5 w-px bg-border-subtle" />
                {running ? (
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                  </span>
                ) : (
                  <span className="h-2 w-2 rounded-full bg-border-strong" />
                )}
                <span className={`text-xs ${running ? 'text-success-text' : 'text-text-disabled'}`}>
                  {running ? 'Running' : 'Stopped'}
                </span>
                <span className="mx-0.5 h-3.5 w-px bg-border-subtle" />
                <button
                  onClick={running ? stopWorkflow : startWorkflow}
                  className={[
                    'flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium transition-colors',
                    running
                      ? 'bg-danger/15 text-danger hover:bg-danger/25'
                      : 'bg-success/15 text-success-text hover:bg-success/25',
                  ].join(' ')}
                >
                  {running ? (
                    <>
                      <svg viewBox="0 0 10 10" width={8} height={8} fill="currentColor"><rect width={10} height={10} rx={1} /></svg>
                      Stop
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 10 10" width={8} height={8} fill="currentColor"><path d="M2 1l7 4-7 4z" /></svg>
                      Run
                    </>
                  )}
                </button>
              </>
            )}
            <span className="mx-0.5 h-3.5 w-px bg-border-subtle" />
            <button
              onClick={save}
              disabled={saving || !wfName.trim()}
              className="rounded px-2 py-0.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-overlay hover:text-text-primary disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          onNodesDelete={(deleted) => {
            if (deleted.some((n) => n.id === selectedNodeId)) setSelectedNodeId(null)
          }}
          onInit={setRfInstance}
          deleteKeyCode={['Delete', 'Backspace']}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          defaultEdgeOptions={{ style: { stroke: '#32324a', strokeWidth: 1.5 } }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1a1a24" />
          <Controls />
          <MiniMap
            nodeColor={(node) => nodeMap.get(node.data?.type as string)?.color ?? '#32324a'}
            maskColor="rgba(9,9,13,0.85)"
            style={{ background: '#0f0f15', border: '1px solid #252533' }}
          />
        </ReactFlow>
      </div>

      {/* ── Inspector ── */}
      <NodeInspector
        node={selectedNode}
        nodes={nodes}
        edges={edges}
        sources={sources}
        models={models}
        datasets={datasets}
        brokers={brokers}
        reloadBrokers={loadBrokers}
        onChange={updateSelectedConfig}
        onDeleteNode={() => {
          if (selectedNodeId) {
            setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId))
            setEdges((eds) => eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId))
            setSelectedNodeId(null)
          }
        }}
        overlayConfig={(nodes.find((n) => n.data?.type === 'overlay')?.data?.config ?? {}) as NodeConfig}
        onOverlayChange={updateOverlayConfig}
      />
    </div>
  )
}

// ─── Inspector panel ─────────────────────────────────────────────────────────

function NodeInspector({
  node,
  nodes,
  edges,
  sources,
  models,
  datasets,
  brokers,
  reloadBrokers,
  onChange,
  onDeleteNode,
  overlayConfig,
  onOverlayChange,
}: {
  node: Node | null
  nodes: Node[]
  edges: Edge[]
  sources: Source[]
  models: YoloModel[]
  datasets: Dataset[]
  brokers: MqttBroker[]
  reloadBrokers: () => void
  onChange: (patch: NodeConfig) => void
  onDeleteNode: () => void
  overlayConfig: NodeConfig
  onOverlayChange: (patch: NodeConfig) => void
}) {
  const config = (node?.data?.config ?? {}) as NodeConfig
  const type = node?.data?.type as string | undefined
  const definition = type ? nodeMap.get(type) : null

  // Find the upstream source_id for nodes that need it (zone_filter, etc.)
  const upstreamSourceId = useMemo(() => {
    if (!node) return null
    return findUpstreamSourceId(node.id, nodes, edges)
  }, [node?.id, nodes, edges])

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-border-subtle bg-bg-surface">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border-subtle bg-bg-surface px-4 py-3">
        <p className="text-2xs font-semibold uppercase tracking-widest text-text-disabled">
          Node settings
        </p>
        {definition ? (
          <div className="mt-1.5 flex items-center gap-2">
            <div
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm"
              style={{ background: `${definition.color}20` }}
            >
              <NodeIcon type={definition.type} color={definition.color} />
            </div>
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
              {definition.label}
            </h2>
            <span
              className="shrink-0 rounded px-1 py-0.5 text-2xs font-medium"
              style={{ background: `${definition.color}15`, color: definition.color }}
            >
              {definition.group}
            </span>
            <button
              title="Delete node (Del)"
              onClick={onDeleteNode}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-disabled hover:bg-danger/20 hover:text-danger"
            >
              <svg viewBox="0 0 14 14" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
                <path d="M2 4h10M5 4V2.5h4V4M3 4l.7 7.5h6.6L11 4" />
                <path d="M5.5 6.5v3.5M8.5 6.5v3.5" />
              </svg>
            </button>
          </div>
        ) : (
          <h2 className="mt-1 text-sm text-text-tertiary">Select a node</h2>
        )}
      </div>

      {!node || !definition ? (
        <div className="space-y-5 px-4 py-4">
          {/* Display settings — always accessible without selecting a node */}
          <div>
            <p className="mb-3 text-2xs font-semibold uppercase tracking-widest text-text-disabled">
              Display Settings
            </p>
            <p className="mb-3 text-2xs text-text-tertiary">
              Contrôle l'affichage des annotations sur le flux live. Ajoute automatiquement un nœud Overlay si absent.
            </p>
            <InspectorSection label="Détections">
              <div className="space-y-px rounded-lg border border-border-subtle bg-bg-overlay">
                <Toggle label="Bounding boxes" checked={overlayConfig.show_boxes !== false} onChange={(v) => onOverlayChange({ show_boxes: v })} inset />
                <div className="mx-3 border-t border-border-subtle" />
                <Toggle label="Masque segmentation" checked={overlayConfig.show_mask === true} onChange={(v) => onOverlayChange({ show_mask: v })} inset />
              </div>
              {overlayConfig.show_boxes !== false && (
                <div className="mt-2 space-y-2">
                  <div>
                    <p className="mb-1 text-2xs text-text-disabled">Style de boîte</p>
                    <Select
                      value={String(overlayConfig.box_style ?? 'box')}
                      onChange={(e) => onOverlayChange({ box_style: e.target.value })}
                    >
                      <option value="box">Rectangulaire</option>
                      <option value="round">Arrondi</option>
                      <option value="ellipse">Ellipse</option>
                      <option value="dot">Point central</option>
                      <option value="triangle">Triangle</option>
                    </Select>
                  </div>
                  {!['dot', 'triangle'].includes(String(overlayConfig.box_style ?? 'box')) && (
                    <div>
                      <p className="mb-1 text-2xs text-text-disabled">
                        Épaisseur — {Number(overlayConfig.box_thickness ?? 2)} px
                      </p>
                      <input
                        type="range" min={1} max={6} step={1}
                        value={Number(overlayConfig.box_thickness ?? 2)}
                        onChange={(e) => onOverlayChange({ box_thickness: Number(e.target.value) })}
                        className="w-full accent-accent"
                      />
                    </div>
                  )}
                </div>
              )}
            </InspectorSection>
            <div className="mt-3">
              <InspectorSection label="Labels">
                <div className="space-y-px rounded-lg border border-border-subtle bg-bg-overlay">
                  <Toggle label="Classe" checked={overlayConfig.show_labels !== false} onChange={(v) => onOverlayChange({ show_labels: v })} inset />
                  <div className="mx-3 border-t border-border-subtle" />
                  <Toggle label="Confiance" checked={overlayConfig.show_confidence !== false} onChange={(v) => onOverlayChange({ show_confidence: v })} inset />
                  <div className="mx-3 border-t border-border-subtle" />
                  <Toggle label="Tracker ID" checked={overlayConfig.show_tracker_id !== false} onChange={(v) => onOverlayChange({ show_tracker_id: v })} inset />
                </div>
                {overlayConfig.show_labels !== false && (
                  <div className="mt-2">
                    <p className="mb-1 text-2xs text-text-disabled">Position</p>
                    <Select
                      value={String(overlayConfig.label_position ?? 'top_left')}
                      onChange={(e) => onOverlayChange({ label_position: e.target.value })}
                    >
                      <option value="top_left">Haut gauche</option>
                      <option value="top_center">Haut centre</option>
                      <option value="bottom_center">Bas centre</option>
                      <option value="center">Centre</option>
                    </Select>
                  </div>
                )}
              </InspectorSection>
            </div>
            {nodes.length > 0 && !nodes.some((n) => n.data?.type === 'overlay') && (
              <p className="mt-2 text-2xs text-text-tertiary opacity-70">
                Aucun nœud Overlay — il sera ajouté automatiquement à la modification.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-5 px-4 py-4">
          <InspectorSection label="Runtime">
            <p className="font-mono text-xs text-text-secondary">{definition.type}</p>
          </InspectorSection>

          {type === 'schedule_trigger' && (
            <ScheduleTriggerInspector config={config} onChange={onChange} />
          )}

          {type === 'source' && (
            <>
              <InspectorSection label="Source">
                <Select
                  value={String(config.source_id ?? '')}
                  onChange={(e) => onChange({ source_id: Number(e.target.value) })}
                >
                  <option value="">Select source…</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      #{s.id} {s.name} ({s.type})
                    </option>
                  ))}
                </Select>
              </InspectorSection>
              {/* Live preview refresh button */}
              {config.source_id && (
                <SourcePreviewPanel sourceId={config.source_id as number} />
              )}
            </>
          )}

          {type === 'satellite_scene' && (
            <NumberField
              label="Satellite scene ID"
              min={1} max={999999} step={1}
              value={numericValue(config.scene_id, 1)}
              onChange={(v) => onChange({ scene_id: Math.round(v) })}
            />
          )}

          {type === 'yolo_detect' && (
            <>
              <InspectorSection label="Model">
                <Select
                  value={String(config.model_path ?? 'yolov8n.pt')}
                  onChange={(e) => onChange({ model_path: e.target.value })}
                >
                  <option value="yolov8n.pt">YOLOv8n (built-in)</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.path}>{m.name}</option>
                  ))}
                </Select>
              </InspectorSection>
              <InspectorSection label="Device">
                <Select
                  value={String(config.device ?? 'auto')}
                  onChange={(e) => onChange({ device: e.target.value })}
                >
                  <option value="auto">Auto (CUDA → CPU)</option>
                  <option value="cuda">CUDA (GPU)</option>
                  <option value="cpu">CPU only</option>
                </Select>
              </InspectorSection>
              <NumberField
                label="Confidence threshold"
                min={0.05} max={1} step={0.05}
                value={numericValue(config.confidence, 0.25)}
                onChange={(v) => onChange({ confidence: v })}
              />
              <NumberField
                label="IoU threshold"
                min={0.1} max={1} step={0.05}
                value={numericValue(config.iou, 0.7)}
                onChange={(v) => onChange({ iou: v })}
              />
            </>
          )}

          {type === 'tracker' && (
            <>
              <Toggle
                label="Enabled"
                checked={boolValue(config.enabled)}
                onChange={(v) => onChange({ enabled: v })}
              />
              <InspectorSection label="Algorithm">
                <Input
                  value={String(config.tracker ?? 'bytetrack')}
                  onChange={(e) => onChange({ tracker: e.target.value })}
                />
              </InspectorSection>
            </>
          )}

          {type === 'class_filter' && (
            <InspectorSection label="Classes (comma-separated)" hint="e.g. person, car, bicycle">
              <Input
                value={Array.isArray(config.classes) ? (config.classes as string[]).join(', ') : ''}
                onChange={(e) =>
                  onChange({ classes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                }
              />
            </InspectorSection>
          )}

          {type === 'confidence_filter' && (
            <NumberField
              label="Minimum confidence"
              min={0.05} max={1} step={0.05}
              value={numericValue(config.min_confidence, 0.5)}
              onChange={(v) => onChange({ min_confidence: v })}
            />
          )}

          {type === 'color_filter' && (
            <ColorFilterInspector config={config} onChange={onChange} />
          )}

          {type === 'zone_filter' && (
            <ZoneFilterInspector
              key={node.id}
              zones={config.zones as ZoneConfig[] | undefined}
              sourceId={upstreamSourceId}
              onChange={(zones) => onChange({ zones })}
            />
          )}

          {type === 'event_trigger' && (
            <>
              <NumberField
                label="Cooldown (seconds)"
                min={0} max={120} step={1}
                value={numericValue(config.cooldown_seconds, 5)}
                onChange={(v) => onChange({ cooldown_seconds: v })}
              />
              <Toggle
                label="Trigger once per object"
                checked={boolValue(config.trigger_once_per_object)}
                onChange={(v) => onChange({ trigger_once_per_object: v })}
              />
            </>
          )}

          {type === 'zone_sequence_trigger' && (
            <ZoneSequenceInspector
              key={node.id}
              config={config}
              sourceId={upstreamSourceId}
              onChange={onChange}
            />
          )}

          {type === 'geo_zone_trigger' && (
            <GeoZoneTriggerInspector config={config} onChange={onChange} />
          )}

          {type === 'save_event' && (
            <>
              <Toggle
                label="Save frame snapshot"
                checked={boolValue(config.save_frame)}
                onChange={(v) => onChange({ save_frame: v })}
              />
              <Toggle
                label="Save metadata"
                checked={config.save_metadata !== false}
                onChange={(v) => onChange({ save_metadata: v })}
              />
              <CustomColumnsEditor
                columns={(config.custom_columns ?? []) as CustomColumn[]}
                onChange={(cols) => onChange({ custom_columns: cols })}
              />
            </>
          )}

          {type === 'overlay' && (
            <>
              <InspectorSection label="Détections">
                <div className="space-y-px rounded-lg border border-border-subtle bg-bg-overlay">
                  <Toggle label="Bounding boxes" checked={config.show_boxes !== false} onChange={(v) => onChange({ show_boxes: v })} inset />
                  <div className="mx-3 border-t border-border-subtle" />
                  <Toggle label="Masque de segmentation" checked={config.show_mask === true} onChange={(v) => onChange({ show_mask: v })} inset />
                </div>
                {config.show_boxes !== false && (
                  <div className="mt-2 space-y-2">
                    <div>
                      <p className="mb-1 text-2xs text-text-disabled">Style</p>
                      <Select
                        value={String(config.box_style ?? 'box')}
                        onChange={(e) => onChange({ box_style: e.target.value })}
                      >
                        <option value="box">Rectangulaire</option>
                        <option value="round">Arrondi</option>
                        <option value="ellipse">Ellipse</option>
                        <option value="dot">Point central</option>
                        <option value="triangle">Triangle</option>
                      </Select>
                    </div>
                    {!['dot', 'triangle'].includes(String(config.box_style ?? 'box')) && (
                      <div>
                        <p className="mb-1 text-2xs text-text-disabled">Épaisseur — {Number(config.box_thickness ?? 2)} px</p>
                        <input
                          type="range" min={1} max={6} step={1}
                          value={Number(config.box_thickness ?? 2)}
                          onChange={(e) => onChange({ box_thickness: Number(e.target.value) })}
                          className="w-full accent-accent"
                        />
                      </div>
                    )}
                  </div>
                )}
              </InspectorSection>

              <InspectorSection label="Labels">
                <div className="space-y-px rounded-lg border border-border-subtle bg-bg-overlay">
                  <Toggle label="Labels de classe" checked={config.show_labels !== false} onChange={(v) => onChange({ show_labels: v })} inset />
                  <div className="mx-3 border-t border-border-subtle" />
                  <Toggle label="Score de confiance" checked={config.show_confidence !== false} onChange={(v) => onChange({ show_confidence: v })} inset />
                  <div className="mx-3 border-t border-border-subtle" />
                  <Toggle label="Tracker ID" checked={config.show_tracker_id !== false} onChange={(v) => onChange({ show_tracker_id: v })} inset />
                </div>
                {config.show_labels !== false && (
                  <div className="mt-2">
                    <p className="mb-1 text-2xs text-text-disabled">Position du label</p>
                    <Select
                      value={String(config.label_position ?? 'top_left')}
                      onChange={(e) => onChange({ label_position: e.target.value })}
                    >
                      <option value="top_left">Haut gauche</option>
                      <option value="top_center">Haut centre</option>
                      <option value="bottom_center">Bas centre</option>
                      <option value="center">Centre</option>
                    </Select>
                  </div>
                )}
              </InspectorSection>
            </>
          )}

          {type === 'harvest' && (
            <HarvestInspector
              config={config}
              datasets={datasets}
              onChange={onChange}
            />
          )}

          {type === 'line_crossing' && (
            <LineCrossingInspector config={config} onChange={onChange} sourceId={upstreamSourceId} />
          )}

          {type === 'crop_save' && (
            <CropSaveInspector config={config} onChange={onChange} />
          )}

          {type === 'notify' && (
            <NotifyInspector
              config={config}
              brokers={brokers}
              reloadBrokers={reloadBrokers}
              onChange={onChange}
            />
          )}
        </div>
      )}
    </aside>
  )
}

// ─── Source preview panel (inspector) ────────────────────────────────────────

function SourcePreviewPanel({ sourceId }: { sourceId: number }) {
  const [frame, setFrame] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const d = await sourcesApi.preview(sourceId)
      setFrame(d.frame ?? null)
    } catch {
    } finally {
      setLoading(false)
    }
  }, [sourceId])

  useEffect(() => { refresh() }, [refresh])

  return (
    <InspectorSection label="Live preview">
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-overlay" style={{ minHeight: 80 }}>
        {frame ? (
          <img
            src={`data:image/jpeg;base64,${frame}`}
            className="block w-full"
            draggable={false}
            alt="source preview"
          />
        ) : (
          <div className="flex h-20 items-center justify-center">
            <span className="text-2xs text-text-disabled">{loading ? 'Loading…' : 'No frame'}</span>
          </div>
        )}
      </div>
      <Button size="xs" variant="ghost" onClick={refresh} disabled={loading} className="w-full">
        {loading ? 'Refreshing…' : 'Refresh preview'}
      </Button>
    </InspectorSection>
  )
}

// ─── Inspector sub-components ────────────────────────────────────────────────

function InspectorSection({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-2xs font-semibold uppercase tracking-wider text-text-disabled">{label}</p>
      {hint && <p className="text-2xs text-text-tertiary">{hint}</p>}
      {children}
    </div>
  )
}

interface ZoneConfig {
  name: string
  points: [number, number][]
}

const COLOR_OPTIONS = [
  { value: 'green', label: 'Green', swatch: '#22c55e' },
  { value: 'blue', label: 'Blue', swatch: '#3b82f6' },
  { value: 'red', label: 'Red', swatch: '#ef4444' },
  { value: 'yellow', label: 'Yellow', swatch: '#eab308' },
  { value: 'orange', label: 'Orange', swatch: '#f97316' },
  { value: 'white', label: 'White', swatch: '#f8fafc' },
  { value: 'black', label: 'Black', swatch: '#111827' },
  { value: 'gray', label: 'Gray', swatch: '#94a3b8' },
]

function ColorFilterInspector({
  config,
  onChange,
}: {
  config: NodeConfig
  onChange: (patch: NodeConfig) => void
}) {
  const target = String(config.target_color ?? 'green')
  return (
    <>
      <InspectorSection label="Target color">
        <div className="grid grid-cols-2 gap-1.5">
          {COLOR_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange({ target_color: option.value })}
              className={[
                'flex items-center gap-2 rounded border px-2 py-1.5 text-left text-xs transition-colors',
                target === option.value
                  ? 'border-accent bg-accent-subtle text-text-primary'
                  : 'border-border-subtle bg-bg-overlay text-text-secondary hover:border-border hover:text-text-primary',
              ].join(' ')}
            >
              <span
                className="h-3 w-3 rounded-sm border border-white/20"
                style={{ background: option.swatch }}
              />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </InspectorSection>
      <NumberField
        label="Minimum color coverage"
        min={0.01} max={0.8} step={0.01}
        value={numericValue(config.min_color_ratio, 0.12)}
        onChange={(v) => onChange({ min_color_ratio: v })}
      />
      <NumberField
        label="Minimum saturation"
        min={0} max={255} step={5}
        value={numericValue(config.min_saturation, 40)}
        onChange={(v) => onChange({ min_saturation: Math.round(v) })}
      />
      <NumberField
        label="Minimum brightness"
        min={0} max={255} step={5}
        value={numericValue(config.min_value, 40)}
        onChange={(v) => onChange({ min_value: Math.round(v) })}
      />
      <NumberField
        label="BBox padding (px)"
        min={0} max={80} step={2}
        value={numericValue(config.bbox_padding_px, 0)}
        onChange={(v) => onChange({ bbox_padding_px: Math.round(v) })}
      />
    </>
  )
}

function ZoneSequenceInspector({
  config,
  sourceId,
  onChange,
}: {
  config: NodeConfig
  sourceId?: number | null
  onChange: (patch: NodeConfig) => void
}) {
  const zones = normalizeZones(config.zones as ZoneConfig[] | undefined)
  const zoneNames = zones.map((zone, index) => zone.name || `Zone ${index + 1}`)
  const configuredSequence = Array.isArray(config.sequence)
    ? (config.sequence as unknown[]).map(String).filter(Boolean)
    : ['Zone 1', 'Zone 2']
  const sequence = [
    configuredSequence[0] ?? zoneNames[0] ?? 'Zone 1',
    configuredSequence[1] ?? zoneNames[1] ?? 'Zone 2',
  ]

  const setSequenceItem = (index: number, value: string) => {
    const next = [...sequence]
    next[index] = value
    onChange({ sequence: next })
  }

  const updateZones = (nextZones: ZoneConfig[]) => {
    const nextNames = nextZones.map((zone, index) => zone.name || `Zone ${index + 1}`)
    const validSequence = sequence.filter((name) => nextNames.includes(name))
    onChange({
      zones: nextZones,
      sequence: validSequence.length >= 2 ? validSequence.slice(0, 2) : nextNames.slice(0, 2),
    })
  }

  return (
    <div className="space-y-4">
      <ZoneFilterInspector
        zones={config.zones as ZoneConfig[] | undefined}
        sourceId={sourceId}
        onChange={updateZones}
      />

      <InspectorSection label="Required order" hint="The same tracker_id must visit both zones in this order.">
        <div className="space-y-2">
          <Select
            value={sequence[0]}
            onChange={(e) => setSequenceItem(0, e.target.value)}
            disabled={zoneNames.length === 0}
          >
            {zoneNames.length === 0 ? (
              <option value={sequence[0]}>Create zones first</option>
            ) : zoneNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </Select>
          <Select
            value={sequence[1]}
            onChange={(e) => setSequenceItem(1, e.target.value)}
            disabled={zoneNames.length === 0}
          >
            {zoneNames.length === 0 ? (
              <option value={sequence[1]}>Create zones first</option>
            ) : zoneNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </Select>
        </div>
      </InspectorSection>

      <NumberField
        label="Max seconds between zones"
        min={1} max={600} step={1}
        value={numericValue(config.max_seconds_between_zones, 30)}
        onChange={(v) => onChange({ max_seconds_between_zones: Math.round(v) })}
      />
      <NumberField
        label="Cooldown after trigger"
        min={0} max={300} step={1}
        value={numericValue(config.cooldown_seconds, 0)}
        onChange={(v) => onChange({ cooldown_seconds: Math.round(v) })}
      />
      <Toggle
        label="Trigger once per object"
        checked={config.trigger_once_per_object !== false}
        onChange={(v) => onChange({ trigger_once_per_object: v })}
      />
      <InspectorSection label="Point d'ancrage">
        <Select value={String(config.anchor ?? 'bottom_center')} onChange={(e) => onChange({ anchor: e.target.value })}>
          <option value="bottom_center">Bottom center</option>
          <option value="center">Center</option>
          <option value="top_center">Top center</option>
        </Select>
      </InspectorSection>
    </div>
  )
}

// ─── Zone Filter Inspector ───────────────────────────────────────────────────

function GeoZoneTriggerInspector({
  config,
  onChange,
}: {
  config: NodeConfig
  onChange: (patch: NodeConfig) => void
}) {
  const areas = Array.isArray(config.areas) ? config.areas : []
  const [areasText, setAreasText] = useState(JSON.stringify(areas, null, 2))

  useEffect(() => {
    setAreasText(JSON.stringify(Array.isArray(config.areas) ? config.areas : [], null, 2))
  }, [config.areas])

  const applyAreas = () => {
    try {
      const parsed = JSON.parse(areasText)
      onChange({ areas: Array.isArray(parsed) ? parsed : [] })
    } catch {
    }
  }

  const addSampleArea = () => {
    const next = [
      ...areas,
      {
        name: `Geo Zone ${areas.length + 1}`,
        geojson: {
          type: 'Polygon',
          coordinates: [[[2, 48], [3, 48], [3, 49], [2, 49], [2, 48]]],
        },
      },
    ]
    onChange({ areas: next })
  }

  return (
    <>
      <NumberField
        label="Max cloud cover"
        min={0} max={100} step={1}
        value={numericValue(config.max_cloud_cover, 30)}
        onChange={(v) => onChange({ max_cloud_cover: Math.round(v) })}
      />
      <InspectorSection label="Event class">
        <Input
          value={String(config.event_class_name ?? 'satellite_scene')}
          onChange={(e) => onChange({ event_class_name: e.target.value })}
        />
      </InspectorSection>
      <InspectorSection label="Geo areas" hint="Array of { name, geojson }. Coordinates use lon/lat.">
        <textarea
          value={areasText}
          onChange={(e) => setAreasText(e.target.value)}
          rows={8}
          className="w-full resize-none rounded border border-border bg-bg-overlay px-2 py-1.5 font-mono text-2xs text-text-primary focus:border-accent/50 focus:outline-none"
        />
        <div className="mt-2 flex gap-2">
          <Button size="xs" variant="secondary" onClick={applyAreas}>Apply JSON</Button>
          <Button size="xs" variant="ghost" onClick={addSampleArea}>Add sample AOI</Button>
        </div>
      </InspectorSection>
    </>
  )
}

function ZoneFilterInspector({
  zones,
  onChange,
  sourceId,
}: {
  zones: ZoneConfig[] | undefined
  onChange: (zones: ZoneConfig[]) => void
  sourceId?: number | null
}) {
  // Native backend frame space — see FRAME_WIDTH/HEIGHT in LiveViewPage.
  const editorWidth = 1280
  const editorHeight = 720
  const zoneList = useMemo(() => normalizeZones(zones), [zones])
  const [selectedZoneIndex, setSelectedZoneIndex] = useState(0)
  const [dragPoint, setDragPoint] = useState<{ zoneIndex: number; pointIndex: number } | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const selectedZone = zoneList[selectedZoneIndex] ?? null

  useEffect(() => {
    if (zoneList.length === 0) {
      setSelectedZoneIndex(0)
    } else if (selectedZoneIndex > zoneList.length - 1) {
      setSelectedZoneIndex(zoneList.length - 1)
    }
  }, [selectedZoneIndex, zoneList.length])

  const commit = (nextZones: ZoneConfig[]) => {
    onChange(nextZones.map((zone) => ({
      name: zone.name,
      points: zone.points.map(([x, y]) => [Math.round(x), Math.round(y)] as [number, number]),
    })))
  }

  const updateZone = (index: number, patch: Partial<ZoneConfig>) => {
    commit(zoneList.map((zone, i) => (i === index ? { ...zone, ...patch } : zone)))
  }

  const addZone = (presetKey = 'rectangle') => {
    const preset = ZONE_PRESETS[presetKey] ?? ZONE_PRESETS.rectangle
    const nextZone: ZoneConfig = {
      name: `Zone ${zoneList.length + 1}`,
      points: preset.build(),
    }
    commit([...zoneList, nextZone])
    setSelectedZoneIndex(zoneList.length)
  }

  const deleteZone = () => {
    if (!selectedZone) return
    const nextZones = zoneList.filter((_, i) => i !== selectedZoneIndex)
    commit(nextZones)
    setSelectedZoneIndex(Math.max(0, selectedZoneIndex - 1))
  }

  const clearPoints = () => {
    if (!selectedZone) return
    updateZone(selectedZoneIndex, { points: [] })
  }

  const pointFromEvent = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * editorWidth
    const y = ((event.clientY - rect.top) / rect.height) * editorHeight
    return [
      Math.min(editorWidth, Math.max(0, x)),
      Math.min(editorHeight, Math.max(0, y)),
    ] as [number, number]
  }

  const addPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!selectedZone || dragPoint) return
    updateZone(selectedZoneIndex, { points: [...selectedZone.points, pointFromEvent(event)] })
  }

  const movePoint = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!dragPoint) return
    const point = pointFromEvent(event)
    const zone = zoneList[dragPoint.zoneIndex]
    if (!zone) return
    const points = zone.points.map((item, i) => (i === dragPoint.pointIndex ? point : item))
    updateZone(dragPoint.zoneIndex, { points })
  }

  const removePoint = (zoneIndex: number, pointIndex: number) => {
    const zone = zoneList[zoneIndex]
    if (!zone) return
    updateZone(zoneIndex, { points: zone.points.filter((_, i) => i !== pointIndex) })
  }

  return (
    <div className="space-y-3">
      <InspectorSection label="Zone polygons">
        <div className="flex gap-2">
          <Button size="xs" variant="secondary" onClick={() => addZone('rectangle')} className="flex-1">Add zone</Button>
          <Button size="xs" variant="danger" onClick={deleteZone} disabled={!selectedZone}>Delete</Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setModalOpen(true)}
            title="Open full-screen editor"
          >
            <svg viewBox="0 0 14 14" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
              <path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" />
            </svg>
          </Button>
        </div>
        <div className="mt-2">
          <p className="mb-1 text-2xs text-text-disabled">Formes pré-faites</p>
          <div className="grid grid-cols-2 gap-1">
            {ZONE_PRESET_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => addZone(k)}
                className="flex flex-col items-center gap-1 rounded border border-border-subtle bg-bg-overlay py-1.5 text-2xs text-text-secondary hover:border-accent/40 hover:text-text-primary"
              >
                <ZonePresetShape presetKey={k} />
                <span>{ZONE_PRESETS[k].label}</span>
              </button>
            ))}
          </div>
        </div>
      </InspectorSection>

      {zoneList.length > 0 && (
        <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto rounded border border-border-subtle bg-bg-overlay p-1">
          {zoneList.map((zone, index) => (
            <button
              key={`${zone.name}_${index}`}
              type="button"
              onClick={() => setSelectedZoneIndex(index)}
              className={[
                'rounded px-2 py-1 text-2xs transition-colors',
                index === selectedZoneIndex
                  ? 'bg-accent text-white'
                  : 'bg-bg-raised text-text-secondary hover:text-text-primary',
              ].join(' ')}
            >
              {zone.name || `Zone ${index + 1}`}
            </button>
          ))}
        </div>
      )}

      {/* Compact inline SVG editor */}
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-[#0a0b10]">
        <svg
          viewBox={`0 0 ${editorWidth} ${editorHeight}`}
          className="block aspect-video w-full touch-none"
          onPointerDown={addPoint}
          onPointerMove={movePoint}
          onPointerUp={() => setDragPoint(null)}
          onPointerLeave={() => setDragPoint(null)}
        >
          <defs>
            <pattern id="zone-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#20212b" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width={editorWidth} height={editorHeight} fill="url(#zone-grid)" />
          <rect x="1" y="1" width={editorWidth - 2} height={editorHeight - 2} fill="none" stroke="#2b2d3a" />
          <ZonePolygons
            zones={zoneList}
            selectedZoneIndex={selectedZoneIndex}
            dragPoint={dragPoint}
            onSelectZone={setSelectedZoneIndex}
            onDragStart={setDragPoint}
            onRemovePoint={removePoint}
            color="#a78bfa"
          />
        </svg>
      </div>

      {selectedZone ? (
        <>
          <InspectorSection label="Selected zone">
            <Input
              value={selectedZone.name}
              onChange={(e) => updateZone(selectedZoneIndex, { name: e.target.value })}
            />
          </InspectorSection>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-2xs text-text-tertiary">
              {selectedZone.points.length} pts
            </span>
            <Button size="xs" variant="ghost" onClick={clearPoints} disabled={selectedZone.points.length === 0}>
              Clear points
            </Button>
          </div>
          {selectedZone.points.length > 0 && (
            <div className="max-h-24 overflow-y-auto rounded border border-border-subtle bg-bg-overlay">
              {selectedZone.points.map(([x, y], index) => (
                <div
                  key={index}
                  className="flex items-center justify-between border-b border-border-subtle px-2 py-1 last:border-b-0"
                >
                  <span className="text-2xs text-text-secondary">P{index + 1}</span>
                  <span className="font-mono text-2xs text-text-tertiary">{Math.round(x)}, {Math.round(y)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="rounded border border-border-subtle bg-bg-overlay px-3 py-2 text-xs text-text-tertiary">
          No zones defined — click &ldquo;Add zone&rdquo; to start
        </p>
      )}

      {/* Full-screen zone editor modal */}
      <ZoneEditorModal
        open={modalOpen}
        sourceId={sourceId ?? null}
        zones={zoneList}
        onClose={() => setModalOpen(false)}
        onApply={(updated) => {
          commit(updated)
          setModalOpen(false)
        }}
      />
    </div>
  )
}

// ─── Shared SVG zone polygons renderer ───────────────────────────────────────

function ZonePolygons({
  zones,
  selectedZoneIndex,
  dragPoint,
  onSelectZone,
  onDragStart,
  onRemovePoint,
  color,
}: {
  zones: ZoneConfig[]
  selectedZoneIndex: number
  dragPoint: { zoneIndex: number; pointIndex: number } | null
  onSelectZone: (i: number) => void
  onDragStart: (d: { zoneIndex: number; pointIndex: number }) => void
  onRemovePoint: (zi: number, pi: number) => void
  color: string
}) {
  return (
    <>
      {zones.map((zone, zoneIndex) => {
        const isSelected = zoneIndex === selectedZoneIndex
        const points = zone.points.map(([x, y]) => `${x},${y}`).join(' ')
        return (
          <g key={`${zone.name}_${zoneIndex}`} opacity={isSelected ? 1 : 0.45}>
            {zone.points.length > 1 && (
              <polyline
                points={points}
                fill={zone.points.length > 2 ? `${color}26` : 'none'}
                stroke={isSelected ? color : '#55556e'}
                strokeWidth={isSelected ? 3 : 2}
                strokeLinejoin="round"
              />
            )}
            {zone.points.length > 2 && (
              <polygon points={points} fill={`${color}18`} stroke="none" />
            )}
            {zone.points.map(([x, y], pointIndex) => (
              <g key={`${zoneIndex}_${pointIndex}`}>
                <circle
                  cx={x}
                  cy={y}
                  r={isSelected ? 9 : 6}
                  fill={isSelected ? color : '#55556e'}
                  stroke="#0a0b10"
                  strokeWidth={3}
                  className="cursor-grab"
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    onSelectZone(zoneIndex)
                    onDragStart({ zoneIndex, pointIndex })
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    onRemovePoint(zoneIndex, pointIndex)
                  }}
                />
                {isSelected && (
                  <text x={x + 12} y={y - 10} fill="#d8d3ff" fontSize="18" fontFamily="monospace">
                    {pointIndex + 1}
                  </text>
                )}
              </g>
            ))}
          </g>
        )
      })}
    </>
  )
}

// ─── Full-screen zone editor modal ───────────────────────────────────────────

function ZoneEditorModal({
  open,
  sourceId,
  zones,
  onClose,
  onApply,
}: {
  open: boolean
  sourceId: number | null
  zones: ZoneConfig[]
  onClose: () => void
  onApply: (zones: ZoneConfig[]) => void
}) {
  const editorWidth = 1280
  const editorHeight = 720

  const [localZones, setLocalZones] = useState<ZoneConfig[]>([])
  const [selectedZoneIndex, setSelectedZoneIndex] = useState(0)
  const [dragPoint, setDragPoint] = useState<{ zoneIndex: number; pointIndex: number } | null>(null)
  const [frame, setFrame] = useState<string | null>(null)
  const [loadingFrame, setLoadingFrame] = useState(false)

  // Reset local state each time the modal opens
  useEffect(() => {
    if (open) {
      setLocalZones(normalizeZones(zones))
      setSelectedZoneIndex(0)
      setDragPoint(null)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchFrame = useCallback(async () => {
    if (!sourceId) return
    setLoadingFrame(true)
    try {
      const d = await sourcesApi.preview(sourceId)
      setFrame(d.frame ?? null)
    } catch {
    } finally {
      setLoadingFrame(false)
    }
  }, [sourceId])

  useEffect(() => {
    if (open && sourceId) fetchFrame()
    else if (!open) setFrame(null)
  }, [open, sourceId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const selectedZone = localZones[selectedZoneIndex] ?? null

  const commit = (next: ZoneConfig[]) => {
    setLocalZones(next.map((z) => ({
      name: z.name,
      points: z.points.map(([x, y]) => [Math.round(x), Math.round(y)] as [number, number]),
    })))
  }

  const updateZone = (index: number, patch: Partial<ZoneConfig>) => {
    commit(localZones.map((z, i) => (i === index ? { ...z, ...patch } : z)))
  }

  const addZone = (presetKey = 'rectangle') => {
    const preset = ZONE_PRESETS[presetKey] ?? ZONE_PRESETS.rectangle
    const next: ZoneConfig = {
      name: `Zone ${localZones.length + 1}`,
      points: preset.build(),
    }
    commit([...localZones, next])
    setSelectedZoneIndex(localZones.length)
  }

  const deleteZone = () => {
    if (!selectedZone) return
    const next = localZones.filter((_, i) => i !== selectedZoneIndex)
    commit(next)
    setSelectedZoneIndex(Math.max(0, selectedZoneIndex - 1))
  }

  const pointFromEvent = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * editorWidth
    const y = ((event.clientY - rect.top) / rect.height) * editorHeight
    return [
      Math.min(editorWidth, Math.max(0, x)),
      Math.min(editorHeight, Math.max(0, y)),
    ] as [number, number]
  }

  const addPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!selectedZone || dragPoint) return
    updateZone(selectedZoneIndex, { points: [...selectedZone.points, pointFromEvent(event)] })
  }

  const movePoint = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!dragPoint) return
    const point = pointFromEvent(event)
    const zone = localZones[dragPoint.zoneIndex]
    if (!zone) return
    const points = zone.points.map((item, i) => (i === dragPoint.pointIndex ? point : item))
    updateZone(dragPoint.zoneIndex, { points })
  }

  const removePoint = (zoneIndex: number, pointIndex: number) => {
    const zone = localZones[zoneIndex]
    if (!zone) return
    updateZone(zoneIndex, { points: zone.points.filter((_, i) => i !== pointIndex) })
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/85 p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-4xl rounded-xl border border-border-subtle bg-bg-surface shadow-2xl">
        {/* Modal header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3.5">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="#a78bfa" strokeWidth={1.5} strokeLinecap="round">
              <path d="M8 1.5L14 5v6L8 14.5 2 11V5z" />
              <path d="M8 5.5l3 2v3L8 12.5 5 10.5v-3z" />
            </svg>
            <h2 className="text-sm font-semibold text-text-primary">Zone Editor</h2>
            {!sourceId && (
              <span className="text-2xs text-text-tertiary">(no source connected)</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="xs" variant="ghost" onClick={fetchFrame} disabled={loadingFrame || !sourceId}>
              {loadingFrame ? 'Refreshing…' : 'Refresh frame'}
            </Button>
            <button
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded text-text-tertiary hover:bg-bg-overlay hover:text-text-primary"
            >
              <svg viewBox="0 0 12 12" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M1 1l10 10M11 1L1 11" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex gap-4 p-5">
          {/* Canvas */}
          <div className="min-w-0 flex-1">
            <div className="overflow-hidden rounded-lg border border-border-subtle bg-[#07070c]">
              <svg
                viewBox={`0 0 ${editorWidth} ${editorHeight}`}
                className="block w-full touch-none"
                style={{ aspectRatio: `${editorWidth}/${editorHeight}` }}
                onPointerDown={addPoint}
                onPointerMove={movePoint}
                onPointerUp={() => setDragPoint(null)}
                onPointerLeave={() => setDragPoint(null)}
              >
                {/* Background: source frame or grid */}
                {frame ? (
                  <image
                    href={`data:image/jpeg;base64,${frame}`}
                    x="0" y="0"
                    width={editorWidth}
                    height={editorHeight}
                    preserveAspectRatio="xMidYMid slice"
                  />
                ) : (
                  <>
                    <defs>
                      <pattern id="modal-zone-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#20212b" strokeWidth="1" />
                      </pattern>
                    </defs>
                    <rect width={editorWidth} height={editorHeight} fill="url(#modal-zone-grid)" />
                    {!sourceId && (
                      <text x={editorWidth / 2} y={editorHeight / 2} textAnchor="middle" fill="#55556e" fontSize="20" fontFamily="system-ui">
                        Connect a Source node to see preview
                      </text>
                    )}
                    {sourceId && loadingFrame && (
                      <text x={editorWidth / 2} y={editorHeight / 2} textAnchor="middle" fill="#55556e" fontSize="20" fontFamily="system-ui">
                        Loading…
                      </text>
                    )}
                  </>
                )}

                {/* Semi-transparent overlay on top of image */}
                {frame && <rect width={editorWidth} height={editorHeight} fill="rgba(0,0,0,0.15)" />}

                {/* Border */}
                <rect x="1" y="1" width={editorWidth - 2} height={editorHeight - 2} fill="none" stroke="#2b2d3a" strokeWidth="1" />

                <ZonePolygons
                  zones={localZones}
                  selectedZoneIndex={selectedZoneIndex}
                  dragPoint={dragPoint}
                  onSelectZone={setSelectedZoneIndex}
                  onDragStart={setDragPoint}
                  onRemovePoint={removePoint}
                  color="#a78bfa"
                />
              </svg>
            </div>

            <p className="mt-2 text-2xs text-text-disabled">
              Click on canvas to add points · Drag points to move · Double-click a point to remove
            </p>
          </div>

          {/* Sidebar controls */}
          <div className="w-52 shrink-0 space-y-4">
            {/* Zone list */}
            <div className="space-y-2">
              <p className="text-2xs font-semibold uppercase tracking-wider text-text-disabled">Zones</p>
              <div className="flex gap-1.5">
                <Button size="xs" variant="secondary" onClick={() => addZone('rectangle')} className="flex-1">+ Add</Button>
                <Button size="xs" variant="danger" onClick={deleteZone} disabled={!selectedZone}>Del</Button>
              </div>
              <div>
                <p className="mb-1 text-2xs text-text-disabled">Formes pré-faites</p>
                <div className="grid grid-cols-2 gap-1">
                  {ZONE_PRESET_KEYS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => addZone(k)}
                      className="flex flex-col items-center gap-1 rounded border border-border-subtle bg-bg-overlay py-1.5 text-2xs text-text-secondary hover:border-accent/40 hover:text-text-primary"
                    >
                      <ZonePresetShape presetKey={k} />
                      <span>{ZONE_PRESETS[k].label}</span>
                    </button>
                  ))}
                </div>
              </div>
              {localZones.length > 0 && (
                <div className="space-y-1 rounded border border-border-subtle bg-bg-overlay p-1">
                  {localZones.map((zone, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => setSelectedZoneIndex(index)}
                      className={[
                        'w-full rounded px-2 py-1 text-left text-2xs transition-colors',
                        index === selectedZoneIndex
                          ? 'bg-accent text-white'
                          : 'text-text-secondary hover:bg-bg-raised hover:text-text-primary',
                      ].join(' ')}
                    >
                      {zone.name || `Zone ${index + 1}`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selected zone properties */}
            {selectedZone && (
              <div className="space-y-2">
                <p className="text-2xs font-semibold uppercase tracking-wider text-text-disabled">Selected zone</p>
                <Input
                  value={selectedZone.name}
                  onChange={(e) => updateZone(selectedZoneIndex, { name: e.target.value })}
                  placeholder="Zone name"
                />
                <div className="flex items-center justify-between">
                  <span className="font-mono text-2xs text-text-tertiary">{selectedZone.points.length} pts</span>
                  <Button
                    size="xs" variant="ghost"
                    onClick={() => updateZone(selectedZoneIndex, { points: [] })}
                    disabled={selectedZone.points.length === 0}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            )}

            {/* Apply / Cancel */}
            <div className="space-y-1.5 pt-2">
              <Button className="w-full" onClick={() => onApply(localZones)}>Apply zones</Button>
              <Button className="w-full" variant="ghost" onClick={onClose}>Cancel</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Line Editor Modal ────────────────────────────────────────────────────────

interface LineCoords { start_x: number; start_y: number; end_x: number; end_y: number }

function LineEditorModal({
  open,
  sourceId,
  line,
  onClose,
  onApply,
}: {
  open: boolean
  sourceId: number | null
  line: LineCoords
  onClose: () => void
  onApply: (line: LineCoords) => void
}) {
  const editorWidth = 1280
  const editorHeight = 720
  const [localLine, setLocalLine] = useState<LineCoords>(line)
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null)
  const [frame, setFrame] = useState<string | null>(null)
  const [loadingFrame, setLoadingFrame] = useState(false)

  useEffect(() => {
    if (open) setLocalLine(line)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchFrame = useCallback(async () => {
    if (!sourceId) return
    setLoadingFrame(true)
    try {
      const d = await sourcesApi.preview(sourceId)
      setFrame(d.frame ?? null)
    } catch {
    } finally {
      setLoadingFrame(false)
    }
  }, [sourceId])

  useEffect(() => {
    if (open && sourceId) fetchFrame()
    else if (!open) setFrame(null)
  }, [open, sourceId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const pointFromSvgEvent = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * editorWidth
    const y = ((event.clientY - rect.top) / rect.height) * editorHeight
    return {
      x: Math.min(editorWidth, Math.max(0, Math.round(x))),
      y: Math.min(editorHeight, Math.max(0, Math.round(y))),
    }
  }

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return
    const { x, y } = pointFromSvgEvent(e)
    if (dragging === 'start') setLocalLine(l => ({ ...l, start_x: x, start_y: y }))
    else setLocalLine(l => ({ ...l, end_x: x, end_y: y }))
  }

  const { start_x: sx, start_y: sy, end_x: ex, end_y: ey } = localLine
  const mx = (sx + ex) / 2, my = (sy + ey) / 2
  const dx = ex - sx, dy = ey - sy
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const nx = -dy / len, ny = dx / len
  const arrowLen = 50
  const ax = mx + nx * arrowLen, ay = my + ny * arrowLen

  const LINE_C = '#ec4899', START_C = '#f97316', END_C = '#a855f7', IN_C = '#22d3ee'

  const LINE_PRESETS: { label: string; line: LineCoords }[] = [
    { label: 'Horizontale centre', line: { start_x: 0, start_y: 360, end_x: 1280, end_y: 360 } },
    { label: 'Verticale centre', line: { start_x: 640, start_y: 0, end_x: 640, end_y: 720 } },
    { label: 'Diagonale ↘', line: { start_x: 0, start_y: 0, end_x: 1280, end_y: 720 } },
    { label: 'Diagonale ↗', line: { start_x: 0, start_y: 720, end_x: 1280, end_y: 0 } },
    { label: 'Tiers haut', line: { start_x: 0, start_y: 240, end_x: 1280, end_y: 240 } },
    { label: 'Tiers bas', line: { start_x: 0, start_y: 480, end_x: 1280, end_y: 480 } },
  ]

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/85 p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-4xl rounded-xl border border-border-subtle bg-bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3.5">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke={LINE_C} strokeWidth={1.5} strokeLinecap="round">
              <line x1="1" y1="13" x2="15" y2="3" />
              <circle cx="1" cy="13" r="2" fill={START_C} stroke="none" />
              <circle cx="15" cy="3" r="2" fill={END_C} stroke="none" />
            </svg>
            <h2 className="text-sm font-semibold text-text-primary">Line Crossing Editor</h2>
            {!sourceId && <span className="text-2xs text-text-tertiary">(no source connected)</span>}
          </div>
          <div className="flex items-center gap-2">
            <Button size="xs" variant="ghost" onClick={fetchFrame} disabled={loadingFrame || !sourceId}>
              {loadingFrame ? 'Refreshing…' : 'Refresh frame'}
            </Button>
            <button onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded text-text-tertiary hover:bg-bg-overlay hover:text-text-primary">
              <svg viewBox="0 0 12 12" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M1 1l10 10M11 1L1 11" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex gap-4 p-5">
          <div className="min-w-0 flex-1">
            <div className="overflow-hidden rounded-lg border border-border-subtle bg-[#07070c]">
              <svg
                viewBox={`0 0 ${editorWidth} ${editorHeight}`}
                className="block w-full touch-none"
                style={{ aspectRatio: `${editorWidth}/${editorHeight}` }}
                onPointerMove={handlePointerMove}
                onPointerUp={() => setDragging(null)}
                onPointerLeave={() => setDragging(null)}
              >
                {frame ? (
                  <image href={`data:image/jpeg;base64,${frame}`} x="0" y="0"
                    width={editorWidth} height={editorHeight} preserveAspectRatio="xMidYMid slice" />
                ) : (
                  <>
                    <defs>
                      <pattern id="line-editor-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#20212b" strokeWidth="1" />
                      </pattern>
                    </defs>
                    <rect width={editorWidth} height={editorHeight} fill="url(#line-editor-grid)" />
                    {!sourceId && (
                      <text x={editorWidth / 2} y={editorHeight / 2} textAnchor="middle" fill="#55556e" fontSize="20" fontFamily="system-ui">Connect a Source node to see preview</text>
                    )}
                    {sourceId && loadingFrame && (
                      <text x={editorWidth / 2} y={editorHeight / 2} textAnchor="middle" fill="#55556e" fontSize="20" fontFamily="system-ui">Loading…</text>
                    )}
                  </>
                )}
                {frame && <rect width={editorWidth} height={editorHeight} fill="rgba(0,0,0,0.15)" />}
                <rect x="1" y="1" width={editorWidth - 2} height={editorHeight - 2} fill="none" stroke="#2b2d3a" strokeWidth="1" />

                {/* Main line */}
                <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={LINE_C} strokeWidth="3" strokeLinecap="round" />

                {/* IN direction arrow */}
                <line x1={mx} y1={my} x2={ax} y2={ay} stroke={IN_C} strokeWidth="2" strokeDasharray="8 4" />
                <polygon
                  points={`${ax},${ay} ${ax - ny * 12 - nx * 8},${ay + nx * 12 - ny * 8} ${ax + ny * 12 - nx * 8},${ay - nx * 12 - ny * 8}`}
                  fill={IN_C}
                />
                <text x={ax + nx * 24} y={ay + ny * 24 + 6} fill={IN_C} fontSize="18" textAnchor="middle" fontFamily="system-ui" fontWeight="bold">IN</text>

                {/* Start handle */}
                <circle cx={sx} cy={sy} r="14" fill={START_C} opacity="0.9" style={{ cursor: 'grab' }}
                  onPointerDown={(e) => { e.stopPropagation(); setDragging('start'); (e.target as Element).setPointerCapture(e.pointerId) }}
                />
                <text x={sx} y={sy + 5} textAnchor="middle" fontSize="13" fill="white" fontFamily="system-ui" fontWeight="bold" style={{ pointerEvents: 'none' }}>S</text>

                {/* End handle */}
                <circle cx={ex} cy={ey} r="14" fill={END_C} opacity="0.9" style={{ cursor: 'grab' }}
                  onPointerDown={(e) => { e.stopPropagation(); setDragging('end'); (e.target as Element).setPointerCapture(e.pointerId) }}
                />
                <text x={ex} y={ey + 5} textAnchor="middle" fontSize="13" fill="white" fontFamily="system-ui" fontWeight="bold" style={{ pointerEvents: 'none' }}>E</text>
              </svg>
            </div>
            <p className="mt-2 text-2xs text-text-disabled">
              Glisser <span style={{ color: START_C }} className="font-semibold">S</span> (départ)
              et <span style={{ color: END_C }} className="font-semibold">E</span> (fin) ·
              La flèche <span style={{ color: IN_C }} className="font-semibold">cyan</span> indique le côté IN
            </p>
          </div>

          <div className="w-52 shrink-0 space-y-4">
            <div className="space-y-2">
              <p className="text-2xs font-semibold uppercase tracking-wider text-text-disabled">Coordonnées</p>
              <div className="rounded border border-border-subtle bg-bg-overlay p-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span style={{ color: START_C }} className="text-2xs font-semibold">Départ (S)</span>
                  <span className="font-mono text-2xs text-text-secondary">{sx}, {sy}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span style={{ color: END_C }} className="text-2xs font-semibold">Fin (E)</span>
                  <span className="font-mono text-2xs text-text-secondary">{ex}, {ey}</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-2xs font-semibold uppercase tracking-wider text-text-disabled">Prépositions</p>
              <div className="space-y-1">
                {LINE_PRESETS.map((p) => (
                  <button key={p.label} type="button" onClick={() => setLocalLine(p.line)}
                    className="w-full rounded border border-border-subtle bg-bg-overlay px-2 py-1 text-left text-2xs text-text-secondary hover:border-accent/40 hover:text-text-primary">
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 pt-2">
              <Button className="w-full" onClick={() => onApply(localLine)}>Apply line</Button>
              <Button className="w-full" variant="ghost" onClick={onClose}>Cancel</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Custom columns editor (save_event node) ─────────────────────────────────

interface CustomColumn {
  name: string
  value: string
}

// ─── Schedule Trigger inspector ──────────────────────────────────────────────

interface TimeWindow { start: string; end: string }

function ScheduleTriggerInspector({
  config,
  onChange,
}: { config: NodeConfig; onChange: (p: Partial<NodeConfig>) => void }) {
  const mode = String(config.mode ?? 'time_window')
  const windows: TimeWindow[] = Array.isArray(config.windows)
    ? (config.windows as TimeWindow[])
    : [{ start: '08:00', end: '20:00' }]

  const setWindow = (i: number, key: 'start' | 'end', val: string) => {
    const next = windows.map((w, idx) => idx === i ? { ...w, [key]: val } : w)
    onChange({ windows: next })
  }
  const addWindow = () => onChange({ windows: [...windows, { start: '08:00', end: '20:00' }] })
  const removeWindow = (i: number) => onChange({ windows: windows.filter((_, idx) => idx !== i) })

  return (
    <>
      <InspectorSection label="Mode de déclenchement">
        <Select value={mode} onChange={(e) => onChange({ mode: e.target.value })}>
          <option value="time_window">Plages horaires quotidiennes</option>
          <option value="periodic">Périodique</option>
          <option value="once">Une seule fois</option>
        </Select>
      </InspectorSection>

      {mode === 'time_window' && (
        <InspectorSection label="Plages horaires">
          <div className="space-y-2">
            {windows.map((w, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  type="time" value={w.start}
                  onChange={(e) => setWindow(i, 'start', e.target.value)}
                  className="h-7 flex-1 rounded border border-border bg-bg-overlay px-2 text-xs text-text-primary focus:border-accent/50 focus:outline-none"
                />
                <span className="text-2xs text-text-disabled">→</span>
                <input
                  type="time" value={w.end}
                  onChange={(e) => setWindow(i, 'end', e.target.value)}
                  className="h-7 flex-1 rounded border border-border bg-bg-overlay px-2 text-xs text-text-primary focus:border-accent/50 focus:outline-none"
                />
                {windows.length > 1 && (
                  <button
                    onClick={() => removeWindow(i)}
                    className="flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:bg-bg-overlay hover:text-danger"
                  >
                    <svg viewBox="0 0 12 12" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path d="M1 1l10 10M11 1L1 11" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            <Button size="xs" variant="ghost" onClick={addWindow} className="w-full">
              + Ajouter une plage
            </Button>
          </div>
          <p className="mt-1.5 text-2xs text-text-disabled">Répété chaque jour aux mêmes horaires.</p>
        </InspectorSection>
      )}

      {mode === 'periodic' && (
        <InspectorSection label="Intervalle périodique">
          <div className="space-y-2">
            <div>
              <p className="mb-1 text-2xs text-text-disabled">Toutes les (minutes)</p>
              <input
                type="number" min={1} step={1}
                value={Number(config.interval_minutes ?? 60)}
                onChange={(e) => onChange({ interval_minutes: Number(e.target.value) })}
                className="h-7 w-full rounded border border-border bg-bg-overlay px-2 text-xs text-text-primary focus:border-accent/50 focus:outline-none"
              />
            </div>
            <div>
              <p className="mb-1 text-2xs text-text-disabled">Durée active (minutes)</p>
              <input
                type="number" min={1} step={1}
                value={Number(config.duration_minutes ?? 10)}
                onChange={(e) => onChange({ duration_minutes: Number(e.target.value) })}
                className="h-7 w-full rounded border border-border bg-bg-overlay px-2 text-xs text-text-primary focus:border-accent/50 focus:outline-none"
              />
            </div>
          </div>
          <p className="mt-1.5 text-2xs text-text-disabled leading-relaxed">
            Ex : toutes les 60 min, actif 10 min → collecte pendant 10 min par heure.
          </p>
        </InspectorSection>
      )}

      {mode === 'once' && (
        <InspectorSection label="Exécution unique">
          <div className="space-y-2">
            <div>
              <p className="mb-1 text-2xs text-text-disabled">Date et heure de démarrage</p>
              <input
                type="datetime-local"
                value={String(config.start_at ?? '')}
                onChange={(e) => onChange({ start_at: e.target.value })}
                className="h-7 w-full rounded border border-border bg-bg-overlay px-2 text-xs text-text-primary focus:border-accent/50 focus:outline-none"
              />
            </div>
            <div>
              <p className="mb-1 text-2xs text-text-disabled">Durée (minutes)</p>
              <input
                type="number" min={1} step={1}
                value={Number(config.duration_minutes ?? 60)}
                onChange={(e) => onChange({ duration_minutes: Number(e.target.value) })}
                className="h-7 w-full rounded border border-border bg-bg-overlay px-2 text-xs text-text-primary focus:border-accent/50 focus:outline-none"
              />
            </div>
          </div>
          <p className="mt-1.5 text-2xs text-text-disabled">
            Le workflow doit être démarré avant cette date/heure.
          </p>
        </InspectorSection>
      )}
    </>
  )
}

// ─── Line Crossing inspector ─────────────────────────────────────────────────

function LineCrossingInspector({
  config,
  onChange,
  sourceId,
}: { config: NodeConfig; onChange: (p: Partial<NodeConfig>) => void; sourceId?: number | null }) {
  const line = (config.line as Record<string, number>) || {}
  const sx = Number(line.start_x ?? 100), sy = Number(line.start_y ?? 360)
  const ex = Number(line.end_x ?? 1180), ey = Number(line.end_y ?? 360)
  const [modalOpen, setModalOpen] = useState(false)

  const setCoord = (k: 'start_x' | 'start_y' | 'end_x' | 'end_y', v: number) =>
    onChange({ line: { ...line, [k]: v } })

  const previewScale = 200 / 1280
  const psy = (v: number) => v * previewScale * (112 / 720)

  return (
    <div>
      <InspectorSection label="Ligne de comptage">
        <div className="rounded border border-border-subtle bg-bg-overlay p-2">
          <svg viewBox="0 0 200 112" width="100%" style={{ maxHeight: 120 }}>
            <rect x="0" y="0" width="200" height="112" fill="#0a0a14" stroke="#2a2a3a" strokeWidth="0.5" />
            <line
              x1={sx * previewScale} y1={psy(sy)}
              x2={ex * previewScale} y2={psy(ey)}
              stroke="#ec4899" strokeWidth="1.5"
            />
            <circle cx={sx * previewScale} cy={psy(sy)} r="3" fill="#f97316" />
            <circle cx={ex * previewScale} cy={psy(ey)} r="3" fill="#a855f7" />
          </svg>
          <div className="mt-1 flex items-center justify-between">
            <p className="text-2xs text-text-disabled">Espace 1280×720</p>
            <Button size="xs" variant="ghost" onClick={() => setModalOpen(true)}>
              <svg viewBox="0 0 14 14" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="mr-1">
                <path d="M5 1H2a1 1 0 0 0-1 1v3M9 1h3a1 1 0 0 1 1 1v3M5 13H2a1 1 0 0 1-1-1v-3M9 13h3a1 1 0 0 0 1-1v-3" />
              </svg>
              Éditer
            </Button>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <div>
            <p className="mb-0.5 text-2xs text-text-disabled">Start X</p>
            <input type="number" value={sx} onChange={(e) => setCoord('start_x', Number(e.target.value))}
              className="h-7 w-full rounded border border-border bg-bg-overlay px-2 text-xs text-text-primary focus:border-accent/50 focus:outline-none" />
          </div>
          <div>
            <p className="mb-0.5 text-2xs text-text-disabled">Start Y</p>
            <input type="number" value={sy} onChange={(e) => setCoord('start_y', Number(e.target.value))}
              className="h-7 w-full rounded border border-border bg-bg-overlay px-2 text-xs text-text-primary focus:border-accent/50 focus:outline-none" />
          </div>
          <div>
            <p className="mb-0.5 text-2xs text-text-disabled">End X</p>
            <input type="number" value={ex} onChange={(e) => setCoord('end_x', Number(e.target.value))}
              className="h-7 w-full rounded border border-border bg-bg-overlay px-2 text-xs text-text-primary focus:border-accent/50 focus:outline-none" />
          </div>
          <div>
            <p className="mb-0.5 text-2xs text-text-disabled">End Y</p>
            <input type="number" value={ey} onChange={(e) => setCoord('end_y', Number(e.target.value))}
              className="h-7 w-full rounded border border-border bg-bg-overlay px-2 text-xs text-text-primary focus:border-accent/50 focus:outline-none" />
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <Button size="xs" variant="ghost" onClick={() => onChange({ line: { start_x: 0, start_y: 360, end_x: 1280, end_y: 360 } })}>Horizontale</Button>
          <Button size="xs" variant="ghost" onClick={() => onChange({ line: { start_x: 640, start_y: 0, end_x: 640, end_y: 720 } })}>Verticale</Button>
          <Button size="xs" variant="ghost" onClick={() => onChange({ line: { start_x: 0, start_y: 0, end_x: 1280, end_y: 720 } })}>Diagonale</Button>
        </div>
      </InspectorSection>

      <InspectorSection label="Direction comptée">
        <Select value={String(config.direction ?? 'both')} onChange={(e) => onChange({ direction: e.target.value })}>
          <option value="both">Les deux (in & out)</option>
          <option value="in">Entrées seulement</option>
          <option value="out">Sorties seulement</option>
        </Select>
      </InspectorSection>

      <InspectorSection label="Point d'ancrage">
        <Select value={String(config.anchor ?? 'bottom_center')} onChange={(e) => onChange({ anchor: e.target.value })}>
          <option value="bottom_center">Bas du bbox (piétons/véhicules au sol)</option>
          <option value="center">Centre du bbox</option>
          <option value="top_center">Haut du bbox (objets aériens)</option>
        </Select>
        <p className="mt-1.5 text-2xs text-text-disabled leading-relaxed">
          Nécessite un node <strong>Tracker</strong> en amont. Les events de franchissement
          sont propagés en aval (Save Event / Notify) sans Event Trigger requis.
        </p>
      </InspectorSection>

      <LineEditorModal
        open={modalOpen}
        sourceId={sourceId ?? null}
        line={{ start_x: sx, start_y: sy, end_x: ex, end_y: ey }}
        onClose={() => setModalOpen(false)}
        onApply={(l) => { onChange({ line: l }); setModalOpen(false) }}
      />
    </div>
  )
}

// ─── Crop & Save inspector ───────────────────────────────────────────────────

function CropSaveInspector({
  config,
  onChange,
}: { config: NodeConfig; onChange: (p: Partial<NodeConfig>) => void }) {
  const classes = Array.isArray(config.filter_classes) ? (config.filter_classes as string[]) : []
  const classesStr = classes.join(', ')
  return (
    <>
      <InspectorSection label="Dossier de sortie">
        <input
          type="text" value={String(config.output_subdir ?? 'crops')}
          onChange={(e) => onChange({ output_subdir: e.target.value })}
          className="h-8 w-full rounded border border-border bg-bg-overlay px-2.5 text-xs text-text-primary focus:border-accent/50 focus:outline-none"
          placeholder="crops"
        />
        <p className="mt-1 text-2xs text-text-disabled">Sous-dossier de <code>data/exports/</code>.</p>
      </InspectorSection>

      <InspectorSection label="Filtres">
        <div className="space-y-2">
          <div>
            <p className="mb-1 text-2xs text-text-disabled">Classes à conserver (vide = toutes)</p>
            <input
              type="text" value={classesStr}
              onChange={(e) => onChange({
                filter_classes: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
              })}
              className="h-7 w-full rounded border border-border bg-bg-overlay px-2 text-xs text-text-primary focus:border-accent/50 focus:outline-none"
              placeholder="person, car, license_plate"
            />
          </div>
          <div>
            <p className="mb-1 text-2xs text-text-disabled">Confiance minimale</p>
            <input
              type="number" min={0} max={1} step={0.05}
              value={Number(config.min_confidence ?? 0)}
              onChange={(e) => onChange({ min_confidence: Number(e.target.value) })}
              className="h-7 w-full rounded border border-border bg-bg-overlay px-2 text-xs text-text-primary focus:border-accent/50 focus:outline-none"
            />
          </div>
        </div>
      </InspectorSection>

      <InspectorSection label="Crop">
        <div className="space-y-2">
          <div>
            <p className="mb-1 text-2xs text-text-disabled">Marge autour du bbox (px)</p>
            <input
              type="number" min={0} step={1}
              value={Number(config.padding_px ?? 0)}
              onChange={(e) => onChange({ padding_px: Number(e.target.value) })}
              className="h-7 w-full rounded border border-border bg-bg-overlay px-2 text-xs text-text-primary focus:border-accent/50 focus:outline-none"
            />
          </div>
          <div>
            <p className="mb-1 text-2xs text-text-disabled">Max crops par frame (0 = illimité)</p>
            <input
              type="number" min={0} step={1}
              value={Number(config.max_per_frame ?? 0)}
              onChange={(e) => onChange({ max_per_frame: Number(e.target.value) })}
              className="h-7 w-full rounded border border-border bg-bg-overlay px-2 text-xs text-text-primary focus:border-accent/50 focus:outline-none"
            />
          </div>
        </div>
        <div className="mt-2">
          <Toggle
            label="Sauvegarder uniquement sur events"
            checked={config.only_with_event === true}
            onChange={(v) => onChange({ only_with_event: v })}
          />
        </div>
        <p className="mt-1.5 text-2xs text-text-disabled leading-relaxed">
          Si activé, le node ne sauvegarde rien tant qu'aucun Event Trigger en amont
          n'a déclenché — utile pour ne capturer que les moments d'intérêt.
        </p>
      </InspectorSection>
    </>
  )
}

// ─── Harvest node inspector ──────────────────────────────────────────────────

function HarvestInspector({
  config,
  datasets,
  onChange,
}: {
  config: NodeConfig
  datasets: Dataset[]
  onChange: (patch: NodeConfig) => void
}) {
  const datasetId = config.dataset_id as number | null | undefined
  const mode = (config.mode as string) || 'every_n'
  const linkedDataset = datasets.find((d) => d.id === datasetId)

  return (
    <>
      <InspectorSection label="Target dataset">
        <select
          value={datasetId ?? ''}
          onChange={(e) => onChange({ dataset_id: e.target.value === '' ? null : Number(e.target.value) })}
          className="h-8 w-full rounded border border-border bg-bg-raised px-2.5 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="" disabled>Pick a dataset…</option>
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>{d.name} ({d.num_train} imgs)</option>
          ))}
        </select>
        {datasets.length === 0 && (
          <p className="mt-1 text-2xs text-warning-text">
            No dataset yet. Create one in the Training tab first.
          </p>
        )}
        {linkedDataset && (
          <p className="mt-1 text-2xs text-text-tertiary">
            Frames will land under <code>{linkedDataset.path}/images/train/</code>
          </p>
        )}
      </InspectorSection>

      <InspectorSection label="When to save">
        <div className="space-y-1.5">
          {([
            ['every_n',       'Every N frames',  'Sample regularly through the stream'],
            ['every_seconds', 'Every X seconds', 'Wall-clock spacing (best for streams)'],
            ['on_detection',  'On detection',    'Only frames with at least one box; seeds the .txt with normalized YOLO boxes'],
          ] as const).map(([value, label, hint]) => (
            <label
              key={value}
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer ${
                mode === value
                  ? 'border-accent bg-accent-subtle'
                  : 'border-border-subtle bg-bg-overlay hover:border-border'
              }`}
            >
              <input
                type="radio"
                name="harvest-mode"
                value={value}
                checked={mode === value}
                onChange={() => onChange({ mode: value })}
                className="mt-0.5 accent-accent flex-shrink-0"
              />
              <div className="min-w-0">
                <p className="text-xs font-medium text-text-primary">{label}</p>
                <p className="text-2xs text-text-tertiary mt-0.5">{hint}</p>
              </div>
            </label>
          ))}
        </div>
      </InspectorSection>

      {mode === 'every_n' && (
        <NumberField
          label="N (frames between saves)"
          min={1} max={500} step={1}
          value={numericValue(config.n, 30)}
          onChange={(v) => onChange({ n: Math.round(v) })}
        />
      )}

      {mode === 'every_seconds' && (
        <NumberField
          label="Interval (seconds)"
          min={0.5} max={300} step={0.5}
          value={numericValue(config.interval_seconds, 5)}
          onChange={(v) => onChange({ interval_seconds: v })}
        />
      )}

      <NumberField
        label="Max frames (0 = no limit)"
        min={0} max={5000} step={10}
        value={numericValue(config.max_frames, 200)}
        onChange={(v) => onChange({ max_frames: Math.round(v) })}
      />

      <Toggle
        label="Save the annotated frame (with overlay)"
        checked={boolValue(config.save_annotated)}
        onChange={(v) => onChange({ save_annotated: v })}
      />

      <div className="rounded border border-border-subtle bg-bg-overlay px-3 py-2 space-y-1">
        <p className="text-2xs font-medium text-text-secondary">Tip</p>
        <p className="text-2xs text-text-tertiary leading-relaxed">
          Use a generic YOLO upstream and pick <code>On detection</code> to build a pre-labeled
          dataset of frames where something interesting was spotted. Then refine the boxes via
          the Annotate button in Training.
        </p>
      </div>
    </>
  )
}


// ─── Notify node inspector ───────────────────────────────────────────────────

function NotifyInspector({
  config,
  brokers,
  reloadBrokers,
  onChange,
}: {
  config: NodeConfig
  brokers: MqttBroker[]
  reloadBrokers: () => void
  onChange: (patch: NodeConfig) => void
}) {
  const channel = (config.channel as string) || 'webhook'
  const [brokerModalOpen, setBrokerModalOpen] = useState(false)

  return (
    <>
      <InspectorSection label="Channel">
        <div className="grid grid-cols-2 gap-1.5">
          {(['webhook', 'email', 'mqtt', 'telegram'] as const).map((ch) => (
            <button
              key={ch}
              onClick={() => onChange({ channel: ch })}
              className={`rounded border px-2 py-1.5 text-xs font-medium uppercase tracking-wider transition-colors ${
                channel === ch
                  ? 'border-accent bg-accent-subtle text-accent'
                  : 'border-border-subtle bg-bg-overlay text-text-secondary hover:border-border'
              }`}
            >
              {ch}
            </button>
          ))}
        </div>
      </InspectorSection>

      {channel === 'webhook' && (
        <>
          <TextField
            label="Webhook URL"
            value={String(config.webhook_url ?? '')}
            onChange={(v) => onChange({ webhook_url: v })}
            placeholder="https://hooks.slack.com/services/..."
          />
          <InspectorSection label="Method">
            <select
              value={String(config.webhook_method ?? 'POST')}
              onChange={(e) => onChange({ webhook_method: e.target.value })}
              className="h-8 w-full rounded border border-border bg-bg-raised px-2.5 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
            </select>
          </InspectorSection>
          <TextAreaField
            label="Custom headers (JSON, optional)"
            value={String(config.webhook_headers ?? '')}
            onChange={(v) => onChange({ webhook_headers: v })}
            placeholder='{"X-Token": "abc123"}'
            rows={2}
          />
          <div className="rounded border border-border-subtle bg-bg-overlay px-3 py-2 text-2xs text-text-tertiary leading-relaxed">
            Payload is JSON: <code>{'{workflow_id, source_id, count, events: […]}'}</code>.
            Compatible with Slack/Discord webhooks (via incoming-webhook URLs), Home Assistant,
            ntfy.sh, IFTTT, Make, n8n, etc.
          </div>
        </>
      )}

      {channel === 'email' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <TextField label="SMTP host" value={String(config.smtp_host ?? '')} onChange={(v) => onChange({ smtp_host: v })} placeholder="smtp.gmail.com" />
            <NumberField label="Port" min={1} max={65535} step={1} value={numericValue(config.smtp_port, 587)} onChange={(v) => onChange({ smtp_port: Math.round(v) })} />
          </div>
          <TextField label="SMTP user" value={String(config.smtp_user ?? '')} onChange={(v) => onChange({ smtp_user: v })} placeholder="alerts@example.com" />
          <TextField label="SMTP password" type="password" value={String(config.smtp_password ?? '')} onChange={(v) => onChange({ smtp_password: v })} placeholder="app-specific password" />
          <Toggle label="STARTTLS (port 587)" checked={boolValue(config.smtp_use_tls)} onChange={(v) => onChange({ smtp_use_tls: v, smtp_use_ssl: v ? false : config.smtp_use_ssl })} />
          <Toggle label="SMTPS (SSL, port 465)" checked={boolValue(config.smtp_use_ssl)} onChange={(v) => onChange({ smtp_use_ssl: v, smtp_use_tls: v ? false : config.smtp_use_tls })} />
          <TextField label="From address" value={String(config.from_addr ?? '')} onChange={(v) => onChange({ from_addr: v })} placeholder="alerts@example.com" />
          <TextField label="To (comma-separated)" value={String(config.to_addrs ?? '')} onChange={(v) => onChange({ to_addrs: v })} placeholder="me@example.com, you@example.com" />
          <TextField label="Subject template" value={String(config.subject_template ?? '')} onChange={(v) => onChange({ subject_template: v })} placeholder="Alert: {class_name}" />
          <TextAreaField
            label="Body template (optional)"
            value={String(config.body_template ?? '')}
            onChange={(v) => onChange({ body_template: v })}
            placeholder="Leave empty for auto-generated summary"
            rows={3}
          />
          <div className="rounded border border-border-subtle bg-bg-overlay px-3 py-2 text-2xs text-text-tertiary leading-relaxed">
            Variables: <code>{'{class_name}'}</code>, <code>{'{confidence}'}</code>, <code>{'{tracker_id}'}</code>, <code>{'{zone_name}'}</code>, <code>{'{workflow_id}'}</code>, <code>{'{source_id}'}</code>.
            For Gmail, use an <a className="text-accent hover:underline" href="https://support.google.com/accounts/answer/185833" target="_blank" rel="noreferrer">app password</a>.
          </div>
        </>
      )}

      {channel === 'mqtt' && (
        <>
          <InspectorSection label="Broker">
            <div className="flex gap-1.5">
              <select
                value={config.broker_id == null ? '' : String(config.broker_id)}
                onChange={(e) => onChange({ broker_id: e.target.value === '' ? null : Number(e.target.value) })}
                className="h-8 flex-1 min-w-0 rounded border border-border bg-bg-raised px-2.5 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="" disabled>Pick a broker…</option>
                {brokers.map((b) => (
                  <option key={b.id} value={b.id}>{b.name} ({b.host}:{b.port})</option>
                ))}
              </select>
              <Button size="xs" variant="ghost" onClick={() => setBrokerModalOpen(true)}>+ New</Button>
            </div>
            {brokers.length === 0 && (
              <p className="mt-1 text-2xs text-warning-text">
                No broker configured yet. Click <b>+ New</b> to create one.
              </p>
            )}
          </InspectorSection>

          <TextField label="Topic template" value={String(config.topic_template ?? '')} onChange={(v) => onChange({ topic_template: v })} placeholder="omv/workflow/{workflow_id}/events" />

          <TextAreaField
            label="Payload template (optional)"
            value={String(config.payload_template ?? '')}
            onChange={(v) => onChange({ payload_template: v })}
            placeholder="Leave empty to publish the full event as JSON"
            rows={3}
          />

          <div className="grid grid-cols-2 gap-2">
            <NumberField label="QoS" min={0} max={2} step={1} value={numericValue(config.qos, 0)} onChange={(v) => onChange({ qos: Math.round(v) })} />
            <div className="flex items-end">
              <Toggle label="Retain" checked={boolValue(config.retain)} onChange={(v) => onChange({ retain: v })} />
            </div>
          </div>

          <div className="rounded border border-border-subtle bg-bg-overlay px-3 py-2 text-2xs text-text-tertiary leading-relaxed">
            One MQTT publish per event. Topic and payload templates accept the same
            <code> {'{placeholders}'} </code>as email. Connection is cached and reused across publishes.
          </div>

          {brokerModalOpen && (
            <BrokerModal
              onClose={() => setBrokerModalOpen(false)}
              onCreated={(newBroker) => {
                reloadBrokers()
                onChange({ broker_id: newBroker.id })
                setBrokerModalOpen(false)
              }}
            />
          )}
        </>
      )}

      {channel === 'telegram' && (
        <>
          <TextField
            label="Bot token"
            value={String(config.telegram_bot_token ?? '')}
            onChange={(v) => onChange({ telegram_bot_token: v })}
            placeholder="123456:ABC-..."
          />
          <TextField
            label="Chat ID"
            value={String(config.telegram_chat_id ?? '')}
            onChange={(v) => onChange({ telegram_chat_id: v })}
            placeholder="-1001234567890"
          />
          <InspectorSection label="Parse mode">
            <select
              value={String(config.telegram_parse_mode ?? '')}
              onChange={(e) => onChange({ telegram_parse_mode: e.target.value })}
              className="h-8 w-full rounded border border-border bg-bg-raised px-2.5 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">Plain text</option>
              <option value="Markdown">Markdown</option>
              <option value="MarkdownV2">Markdown V2</option>
              <option value="HTML">HTML</option>
            </select>
          </InspectorSection>
          <TextAreaField
            label="Message template"
            value={String(config.telegram_message_template ?? '')}
            onChange={(v) => onChange({ telegram_message_template: v })}
            placeholder="Leave empty for auto-formatted summary"
            rows={3}
          />
          <div className="rounded border border-border-subtle bg-bg-overlay px-3 py-2 text-2xs text-text-tertiary leading-relaxed">
            Crée un bot via <a className="text-accent hover:underline" href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a>, récupère le token, puis lance un message au bot et utilise <code>chat_id</code> personnel ou de groupe. Variables : <code>{'{class_name}'}</code> <code>{'{confidence}'}</code> <code>{'{tracker_id}'}</code> <code>{'{zone_name}'}</code>.
          </div>
        </>
      )}
    </>
  )
}

// ─── Broker creation modal ───────────────────────────────────────────────────

function BrokerModal({ onClose, onCreated }: { onClose: () => void; onCreated: (b: MqttBroker) => void }) {
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(1883)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [useTls, setUseTls] = useState(false)
  const [clientId, setClientId] = useState('')
  const [keepalive, setKeepalive] = useState(60)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const payload = () => ({
    name: name.trim(),
    host: host.trim(),
    port: Math.max(1, Math.min(65535, port || 1883)),
    username: username.trim() || null,
    password: password || null,
    use_tls: useTls,
    client_id: clientId.trim() || null,
    keepalive: Math.max(5, Math.min(600, keepalive || 60)),
  })

  const canSubmit = !!name.trim() && !!host.trim() && !saving

  const save = async () => {
    setSaving(true); setError(null)
    try {
      const created = await mqttApi.create(payload())
      onCreated(created)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to create broker')
    } finally {
      setSaving(false)
    }
  }

  // Test against a transient (unsaved) broker by first creating, testing, then deleting on failure.
  // Simpler UX: create the broker → run the test → keep it either way; user sees the result and can keep editing.
  const testNow = async () => {
    setTestResult(null); setError(null); setSaving(true)
    try {
      const created = await mqttApi.create(payload())
      const result = await mqttApi.test(created.id)
      setTestResult(result)
      onCreated(created)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Test failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border border-border bg-bg-base shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle">
          <h3 className="text-sm font-medium text-text-primary">New MQTT broker</h3>
          <Button size="xs" variant="ghost" onClick={onClose}>Close</Button>
        </div>
        <div className="p-5 space-y-3">
          <TextField label="Name" value={name} onChange={setName} placeholder="My home broker" />
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <TextField label="Host" value={host} onChange={setHost} placeholder="mqtt.example.com" />
            </div>
            <NumberField label="Port" min={1} max={65535} step={1} value={port} onChange={(v) => setPort(Math.round(v))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Username (optional)" value={username} onChange={setUsername} placeholder="" />
            <TextField label="Password (optional)" type="password" value={password} onChange={setPassword} placeholder="" />
          </div>
          <Toggle label="Use TLS" checked={useTls} onChange={setUseTls} />
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Client ID (optional)" value={clientId} onChange={setClientId} placeholder="auto-generated" />
            <NumberField label="Keepalive (s)" min={5} max={600} step={5} value={keepalive} onChange={(v) => setKeepalive(Math.round(v))} />
          </div>

          {error && <p className="text-xs text-danger-text">{error}</p>}
          {testResult && (
            <div className={`rounded border px-3 py-2 text-xs ${testResult.ok ? 'border-success/40 bg-success-subtle text-success-text' : 'border-danger/40 bg-danger-subtle text-danger-text'}`}>
              {testResult.ok ? '✓ ' : '✗ '}{testResult.message}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={save} disabled={!canSubmit}>{saving ? 'Saving…' : 'Save'}</Button>
            <Button size="sm" variant="ghost" onClick={testNow} disabled={!canSubmit}>Save & test</Button>
            <Button size="sm" variant="ghost" onClick={onClose} className="ml-auto">Cancel</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Tiny shared field helpers (used by NotifyInspector / BrokerModal) ───────

function TextField({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-text-secondary">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded border border-border bg-bg-raised px-2.5 text-xs text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </div>
  )
}

function TextAreaField({ label, value, onChange, placeholder, rows = 3 }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-text-secondary">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full rounded border border-border bg-bg-raised px-2.5 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent resize-none"
      />
    </div>
  )
}


function CustomColumnsEditor({
  columns,
  onChange,
}: {
  columns: CustomColumn[]
  onChange: (cols: CustomColumn[]) => void
}) {
  const addColumn = () => onChange([...columns, { name: '', value: '' }])
  const removeColumn = (i: number) => onChange(columns.filter((_, idx) => idx !== i))
  const updateColumn = (i: number, patch: Partial<CustomColumn>) =>
    onChange(columns.map((col, idx) => (idx === i ? { ...col, ...patch } : col)))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-2xs font-semibold uppercase tracking-wider text-text-disabled">Custom columns</p>
        <Button size="xs" variant="secondary" onClick={addColumn}>+ Add</Button>
      </div>

      {columns.length === 0 ? (
        <p className="text-2xs text-text-tertiary">
          No custom columns — extra fields stored in metadata.
        </p>
      ) : (
        <div className="space-y-1.5">
          {columns.map((col, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                className="h-7 w-0 flex-1 rounded-l border border-border bg-bg-overlay px-2 text-xs text-text-primary placeholder:text-text-disabled focus:border-accent/50 focus:outline-none"
                placeholder="name"
                value={col.name}
                onChange={(e) => updateColumn(i, { name: e.target.value })}
              />
              <input
                className="h-7 w-0 flex-1 rounded-r border border-l-0 border-border bg-bg-overlay px-2 font-mono text-xs text-text-primary placeholder:text-text-disabled focus:border-accent/50 focus:outline-none"
                placeholder="{class_name}"
                value={col.value}
                onChange={(e) => updateColumn(i, { value: e.target.value })}
              />
              <button
                onClick={() => removeColumn(i)}
                className="ml-0.5 flex h-7 w-6 items-center justify-center rounded text-text-disabled hover:text-danger-text"
              >
                <svg viewBox="0 0 10 10" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path d="M1 1l8 8M9 1L1 9" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {columns.length > 0 && (
        <div className="rounded border border-border-subtle bg-bg-overlay px-2.5 py-2">
          <p className="text-2xs font-medium text-text-disabled">Available variables:</p>
          <p className="mt-0.5 font-mono text-2xs text-text-tertiary leading-relaxed">
            {'{class_name}'} {'{confidence}'} {'{tracker_id}'} {'{zone_name}'}
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function findUpstreamSourceId(nodeId: string, nodes: Node[], edges: Edge[]): number | null {
  const visited = new Set<string>()
  const queue = [nodeId]
  while (queue.length > 0) {
    const currentId = queue.shift()!
    if (visited.has(currentId)) continue
    visited.add(currentId)
    const current = nodes.find((n) => n.id === currentId)
    if (current?.data?.type === 'source') {
      const sid = (current.data?.config as NodeConfig)?.source_id
      return sid ? Number(sid) : null
    }
    for (const e of edges.filter((e) => e.target === currentId)) {
      queue.push(e.source)
    }
  }
  return null
}

// ─── Zone preset shape icon ──────────────────────────────────────────────────

function ZonePresetShape({ presetKey }: { presetKey: string }) {
  const W = 36, H = 22
  const bg = { fill: '#12121e', stroke: '#2b2d3a', strokeWidth: 0.5 }
  const sh = { fill: '#a78bfa30', stroke: '#a78bfa', strokeWidth: 1 }
  const cx = W / 2, cy = H / 2
  switch (presetKey) {
    case 'rectangle':
      return (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
          <rect width={W} height={H} rx="1" {...bg} />
          <rect x={W * 0.2} y={H * 0.2} width={W * 0.6} height={H * 0.6} {...sh} />
        </svg>
      )
    case 'full_frame':
      return (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
          <rect width={W} height={H} rx="1" {...bg} />
          <rect x={1} y={1} width={W - 2} height={H - 2} {...sh} />
        </svg>
      )
    case 'top_half':
      return (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
          <rect width={W} height={H} rx="1" {...bg} />
          <rect x={1} y={1} width={W - 2} height={H / 2 - 1} {...sh} />
          <line x1={1} y1={cy} x2={W - 1} y2={cy} stroke="#a78bfa60" strokeWidth={0.5} strokeDasharray="2 2" />
        </svg>
      )
    case 'bottom_half':
      return (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
          <rect width={W} height={H} rx="1" {...bg} />
          <rect x={1} y={cy} width={W - 2} height={H / 2 - 1} {...sh} />
          <line x1={1} y1={cy} x2={W - 1} y2={cy} stroke="#a78bfa60" strokeWidth={0.5} strokeDasharray="2 2" />
        </svg>
      )
    case 'left_half':
      return (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
          <rect width={W} height={H} rx="1" {...bg} />
          <rect x={1} y={1} width={W / 2 - 1} height={H - 2} {...sh} />
          <line x1={cx} y1={1} x2={cx} y2={H - 1} stroke="#a78bfa60" strokeWidth={0.5} strokeDasharray="2 2" />
        </svg>
      )
    case 'right_half':
      return (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
          <rect width={W} height={H} rx="1" {...bg} />
          <rect x={cx} y={1} width={W / 2 - 1} height={H - 2} {...sh} />
          <line x1={cx} y1={1} x2={cx} y2={H - 1} stroke="#a78bfa60" strokeWidth={0.5} strokeDasharray="2 2" />
        </svg>
      )
    case 'circle':
      return (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
          <rect width={W} height={H} rx="1" {...bg} />
          <ellipse cx={cx} cy={cy} rx={W * 0.35} ry={H * 0.38} {...sh} />
        </svg>
      )
    default:
      return (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
          <rect width={W} height={H} rx="1" {...bg} />
          <rect x={W * 0.15} y={H * 0.15} width={W * 0.7} height={H * 0.7} {...sh} />
        </svg>
      )
  }
}

// ─── Zone preset shapes ──────────────────────────────────────────────────────
// Espace 1280×720 (résolution frame backend).
const ZONE_PRESETS: Record<string, { label: string; build: () => [number, number][] }> = {
  rectangle: {
    label: 'Rectangle',
    build: () => [[320, 180], [960, 180], [960, 540], [320, 540]],
  },
  full_frame: {
    label: 'Plein écran',
    build: () => [[0, 0], [1280, 0], [1280, 720], [0, 720]],
  },
  top_half: {
    label: 'Moitié haute',
    build: () => [[0, 0], [1280, 0], [1280, 360], [0, 360]],
  },
  bottom_half: {
    label: 'Moitié basse',
    build: () => [[0, 360], [1280, 360], [1280, 720], [0, 720]],
  },
  left_half: {
    label: 'Moitié gauche',
    build: () => [[0, 0], [640, 0], [640, 720], [0, 720]],
  },
  right_half: {
    label: 'Moitié droite',
    build: () => [[640, 0], [1280, 0], [1280, 720], [640, 720]],
  },
  circle: {
    label: 'Cercle',
    build: () => {
      const cx = 640, cy = 360, r = 260
      const n = 24
      return Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2
        return [Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a))] as [number, number]
      })
    },
  },
}
const ZONE_PRESET_KEYS = Object.keys(ZONE_PRESETS)

function normalizeZones(value: ZoneConfig[] | undefined): ZoneConfig[] {
  if (!Array.isArray(value)) return []
  return value.map((zone, index) => ({
    name: typeof zone?.name === 'string' && zone.name.trim() ? zone.name : `Zone ${index + 1}`,
    points: Array.isArray(zone?.points)
      ? zone.points
          .filter((point): point is [number, number] =>
            Array.isArray(point) &&
            point.length >= 2 &&
            Number.isFinite(Number(point[0])) &&
            Number.isFinite(Number(point[1])),
          )
          .map(([x, y]) => [Number(x), Number(y)] as [number, number])
      : [],
  }))
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-text-secondary">{label}</label>
        <span className="rounded bg-bg-raised px-1.5 py-0.5 font-mono text-xs text-text-primary">
          {value}
        </span>
      </div>
      <div className="relative h-1.5 w-full rounded-full bg-bg-raised">
        <div
          className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-accent"
          style={{ width: `${pct}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded border border-border bg-bg-raised px-2.5 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
  inset,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  inset?: boolean
}) {
  return (
    <div
      className={`flex cursor-pointer select-none items-center justify-between gap-3 py-2 ${inset ? 'px-3' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="text-xs text-text-secondary">{label}</span>
      <div
        className="relative shrink-0 rounded-full transition-colors duration-150"
        style={{
          width: 32,
          height: 18,
          background: checked ? '#5c6bc0' : '#252533',
        }}
      >
        <div
          className="absolute top-[3px] h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-150"
          style={{ transform: checked ? 'translateX(17px)' : 'translateX(3px)' }}
        />
      </div>
    </div>
  )
}

function RunIcon() {
  return (
    <svg viewBox="0 0 12 12" width={10} height={10} fill="currentColor">
      <path d="M2 2l8 4-8 4z" />
    </svg>
  )
}
