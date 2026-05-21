import { useEffect, useRef, useState } from 'react'
import { workflowsApi } from '../api/workflows'
import type { Detection, Workflow, WsFrame } from '../types'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Select } from '../components/ui/Input'

export function LiveViewPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [frame, setFrame] = useState<string | null>(null)
  const [detections, setDetections] = useState<Detection[]>([])
  const [fps, setFps] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const fpsCountRef = useRef(0)
  const fpsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
    try {
      await workflowsApi.start(selectedId)
      setIsRunning(true)
      connect(selectedId)
    } catch (e: any) {
      alert(e.message)
    }
  }

  const stop = async () => {
    if (!selectedId) return
    wsRef.current?.close()
    clearInterval(fpsTimerRef.current!)
    await workflowsApi.stop(selectedId)
    setIsRunning(false)
    setFrame(null)
    setDetections([])
    setFps(0)
  }

  useEffect(() => () => {
    wsRef.current?.close()
    clearInterval(fpsTimerRef.current!)
  }, [])

  return (
    <div className="p-6 space-y-4 h-full flex flex-col max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Live</h1>
          <p className="text-sm text-text-secondary mt-0.5">Real-time detection stream</p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={selectedId ?? ''}
            onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
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
        </div>
      </div>

      {/* Content */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Stream */}
        <div className="flex-1 flex flex-col gap-2 min-w-0">
          <Card padding="none" className="flex-1 overflow-hidden relative bg-bg-base">
            {frame ? (
              <img
                src={`data:image/jpeg;base64,${frame}`}
                alt="Live stream"
                className="w-full h-full object-contain"
              />
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
