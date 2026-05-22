import { api } from './client'
import type { Workflow } from '../types'

export const workflowsApi = {
  list: () => api.get<Workflow[]>('/workflows'),
  get: (id: number) => api.get<Workflow>(`/workflows/${id}`),
  create: (data: { name: string; nodes: unknown[]; edges: unknown[] }) => api.post<Workflow>('/workflows', data),
  update: (id: number, data: Partial<Workflow>) => api.patch<Workflow>(`/workflows/${id}`, data),
  delete: (id: number) => api.delete(`/workflows/${id}`),
  start: (id: number) => api.post<{ status: string }>(`/workflows/${id}/start`),
  stop: (id: number) => api.post<{ status: string }>(`/workflows/${id}/stop`),
  status: (id: number) => api.get<{ running: boolean }>(`/workflows/${id}/status`),
  validate: (data: { nodes: unknown[]; edges: unknown[] }) =>
    api.post<{ valid: boolean; errors: string[] }>('/workflows/validate', data),
}
