import { useEffect, useMemo, useRef, useState } from 'react'
import { workflowsApi } from '../api/workflows'
import type { Detection, Workflow, WsFrame } from '../types'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Select } from '../components/ui/Input'

interface ZoneConfig {
  name: string
  points: [number, number][]
}

interface DisplaySettings {
  boxes: boolean
  labels: boolean
  confidence: boolean
  trackerId: boolean
  fontSize: number
}

const DEFAULT_DISPLAY: DisplaySettings = {
  boxes: true,
  labels: true,
  confidence: true,
  trackerId: false,
  fontSize: 13,
}

// Match the backend frame dimensions (settings.frame_width / frame_height).
// Zone polygon points are stored in this coordinate space so sv.PolygonZone
// filters detections in the same frame the WebSocket streams.
const FRAME_WIDTH = 1280
const FRAME_HEIGHT = 720

// Palette for client-side detection rendering (cycles by class_id)
const DET_PALETTE = [
  '#3b82f6','#ef4444','#22c55e','#f59e0b','#a78bfa',
  '#ec4899','#06b6d4','#f97316','#84cc16','#14b8a6',
]

export function LiveViewPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [frame, setFrame] = useState<string | null>(null)
  const [detections, setDetections] = useState<Detection[]>([])
  const [fps, setFps] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [display, setDisplay] = useState<DisplaySettings>(() => {
    try { return { ...DEFAULT_DISPLAY, ...JSON.parse(localStorage.getItem('omv-display') ?? '{}') } }
    catch { return DEFAULT_DISPLAY }
  })
  const patchDisplay = (patch: Partial<DisplaySettings>) => {
    const next = { ...display, ...patch }
    setDisplay(next)
    localStorage.setItem('omv-display', JSON.stringify(next))
  }

  const [zoneEditEnabled, setZoneEditEnabled] = useState(false)
  const [draftZones, setDraftZones] = useState<ZoneConfig[]>([])
  const [selectedZoneIndex, setSelectedZoneIndex] = useState(0)
  const [dragPoint, setDragPoint] = useState<{ zoneIndex: number; pointIndex: number } | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fpsCountRef = useRef(0)
  const fpsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedId) ?? null,
    [workflows, selectedId],
  )

  const workflowZones = useMemo(
    () => extractWorkflowZones(selectedWorkflow),
    [selectedWorkflow],
  )

  const hasZoneFilterNode = useMemo(
    () => Boolean(selectedWorkflow?.nodes.some((node) => node.data?.type === 'zone_filter')),
    [selectedWorkflow],
  )

  const hasOverlayNode = useMemo(
    () => Boolean(selectedWorkflow?.nodes.some((node) => node.data?.type === 'overlay')),
    [selectedWorkflow],
  )

  useEffect(() => {
    setDraftZones(workflowZones)
    setSelectedZoneIndex(0)
    setDragPoint(null)
  }, [workflowZones])

  useEffect(() => {
    workflowsApi.list().then(setWorkflows).catch(() => {})
  }, [])

  const connect = (workflowId: number) => {
    wsRef.current?.close()
    const ws = new WebSocket(`ws://${location.host}/ws/workflow/${workflowId}`)
    ws.onmessage = (e) => {
      const data: WsFrame = JSON.parse(e.data)
      if (data.type === 'frame') {
        setFrame(data.frame)
        setDetections(data.detections ?? [])
        fpsCountRef.current++
      }
    }
    ws.onclose = () => {
      setIsRunning(false)
      clearInterval(fpsTimerRef.current!)
    }
    wsRef.current = ws

    fpsTimerRef.current = setInterval(() => {
      setFps(fpsCountRef.current)
      fpsCountRef.current = 0
    }, 1000)
  }

  const start = async () => {
    if (!selectedId) return
    setError(null)
    try {
      await workflowsApi.start(selectedId)
      setIsRunning(true)
      connect(selectedId)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to start workflow')
    }
  }

  const stop = async () => {
    if (!selectedId) return
    setError(null)
    wsRef.current?.close()
    clearInterval(fpsTimerRef.current!)
    await workflowsApi.stop(selectedId)
    setIsRunning(false)
    setFrame(null)
    setDetections([])
    setFps(0)
  }

  const saveZones = async () => {
    if (!selectedWorkflow || !hasZoneFilterNode) return
    setError(null)
    const updatedNodes = writeWorkflowZones(selectedWorkflow, draftZones)
    try {
      const updated = await workflowsApi.update(selectedWorkflow.id, { nodes: updatedNodes })
      setWorkflows((items) => items.map((item) => (item.id === updated.id ? updated : item)))
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to save zones')
    }
  }

  const addZone = () => {
    if (!hasZoneFilterNode) return
    const nextZone = {
      name: `Zone ${draftZones.length + 1}`,
      points: [[160, 100], [480, 100], [480, 260], [160, 260]] as [number, number][],
    }
    setDraftZones((zones) => [...zones, nextZone])
    setSelectedZoneIndex(draftZones.length)
  }

  const deleteZone = () => {
    if (draftZones.length === 0) return
    setDraftZones((zones) => zones.filter((_, index) => index !== selectedZoneIndex))
    setSelectedZoneIndex((index) => Math.max(0, index - 1))
  }

  const updateZone = (zoneIndex: number, patch: Partial<ZoneConfig>) => {
    setDraftZones((zones) =>
      zones.map((zone, index) => (index === zoneIndex ? { ...zone, ...patch } : zone)),
    )
  }

  const pointFromEvent = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * FRAME_WIDTH
    const y = ((event.clientY - rect.top) / rect.height) * FRAME_HEIGHT
    return [
      Math.round(Math.min(FRAME_WIDTH, Math.max(0, x))),
      Math.round(Math.min(FRAME_HEIGHT, Math.max(0, y))),
    ] as [number, number]
  }

  const addZonePoint = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!zoneEditEnabled || dragPoint || draftZones.length === 0) return
    const zone = draftZones[selectedZoneIndex]
    if (!zone) return
    updateZone(selectedZoneIndex, { points: [...zone.points, pointFromEvent(event)] })
  }

  const moveZonePoint = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!zoneEditEnabled || !dragPoint) return
    const zone = draftZones[dragPoint.zoneIndex]
    if (!zone) return
    const point = pointFromEvent(event)
    updateZone(dragPoint.zoneIndex, {
      points: zone.points.map((item, index) => (index === dragPoint.pointIndex ? point : item)),
    })
  }

  const removeZonePoint = (zoneIndex: number, pointIndex: number) => {
    const zone = draftZones[zoneIndex]
    if (!zone) return
    updateZone(zoneIndex, { points: zone.points.filter((_, index) => index !== pointIndex) })
  }

  useEffect(() => () => {
    wsRef.current?.close()
    clearInterval(fpsTimerRef.current!)
  }, [])

  return (
    <div className="h-full w-full p-6 space-y-4 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Live</h1>
          <p className="text-sm text-text-secondary mt-0.5">Real-time detection stream</p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={selectedId ?? ''}
            onChange={(e) => {
              setSelectedId(e.target.value ? Number(e.target.value) : null)
              setZoneEditEnabled(false)
            }}
            className="w-52"
          >
            <option value="">Select workflow...</option>
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </Select>
          {isRunning ? (
            <Button variant="danger" onClick={stop}>Stop</Button>
          ) : (
            <Button onClick={start} disabled={!selectedId}>Start</Button>
          )}
          <Button
            variant={zoneEditEnabled ? 'primary' : 'secondary'}
            onClick={() => setZoneEditEnabled((value) => !value)}
            disabled={!selectedWorkflow}
          >
            Zones
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-danger/30 bg-danger-subtle px-4 py-2.5 text-sm text-danger-text">
          <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
            <circle cx="8" cy="8" r="6" />
            <line x1="8" y1="5" x2="8" y2="8.5" />
            <circle cx="8" cy="11" r="0.5" fill="currentColor" />
          </svg>
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="opacity-60 hover:opacity-100 transition-opacity">
            <svg viewBox="0 0 12 12" width={12} height={12} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
              <line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" />
            </svg>
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Stream */}
        <div className="flex-1 flex flex-col gap-2 min-w-0">
          <Card padding="none" className="flex-1 overflow-hidden relative bg-bg-base">
            {frame ? (
              <div className="flex h-full w-full items-center justify-center">
                <div className="relative aspect-video max-h-full w-full max-w-full">
                  <img
                    src={`data:image/jpeg;base64,${frame}`}
                    alt="Live stream"
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                  {/* Client-side detection rendering — only when no backend Overlay node */}
                  {!hasOverlayNode && (
                    <DetectionOverlay detections={detections} display={display} />
                  )}
                  <ZoneOverlay
                    zones={draftZones}
                    selectedZoneIndex={selectedZoneIndex}
                    editable={zoneEditEnabled}
                    onSelectZone={setSelectedZoneIndex}
                    onStartDrag={setDragPoint}
                    onRemovePoint={removeZonePoint}
                    onPointerDown={addZonePoint}
                    onPointerMove={moveZonePoint}
                    onPointerEnd={() => setDragPoint(null)}
                  />
                </div>
              </div>
            ) : (
              <div className="w-full h-full min-h-64 flex flex-col items-center justify-center gap-2">
                <div className={[
                  'w-2 h-2 rounded-full',
                  isRunning ? 'bg-success animate-pulse' : 'bg-border-strong',
                ].join(' ')} />
                <p className="text-sm text-text-tertiary">
                  {isRunning ? 'Waiting for frames...' : 'Select a workflow and press Start'}
                </p>
              </div>
            )}
            {/* Overlay status bar */}
            {isRunning && (
              <div className="absolute bottom-0 left-0 right-0 h-7 bg-bg-base/80 backdrop-blur-sm border-t border-border-subtle flex items-center px-4 gap-4">
                <Badge variant="success" dot>Live</Badge>
                <span className="text-xs text-text-tertiary font-mono">{fps} fps</span>
                <span className="text-xs text-text-tertiary">{detections.length} detections</span>
              </div>
            )}
          </Card>
        </div>

        {/* Side panel */}
        <div className="w-60 flex-shrink-0 flex flex-col gap-3">
          <Card padding="none" className="overflow-hidden">
            <div className="border-b border-border-subtle px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-text-primary">Zones</h3>
                <Badge variant={zoneEditEnabled ? 'accent' : 'neutral'}>
                  {draftZones.length}
                </Badge>
              </div>
            </div>
            <div className="space-y-2 p-3">
              <div className="flex gap-2">
                <Button size="xs" variant="secondary" className="flex-1" onClick={addZone} disabled={!selectedWorkflow || !hasZoneFilterNode}>
                  Add
                </Button>
                <Button size="xs" variant="danger" onClick={deleteZone} disabled={!selectedWorkflow || !hasZoneFilterNode || draftZones.length === 0}>
                  Delete
                </Button>
                <Button size="xs" onClick={saveZones} disabled={!selectedWorkflow || !hasZoneFilterNode}>
                  Save
                </Button>
              </div>
              {!hasZoneFilterNode ? (
                <p className="text-xs text-text-tertiary">No Zone Filter node</p>
              ) : draftZones.length === 0 ? (
                <p className="text-xs text-text-tertiary">No zones configured</p>
              ) : (
                <div className="max-h-28 overflow-y-auto rounded border border-border-subtle bg-bg-overlay">
                  {draftZones.map((zone, index) => (
                    <button
                      key={`${zone.name}_${index}`}
                      type="button"
                      onClick={() => setSelectedZoneIndex(index)}
                      className={[
                        'flex w-full items-center justify-between border-b border-border-subtle px-2 py-1.5 text-left text-xs last:border-b-0',
                        selectedZoneIndex === index ? 'bg-accent-subtle text-accent' : 'text-text-secondary hover:text-text-primary',
                      ].join(' ')}
                    >
                      <span className="truncate">{zone.name || `Zone ${index + 1}`}</span>
                      <span className="font-mono text-2xs text-text-tertiary">{zone.points.length} pts</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* Display settings */}
          <Card padding="none" className="overflow-hidden">
            <div className="border-b border-border-subtle px-4 py-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-text-primary">Affichage</h3>
                {hasOverlayNode && (
                  <span className="text-2xs text-text-disabled" title="Overlay node présent dans le workflow — les annotations sont rendues côté backend">backend</span>
                )}
              </div>
            </div>
            <div className="space-y-2 p-3">
              {hasOverlayNode ? (
                <p className="text-xs text-text-tertiary">
                  Un nœud Overlay est présent dans le workflow. Les annotations sont rendues côté serveur. Supprimez-le pour activer les contrôles ci-dessous.
                </p>
              ) : (
                <>
                  <div className="space-y-1">
                    {(
                      [
                        { key: 'boxes', label: 'Boîtes' },
                        { key: 'labels', label: 'Labels' },
                        { key: 'confidence', label: 'Confiance' },
                        { key: 'trackerId', label: 'Tracker ID' },
                      ] as { key: keyof DisplaySettings; label: string }[]
                    ).map(({ key, label }) => (
                      <label key={key} className="flex cursor-pointer items-center justify-between gap-2">
                        <span className="text-xs text-text-secondary">{label}</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={!!display[key]}
                          onClick={() => patchDisplay({ [key]: !display[key] } as Partial<DisplaySettings>)}
                          className={[
                            'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors',
                            display[key] ? 'bg-accent' : 'bg-border-strong',
                          ].join(' ')}
                        >
                          <span className={[
                            'inline-block h-3 w-3 rounded-full bg-white shadow transition-transform',
                            display[key] ? 'translate-x-3.5' : 'translate-x-0.5',
                          ].join(' ')} />
                        </button>
                      </label>
                    ))}
                  </div>
                  {display.labels && (
                    <div>
                      <p className="mb-1 text-2xs text-text-disabled">Taille — {display.fontSize} px</p>
                      <input
                        type="range" min={9} max={20} step={1}
                        value={display.fontSize}
                        onChange={(e) => patchDisplay({ fontSize: Number(e.target.value) })}
                        className="w-full accent-accent"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </Card>

          <Card padding="none" className="flex-1 overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
              <h3 className="text-sm font-medium text-text-primary">Detections</h3>
              <span className="text-xs text-text-tertiary">{detections.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {detections.length === 0 ? (
                <div className="px-4 py-6 text-xs text-text-tertiary">
                  {isRunning ? 'No detections in current frame' : 'Stream stopped'}
                </div>
              ) : (
                <div className="divide-y divide-border-subtle">
                  {detections.map((d, i) => (
                    <div key={i} className="px-4 py-2.5 space-y-1">
                      <div className="flex items-center justify-between">
                        <Badge variant="accent">{d.class_name}</Badge>
                        <span className="text-xs font-mono text-text-secondary">
                          {d.confidence != null ? `${(d.confidence * 100).toFixed(0)}%` : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-text-tertiary">
                        {d.tracker_id != null && <span>#{d.tracker_id}</span>}
                        {d.zone_name && <span>{d.zone_name}</span>}
                        {d.bbox && (
                          <span className="font-mono">
                            {Math.round(d.bbox.x2 - d.bbox.x1)}x{Math.round(d.bbox.y2 - d.bbox.y1)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

// ─── Client-side detection overlay ───────────────────────────────────────────

function DetectionOverlay({
  detections,
  display,
}: {
  detections: import('../types').Detection[]
  display: DisplaySettings
}) {
  if (!display.boxes && !display.labels) return null
  return (
    <svg
      viewBox={`0 0 ${FRAME_WIDTH} ${FRAME_HEIGHT}`}
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      {detections.map((det, i) => {
        if (!det.bbox) return null
        const { x1, y1, x2, y2 } = det.bbox
        const color = DET_PALETTE[det.class_id % DET_PALETTE.length]
        const labelParts = [
          det.class_name,
          display.confidence && det.confidence != null
            ? `${Math.round(det.confidence * 100)}%`
            : '',
          display.trackerId && det.tracker_id != null ? `#${det.tracker_id}` : '',
        ].filter(Boolean)
        const labelText = labelParts.join(' ')
        const charW = display.fontSize * 0.62
        const labelW = labelText.length * charW + 8
        const labelH = display.fontSize + 6
        return (
          <g key={i}>
            {display.boxes && (
              <rect
                x={x1} y={y1}
                width={x2 - x1} height={y2 - y1}
                stroke={color} fill={`${color}18`} strokeWidth={1.5}
              />
            )}
            {display.labels && labelText && (
              <>
                <rect
                  x={x1}
                  y={Math.max(0, y1 - labelH)}
                  width={labelW}
                  height={labelH}
                  fill={color}
                  rx={2}
                />
                <text
                  x={x1 + 4}
                  y={Math.max(display.fontSize, y1 - 3)}
                  fill="white"
                  fontSize={display.fontSize}
                  fontFamily="ui-monospace, monospace"
                  fontWeight="600"
                >
                  {labelText}
                </text>
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function extractWorkflowZones(workflow: Workflow | null): ZoneConfig[] {
  if (!workflow) return []
  const zoneNode = workflow.nodes.find((node) => node.data?.type === 'zone_filter')
  const zones = zoneNode?.data?.config?.zones
  if (!Array.isArray(zones)) return []
  return (zones as unknown[]).map((zone, index) => {
    const item = zone as { name?: unknown; points?: unknown }
    const points = Array.isArray(item.points) ? item.points : []
    return {
      name: typeof item.name === 'string' && item.name.trim() ? item.name : `Zone ${index + 1}`,
      points: points
          .filter((point: unknown): point is [number, number] =>
            Array.isArray(point) &&
            point.length >= 2 &&
            Number.isFinite(Number(point[0])) &&
            Number.isFinite(Number(point[1])),
          )
          .map(([x, y]) => [Number(x), Number(y)] as [number, number])
    }
  })
}

function writeWorkflowZones(workflow: Workflow, zones: ZoneConfig[]) {
  return workflow.nodes.map((node) => {
    if (node.data?.type !== 'zone_filter') return node
    return {
      ...node,
      data: {
        ...node.data,
        config: {
          ...(node.data.config ?? {}),
          zones: zones.map((zone) => ({
            name: zone.name,
            points: zone.points.map(([x, y]) => [Math.round(x), Math.round(y)]),
          })),
        },
      },
    }
  })
}

function ZoneOverlay({
  zones,
  selectedZoneIndex,
  editable,
  onSelectZone,
  onStartDrag,
  onRemovePoint,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
}: {
  zones: ZoneConfig[]
  selectedZoneIndex: number
  editable: boolean
  onSelectZone: (index: number) => void
  onStartDrag: (drag: { zoneIndex: number; pointIndex: number }) => void
  onRemovePoint: (zoneIndex: number, pointIndex: number) => void
  onPointerDown: (event: React.PointerEvent<SVGSVGElement>) => void
  onPointerMove: (event: React.PointerEvent<SVGSVGElement>) => void
  onPointerEnd: () => void
}) {
  return (
    <svg
      viewBox={`0 0 ${FRAME_WIDTH} ${FRAME_HEIGHT}`}
      className={[
        'absolute inset-0 h-full w-full',
        editable ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none',
      ].join(' ')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerLeave={onPointerEnd}
    >
      {zones.map((zone, zoneIndex) => {
        const isSelected = zoneIndex === selectedZoneIndex
        const points = zone.points.map(([x, y]) => `${x},${y}`).join(' ')
        return (
          <g key={`${zone.name}_${zoneIndex}`} opacity={isSelected || !editable ? 1 : 0.45}>
            {zone.points.length > 2 && (
              <polygon
                points={points}
                fill={isSelected ? '#a78bfa28' : '#14b8a620'}
                stroke={isSelected ? '#a78bfa' : '#14b8a6'}
                strokeWidth={2}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  onSelectZone(zoneIndex)
                }}
              />
            )}
            {zone.points.length === 2 && (
              <polyline points={points} fill="none" stroke="#a78bfa" strokeWidth={2} />
            )}
            {editable && zone.points.map(([x, y], pointIndex) => (
              <circle
                key={`${zoneIndex}_${pointIndex}`}
                cx={x}
                cy={y}
                r={isSelected ? 7 : 5}
                fill={isSelected ? '#a78bfa' : '#14b8a6'}
                stroke="#09090d"
                strokeWidth={2}
                className="cursor-grab"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  onSelectZone(zoneIndex)
                  onStartDrag({ zoneIndex, pointIndex })
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation()
                  onRemovePoint(zoneIndex, pointIndex)
                }}
              />
            ))}
          </g>
        )
      })}
    </svg>
  )
}
