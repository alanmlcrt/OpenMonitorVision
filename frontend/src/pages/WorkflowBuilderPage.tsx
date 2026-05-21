import { memo, useCallback, useEffect, useMemo, useState } from 'react'
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
} from 'reactflow'
import 'reactflow/dist/style.css'
import { api } from '../api/client'
import { sourcesApi } from '../api/sources'
import { workflowsApi } from '../api/workflows'
import type { Source, Workflow, YoloModel } from '../types'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'

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
    summary: (c) => `Source #${c.source_id ?? '-'}`,
  },
  {
    type: 'yolo_detect',
    label: 'YOLO Detect',
    group: 'Vision',
    color: '#3b82f6',
    defaultConfig: { model_path: 'yolov8n.pt', confidence: 0.25, iou: 0.7, device: 'auto' },
    summary: (c) => `${c.model_path ?? 'model'} @ ${c.confidence ?? 0.25}`,
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
    summary: (c) => Array.isArray(c.classes) ? c.classes.join(', ') : 'All classes',
  },
  {
    type: 'confidence_filter',
    label: 'Confidence Filter',
    group: 'Filter',
    color: '#fb7185',
    defaultConfig: { min_confidence: 0.5 },
    summary: (c) => `Min ${c.min_confidence ?? 0.5}`,
  },
  {
    type: 'event_trigger',
    label: 'Event Trigger',
    group: 'Event',
    color: '#ef4444',
    defaultConfig: { cooldown_seconds: 5, trigger_once_per_object: false },
    summary: (c) => `${c.cooldown_seconds ?? 5}s cooldown`,
  },
  {
    type: 'save_event',
    label: 'Save Event',
    group: 'Event',
    color: '#22c55e',
    defaultConfig: { save_frame: false, save_metadata: true },
    summary: (c) => (c.save_frame ? 'SQLite + frame' : 'SQLite metadata'),
  },
  {
    type: 'overlay',
    label: 'Overlay',
    group: 'Output',
    color: '#a855f7',
    defaultConfig: {
      show_boxes: true,
      show_labels: true,
      show_confidence: true,
      show_tracker_id: true,
      show_zones: true,
    },
    summary: () => 'Boxes and labels',
  },
]

const nodeMap = new Map(NODE_DEFINITIONS.map((item) => [item.type, item]))
let nodeCounter = 1

function makeNode(type: string, position = { x: 160, y: 100 }): Node {
  const definition = nodeMap.get(type)
  const id = `${type}_${Date.now()}_${nodeCounter++}`
  return {
    id,
    type: 'workflowNode',
    position,
    data: {
      type,
      label: definition?.label ?? type,
      config: { ...(definition?.defaultConfig ?? {}) },
    },
  }
}

const WorkflowNodeCard = memo(({ data, selected }: NodeProps) => {
  const definition = nodeMap.get(data.type)
  const color = definition?.color ?? '#94a3b8'
  const summary = definition?.summary(data.config ?? {}) ?? data.type

  return (
    <div
      className={[
        'w-56 rounded-lg border bg-[#14141c] px-3 py-2 shadow-sm',
        selected ? 'border-accent ring-2 ring-accent-ring' : 'border-border-subtle',
      ].join(' ')}
      style={{ borderTopColor: color, borderTopWidth: 3 }}
    >
      {data.type !== 'source' && (
        <Handle type="target" position={Position.Left} />
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
            <span className="truncate text-sm font-medium text-text-primary">{data.label}</span>
          </div>
          <p className="mt-1 truncate text-xs text-text-tertiary">{summary}</p>
        </div>
        <Badge variant="neutral" className="shrink-0">{definition?.group ?? 'Node'}</Badge>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
})

const nodeTypes = { workflowNode: WorkflowNodeCard }

function boolValue(value: unknown) {
  return value === true
}

function numericValue(value: unknown, fallback: number) {
  return typeof value === 'number' ? value : Number(value ?? fallback)
}

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
  const [notice, setNotice] = useState<{ msg: string; ok: boolean } | null>(null)

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )

  const loadWorkflows = () => workflowsApi.list().then(setWorkflows).catch(() => {})

  useEffect(() => {
    loadWorkflows()
    sourcesApi.list().then(setSources).catch(() => {})
    api.get<YoloModel[]>('/models').then(setModels).catch(() => {})
  }, [])

  const loadWorkflow = (wf: Workflow) => {
    setSelectedWf(wf)
    setWfName(wf.name)
    setNodes((wf.nodes as Node[]) ?? [])
    setEdges((wf.edges as Edge[]) ?? [])
    setSelectedNodeId(null)
  }

  const newWorkflow = () => {
    setSelectedWf(null)
    setWfName('MVP detection workflow')
    setNodes([])
    setEdges([])
    setSelectedNodeId(null)
  }

  const addMvpWorkflow = () => {
    const chain = [
      'source',
      'yolo_detect',
      'tracker',
      'confidence_filter',
      'event_trigger',
      'save_event',
      'overlay',
    ]
    const nextNodes = chain.map((type, index) => makeNode(type, { x: 80 + index * 250, y: 160 }))
    const nextEdges = nextNodes.slice(0, -1).map((node, index) => ({
      id: `edge_${node.id}_${nextNodes[index + 1].id}`,
      source: node.id,
      target: nextNodes[index + 1].id,
      animated: false,
    }))
    setWfName(wfName.trim() || 'MVP detection workflow')
    setNodes(nextNodes)
    setEdges(nextEdges)
    setSelectedNodeId(nextNodes[0]?.id ?? null)
  }

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, animated: false }, eds)),
    [setEdges],
  )

  const addNode = (type: string) => {
    const node = makeNode(type, {
      x: 120 + Math.random() * 80,
      y: 80 + nodes.length * 88,
    })
    setNodes((items) => [...items, node])
    setSelectedNodeId(node.id)
  }

  const updateSelectedConfig = (patch: NodeConfig) => {
    if (!selectedNodeId) return
    setNodes((items) => items.map((node) => {
      if (node.id !== selectedNodeId) return node
      return {
        ...node,
        data: {
          ...node.data,
          config: { ...(node.data?.config ?? {}), ...patch },
        },
      }
    }))
  }

  const save = async () => {
    if (!wfName.trim()) return
    setSaving(true)
    try {
      const payload = { name: wfName.trim(), nodes, edges }
      if (selectedWf) {
        const updated = await workflowsApi.update(selectedWf.id, payload as Partial<Workflow>)
        setSelectedWf(updated)
      } else {
        const created = await workflowsApi.create(payload)
        setSelectedWf(created)
      }
      setNotice({ msg: 'Saved', ok: true })
      loadWorkflows()
    } catch (e: any) {
      setNotice({ msg: e.message, ok: false })
    } finally {
      setSaving(false)
      setTimeout(() => setNotice(null), 2500)
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-60 shrink-0 overflow-hidden border-r border-border-subtle bg-bg-surface">
        <div className="flex h-full flex-col">
          <div className="border-b border-border-subtle px-3 py-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">Workflows</span>
              <Button size="xs" variant="ghost" onClick={newWorkflow}>New</Button>
            </div>
            <Button size="sm" variant="secondary" className="mt-3 w-full" onClick={addMvpWorkflow}>
              Build MVP chain
            </Button>
          </div>

          <div className="max-h-48 overflow-y-auto py-1">
            {workflows.length === 0 && (
              <p className="px-3 py-2 text-xs text-text-tertiary">No workflows</p>
            )}
            {workflows.map((wf) => (
              <button
                key={wf.id}
                onClick={() => loadWorkflow(wf)}
                className={[
                  'flex w-full items-center justify-between px-3 py-2 text-sm transition-colors',
                  selectedWf?.id === wf.id
                    ? 'bg-accent-subtle text-accent'
                    : 'text-text-secondary hover:bg-bg-overlay hover:text-text-primary',
                ].join(' ')}
              >
                <span className="truncate">{wf.name}</span>
                {wf.enabled && <span className="ml-2 h-1.5 w-1.5 shrink-0 rounded-full bg-success" />}
              </button>
            ))}
          </div>

          <div className="border-t border-border-subtle px-3 py-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">Add node</span>
          </div>
          <div className="flex-1 overflow-y-auto pb-2">
            {NODE_DEFINITIONS.map((item) => (
              <button
                key={item.type}
                onClick={() => addNode(item.type)}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-bg-overlay hover:text-text-primary"
              >
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: item.color }} />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="text-[10px] uppercase text-text-tertiary">{item.group}</span>
              </button>
            ))}
          </div>

          <div className="space-y-2 border-t border-border-subtle p-3">
            <Input
              value={wfName}
              onChange={(e) => setWfName(e.target.value)}
              placeholder="Workflow name"
            />
            <Button className="w-full" onClick={save} disabled={saving || !wfName.trim()}>
              {saving ? 'Saving...' : 'Save workflow'}
            </Button>
            {notice && (
              <p className={`text-center text-xs ${notice.ok ? 'text-success-text' : 'text-danger-text'}`}>
                {notice.msg}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="min-w-0 flex-1 bg-[#0f0f15]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          defaultEdgeOptions={{ style: { stroke: '#64748b', strokeWidth: 1.5 } }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e1e28" />
          <Controls />
          <MiniMap
            nodeColor={(node) => {
              const type = node.data?.type as string
              return nodeMap.get(type)?.color ?? '#64748b'
            }}
            maskColor="rgba(9,9,13,0.8)"
          />
        </ReactFlow>
      </div>

      <NodeInspector
        node={selectedNode}
        sources={sources}
        models={models}
        onChange={updateSelectedConfig}
      />
    </div>
  )
}

function NodeInspector({
  node,
  sources,
  models,
  onChange,
}: {
  node: Node | null
  sources: Source[]
  models: YoloModel[]
  onChange: (patch: NodeConfig) => void
}) {
  const config = (node?.data?.config ?? {}) as NodeConfig
  const type = node?.data?.type as string | undefined
  const definition = type ? nodeMap.get(type) : null

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-border-subtle bg-bg-surface">
      <div className="border-b border-border-subtle px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">Node settings</p>
        <h2 className="mt-1 truncate text-sm font-medium text-text-primary">
          {definition?.label ?? 'Select a node'}
        </h2>
      </div>

      {!node || !definition ? (
        <div className="px-4 py-6 text-sm text-text-tertiary">
          Select a node on the canvas to edit its configuration.
        </div>
      ) : (
        <div className="space-y-4 px-4 py-4">
          <div>
            <p className="text-xs text-text-tertiary">Runtime type</p>
            <p className="mt-1 font-mono text-xs text-text-secondary">{definition.type}</p>
          </div>

          {type === 'source' && (
            <Select
              label="Source"
              value={String(config.source_id ?? '')}
              onChange={(e) => onChange({ source_id: Number(e.target.value) })}
            >
              <option value="">Select source...</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  #{source.id} {source.name} ({source.type})
                </option>
              ))}
            </Select>
          )}

          {type === 'yolo_detect' && (
            <>
              <Select
                label="Model"
                value={String(config.model_path ?? 'yolov8n.pt')}
                onChange={(e) => onChange({ model_path: e.target.value })}
              >
                <option value="yolov8n.pt">YOLOv8n built-in</option>
                {models.map((model) => (
                  <option key={model.id} value={model.path}>{model.name}</option>
                ))}
              </Select>
              <Select
                label="Device"
                value={String(config.device ?? 'auto')}
                onChange={(e) => onChange({ device: e.target.value })}
              >
                <option value="auto">Auto (CUDA then CPU)</option>
                <option value="cuda">CUDA</option>
                <option value="cpu">CPU</option>
              </Select>
              <NumberField label="Confidence" min={0} max={1} step={0.05} value={numericValue(config.confidence, 0.25)} onChange={(value) => onChange({ confidence: value })} />
              <NumberField label="IoU" min={0} max={1} step={0.05} value={numericValue(config.iou, 0.7)} onChange={(value) => onChange({ iou: value })} />
            </>
          )}

          {type === 'tracker' && (
            <>
              <Toggle label="Enabled" checked={boolValue(config.enabled)} onChange={(value) => onChange({ enabled: value })} />
              <Input label="Tracker" value={String(config.tracker ?? 'bytetrack')} onChange={(e) => onChange({ tracker: e.target.value })} />
            </>
          )}

          {type === 'class_filter' && (
            <Input
              label="Classes"
              hint="Comma-separated class names"
              value={Array.isArray(config.classes) ? config.classes.join(', ') : ''}
              onChange={(e) => onChange({
                classes: e.target.value.split(',').map((item) => item.trim()).filter(Boolean),
              })}
            />
          )}

          {type === 'confidence_filter' && (
            <NumberField label="Min confidence" min={0} max={1} step={0.05} value={numericValue(config.min_confidence, 0.5)} onChange={(value) => onChange({ min_confidence: value })} />
          )}

          {type === 'event_trigger' && (
            <>
              <NumberField label="Cooldown seconds" min={0} max={120} step={1} value={numericValue(config.cooldown_seconds, 5)} onChange={(value) => onChange({ cooldown_seconds: value })} />
              <Toggle label="Trigger once per object" checked={boolValue(config.trigger_once_per_object)} onChange={(value) => onChange({ trigger_once_per_object: value })} />
            </>
          )}

          {type === 'save_event' && (
            <>
              <Toggle label="Save frame" checked={boolValue(config.save_frame)} onChange={(value) => onChange({ save_frame: value })} />
              <Toggle label="Save metadata" checked={config.save_metadata !== false} onChange={(value) => onChange({ save_metadata: value })} />
            </>
          )}

          {type === 'overlay' && (
            <>
              <Toggle label="Boxes" checked={config.show_boxes !== false} onChange={(value) => onChange({ show_boxes: value })} />
              <Toggle label="Labels" checked={config.show_labels !== false} onChange={(value) => onChange({ show_labels: value })} />
              <Toggle label="Confidence" checked={config.show_confidence !== false} onChange={(value) => onChange({ show_confidence: value })} />
              <Toggle label="Tracker ID" checked={config.show_tracker_id !== false} onChange={(value) => onChange({ show_tracker_id: value })} />
            </>
          )}
        </div>
      )}
    </aside>
  )
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
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-text-secondary">{label}</label>
        <span className="font-mono text-xs text-text-tertiary">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded border border-border-subtle bg-bg-overlay px-3 py-2">
      <span className="text-sm text-text-secondary">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-accent"
      />
    </label>
  )
}
