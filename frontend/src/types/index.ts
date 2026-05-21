export type SourceType = 'webcam' | 'video' | 'rtsp' | 'image'

export interface Source {
  id: number
  name: string
  type: SourceType
  uri: string
  enabled: boolean
  created_at: string
}

export interface BBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Detection {
  class_id: number
  class_name: string
  confidence: number | null
  tracker_id: number | null
  bbox: BBox
  zone_name: string | null
}

export interface Event {
  id: number
  timestamp: string
  source_id: number | null
  workflow_id: number | null
  class_name: string
  class_id: number | null
  confidence: number | null
  tracker_id: number | null
  zone_name: string | null
  bbox: BBox | null
  frame_path: string | null
}

export interface EventStats {
  total: number
  by_class: Record<string, number>
  by_source: Record<string, number>
  by_hour: Record<string, number>
}

export interface Workflow {
  id: number
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface WorkflowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    type: string
    label: string
    config: Record<string, unknown>
  }
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
}

export interface YoloModel {
  id: number
  name: string
  filename: string
  path: string
  is_default: boolean
  created_at: string
}

export interface WsFrame {
  type: 'frame'
  frame: string
  detections: Detection[]
  events: Detection[]
}
