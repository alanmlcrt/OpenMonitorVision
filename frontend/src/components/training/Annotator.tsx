/**
 * In-app YOLO annotator.
 *
 * Coordinate system:
 *   - Boxes are stored normalized (0..1) on disk, matching the YOLO label format.
 *   - The SVG overlay uses a viewBox of the image's pixel size, so drag handlers
 *     receive pixel coordinates which are normalized on commit.
 *
 * Keyboard:
 *   1..9    assign class to the selected box (or the next-drawn box)
 *   Delete  remove the selected box
 *   Esc     deselect
 *   ←/→     prev / next image
 *   s       save
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { datasetsApi } from '../../api/datasets'
import type { Dataset, DatasetImage, YoloBox } from '../../types'

interface Props {
  dataset: Dataset
  onClose: () => void
}

// Distinct colours per class (cycled if classes > palette length)
const PALETTE = ['#5c6bc0', '#22c55e', '#f59e0b', '#ec4899', '#22d3ee', '#a855f7', '#ef4444', '#94a3b8', '#facc15', '#34d399']

type Pt = { x: number; y: number }
type Handle = 'nw' | 'ne' | 'se' | 'sw' | 'body' | null

interface PxBox { x1: number; y1: number; x2: number; y2: number; cls: number }

// ─────────────────────────────────────────────────────────────────────────────

function toPx(b: YoloBox, W: number, H: number): PxBox {
  const cx = b.x * W, cy = b.y * H, w = b.w * W, h = b.h * H
  return { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, cls: b.class_id }
}

function toYolo(b: PxBox, W: number, H: number): YoloBox {
  const x1 = Math.min(b.x1, b.x2), x2 = Math.max(b.x1, b.x2)
  const y1 = Math.min(b.y1, b.y2), y2 = Math.max(b.y1, b.y2)
  return {
    class_id: b.cls,
    x: ((x1 + x2) / 2) / W,
    y: ((y1 + y2) / 2) / H,
    w: (x2 - x1) / W,
    h: (y2 - y1) / H,
  }
}

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)) }

// ─────────────────────────────────────────────────────────────────────────────

export function Annotator({ dataset, onClose }: Props) {
  const [images, setImages] = useState<DatasetImage[]>([])
  const [imgIdx, setImgIdx] = useState(0)
  const [boxes, setBoxes] = useState<PxBox[]>([])
  const [activeCls, setActiveCls] = useState(0)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [imgSize, setImgSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

  // Drag state
  const draftRef = useRef<{ start: Pt; mode: 'new' | 'move' | 'resize'; handle?: Handle; origBox?: PxBox; idx?: number } | null>(null)
  const [drawingPreview, setDrawingPreview] = useState<PxBox | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const classes = dataset.classes ?? []
  const current = images[imgIdx]

  // ── load images once ─────────────────────────────────────────────────────
  useEffect(() => {
    datasetsApi.listImages(dataset.id).then((list) => {
      setImages(list)
      setImgIdx(0)
    }).catch(() => {})
  }, [dataset.id])

  // ── load label on image change ───────────────────────────────────────────
  useEffect(() => {
    if (!current) { setBoxes([]); return }
    setBoxes([])
    setSelectedIdx(null)
    setDirty(false)
    setImgSize({ w: current.width, h: current.height })
    datasetsApi.getLabel(dataset.id, current.stem, current.split)
      .then(({ boxes }) => {
        if (current.width > 0 && current.height > 0) {
          setBoxes(boxes.map((b) => toPx(b, current.width, current.height)))
        }
      })
      .catch(() => {})
  }, [current?.stem, current?.split, dataset.id])

  // ── persistence ──────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (!current || imgSize.w === 0) return
    setSaving(true)
    try {
      const payload = boxes.map((b) => toYolo(b, imgSize.w, imgSize.h))
      await datasetsApi.putLabel(dataset.id, current.stem, current.split, payload)
      setDirty(false)
      // Update the local image list count
      setImages((prev) => prev.map((im, i) =>
        i === imgIdx ? { ...im, label_count: payload.length, annotated: payload.length > 0 } : im
      ))
    } catch {
      /* keep dirty=true so user knows */
    } finally {
      setSaving(false)
    }
  }, [boxes, current, dataset.id, imgIdx, imgSize])

  // ── navigation ───────────────────────────────────────────────────────────
  const nav = useCallback(async (delta: number) => {
    if (dirty) await save()
    setImgIdx((i) => clamp(i + delta, 0, images.length - 1))
  }, [dirty, save, images.length])

  // ── keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'Escape') { setSelectedIdx(null); onClose(); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); nav(+1); return }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); nav(-1); return }
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); save(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIdx !== null) {
          setBoxes((bs) => bs.filter((_, i) => i !== selectedIdx))
          setSelectedIdx(null)
          setDirty(true)
        }
        return
      }
      const n = parseInt(e.key, 10)
      if (!Number.isNaN(n) && n >= 1 && n <= classes.length) {
        const cls = n - 1
        setActiveCls(cls)
        if (selectedIdx !== null) {
          setBoxes((bs) => bs.map((b, i) => i === selectedIdx ? { ...b, cls } : b))
          setDirty(true)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [classes.length, selectedIdx, nav, save, onClose])

  // ── SVG event helpers ────────────────────────────────────────────────────
  const ptFromEvent = (e: React.MouseEvent): Pt => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const r = svg.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width)  * imgSize.w,
      y: ((e.clientY - r.top)  / r.height) * imgSize.h,
    }
  }

  const onSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (imgSize.w === 0) return
    if (e.button !== 0) return
    const p = ptFromEvent(e)
    // Empty area click starts a new box
    setSelectedIdx(null)
    draftRef.current = { start: p, mode: 'new' }
    setDrawingPreview({ x1: p.x, y1: p.y, x2: p.x, y2: p.y, cls: activeCls })
  }

  const onSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const draft = draftRef.current
    if (!draft) return
    const p = ptFromEvent(e)
    if (draft.mode === 'new') {
      setDrawingPreview({ x1: draft.start.x, y1: draft.start.y, x2: p.x, y2: p.y, cls: activeCls })
    } else if (draft.mode === 'move' && draft.origBox && draft.idx != null) {
      const dx = p.x - draft.start.x, dy = p.y - draft.start.y
      const b = draft.origBox
      setBoxes((bs) => bs.map((bb, i) => i === draft.idx ? {
        ...bb,
        x1: clamp(b.x1 + dx, 0, imgSize.w),
        y1: clamp(b.y1 + dy, 0, imgSize.h),
        x2: clamp(b.x2 + dx, 0, imgSize.w),
        y2: clamp(b.y2 + dy, 0, imgSize.h),
      } : bb))
    } else if (draft.mode === 'resize' && draft.origBox && draft.idx != null) {
      const b = draft.origBox
      const next = { ...b }
      const px = clamp(p.x, 0, imgSize.w), py = clamp(p.y, 0, imgSize.h)
      if (draft.handle === 'nw') { next.x1 = px; next.y1 = py }
      if (draft.handle === 'ne') { next.x2 = px; next.y1 = py }
      if (draft.handle === 'se') { next.x2 = px; next.y2 = py }
      if (draft.handle === 'sw') { next.x1 = px; next.y2 = py }
      setBoxes((bs) => bs.map((bb, i) => i === draft.idx ? next : bb))
    }
  }

  const onSvgMouseUp = () => {
    const draft = draftRef.current
    draftRef.current = null
    if (!draft) return
    if (draft.mode === 'new' && drawingPreview) {
      const { x1, y1, x2, y2 } = drawingPreview
      const minSize = 4
      if (Math.abs(x2 - x1) >= minSize && Math.abs(y2 - y1) >= minSize) {
        setBoxes((bs) => [...bs, { x1, y1, x2, y2, cls: activeCls }])
        setSelectedIdx(boxes.length)   // newly appended index
        setDirty(true)
      }
    } else if (draft.mode === 'move' || draft.mode === 'resize') {
      setDirty(true)
    }
    setDrawingPreview(null)
  }

  const beginBoxDrag = (e: React.MouseEvent, idx: number, mode: 'move' | 'resize', handle: Handle = 'body') => {
    e.stopPropagation()
    const p = ptFromEvent(e)
    draftRef.current = { start: p, mode, handle, origBox: { ...boxes[idx] }, idx }
    setSelectedIdx(idx)
  }

  // ── deduce annotation progress for UI ────────────────────────────────────
  const annotatedCount = useMemo(() => images.filter((i) => i.annotated).length, [images])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg-base">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-5 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-text-primary truncate">
            Annotate · {dataset.name}
          </h2>
          <p className="text-2xs text-text-tertiary mt-0.5">
            {annotatedCount} / {images.length} annotated
            {current && <> · {current.filename}  ({current.split})</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <Badge variant="warning" dot>Unsaved</Badge>}
          <Button size="xs" variant="ghost" onClick={() => nav(-1)} disabled={imgIdx === 0}>← Prev</Button>
          <span className="text-xs text-text-tertiary tabular-nums">
            {images.length === 0 ? 0 : imgIdx + 1} / {images.length}
          </span>
          <Button size="xs" variant="ghost" onClick={() => nav(+1)} disabled={imgIdx >= images.length - 1}>Next →</Button>
          <Button size="xs" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save (s)'}
          </Button>
          <Button size="xs" variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex">
        {/* Canvas */}
        <div className="flex-1 min-w-0 flex items-center justify-center bg-black/40 relative overflow-hidden">
          {current ? (
            <div
              className="relative max-h-full max-w-full"
              style={{ aspectRatio: imgSize.w && imgSize.h ? `${imgSize.w} / ${imgSize.h}` : undefined }}
            >
              <img
                src={datasetsApi.imageUrl(dataset.id, current.stem, current.split)}
                alt={current.filename}
                className="block max-h-[calc(100vh-120px)] max-w-full object-contain select-none"
                draggable={false}
                onLoad={(e) => {
                  const im = e.currentTarget
                  if (im.naturalWidth > 0 && (im.naturalWidth !== imgSize.w || im.naturalHeight !== imgSize.h)) {
                    setImgSize({ w: im.naturalWidth, h: im.naturalHeight })
                  }
                }}
              />
              {imgSize.w > 0 && (
                <svg
                  ref={svgRef}
                  className="absolute inset-0 w-full h-full cursor-crosshair"
                  viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
                  preserveAspectRatio="none"
                  onMouseDown={onSvgMouseDown}
                  onMouseMove={onSvgMouseMove}
                  onMouseUp={onSvgMouseUp}
                  onMouseLeave={onSvgMouseUp}
                >
                  {boxes.map((b, i) => {
                    const color = PALETTE[b.cls % PALETTE.length]
                    const selected = i === selectedIdx
                    const x = Math.min(b.x1, b.x2), y = Math.min(b.y1, b.y2)
                    const w = Math.abs(b.x2 - b.x1), h = Math.abs(b.y2 - b.y1)
                    return (
                      <g key={i}>
                        <rect
                          x={x} y={y} width={w} height={h}
                          fill={`${color}22`}
                          stroke={color}
                          strokeWidth={selected ? 3 : 2}
                          vectorEffect="non-scaling-stroke"
                          onMouseDown={(e) => beginBoxDrag(e, i, 'move', 'body')}
                          style={{ cursor: 'move' }}
                        />
                        <text x={x + 4} y={y + 14} fill={color} fontSize={14} fontFamily="sans-serif" style={{ pointerEvents: 'none' }}>
                          {classes[b.cls] ?? `#${b.cls}`}
                        </text>
                        {selected && (['nw', 'ne', 'se', 'sw'] as Handle[]).map((h2) => {
                          if (h2 === null) return null
                          const hx = h2 === 'nw' || h2 === 'sw' ? x : x + w
                          const hy = h2 === 'nw' || h2 === 'ne' ? y : y + h
                          const cursor = h2 === 'nw' || h2 === 'se' ? 'nwse-resize' : 'nesw-resize'
                          return (
                            <rect
                              key={h2 ?? 'k'} x={hx - 6} y={hy - 6} width={12} height={12}
                              fill={color} stroke="white" strokeWidth={1}
                              vectorEffect="non-scaling-stroke"
                              style={{ cursor }}
                              onMouseDown={(e) => beginBoxDrag(e, i, 'resize', h2)}
                            />
                          )
                        })}
                      </g>
                    )
                  })}
                  {drawingPreview && (() => {
                    const color = PALETTE[activeCls % PALETTE.length]
                    const x = Math.min(drawingPreview.x1, drawingPreview.x2)
                    const y = Math.min(drawingPreview.y1, drawingPreview.y2)
                    const w = Math.abs(drawingPreview.x2 - drawingPreview.x1)
                    const h = Math.abs(drawingPreview.y2 - drawingPreview.y1)
                    return (
                      <rect x={x} y={y} width={w} height={h}
                        fill={`${color}22`} stroke={color} strokeWidth={2}
                        strokeDasharray="6 3"
                        vectorEffect="non-scaling-stroke"
                        style={{ pointerEvents: 'none' }}
                      />
                    )
                  })()}
                </svg>
              )}
            </div>
          ) : (
            <p className="text-sm text-text-tertiary">No images in this dataset</p>
          )}
        </div>

        {/* Right panel */}
        <aside className="w-64 flex-shrink-0 border-l border-border-subtle flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-border-subtle">
            <p className="text-2xs uppercase tracking-wider text-text-disabled mb-2">Class (press 1-{Math.min(9, classes.length)})</p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {classes.map((c, i) => {
                const color = PALETTE[i % PALETTE.length]
                const active = i === activeCls
                return (
                  <button
                    key={c}
                    onClick={() => setActiveCls(i)}
                    className={`flex items-center w-full gap-2 rounded px-2 py-1 text-xs ${
                      active ? 'bg-bg-overlay text-text-primary' : 'text-text-secondary hover:bg-bg-overlay'
                    }`}
                  >
                    <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: color }} />
                    <span className="flex-1 text-left truncate">{c}</span>
                    {i < 9 && <span className="text-2xs text-text-disabled">{i + 1}</span>}
                  </button>
                )
              })}
              {classes.length === 0 && (
                <p className="text-2xs text-text-tertiary">Dataset has no classes</p>
              )}
            </div>
          </div>

          <div className="px-4 py-3 border-b border-border-subtle">
            <p className="text-2xs uppercase tracking-wider text-text-disabled mb-2">Boxes on this image ({boxes.length})</p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {boxes.length === 0 ? (
                <p className="text-2xs text-text-tertiary">Click-drag on the image to draw a box</p>
              ) : boxes.map((b, i) => (
                <div
                  key={i}
                  onClick={() => setSelectedIdx(i)}
                  className={`flex items-center gap-2 rounded px-2 py-1 text-xs cursor-pointer ${
                    i === selectedIdx ? 'bg-accent-subtle text-text-primary' : 'text-text-secondary hover:bg-bg-overlay'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                        style={{ background: PALETTE[b.cls % PALETTE.length] }} />
                  <span className="flex-1 truncate">{classes[b.cls] ?? `#${b.cls}`}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setBoxes((bs) => bs.filter((_, j) => j !== i))
                      if (selectedIdx === i) setSelectedIdx(null)
                      setDirty(true)
                    }}
                    className="text-text-tertiary hover:text-danger-text text-2xs"
                  >×</button>
                </div>
              ))}
            </div>
          </div>

          {/* Image strip */}
          <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
            <p className="px-2 text-2xs uppercase tracking-wider text-text-disabled mb-1.5">Images</p>
            <div className="grid grid-cols-2 gap-1.5">
              {images.map((im, i) => (
                <button
                  key={`${im.split}/${im.stem}`}
                  onClick={() => setImgIdx(i)}
                  className={`relative rounded overflow-hidden border ${
                    i === imgIdx ? 'border-accent' : 'border-border-subtle'
                  }`}
                >
                  <img
                    src={datasetsApi.imageUrl(dataset.id, im.stem, im.split)}
                    alt={im.filename}
                    className="w-full h-16 object-cover"
                    loading="lazy"
                  />
                  {im.annotated && (
                    <span className="absolute top-0.5 right-0.5 inline-block w-1.5 h-1.5 rounded-full bg-success" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="px-4 py-2 border-t border-border-subtle text-2xs text-text-tertiary space-y-0.5">
            <p>← →  navigate · <kbd className="text-text-secondary">s</kbd> save · <kbd className="text-text-secondary">Del</kbd> delete</p>
            <p>Click-drag empty area to draw · Click a box to select</p>
          </div>
        </aside>
      </div>
    </div>
  )
}
