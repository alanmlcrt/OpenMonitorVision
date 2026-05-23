import { api } from './client'
import type { BaseModelOption, TrainingDeviceInfo, TrainingJob } from '../types'

export interface TrainingCreatePayload {
  name: string
  dataset_id: number
  base_model: string
  config: {
    epochs: number
    imgsz: number
    batch: number
    lr0: number
    device: string | null
  }
}

export const trainingApi = {
  list:        ()       => api.get<TrainingJob[]>('/training'),
  get:         (id: number) => api.get<TrainingJob>(`/training/${id}`),
  create:      (data: TrainingCreatePayload) => api.post<TrainingJob>('/training', data),
  cancel:      (id: number) => api.post<TrainingJob>(`/training/${id}/cancel`),
  delete:      (id: number) => api.delete(`/training/${id}`),
  baseModels:  ()       => api.get<BaseModelOption[]>('/training/base-models'),
  userModels:  ()       => api.get<BaseModelOption[]>('/training/user-models'),
  deviceInfo:  ()       => api.get<TrainingDeviceInfo>('/training/device-info'),
  log:         (id: number, tail = 500) => api.get<{ lines: string[] }>(`/training/${id}/log?tail=${tail}`),
  export:      (id: number, format: 'onnx' | 'torchscript' = 'onnx') =>
    api.post<{ ok: boolean; format: string; path: string }>(`/training/${id}/export?format=${format}`),
  exportDownloadUrl: (id: number, format: 'onnx' | 'torchscript' = 'onnx') =>
    `/api/training/${id}/export/download?format=${format}`,
}
