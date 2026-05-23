import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { satelliteApi } from '../api/satellite'
import type { Event, SatelliteArea, SatelliteMonitorResult, SatelliteScene, SatelliteStats } from '../types'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'map' | 'areas' | 'scenes' | 'search'
type MapMode = 'view' | 'draw'

interface ViewBox { x: number; y: number; w: number; h: number }
interface GeoPoint { lon: number; lat: number }

// ─── Constants ───────────────────────────────────────────────────────────────

const NATIVE_W = 960
const NATIVE_H = 480

const STAC_PROVIDERS = [
  { id: 'element84', name: 'Element 84 Earth Search', url: 'https://earth-search.aws.element84.com/v1/search', requiresAuth: false },
  { id: 'planetary', name: 'Planetary Computer (MSFT)', url: 'https://planetarycomputer.microsoft.com/api/stac/v1/search', requiresAuth: false },
  { id: 'cdse', name: 'Copernicus CDSE', url: 'https://catalogue.dataspace.copernicus.eu/stac/search', requiresAuth: true },
  { id: 'custom', name: 'Custom endpoint…', url: '', requiresAuth: false },
]

const STAC_COLLECTIONS: Record<string, string[]> = {
  element84: ['sentinel-2-l2a', 'sentinel-2-l1c', 'cop-dem-glo-30', 'landsat-c2-l2'],
  planetary: ['sentinel-2-l2a', 'landsat-c2-l2', 'cop-dem-glo-30', 'naip'],
  cdse: ['SENTINEL-2', 'SENTINEL-1', 'SENTINEL-3', 'SENTINEL-5P'],
  custom: [],
}

// ─── Projection helpers ───────────────────────────────────────────────────────

function project(lon: number, lat: number, vb: ViewBox) {
  const nx = ((lon + 180) / 360) * NATIVE_W
  const ny = ((90 - lat) / 180) * NATIVE_H
  return { x: nx, y: ny }
}

function unproject(svgX: number, svgY: number): GeoPoint {
  const lon = (svgX / NATIVE_W) * 360 - 180
  const lat = 90 - (svgY / NATIVE_H) * 180
  return { lon: Math.min(180, Math.max(-180, lon)), lat: Math.min(90, Math.max(-90, lat)) }
}

function bboxToPoints(bbox: [number, number, number, number], vb: ViewBox): string {
  const [minLon, minLat, maxLon, maxLat] = bbox
  return [
    project(minLon, maxLat, vb),
    project(maxLon, maxLat, vb),
    project(maxLon, minLat, vb),
    project(minLon, minLat, vb),
  ].map((p) => `${p.x},${p.y}`).join(' ')
}

function geojsonToPoints(geojson: Record<string, unknown>, vb: ViewBox): string {
  let coords: [number, number][] = []
  const g = (geojson.type === 'Feature' ? (geojson.geometry as Record<string, unknown>) : geojson)
  if (!g) return ''
  const raw = (g.coordinates as unknown[]) ?? []
  const ring = Array.isArray(raw[0]) && Array.isArray(raw[0][0]) ? raw[0] : raw
  coords = (ring as [number, number][]).filter(
    (p): p is [number, number] => Array.isArray(p) && p.length >= 2,
  )
  return coords.map(([lon, lat]) => {
    const { x, y } = project(lon, lat, vb)
    return `${x},${y}`
  }).join(' ')
}

function geoJsonFromPoints(pts: GeoPoint[]): Record<string, unknown> {
  if (pts.length < 3) return {}
  const ring = [...pts, pts[0]].map((p) => [p.lon, p.lat])
  return { type: 'Polygon', coordinates: [ring] }
}

function bboxFromPoints(pts: GeoPoint[]): [number, number, number, number] {
  const lons = pts.map((p) => p.lon)
  const lats = pts.map((p) => p.lat)
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]
}

function cloudColor(v: number | null): string {
  if (v === null) return '#64748b'
  if (v <= 10) return '#22c55e'
  if (v <= 30) return '#84cc16'
  if (v <= 60) return '#f59e0b'
  return '#ef4444'
}

function formatDate(v: string | null) {
  if (!v) return '—'
  return new Date(v).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

function rectangleGeoJson(bbox: [number, number, number, number]): Record<string, unknown> {
  const [a, b, c, d] = bbox
  return { type: 'Polygon', coordinates: [[[a, b], [c, b], [c, d], [a, d], [a, b]]] }
}

function sampleStacItem(area: SatelliteArea | null): Record<string, unknown> {
  const bbox: [number, number, number, number] = area?.bbox ?? [2.0, 48.0, 3.0, 49.0]
  const inset: [number, number, number, number] = [
    bbox[0] + (bbox[2] - bbox[0]) * 0.15,
    bbox[1] + (bbox[3] - bbox[1]) * 0.15,
    bbox[2] - (bbox[2] - bbox[0]) * 0.15,
    bbox[3] - (bbox[3] - bbox[1]) * 0.15,
  ]
  return {
    type: 'Feature', id: `S2_SAMPLE_${Date.now()}`, collection: 'sentinel-2-l2a',
    bbox: inset, geometry: rectangleGeoJson(inset),
    properties: { datetime: new Date().toISOString(), platform: 'sentinel-2a', 'eo:cloud_cover': 8, 'processing:level': 'L2A' },
    assets: {},
  }
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function SatellitePage() {
  const [tab, setTab] = useState<Tab>('map')
  const [areas, setAreas] = useState<SatelliteArea[]>([])
  const [scenes, setScenes] = useState<SatelliteScene[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [stats, setStats] = useState<SatelliteStats | null>(null)
  const [selectedAreaId, setSelectedAreaId] = useState<number | null>(null)
  const [selectedSceneId, setSelectedSceneId] = useState<number | null>(null)
  const [monitorResult, setMonitorResult] = useState<SatelliteMonitorResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ msg: string; ok: boolean } | null>(null)

  const showNotice = (msg: string, ok = true) => {
    setNotice({ msg, ok })
    setTimeout(() => setNotice(null), 3500)
  }

  const load = useCallback(async () => {
    try {
      const [nextAreas, nextScenes, nextEvents, nextStats] = await Promise.all([
        satelliteApi.listAreas(),
        satelliteApi.listScenes({ limit: 300 }),
        satelliteApi.listEvents(200),
        satelliteApi.stats(),
      ])
      setAreas(nextAreas)
      setScenes(nextScenes)
      setEvents(nextEvents)
      setStats(nextStats)
      if (selectedAreaId === null && nextAreas[0]) setSelectedAreaId(nextAreas[0].id)
    } catch {}
  }, [selectedAreaId])

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedArea = useMemo(() => areas.find((a) => a.id === selectedAreaId) ?? null, [areas, selectedAreaId])
  const selectedScene = useMemo(() => scenes.find((s) => s.id === selectedSceneId) ?? null, [scenes, selectedSceneId])

  const runMonitor = async () => {
    setBusy(true)
    try {
      const result = await satelliteApi.runMonitor({ area_id: selectedAreaId, max_cloud_cover: 100, create_events: true })
      setMonitorResult(result)
      showNotice(`Monitoring: ${result.matched_scenes} match(es), ${result.created_events} event(s) created`)
      await load()
    } catch (e) {
      showNotice((e as Error).message ?? 'Monitor failed', false)
    } finally {
      setBusy(false)
    }
  }

  const deleteArea = async (id: number) => {
    await satelliteApi.deleteArea(id)
    if (selectedAreaId === id) setSelectedAreaId(null)
    await load()
  }

  const toggleArea = async (area: SatelliteArea) => {
    await satelliteApi.updateArea(area.id, { enabled: !area.enabled })
    await load()
  }

  const deleteScene = async (id: number) => {
    await satelliteApi.deleteScene(id)
    if (selectedSceneId === id) setSelectedSceneId(null)
    await load()
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'map', label: 'Map' },
    { id: 'areas', label: `Areas (${areas.length})` },
    { id: 'scenes', label: `Scenes (${scenes.length})` },
    { id: 'search', label: 'STAC Search' },
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border-subtle bg-bg-surface px-5 py-3">
        <div>
          <h1 className="text-sm font-semibold text-text-primary">Satellite Monitor</h1>
          <p className="text-2xs text-text-tertiary">
            {stats ? `${stats.areas} AOI · ${stats.scenes} scenes · ${stats.events} events` : 'Geospatial AOI monitoring'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {notice && (
            <span className={`text-xs ${notice.ok ? 'text-success-text' : 'text-danger-text'}`}>
              {notice.msg}
            </span>
          )}
          <Button size="sm" variant="secondary" onClick={runMonitor} disabled={busy}>
            {busy ? 'Running…' : 'Run monitor'}
          </Button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex shrink-0 gap-1 border-b border-border-subtle bg-bg-surface px-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={[
              'px-3 py-2.5 text-xs font-medium transition-colors',
              tab === t.id
                ? 'border-b-2 border-accent text-accent'
                : 'text-text-disabled hover:text-text-secondary',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'map' && (
          <MapTab
            areas={areas}
            scenes={scenes}
            events={events}
            selectedAreaId={selectedAreaId}
            selectedSceneId={selectedSceneId}
            onSelectArea={setSelectedAreaId}
            onSelectScene={setSelectedSceneId}
            onAreaCreated={load}
            showNotice={showNotice}
          />
        )}
        {tab === 'areas' && (
          <AreasTab
            areas={areas}
            selectedAreaId={selectedAreaId}
            onSelectArea={setSelectedAreaId}
            onDeleteArea={deleteArea}
            onToggleArea={toggleArea}
            onAreaCreated={load}
            showNotice={showNotice}
          />
        )}
        {tab === 'scenes' && (
          <ScenesTab
            scenes={scenes}
            areas={areas}
            selectedSceneId={selectedSceneId}
            onSelectScene={setSelectedSceneId}
            onDeleteScene={deleteScene}
            onImported={load}
            showNotice={showNotice}
          />
        )}
        {tab === 'search' && (
          <SearchTab
            areas={areas}
            selectedAreaId={selectedAreaId}
            onImported={async (count: number) => {
              showNotice(`${count} scene(s) imported`)
              await load()
            }}
            showNotice={showNotice}
          />
        )}
      </div>

      {/* Monitor result banner */}
      {monitorResult && (
        <div className="shrink-0 border-t border-border-subtle bg-bg-overlay px-5 py-2 text-xs text-text-secondary">
          Last monitor: <span className="text-text-primary font-medium">{monitorResult.matched_scenes}</span> match(es),
          <span className="ml-1 text-text-primary font-medium">{monitorResult.created_events}</span> new event(s)
        </div>
      )}
    </div>
  )
}

// ─── Map tab ─────────────────────────────────────────────────────────────────

function MapTab({
  areas, scenes, events, selectedAreaId, selectedSceneId,
  onSelectArea, onSelectScene, onAreaCreated, showNotice,
}: {
  areas: SatelliteArea[]
  scenes: SatelliteScene[]
  events: Event[]
  selectedAreaId: number | null
  selectedSceneId: number | null
  onSelectArea: (id: number | null) => void
  onSelectScene: (id: number | null) => void
  onAreaCreated: () => void
  showNotice: (msg: string, ok?: boolean) => void
}) {
  const [mode, setMode] = useState<MapMode>('view')
  const [drawPoints, setDrawPoints] = useState<GeoPoint[]>([])
  const [drawName, setDrawName] = useState('New AOI')
  const [viewBox, setViewBox] = useState<ViewBox>({ x: 0, y: 0, w: NATIVE_W, h: NATIVE_H })
  const [pan, setPan] = useState<{ startX: number; startY: number; startVb: ViewBox } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverInfo, setHoverInfo] = useState<string | null>(null)
  const [stacText, setStacText] = useState('')

  const svgPoint = useCallback((e: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>): { x: number; y: number } => {
    const rect = svgRef.current!.getBoundingClientRect()
    const sx = ((e.clientX - rect.left) / rect.width) * viewBox.w + viewBox.x
    const sy = ((e.clientY - rect.top) / rect.height) * viewBox.h + viewBox.y
    return { x: sx, y: sy }
  }, [viewBox])

  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 1.2 : 0.833
    const { x: mx, y: my } = svgPoint(e as unknown as React.MouseEvent<SVGSVGElement>)
    setViewBox((vb) => {
      const nw = Math.min(NATIVE_W, Math.max(50, vb.w * factor))
      const nh = Math.min(NATIVE_H, Math.max(25, vb.h * factor))
      return {
        x: Math.max(0, Math.min(NATIVE_W - nw, mx - (mx - vb.x) * (nw / vb.w))),
        y: Math.max(0, Math.min(NATIVE_H - nh, my - (my - vb.y) * (nh / vb.h))),
        w: nw,
        h: nh,
      }
    })
  }, [svgPoint])

  const handlePointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (mode === 'draw') return
    if (e.button !== 0) return
    setPan({ startX: e.clientX, startY: e.clientY, startVb: viewBox })
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }, [mode, viewBox])

  const handlePointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!pan) return
    const rect = svgRef.current!.getBoundingClientRect()
    const dx = ((e.clientX - pan.startX) / rect.width) * pan.startVb.w
    const dy = ((e.clientY - pan.startY) / rect.height) * pan.startVb.h
    setViewBox({
      ...pan.startVb,
      x: Math.max(0, Math.min(NATIVE_W - pan.startVb.w, pan.startVb.x - dx)),
      y: Math.max(0, Math.min(NATIVE_H - pan.startVb.h, pan.startVb.y - dy)),
    })
  }, [pan])

  const handleMapClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (mode !== 'draw') return
    const { x, y } = svgPoint(e)
    const geo = unproject(x, y)
    setDrawPoints((pts) => [...pts, geo])
  }, [mode, svgPoint])

  const cancelDraw = () => { setMode('view'); setDrawPoints([]) }

  const saveDraw = async () => {
    if (drawPoints.length < 3) { showNotice('Need at least 3 points', false); return }
    try {
      await satelliteApi.createArea({ name: drawName.trim() || 'New AOI', geojson: geoJsonFromPoints(drawPoints), enabled: true })
      showNotice('Area created')
      cancelDraw()
      onAreaCreated()
    } catch (e) {
      showNotice((e as Error).message ?? 'Failed', false)
    }
  }

  const importStac = async () => {
    try {
      const parsed = JSON.parse(stacText)
      const payload = parsed.type === 'FeatureCollection'
        ? { feature_collection: parsed, area_id: selectedAreaId, skip_existing: true }
        : { item: parsed, area_id: selectedAreaId, skip_existing: true }
      const imported = await satelliteApi.importStac(payload)
      showNotice(`${imported.length} scene(s) imported`)
      setStacText('')
      onAreaCreated()
    } catch (e) {
      showNotice((e as Error).message ?? 'Invalid JSON', false)
    }
  }

  const seedSample = async () => {
    const area = areas.find((a) => a.id === selectedAreaId) ?? null
    await satelliteApi.importStac({ item: sampleStacItem(area), area_id: selectedAreaId, skip_existing: false })
    showNotice('Sample Sentinel-2 scene added')
    onAreaCreated()
  }

  const fitToArea = (area: SatelliteArea) => {
    const [minLon, minLat, maxLon, maxLat] = area.bbox
    const nx1 = ((minLon + 180) / 360) * NATIVE_W
    const nx2 = ((maxLon + 180) / 360) * NATIVE_W
    const ny1 = ((90 - maxLat) / 180) * NATIVE_H
    const ny2 = ((90 - minLat) / 180) * NATIVE_H
    const pad = Math.max((nx2 - nx1) * 1.5, (ny2 - ny1) * 1.5, 30)
    setViewBox({
      x: Math.max(0, nx1 - pad),
      y: Math.max(0, ny1 - pad),
      w: Math.min(NATIVE_W, (nx2 - nx1) + pad * 2),
      h: Math.min(NATIVE_H, (ny2 - ny1) + pad * 2),
    })
  }

  const resetView = () => setViewBox({ x: 0, y: 0, w: NATIVE_W, h: NATIVE_H })

  const mapEvents = events.filter((ev) => ev.metadata?.geo)
  const selectedArea = areas.find((a) => a.id === selectedAreaId)
  const selectedScene = scenes.find((s) => s.id === selectedSceneId)

  const vb = viewBox
  const drawSvgPoints = drawPoints.map((p) => {
    const { x, y } = project(p.lon, p.lat, vb)
    return `${x},${y}`
  }).join(' ')

  return (
    <div className="flex h-full">
      {/* Left controls */}
      <div className="w-56 shrink-0 space-y-3 overflow-y-auto border-r border-border-subtle bg-bg-surface p-3">
        {/* Area selector */}
        <div>
          <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-text-disabled">Active AOI</p>
          <Select
            value={selectedAreaId ?? ''}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null
              onSelectArea(id)
              const area = areas.find((a) => a.id === id)
              if (area) fitToArea(area)
            }}
          >
            <option value="">All areas</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.enabled ? '●' : '○'} {a.name}
              </option>
            ))}
          </Select>
          {selectedArea && (
            <p className="mt-1 text-2xs text-text-tertiary">
              {selectedArea.scene_count} scene(s) · {selectedArea.enabled ? 'enabled' : 'disabled'}
            </p>
          )}
        </div>

        {/* Draw controls */}
        {mode === 'view' ? (
          <Button size="sm" variant="secondary" className="w-full" onClick={() => setMode('draw')}>
            <svg viewBox="0 0 12 12" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
              <path d="M1 11L5 2l2 4 2-2 2 4" />
            </svg>
            Draw new AOI
          </Button>
        ) : (
          <div className="space-y-2 rounded border border-accent/30 bg-accent-subtle p-2">
            <p className="text-2xs font-semibold text-accent">Drawing mode — click map to add points</p>
            <Input
              value={drawName}
              onChange={(e) => setDrawName(e.target.value)}
              placeholder="AOI name"
            />
            <p className="text-2xs text-text-tertiary">{drawPoints.length} point(s) placed</p>
            <div className="flex gap-1.5">
              <Button size="xs" className="flex-1" onClick={saveDraw} disabled={drawPoints.length < 3}>Save</Button>
              <Button size="xs" variant="ghost" onClick={cancelDraw}>Cancel</Button>
            </div>
            {drawPoints.length > 0 && (
              <Button size="xs" variant="ghost" className="w-full" onClick={() => setDrawPoints((p) => p.slice(0, -1))}>
                Undo last point
              </Button>
            )}
          </div>
        )}

        {/* Map controls */}
        <div className="flex gap-1.5">
          <Button size="xs" variant="ghost" className="flex-1" onClick={resetView}>Reset view</Button>
          {selectedArea && (
            <Button size="xs" variant="ghost" className="flex-1" onClick={() => fitToArea(selectedArea)}>Fit AOI</Button>
          )}
        </div>

        {/* Legend */}
        <div className="space-y-1">
          <p className="text-2xs font-semibold uppercase tracking-wider text-text-disabled">Legend</p>
          {[
            { color: '#3b82f6', label: 'AOI (area)' },
            { color: '#22c55e', label: 'Scene' },
            { color: '#ef4444', label: 'Event' },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />
              <span className="text-2xs text-text-tertiary">{item.label}</span>
            </div>
          ))}
        </div>

        {/* Quick import */}
        <div>
          <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-text-disabled">Quick import</p>
          <textarea
            value={stacText}
            onChange={(e) => setStacText(e.target.value)}
            placeholder="Paste STAC Feature…"
            rows={4}
            className="w-full resize-none rounded border border-border bg-bg-overlay px-2 py-1.5 font-mono text-2xs text-text-primary placeholder:text-text-tertiary focus:border-accent/50 focus:outline-none"
          />
          <div className="mt-1.5 flex gap-1">
            <Button size="xs" variant="secondary" className="flex-1" onClick={importStac} disabled={!stacText.trim()}>Import</Button>
            <Button size="xs" variant="ghost" onClick={seedSample}>Sample</Button>
          </div>
        </div>
      </div>

      {/* Map canvas */}
      <div className="relative min-w-0 flex-1 bg-[#07090e]">
        <svg
          ref={svgRef}
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          className="h-full w-full"
          style={{ cursor: mode === 'draw' ? 'crosshair' : pan ? 'grabbing' : 'grab' }}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={() => setPan(null)}
          onPointerLeave={() => setPan(null)}
          onClick={handleMapClick}
        >
          <defs>
            <pattern id="map-grid" width="80" height="40" patternUnits="userSpaceOnUse">
              <path d="M80 0H0V40" fill="none" stroke="#131a22" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width={NATIVE_W} height={NATIVE_H} fill="#080d14" />
          <rect width={NATIVE_W} height={NATIVE_H} fill="url(#map-grid)" />

          {/* Graticule */}
          {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map((lon) => {
            const p = project(lon, 0, vb); return <line key={`lon${lon}`} x1={p.x} y1={0} x2={p.x} y2={NATIVE_H} stroke="#1a2533" strokeWidth={0.5} />
          })}
          {[-60, -30, 0, 30, 60].map((lat) => {
            const p = project(0, lat, vb); return <line key={`lat${lat}`} x1={0} y1={p.y} x2={NATIVE_W} y2={p.y} stroke="#1a2533" strokeWidth={0.5} />
          })}

          {/* Scenes */}
          {scenes.map((scene) => {
            const isSelected = scene.id === selectedSceneId
            const pts = bboxToPoints(scene.bbox, vb)
            return (
              <polygon
                key={`scene-${scene.id}`}
                points={pts}
                fill={isSelected ? 'rgba(34,197,94,0.35)' : 'rgba(34,197,94,0.12)'}
                stroke={isSelected ? '#4ade80' : '#22c55e'}
                strokeWidth={isSelected ? 2 : 1}
                className="cursor-pointer"
                onClick={(e) => { e.stopPropagation(); onSelectScene(isSelected ? null : scene.id) }}
                onMouseEnter={() => setHoverInfo(`Scene: ${scene.external_id} · ${scene.cloud_cover ?? '?'}% cloud`)}
                onMouseLeave={() => setHoverInfo(null)}
              />
            )
          })}

          {/* Areas */}
          {areas.map((area) => {
            const isSelected = area.id === selectedAreaId
            const pts = geojsonToPoints(area.geojson, vb)
            if (!pts) return null
            return (
              <polygon
                key={`area-${area.id}`}
                points={pts}
                fill={isSelected ? 'rgba(59,130,246,0.22)' : 'rgba(59,130,246,0.10)'}
                stroke={isSelected ? '#60a5fa' : area.enabled ? '#3b82f6' : '#475569'}
                strokeWidth={isSelected ? 2.5 : 1.5}
                strokeDasharray={area.enabled ? undefined : '6 3'}
                className="cursor-pointer"
                onClick={(e) => { e.stopPropagation(); onSelectArea(isSelected ? null : area.id) }}
                onMouseEnter={() => setHoverInfo(`AOI: ${area.name} · ${area.scene_count} scene(s)`)}
                onMouseLeave={() => setHoverInfo(null)}
              />
            )
          })}

          {/* Area name labels */}
          {areas.filter((a) => a.id === selectedAreaId).map((area) => {
            const [minLon, , maxLon, maxLat] = area.bbox
            const p = project((minLon + maxLon) / 2, maxLat, vb)
            return (
              <text key={`lbl-${area.id}`} x={p.x} y={p.y - 4} textAnchor="middle"
                fontSize={Math.max(8, viewBox.w / 80)} fill="#93c5fd" fontFamily="system-ui" pointerEvents="none">
                {area.name}
              </text>
            )
          })}

          {/* Events */}
          {mapEvents.map((ev) => {
            const geo = ev.metadata?.geo as { centroid?: { lon: number; lat: number } } | undefined
            if (!geo?.centroid) return null
            const p = project(geo.centroid.lon, geo.centroid.lat, vb)
            const r = Math.max(4, viewBox.w / 200)
            return (
              <g key={`ev-${ev.id}`}
                className="cursor-pointer"
                onMouseEnter={() => setHoverInfo(`Event #${ev.id}: ${ev.zone_name ?? ev.class_name}`)}
                onMouseLeave={() => setHoverInfo(null)}
              >
                <circle cx={p.x} cy={p.y} r={r * 2.5} fill="none" stroke="#ef4444" strokeOpacity={0.3} />
                <circle cx={p.x} cy={p.y} r={r} fill="#ef4444" />
              </g>
            )
          })}

          {/* In-progress draw polygon */}
          {drawPoints.length > 0 && (
            <>
              {drawPoints.length > 1 && (
                <polyline points={drawSvgPoints} fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="6 3" />
              )}
              {drawPoints.map((p, i) => {
                const { x, y } = project(p.lon, p.lat, vb)
                return <circle key={i} cx={x} cy={y} r={Math.max(3, vb.w / 250)} fill="#f59e0b" stroke="#0a0b10" strokeWidth={1.5} />
              })}
            </>
          )}
        </svg>

        {/* Hover tooltip */}
        {hoverInfo && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-black/80 px-3 py-1.5 text-xs text-white backdrop-blur-sm">
            {hoverInfo}
          </div>
        )}

        {/* Zoom level indicator */}
        <div className="absolute right-3 top-3 flex flex-col gap-1">
          <button onClick={() => setViewBox((vb) => { const nw = vb.w * 0.7; const nh = vb.h * 0.7; return { x: vb.x + (vb.w - nw) / 2, y: vb.y + (vb.h - nh) / 2, w: Math.max(50, nw), h: Math.max(25, nh) } })}
            className="flex h-7 w-7 items-center justify-center rounded border border-border-subtle bg-bg-surface text-text-secondary hover:text-text-primary">
            <svg viewBox="0 0 10 10" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M2 5h6M5 2v6" /></svg>
          </button>
          <button onClick={() => setViewBox((vb) => { const nw = Math.min(NATIVE_W, vb.w * 1.4); const nh = Math.min(NATIVE_H, vb.h * 1.4); return { x: Math.max(0, vb.x + (vb.w - nw) / 2), y: Math.max(0, vb.y + (vb.h - nh) / 2), w: nw, h: nh } })}
            className="flex h-7 w-7 items-center justify-center rounded border border-border-subtle bg-bg-surface text-text-secondary hover:text-text-primary">
            <svg viewBox="0 0 10 10" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M2 5h6" /></svg>
          </button>
        </div>
      </div>

      {/* Right panel — selected item details */}
      <div className="w-60 shrink-0 overflow-y-auto border-l border-border-subtle bg-bg-surface p-3 space-y-4">
        {selectedScene ? (
          <SceneDetail scene={selectedScene} onDelete={async () => { /* handled in parent */ }} />
        ) : selectedArea ? (
          <AreaDetail
            area={selectedArea}
            scenes={scenes.filter((s) => s.area_id === selectedArea.id)}
            events={events.filter((ev) => ev.metadata?.area_id === selectedArea.id)}
            onFit={() => fitToArea(selectedArea)}
          />
        ) : (
          <div className="py-8 text-center">
            <svg viewBox="0 0 24 24" width={28} height={28} fill="none" stroke="#2e3048" strokeWidth={1.25} strokeLinecap="round" className="mx-auto mb-2">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
            </svg>
            <p className="text-xs text-text-tertiary">Click an area or scene on the map to see details</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Area detail panel ────────────────────────────────────────────────────────

function AreaDetail({ area, scenes, events, onFit }: {
  area: SatelliteArea
  scenes: SatelliteScene[]
  events: Event[]
  onFit: () => void
}) {
  const [minLon, minLat, maxLon, maxLat] = area.bbox
  const areaDeg2 = ((maxLon - minLon) * (maxLat - minLat)).toFixed(3)
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-text-primary">{area.name}</p>
          {area.description && <p className="text-2xs text-text-tertiary">{area.description}</p>}
        </div>
        <Badge variant={area.enabled ? 'success' : 'neutral'}>{area.enabled ? 'on' : 'off'}</Badge>
      </div>
      <div className="rounded border border-border-subtle bg-bg-overlay p-2 space-y-1">
        <DetailRow label="Bbox" value={`${minLon.toFixed(2)},${minLat.toFixed(2)} → ${maxLon.toFixed(2)},${maxLat.toFixed(2)}`} mono />
        <DetailRow label="Area" value={`~${areaDeg2}°²`} />
        <DetailRow label="Scenes" value={String(area.scene_count)} />
        <DetailRow label="Events" value={String(events.length)} />
        <DetailRow label="Created" value={formatDate(area.created_at)} />
      </div>
      <Button size="xs" variant="ghost" className="w-full" onClick={onFit}>Fit map to AOI</Button>
      <div className="space-y-1">
        <p className="text-2xs font-semibold uppercase tracking-wider text-text-disabled">Recent scenes</p>
        {scenes.slice(0, 5).map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-1 rounded border border-border-subtle bg-bg-overlay px-2 py-1">
            <span className="truncate text-2xs text-text-secondary">{s.external_id.slice(-20)}</span>
            <span className="shrink-0 text-2xs font-medium" style={{ color: cloudColor(s.cloud_cover) }}>{s.cloud_cover ?? '?'}%</span>
          </div>
        ))}
        {scenes.length === 0 && <p className="text-2xs text-text-tertiary">No scenes for this AOI</p>}
      </div>
    </div>
  )
}

function SceneDetail({ scene, onDelete }: { scene: SatelliteScene; onDelete: () => void }) {
  const hasThumbnail = !!scene.thumbnail_url
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-text-primary truncate">{scene.external_id}</p>
      {hasThumbnail && (
        <img
          src={satelliteApi.thumbnailUrl(scene.id)}
          alt="thumbnail"
          className="w-full rounded border border-border-subtle object-cover"
          style={{ height: 100 }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      )}
      <div className="rounded border border-border-subtle bg-bg-overlay p-2 space-y-1">
        <DetailRow label="Mission" value={scene.mission ?? '—'} />
        <DetailRow label="Provider" value={scene.provider} />
        <DetailRow label="Type" value={scene.product_type ?? '—'} />
        <DetailRow label="Cloud" value={`${scene.cloud_cover ?? '?'}%`} color={cloudColor(scene.cloud_cover)} />
        <DetailRow label="Acquired" value={formatDate(scene.acquired_at)} />
        <DetailRow label="Status" value={scene.status} />
      </div>
    </div>
  )
}

function DetailRow({ label, value, mono = false, color }: { label: string; value: string; mono?: boolean; color?: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-2xs text-text-disabled">{label}</span>
      <span className={`text-right text-2xs ${mono ? 'font-mono' : ''}`} style={{ color: color ?? undefined }}>{value}</span>
    </div>
  )
}

// ─── Areas tab ────────────────────────────────────────────────────────────────

function AreasTab({ areas, selectedAreaId, onSelectArea, onDeleteArea, onToggleArea, onAreaCreated, showNotice }: {
  areas: SatelliteArea[]
  selectedAreaId: number | null
  onSelectArea: (id: number | null) => void
  onDeleteArea: (id: number) => void
  onToggleArea: (area: SatelliteArea) => void
  onAreaCreated: () => void
  showNotice: (msg: string, ok?: boolean) => void
}) {
  const [name, setName] = useState('New AOI')
  const [bboxText, setBboxText] = useState('2.0,48.0,3.0,49.0')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const createArea = async () => {
    const parts = bboxText.split(',').map((v) => Number(v.trim()))
    if (parts.length !== 4 || parts.some(Number.isNaN)) { showNotice('BBox must be minLon,minLat,maxLon,maxLat', false); return }
    setSaving(true)
    try {
      await satelliteApi.createArea({ name: name.trim() || 'AOI', description: description.trim() || null, geojson: rectangleGeoJson(parts as [number, number, number, number]), enabled: true })
      showNotice('Area created')
      await onAreaCreated()
    } catch (e) {
      showNotice((e as Error).message ?? 'Failed', false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full gap-0">
      {/* Create form */}
      <div className="w-64 shrink-0 space-y-3 border-r border-border-subtle bg-bg-surface p-4">
        <p className="text-xs font-semibold text-text-primary">New AOI</p>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Input label="Bbox (minLon,minLat,maxLon,maxLat)" value={bboxText} onChange={(e) => setBboxText(e.target.value)} hint="e.g. -1.5,43.0,1.5,45.0" />
        <Button size="sm" className="w-full" onClick={createArea} disabled={saving}>{saving ? 'Creating…' : 'Create AOI'}</Button>
        <p className="text-2xs text-text-tertiary">Or use "Draw new AOI" in the Map tab to draw a polygon interactively.</p>
      </div>

      {/* Area list */}
      <div className="min-w-0 flex-1 overflow-y-auto p-4">
        {areas.length === 0 ? (
          <p className="text-sm text-text-tertiary">No areas yet — create one above or draw on the map.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {areas.map((area) => (
              <div
                key={area.id}
                className={[
                  'rounded-lg border bg-bg-surface p-3 transition-colors',
                  area.id === selectedAreaId ? 'border-accent' : 'border-border-subtle',
                ].join(' ')}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-text-primary">{area.name}</p>
                    {area.description && <p className="text-2xs text-text-tertiary">{area.description}</p>}
                  </div>
                  <Badge variant={area.enabled ? 'success' : 'neutral'}>{area.enabled ? 'on' : 'off'}</Badge>
                </div>
                <div className="mb-3 space-y-1">
                  <p className="text-2xs text-text-tertiary">
                    {area.bbox.map((v) => v.toFixed(2)).join(', ')}
                  </p>
                  <p className="text-2xs text-text-secondary">{area.scene_count} scene(s) · {formatDate(area.created_at)}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="xs" variant={area.id === selectedAreaId ? 'secondary' : 'ghost'} onClick={() => onSelectArea(area.id)}>
                    {area.id === selectedAreaId ? 'Selected' : 'Select'}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => onToggleArea(area)}>
                    {area.enabled ? 'Disable' : 'Enable'}
                  </Button>
                  <button
                    onClick={() => { if (confirm(`Delete area "${area.name}"?`)) onDeleteArea(area.id) }}
                    className="ml-auto flex h-6 w-6 items-center justify-center rounded text-text-disabled hover:bg-danger/20 hover:text-danger"
                    title="Delete area"
                  >
                    <svg viewBox="0 0 12 12" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
                      <path d="M1.5 3h9M4.5 3V1.5h3V3M2.5 3l.5 7.5h6L10 3" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Scenes tab ───────────────────────────────────────────────────────────────

function ScenesTab({ scenes, areas, selectedSceneId, onSelectScene, onDeleteScene, onImported, showNotice }: {
  scenes: SatelliteScene[]
  areas: SatelliteArea[]
  selectedSceneId: number | null
  onSelectScene: (id: number | null) => void
  onDeleteScene: (id: number) => void
  onImported: () => void
  showNotice: (msg: string, ok?: boolean) => void
}) {
  const [filterAreaId, setFilterAreaId] = useState<number | ''>('')
  const [filterMission, setFilterMission] = useState('')
  const [filterMaxCloud, setFilterMaxCloud] = useState<number | ''>('')

  const filtered = scenes.filter((s) => {
    if (filterAreaId !== '' && s.area_id !== filterAreaId) return false
    if (filterMission && !(s.mission ?? '').toLowerCase().includes(filterMission.toLowerCase())) return false
    if (filterMaxCloud !== '' && (s.cloud_cover ?? 101) > filterMaxCloud) return false
    return true
  })

  const missions = [...new Set(scenes.map((s) => s.mission).filter(Boolean))] as string[]

  return (
    <div className="flex h-full flex-col">
      {/* Filters */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle bg-bg-surface px-4 py-2">
        <Select value={filterAreaId} onChange={(e) => setFilterAreaId(e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">All areas</option>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <Select value={filterMission} onChange={(e) => setFilterMission(e.target.value)}>
          <option value="">All missions</option>
          {missions.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
        <Select value={filterMaxCloud} onChange={(e) => setFilterMaxCloud(e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">Any cloud cover</option>
          {[10, 20, 30, 50, 80].map((v) => <option key={v} value={v}>≤ {v}%</option>)}
        </Select>
        <span className="ml-auto text-xs text-text-tertiary">{filtered.length} / {scenes.length} scene(s)</span>
      </div>

      {/* Scene grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? (
          <p className="text-sm text-text-tertiary">No scenes match the filters.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {filtered.map((scene) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                area={areas.find((a) => a.id === scene.area_id)}
                selected={scene.id === selectedSceneId}
                onSelect={() => onSelectScene(scene.id === selectedSceneId ? null : scene.id)}
                onDelete={() => { if (confirm(`Delete scene "${scene.external_id}"?`)) onDeleteScene(scene.id) }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SceneCard({ scene, area, selected, onSelect, onDelete }: {
  scene: SatelliteScene
  area?: SatelliteArea
  selected: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const hasThumbnail = !!scene.thumbnail_url
  return (
    <div
      className={['relative overflow-hidden rounded-lg border bg-bg-surface transition-colors cursor-pointer', selected ? 'border-accent' : 'border-border-subtle hover:border-border'].join(' ')}
      onClick={onSelect}
    >
      {/* Thumbnail */}
      <div className="relative h-24 bg-bg-overlay">
        {hasThumbnail ? (
          <img src={satelliteApi.thumbnailUrl(scene.id)} alt="" className="h-full w-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).parentElement!.innerHTML = '<div class="flex h-full items-center justify-center text-2xs text-text-disabled">No preview</div>' }} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1">
            <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="#2e3048" strokeWidth={1.25}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9l4-4 4 4 4-4 4 4M3 15l4 4 4-4 4 4 4-4" /></svg>
            <span className="text-2xs text-text-disabled">No thumbnail</span>
          </div>
        )}
        {/* Cloud badge */}
        <span className="absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-2xs font-bold text-black"
          style={{ background: cloudColor(scene.cloud_cover) }}>
          {scene.cloud_cover !== null ? `${Math.round(scene.cloud_cover)}%` : '?'}
        </span>
      </div>

      {/* Info */}
      <div className="p-2">
        <p className="truncate text-2xs font-medium text-text-primary" title={scene.external_id}>
          {scene.external_id.length > 22 ? `…${scene.external_id.slice(-20)}` : scene.external_id}
        </p>
        <p className="mt-0.5 text-2xs text-text-tertiary">
          {scene.mission ?? scene.provider} · {formatDate(scene.acquired_at)}
        </p>
        {area && <p className="mt-0.5 text-2xs" style={{ color: '#3b82f6' }}>{area.name}</p>}
      </div>

      {/* Delete */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded bg-black/60 text-white opacity-0 hover:bg-danger/80 group-hover:opacity-100 [.rounded-lg:hover_&]:opacity-100"
        title="Delete scene"
      >
        <svg viewBox="0 0 10 10" width={8} height={8} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
          <path d="M1 1l8 8M9 1L1 9" />
        </svg>
      </button>
    </div>
  )
}

// ─── STAC Search tab ──────────────────────────────────────────────────────────

function SearchTab({ areas, selectedAreaId, onImported, showNotice }: {
  areas: SatelliteArea[]
  selectedAreaId: number | null
  onImported: (count: number) => void
  showNotice: (msg: string, ok?: boolean) => void
}) {
  const [providerId, setProviderId] = useState('element84')
  const [customUrl, setCustomUrl] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [collections, setCollections] = useState('sentinel-2-l2a')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [maxCloud, setMaxCloud] = useState(30)
  const [limit, setLimit] = useState(20)
  const [targetAreaId, setTargetAreaId] = useState<number | ''>(selectedAreaId ?? '')
  const [results, setResults] = useState<SatelliteScene[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [importing, setImporting] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const provider = STAC_PROVIDERS.find((p) => p.id === providerId)!
  const url = providerId === 'custom' ? customUrl : provider.url
  const collectionList = STAC_COLLECTIONS[providerId] ?? []
  const targetArea = areas.find((a) => a.id === targetAreaId)

  const search = async () => {
    if (!url) { showNotice('No STAC URL configured', false); return }
    setSearching(true)
    setResults(null)
    setSelected(new Set())
    try {
      const payload: Record<string, unknown> = {
        url,
        collections: collections.split(',').map((s) => s.trim()).filter(Boolean),
        date_from: dateFrom ? `${dateFrom}T00:00:00Z` : undefined,
        date_to: dateTo ? `${dateTo}T23:59:59Z` : undefined,
        max_cloud_cover: maxCloud,
        limit,
        area_id: targetAreaId || null,
        auth_token: authToken || undefined,
        skip_existing: false,
      }
      if (targetArea) payload.bbox = targetArea.bbox
      // Use search-stac (raw) to preview results without importing
      const rawPayload: Record<string, unknown> = { url, auth_token: authToken || undefined }
      const colls = (payload.collections as string[])
      if (colls.length) rawPayload.collections = colls
      if (targetArea) rawPayload.bbox = targetArea.bbox
      if (dateFrom || dateTo) rawPayload.datetime = `${dateFrom || '..'}T00:00:00Z/${dateTo || '..'}T23:59:59Z`
      if (maxCloud != null) rawPayload.query = { 'eo:cloud_cover': { lte: maxCloud } }
      rawPayload.limit = limit

      const fc = await satelliteApi.searchStac(rawPayload as Parameters<typeof satelliteApi.searchStac>[0])
      // Build preview list from features
      const scenes: SatelliteScene[] = (fc.features ?? []).map((f: Record<string, unknown>, i: number) => {
        const props = (f.properties as Record<string, unknown>) ?? {}
        return {
          id: -(i + 1), // temp negative ID for preview
          external_id: String(f.id ?? `item-${i}`),
          provider: String(f.collection ?? 'stac'),
          mission: String(props.platform ?? props.constellation ?? '') || null,
          product_type: String(props['processing:level'] ?? '') || null,
          acquired_at: String(props.datetime ?? '') || null,
          cloud_cover: props['eo:cloud_cover'] != null ? Number(props['eo:cloud_cover']) : null,
          bbox: (f.bbox as [number, number, number, number]) ?? [0, 0, 0, 0],
          footprint: (f.geometry as Record<string, unknown>) ?? {},
          assets: (f.assets as Record<string, unknown>) ?? {},
          metadata: props,
          local_path: null,
          thumbnail_url: (() => {
            const assets = (f.assets as Record<string, Record<string, unknown>>) ?? {}
            for (const key of ['thumbnail', 'preview', 'overview', 'visual']) {
              if (assets[key]?.href) return String(assets[key].href)
            }
            return null
          })(),
          source_url: null,
          area_id: null,
          status: 'preview',
          created_at: new Date().toISOString(),
        }
      })
      setResults(scenes)
      if (scenes.length === 0) showNotice('No results found for these criteria')
    } catch (e) {
      showNotice((e as Error).message ?? 'Search failed', false)
    } finally {
      setSearching(false)
    }
  }

  const importSelected = async () => {
    if (selected.size === 0) { showNotice('Select at least one scene', false); return }
    setImporting(true)
    try {
      const items = results!.filter((r) => selected.has(r.id)).map((r) => ({
        type: 'Feature',
        id: r.external_id,
        bbox: r.bbox,
        geometry: r.footprint,
        collection: r.provider,
        properties: { ...r.metadata },
        assets: r.assets,
      }))
      const imported = await satelliteApi.importStac({ items, area_id: targetAreaId || null, skip_existing: true })
      showNotice(`${imported.length} scene(s) imported (${items.length - imported.length} skipped as duplicates)`)
      setSelected(new Set())
      onImported(imported.length)
    } catch (e) {
      showNotice((e as Error).message ?? 'Import failed', false)
    } finally {
      setImporting(false)
    }
  }

  const toggleSelect = (id: number) => {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const toggleAll = () => {
    if (results && selected.size === results.length) setSelected(new Set())
    else setSelected(new Set(results?.map((r) => r.id) ?? []))
  }

  return (
    <div className="flex h-full gap-0">
      {/* Search form */}
      <div className="w-72 shrink-0 space-y-4 overflow-y-auto border-r border-border-subtle bg-bg-surface p-4">
        <div>
          <p className="mb-2 text-xs font-semibold text-text-primary">STAC Provider</p>
          <Select value={providerId} onChange={(e) => { setProviderId(e.target.value); setCollections(STAC_COLLECTIONS[e.target.value]?.[0] ?? '') }}>
            {STAC_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          {providerId === 'custom' && (
            <Input className="mt-2" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="https://…/search" />
          )}
          {provider.requiresAuth && (
            <div className="mt-2">
              <Input label="Bearer token" type="password" value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder="your-access-token" />
              {providerId === 'cdse' && (
                <p className="mt-1 text-2xs text-text-tertiary">Get a token from dataspace.copernicus.eu → OAuth2</p>
              )}
            </div>
          )}
        </div>

        <div>
          <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-text-disabled">Collections</p>
          {collectionList.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {collectionList.map((c) => (
                <button key={c} type="button"
                  onClick={() => setCollections(c)}
                  className={['rounded px-2 py-0.5 text-2xs transition-colors', collections === c ? 'bg-accent text-white' : 'bg-bg-overlay text-text-secondary hover:text-text-primary'].join(' ')}>
                  {c}
                </button>
              ))}
            </div>
          ) : (
            <Input value={collections} onChange={(e) => setCollections(e.target.value)} placeholder="sentinel-2-l2a,landsat-c2-l2" />
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="mb-1 text-2xs text-text-disabled">Date from</p>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="h-8 w-full rounded border border-border bg-bg-overlay px-2 text-xs text-text-primary focus:border-accent/50 focus:outline-none" />
          </div>
          <div>
            <p className="mb-1 text-2xs text-text-disabled">Date to</p>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="h-8 w-full rounded border border-border bg-bg-overlay px-2 text-xs text-text-primary focus:border-accent/50 focus:outline-none" />
          </div>
        </div>

        <div>
          <p className="mb-1 text-2xs text-text-disabled">Max cloud cover — {maxCloud}%</p>
          <input type="range" min={0} max={100} step={5} value={maxCloud} onChange={(e) => setMaxCloud(Number(e.target.value))}
            className="w-full accent-accent" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="mb-1 text-2xs text-text-disabled">Limit</p>
            <input type="number" min={1} max={200} value={limit} onChange={(e) => setLimit(Number(e.target.value))}
              className="h-8 w-full rounded border border-border bg-bg-overlay px-2 text-xs text-text-primary focus:border-accent/50 focus:outline-none" />
          </div>
          <div>
            <p className="mb-1 text-2xs text-text-disabled">Link to AOI</p>
            <Select value={targetAreaId} onChange={(e) => setTargetAreaId(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">None</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </div>
        </div>

        {targetArea && (
          <div className="rounded border border-border-subtle bg-bg-overlay px-2 py-1.5 text-2xs text-text-tertiary">
            bbox auto-filled from <span className="font-medium text-text-secondary">{targetArea.name}</span>
          </div>
        )}

        <Button className="w-full" onClick={search} disabled={searching || !url}>
          {searching ? 'Searching…' : 'Search STAC'}
        </Button>
      </div>

      {/* Results */}
      <div className="flex min-w-0 flex-1 flex-col">
        {results === null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <svg viewBox="0 0 32 32" width={32} height={32} fill="none" stroke="#2e3048" strokeWidth={1.25} strokeLinecap="round">
              <circle cx="14" cy="14" r="9" /><path d="M21 21l7 7" />
            </svg>
            <p className="text-sm text-text-tertiary">Configure a search and click "Search STAC"</p>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-4 py-2">
              <button onClick={toggleAll} className="text-xs text-text-secondary hover:text-text-primary">
                {selected.size === results.length ? 'Deselect all' : `Select all (${results.length})`}
              </button>
              {selected.size > 0 && (
                <Button size="sm" onClick={importSelected} disabled={importing}>
                  {importing ? 'Importing…' : `Import ${selected.size} scene(s)`}
                </Button>
              )}
              <span className="ml-auto text-xs text-text-tertiary">{results.length} result(s)</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {results.length === 0 ? (
                <p className="text-sm text-text-tertiary">No results — try wider date range or more cloud cover.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                  {results.map((scene) => (
                    <div
                      key={scene.id}
                      className={['relative overflow-hidden rounded-lg border cursor-pointer transition-colors', selected.has(scene.id) ? 'border-accent bg-accent-subtle' : 'border-border-subtle bg-bg-surface hover:border-border'].join(' ')}
                      onClick={() => toggleSelect(scene.id)}
                    >
                      {/* Thumbnail */}
                      <div className="h-20 bg-bg-overlay">
                        {scene.thumbnail_url ? (
                          <img src={scene.thumbnail_url} alt="" className="h-full w-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                        ) : (
                          <div className="flex h-full items-center justify-center text-2xs text-text-disabled">No preview</div>
                        )}
                        <span className="absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-2xs font-bold text-black"
                          style={{ background: cloudColor(scene.cloud_cover) }}>
                          {scene.cloud_cover !== null ? `${Math.round(scene.cloud_cover)}%` : '?'}
                        </span>
                        {selected.has(scene.id) && (
                          <div className="absolute left-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded bg-accent">
                            <svg viewBox="0 0 8 8" width={8} height={8} fill="none" stroke="white" strokeWidth={1.5} strokeLinecap="round"><path d="M1.5 4l2 2 3-3.5" /></svg>
                          </div>
                        )}
                      </div>
                      <div className="p-2">
                        <p className="truncate text-2xs font-medium text-text-primary" title={scene.external_id}>
                          {scene.external_id.length > 22 ? `…${scene.external_id.slice(-20)}` : scene.external_id}
                        </p>
                        <p className="mt-0.5 text-2xs text-text-tertiary">
                          {scene.mission ?? scene.provider} · {formatDate(scene.acquired_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
