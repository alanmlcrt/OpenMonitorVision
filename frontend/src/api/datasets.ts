import { api } from './client'
import type { Dataset, DatasetImage, DatasetValidation, YoloBox } from '../types'

export const datasetsApi = {
  list: () => api.get<Dataset[]>('/datasets'),
  get:  (id: number) => api.get<Dataset>(`/datasets/${id}`),
  validate: (id: number) => api.get<DatasetValidation>(`/datasets/${id}/validate`),
  delete: (id: number) => api.delete(`/datasets/${id}`),

  upload: async (name: string, file: File): Promise<Dataset> => {
    const form = new FormData()
    form.append('name', name)
    form.append('file', file)
    const res = await fetch('/api/datasets', { method: 'POST', body: form })
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
    return res.json()
  },

  uploadFolder: async (name: string, classes: string[], files: File[]): Promise<Dataset> => {
    const form = new FormData()
    form.append('name', name)
    form.append('classes', classes.join(','))
    for (const f of files) form.append('files', f)
    const res = await fetch('/api/datasets/from-folder', { method: 'POST', body: form })
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
    return res.json()
  },

  createFromSource: (payload: {
    name: string
    source_id: number
    num_frames: number
    interval_seconds: number
    classes: string[]
  }) => api.post<Dataset>('/datasets/from-source', payload),

  // Annotation
  listImages: (id: number) => api.get<DatasetImage[]>(`/datasets/${id}/images`),
  imageUrl: (id: number, stem: string, split: 'train' | 'val') =>
    `/api/datasets/${id}/image?stem=${encodeURIComponent(stem)}&split=${split}`,
  getLabel: (id: number, stem: string, split: 'train' | 'val') =>
    api.get<{ stem: string; boxes: YoloBox[] }>(
      `/datasets/${id}/label?stem=${encodeURIComponent(stem)}&split=${split}`,
    ),
  putLabel: (id: number, stem: string, split: 'train' | 'val', boxes: YoloBox[]) =>
    fetch(`/api/datasets/${id}/label?stem=${encodeURIComponent(stem)}&split=${split}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boxes }),
    }).then(async (r) => {
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`)
      return r.json() as Promise<{ stem: string; saved: number }>
    }),
}
