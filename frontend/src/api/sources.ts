import { api } from './client'
import type { Source } from '../types'

export const sourcesApi = {
  list: () => api.get<Source[]>('/sources'),
  get: (id: number) => api.get<Source>(`/sources/${id}`),
  create: (data: Omit<Source, 'id' | 'created_at'>) => api.post<Source>('/sources', data),
  update: (id: number, data: Partial<Source>) => api.patch<Source>(`/sources/${id}`, data),
  delete: (id: number) => api.delete(`/sources/${id}`),
  preview: (id: number) => api.get<{ frame: string }>(`/sources/${id}/preview`),
  test: (id: number) => api.get<{ ok: boolean; width?: number; height?: number; error?: string }>(`/sources/${id}/test`),
}
