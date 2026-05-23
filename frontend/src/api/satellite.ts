import { api } from './client'
import type { Event, SatelliteArea, SatelliteMonitorResult, SatelliteScene, SatelliteStats } from '../types'

export const satelliteApi = {
  // ── Areas ────────────────────────────────────────────────────────────────
  listAreas: () => api.get<SatelliteArea[]>('/satellite/areas'),

  createArea: (data: {
    name: string
    description?: string | null
    geojson: Record<string, unknown>
    enabled?: boolean
  }) => api.post<SatelliteArea>('/satellite/areas', data),

  updateArea: (id: number, data: {
    name?: string
    description?: string | null
    geojson?: Record<string, unknown>
    enabled?: boolean
  }) => api.patch<SatelliteArea>(`/satellite/areas/${id}`, data),

  deleteArea: (id: number) => api.delete(`/satellite/areas/${id}`),

  // ── Scenes ───────────────────────────────────────────────────────────────
  listScenes: (params?: {
    area_id?: number
    mission?: string
    max_cloud_cover?: number
    date_from?: string
    date_to?: string
    limit?: number
    offset?: number
  }) => {
    const q = new URLSearchParams()
    if (params?.area_id != null) q.set('area_id', String(params.area_id))
    if (params?.mission) q.set('mission', params.mission)
    if (params?.max_cloud_cover != null) q.set('max_cloud_cover', String(params.max_cloud_cover))
    if (params?.date_from) q.set('date_from', params.date_from)
    if (params?.date_to) q.set('date_to', params.date_to)
    if (params?.limit != null) q.set('limit', String(params.limit))
    if (params?.offset != null) q.set('offset', String(params.offset))
    return api.get<SatelliteScene[]>(`/satellite/scenes${q.size ? `?${q}` : ''}`)
  },

  createScene: (data: Partial<SatelliteScene> & {
    external_id: string
    bbox: number[]
    footprint: Record<string, unknown>
  }) => api.post<SatelliteScene>('/satellite/scenes', data),

  deleteScene: (id: number) => api.delete(`/satellite/scenes/${id}`),

  importStac: (data: {
    item?: Record<string, unknown>
    items?: Record<string, unknown>[]
    feature_collection?: Record<string, unknown>
    area_id?: number | null
    skip_existing?: boolean
  }) => api.post<SatelliteScene[]>('/satellite/scenes/import-stac', data),

  /** Thumbnail proxy URL (call directly as <img src> or fetch). */
  thumbnailUrl: (sceneId: number): string =>
    `/api/satellite/scenes/${sceneId}/thumbnail`,

  // ── STAC search ──────────────────────────────────────────────────────────
  searchStac: (payload: {
    url: string
    auth_token?: string
    [key: string]: unknown
  }) => api.post<{ type: string; features: Record<string, unknown>[] }>('/satellite/search-stac', payload),

  searchAndImport: (data: {
    url: string
    collections?: string[]
    bbox?: number[]
    date_from?: string
    date_to?: string
    max_cloud_cover?: number
    limit?: number
    area_id?: number | null
    auth_token?: string
    skip_existing?: boolean
  }) => api.post<SatelliteScene[]>('/satellite/search-and-import', data),

  // ── Monitor ──────────────────────────────────────────────────────────────
  runMonitor: (data: {
    area_id?: number | null
    max_cloud_cover?: number | null
    create_events?: boolean
  }) => api.post<SatelliteMonitorResult>('/satellite/monitor/run', data),

  listEvents: (limit = 200) =>
    api.get<Event[]>(`/satellite/events?limit=${limit}`),

  stats: () => api.get<SatelliteStats>('/satellite/stats'),
}
