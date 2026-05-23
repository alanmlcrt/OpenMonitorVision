export type SourceType =
  | 'webcam'
  | 'video'
  | 'rtsp'
  | 'image'
  | 'stream'
  | 'ip_camera'
  | 'image_url'
  | 'image_folder'
  | 'satellite'

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
  color_name?: string | null
  color_ratio?: number | null
  zone_sequence?: string[] | null
  zone_sequence_completed?: boolean | null
  sequence_duration_seconds?: number | null
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
  metadata: Record<string, unknown> | null
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

export interface Dataset {
  id: number
  name: string
  path: string
  yaml_path: string
  classes: string[]
  num_images: number
  num_train: number
  num_val: number
  created_at: string
}

export interface DatasetImage {
  stem: string
  filename: string
  split: 'train' | 'val'
  width: number
  height: number
  label_count: number
  annotated: boolean
}

export interface YoloBox {
  class_id: number
  x: number   // center, normalized 0..1
  y: number   // center, normalized 0..1
  w: number   // width, normalized 0..1
  h: number   // height, normalized 0..1
}

export interface DatasetValidation {
  ok: boolean
  warnings: string[]
  errors: string[]
  classes: string[]
  num_train: number
  num_val: number
}

export type TrainingStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface TrainingProgress {
  epoch: number
  total_epochs: number
  metrics: Record<string, number>
}

export interface TrainingMetric {
  epoch: number
  [k: string]: number
}

export interface TrainingJob {
  id: number
  name: string
  dataset_id: number | null
  base_model: string
  config: Record<string, unknown>
  status: TrainingStatus
  progress: TrainingProgress | Record<string, never>
  metrics: TrainingMetric[]
  output_path: string | null
  weights_path: string | null
  model_id: number | null
  error: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
}

export interface BaseModelOption {
  value: string
  label: string
}

export interface TrainingDeviceInfo {
  cuda_available: boolean
  devices: Array<{ id: string; name: string }>
  recommended: string
}

export interface MqttBroker {
  id: number
  name: string
  host: string
  port: number
  username: string | null
  use_tls: boolean
  client_id: string | null
  keepalive: number
  created_at: string
}

export interface MqttBrokerPayload {
  name: string
  host: string
  port: number
  username?: string | null
  password?: string | null
  use_tls: boolean
  client_id?: string | null
  keepalive: number
}

export interface TrainingWsMessage {
  type: 'progress' | 'status' | 'log' | 'error'
  epoch?: number
  total_epochs?: number
  metrics?: Record<string, number>
  status?: TrainingStatus
  error?: string | null
  model_id?: number | null
  line?: string
  message?: string
}

export interface SatelliteArea {
  id: number
  name: string
  description: string | null
  geojson: Record<string, unknown>
  bbox: [number, number, number, number]
  enabled: boolean
  created_at: string
  scene_count: number
}

export interface SatelliteScene {
  id: number
  external_id: string
  provider: string
  mission: string | null
  product_type: string | null
  acquired_at: string | null
  cloud_cover: number | null
  bbox: [number, number, number, number]
  footprint: Record<string, unknown>
  assets: Record<string, unknown>
  metadata: Record<string, unknown> | null
  local_path: string | null
  thumbnail_url: string | null
  source_url: string | null
  area_id: number | null
  status: string
  created_at: string
}

export interface SatelliteMonitorResult {
  matched_scenes: number
  created_events: number
}

export interface SatelliteStats {
  areas: number
  scenes: number
  events: number
  by_mission: Record<string, number>
}
