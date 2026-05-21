import { useCallback, useEffect, useState } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { workflowsApi } from '../api/workflows'
import type { Workflow } from '../types'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'

const NODE_PALETTE = [
  { type: 'source',             label: 'Source',             color: '#7c3aed' },
  { type: 'yolo_detect',        label: 'YOLO Detect',        color: '#2563eb' },
  { type: 'tracker',            label: 'Tracker',            color: '#0891b2' },
  { type: 'class_filter',       label: 'Class Filter',       color: '#d97706' },
  { type: 'confidence_filter',  label: 'Confidence Filter',  color: '#ea580c' },
  { type: 'event_trigger',      label: 'Event Trigger',      color: '#dc2626' },
  { type: 'save_event',         label: 'Save Event',         color: '#16a34a' },
  { type: 'overlay',            label: 'Overlay',            color: '#5c6bc0' },
]

const DEFAULT_CONFIGS: Record<string, Record<string, unknown>> = {
  source:             { source_id: 1 },
  yolo_detect:        { model_path: 'yolov8n.pt', confidence: 0.25, iou: 0.7 },
  tracker:            { enabled: true, tracker: 'bytetrack' },
  class_filter:       { classes: ['person', 'car'] },
  confidence_filter:  { min_confidence: 0.5 },
  event_trigger:      { cooldown_seconds: 5 },
  save_event:         { save_frame: false },
  overlay:            { show_boxes: true, show_labels: true, show_confidence: true, show_tracker_id: true },
}

let nodeCounter = 1

function makeNode(type: string, position = { x: 160, y: 100 }): Node {
  const id = `node_${nodeCounter++}`
  const info = NODE_PALETTE.find((n) => n.type === type)
  return {
    id,
    type: 'default',
    position,
    data: {
      type,
      label: info?.label ?? type,
      config: { ...DEFAULT_CONFIGS[type] },
    },
    style: {
      background: '#14141c',
      border: `1px solid ${info?.color ?? '#252533'}44`,
      borderRadius: 8,
      color: '#eeeef5',
      fontSize: 12,
      padding: '10px 16px',
      minWidth: 150,
      fontFamily: 'Inter, sans-serif',
      boxShadow: `0 0 0 0 ${info?.color}00`,
    },
  }
}

export function WorkflowBuilderPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [selectedWf, setSelectedWf] = useState<Workflow | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [wfName, setWfName] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ msg: string; ok: boolean } | null>(null)

  const loadWorkflows = () => workflowsApi.list().then(setWorkflows).catch(() => {})

  useEffect(() => { loadWorkflows() }, [])

  const loadWorkflow = (wf: Workflow) => {
    setSelectedWf(wf)
    setWfName(wf.name)
    setNodes((wf.nodes as Node[]) ?? [])
    setEdges((wf.edges as Edge[]) ?? [])
  }

  const newWorkflow = () => {
    setSelectedWf(null)
    setWfName('Untitled workflow')
    setNodes([])
    setEdges([])
  }

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, animated: false }, eds)),
    [setEdges],
  )

  const addNode = (type: string) => {
    const node = makeNode(type, {
      x: 100 + Math.random() * 120,
      y: 60 + nodes.length * 90,
    })
    setNodes((ns) => [...ns, node])
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
      {/* Left sidebar */}
      <div className="w-52 flex-shrink-0 flex flex-col border-r border-border-subtle bg-bg-surface overflow-hidden">
        {/* Workflow list */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-3 border-b border-border-subtle flex items-center justify-between">
            <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Workflows</span>
            <Button size="xs" variant="ghost" onClick={newWorkflow}>New</Button>
          </div>
          <div className="py-1">
            {workflows.length === 0 && (
              <p className="px-3 py-2 text-xs text-text-tertiary">No workflows</p>
            )}
            {workflows.map((wf) => (
              <button
                key={wf.id}
                onClick={() => loadWorkflow(wf)}
                className={[
                  'w-full flex items-center justify-between px-3 py-2 text-sm transition-colors',
                  selectedWf?.id === wf.id
                    ? 'bg-accent-subtle text-accent'
                    : 'text-text-secondary hover:bg-bg-overlay hover:text-text-primary',
                ].join(' ')}
              >
                <span className="truncate">{wf.name}</span>
                {wf.enabled && (
                  <span className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0 ml-2" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Node palette */}
        <div className="border-t border-border-subtle">
          <div className="px-3 py-2.5">
            <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Add node</span>
          </div>
          <div className="pb-2">
            {NODE_PALETTE.map((n) => (
              <button
                key={n.type}
                onClick={() => addNode(n.type)}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-overlay hover:text-text-primary transition-colors"
              >
                <span
                  className="w-2 h-2 rounded-sm flex-shrink-0"
                  style={{ background: n.color }}
                />
                {n.label}
              </button>
            ))}
          </div>
        </div>

        {/* Save bar */}
        <div className="p-3 border-t border-border-subtle space-y-2">
          <Input
            value={wfName}
            onChange={(e) => setWfName(e.target.value)}
            placeholder="Workflow name"
          />
          <Button className="w-full" onClick={save} disabled={saving || !wfName.trim()}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
          {notice && (
            <p className={`text-xs text-center ${notice.ok ? 'text-success-text' : 'text-danger-text'}`}>
              {notice.msg}
            </p>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 min-w-0" style={{ background: '#0f0f15' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          defaultEdgeOptions={{ style: { stroke: '#5c6bc0', strokeWidth: 1.5 } }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="#1e1e28"
          />
          <Controls />
          <MiniMap
            nodeColor={(n) => {
              const type = n.data?.type as string
              return NODE_PALETTE.find((p) => p.type === type)?.color ?? '#5c6bc0'
            }}
            maskColor="rgba(9,9,13,0.8)"
          />
        </ReactFlow>
      </div>
    </div>
  )
}
