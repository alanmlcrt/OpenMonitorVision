import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { api } from '../api/client'
import { sourcesApi } from '../api/sources'
import { workflowsApi } from '../api/workflows'
import type { Source, Workflow, YoloModel } from '../types'
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
      show_labels: true,
      show_confidence: true,
      show_tracker_id: true,
    },
    summary: () => 'Boxes, labels, confidence',
  },
]

const nodeMap = new Map(NODE_DEFINITIONS.map((item) => [item.type, item]))
const NODE_GROUPS = ['Input', 'Vision', 'Filter', 'Event', 'Output']
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

      {/* Target handle */}
      {data.type !== 'source' && (
        <Handle
          type="target"
          position={Position.Left}
          style={{
            left: -5,
            width: 10,
            height: 10,
            background: '#0f0f15',
            border: `2px solid ${color}`,
            borderRadius: '50%',
          }}
        />
      )}

      {/* Source handle */}
      <Handle
        type="source"
        position={Position.Right}
        style={{
          right: -5,
          width: 10,
          height: 10,
          background: color,
          border: `2px solid ${color}60`,
          borderRadius: '50%',
        }}
      />

      {/* Card content */}
      <div className="pl-3 pr-2.5">
        {/* Header */}
        <div className="flex items-center gap-2 pb-1.5 pt-2">
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
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [models, setModels] = useState<YoloModel[]>([])
  const [selectedWf, setSelectedWf] = useState<Workflow | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [wfName, setWfName] = useState('')
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState<{ msg: string; ok: boolean } | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null)
  const wsStatusRef = useRef<WebSocket | null>(null)

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )

  const showNotice = (msg: string, ok: boolean) => {
    setNotice({ msg, ok })
    setTimeout(() => setNotice(null), 2800)
  }

  const loadWorkflows = () => workflowsApi.list().then(setWorkflows).catch(() => {})

  useEffect(() => {
    loadWorkflows()
    sourcesApi.list().then(setSources).catch(() => {})
    api.get<YoloModel[]>('/models').then(setModels).catch(() => {})
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

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left sidebar ── */}
      <div className="w-56 shrink-0 overflow-hidden border-r border-border-subtle bg-bg-surface">
        <div className="flex h-full flex-col">
          {/* Workflow list */}
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
          </div>

          <div className="max-h-44 overflow-y-auto py-1">
            {workflows.length === 0 ? (
              <p className="px-3 py-2 text-xs text-text-tertiary">No workflows yet</p>
            ) : (
              workflows.map((wf) => (
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
                  <span className="flex-1 truncate">{wf.name}</span>
                  {wf.enabled && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                  )}
                </button>
              ))
            )}
          </div>

          {/* Node palette — drag or click to add */}
          <div className="border-t border-border-subtle px-3 pb-1 pt-3">
            <span className="text-2xs font-semibold uppercase tracking-widest text-text-disabled">
              Nodes
            </span>
            <p className="mt-0.5 text-2xs text-text-disabled opacity-60">
              Drag onto canvas or click
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
        className="min-w-0 flex-1 bg-[#09090d]"
        onDrop={onDrop}
        onDragOver={onDragOver}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          onInit={setRfInstance}
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
        onChange={updateSelectedConfig}
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
  onChange,
}: {
  node: Node | null
  nodes: Node[]
  edges: Edge[]
  sources: Source[]
  models: YoloModel[]
  onChange: (patch: NodeConfig) => void
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
          </div>
        ) : (
          <h2 className="mt-1 text-sm text-text-tertiary">Select a node</h2>
        )}
      </div>

      {!node || !definition ? (
        <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-bg-overlay">
            <svg viewBox="0 0 16 16" width={18} height={18} fill="none" stroke="#55556e" strokeWidth={1.25} strokeLinecap="round">
              <rect x="2" y="2" width="12" height="12" rx="1.5" />
              <line x1="8" y1="5" x2="8" y2="11" />
              <line x1="5" y1="8" x2="11" y2="8" />
            </svg>
          </div>
          <p className="text-xs text-text-tertiary">Click a node to configure it</p>
        </div>
      ) : (
        <div className="space-y-5 px-4 py-4">
          <InspectorSection label="Runtime">
            <p className="font-mono text-xs text-text-secondary">{definition.type}</p>
          </InspectorSection>

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
            <InspectorSection label="Visible overlays">
              <div className="space-y-px rounded-lg border border-border-subtle bg-bg-overlay">
                <Toggle label="Bounding boxes" checked={config.show_boxes !== false} onChange={(v) => onChange({ show_boxes: v })} inset />
                <div className="mx-3 border-t border-border-subtle" />
                <Toggle label="Class labels" checked={config.show_labels !== false} onChange={(v) => onChange({ show_labels: v })} inset />
                <div className="mx-3 border-t border-border-subtle" />
                <Toggle label="Confidence score" checked={config.show_confidence !== false} onChange={(v) => onChange({ show_confidence: v })} inset />
                <div className="mx-3 border-t border-border-subtle" />
                <Toggle label="Tracker ID" checked={config.show_tracker_id !== false} onChange={(v) => onChange({ show_tracker_id: v })} inset />
              </div>
            </InspectorSection>
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

// ─── Zone Filter Inspector ───────────────────────────────────────────────────

function ZoneFilterInspector({
  zones,
  onChange,
  sourceId,
}: {
  zones: ZoneConfig[] | undefined
  onChange: (zones: ZoneConfig[]) => void
  sourceId?: number | null
}) {
  const editorWidth = 640
  const editorHeight = 360
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

  const addZone = () => {
    const nextZone: ZoneConfig = {
      name: `Zone ${zoneList.length + 1}`,
      points: [[160, 100], [480, 100], [480, 260], [160, 260]],
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
          <Button size="xs" variant="secondary" onClick={addZone} className="flex-1">Add zone</Button>
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
  const editorWidth = 640
  const editorHeight = 360

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

  const addZone = () => {
    const next: ZoneConfig = {
      name: `Zone ${localZones.length + 1}`,
      points: [[160, 100], [480, 100], [480, 260], [160, 260]],
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
                <Button size="xs" variant="secondary" onClick={addZone} className="flex-1">+ Add</Button>
                <Button size="xs" variant="danger" onClick={deleteZone} disabled={!selectedZone}>Del</Button>
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

// ─── Custom columns editor (save_event node) ─────────────────────────────────

interface CustomColumn {
  name: string
  value: string
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
