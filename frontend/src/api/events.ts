import { api } from './client'
import type { Event, EventStats } from '../types'

export const eventsApi = {
  list: (params?: { limit?: number; offset?: number; source_id?: number; workflow_id?: number; class_name?: string }) => {
    const q = new URLSearchParams()
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.offset) q.set('offset', String(params.offset))
    if (params?.source_id) q.set('source_id', String(params.source_id))
    if (params?.workflow_id) q.set('workflow_id', String(params.workflow_id))
    if (params?.class_name) q.set('class_name', params.class_name)
    return api.get<Event[]>(`/events?${q}`)
  },
  stats: () => api.get<EventStats>('/events/stats'),
  delete: (id: number) => api.delete(`/events/${id}`),
  clearAll: (params?: { source_id?: number; workflow_id?: number }) => {
    const q = new URLSearchParams()
    if (params?.source_id) q.set('source_id', String(params.source_id))
    if (params?.workflow_id) q.set('workflow_id', String(params.workflow_id))
    return api.delete<{ deleted: number }>(`/events?${q}`)
  },
  cleanupFrames: (olderThanDays = 7) =>
    api.post<{ deleted_files: number }>(`/events/cleanup-frames?older_than_days=${olderThanDays}`),
}
