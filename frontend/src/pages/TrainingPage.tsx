import { useEffect, useRef, useState, useMemo } from 'react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { datasetsApi } from '../api/datasets'
import { sourcesApi } from '../api/sources'
import { workflowsApi } from '../api/workflows'
import { trainingApi, type TrainingCreatePayload } from '../api/training'
import { MetricsCharts } from '../components/training/MetricsCharts'
import { LogPanel } from '../components/training/LogPanel'
import { CompareModal } from '../components/training/CompareModal'
import { ExportButton } from '../components/training/ExportButton'
import { Annotator } from '../components/training/Annotator'
import type {
  BaseModelOption,
  Dataset,
  DatasetValidation,
  Source,
  TrainingDeviceInfo,
  TrainingJob,
  TrainingStatus,
  TrainingWsMessage,
  Workflow,
} from '../types'

// ── small helpers ────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<TrainingStatus, 'success' | 'danger' | 'accent' | 'warning' | 'neutral'> = {
  queued:    'neutral',
  running:   'accent',
  completed: 'success',
  failed:    'danger',
  cancelled: 'warning',
}

function fmt(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleString()
}

function num(x: unknown, digits = 4): string {
  return typeof x === 'number' && Number.isFinite(x) ? x.toFixed(digits) : '—'
}

// ── WebSocket hook ───────────────────────────────────────────────────────────

function useTrainingWs(jobId: number | null, onMessage: (msg: TrainingWsMessage) => void) {
  const cbRef = useRef(onMessage)
  cbRef.current = onMessage

  useEffect(() => {
    if (jobId == null) return
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${window.location.host}/ws/training/${jobId}`
    const ws = new WebSocket(url)
    ws.onmessage = (e) => {
      try {
        cbRef.current(JSON.parse(e.data))
      } catch { /* ignore */ }
    }
    return () => ws.close()
  }, [jobId])
}

// ── Datasets section ─────────────────────────────────────────────────────────

function DatasetsSection({
  datasets,
  sources,
  workflows,
  reload,
  onAnnotate,
}: { datasets: Dataset[]; sources: Source[]; workflows: Workflow[]; reload: () => void; onAnnotate: (d: Dataset) => void }) {
  // dataset_id → true si un workflow en cours a un node harvest ciblant ce dataset
  const harvestingIds = useMemo(() => {
    const ids = new Set<number>()
    for (const wf of workflows) {
      if (!wf.enabled) continue
      for (const node of wf.nodes) {
        if (node.data?.type === 'harvest') {
          const did = Number(node.data?.config?.dataset_id)
          if (did > 0) ids.add(did)
        }
      }
    }
    return ids
  }, [workflows])
  const [showForm, setShowForm] = useState<null | 'zip' | 'source' | 'folder'>(null)
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // From-source state
  const [srcId, setSrcId] = useState<number | ''>(sources[0]?.id ?? '')
  const [numFrames, setNumFrames] = useState(20)
  const [interval, setInterval] = useState(1.0)
  const [classesCsv, setClassesCsv] = useState('person, car')
  const [capturing, setCapturing] = useState(false)

  // From-folder state
  const [folderFiles, setFolderFiles] = useState<File[]>([])
  const [folderClassesCsv, setFolderClassesCsv] = useState('person, car')
  const [validations, setValidations] = useState<Record<number, DatasetValidation>>({})
  const [validatingId, setValidatingId] = useState<number | null>(null)

  const validate = async (id: number) => {
    setValidatingId(id)
    try {
      const v = await datasetsApi.validate(id)
      setValidations((prev) => ({ ...prev, [id]: v }))
    } catch {
      // surface a synthetic error
      setValidations((prev) => ({
        ...prev,
        [id]: { ok: false, warnings: [], errors: ['Request failed'], classes: [], num_train: 0, num_val: 0 },
      }))
    } finally {
      setValidatingId(null)
    }
  }

  const dismissValidation = (id: number) => {
    setValidations((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const upload = async () => {
    if (!file || !name.trim()) return
    setUploading(true)
    setError(null)
    try {
      await datasetsApi.upload(name.trim(), file)
      setName('')
      setFile(null)
      setShowForm(null)
      reload()
    } catch (e: any) {
      setError(e?.message ?? 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const uploadFolder = async () => {
    if (!name.trim() || folderFiles.length === 0) return
    const classes = folderClassesCsv.split(',').map((s) => s.trim()).filter(Boolean)
    if (classes.length === 0) {
      setError('Provide at least one class name')
      return
    }
    setUploading(true)
    setError(null)
    try {
      await datasetsApi.uploadFolder(name.trim(), classes, folderFiles)
      setName('')
      setFolderFiles([])
      setShowForm(null)
      reload()
    } catch (e: any) {
      setError(e?.message ?? 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const captureFromSource = async () => {
    if (!name.trim() || srcId === '') return
    const classes = classesCsv.split(',').map((s) => s.trim()).filter(Boolean)
    if (classes.length === 0) {
      setError('Provide at least one class name')
      return
    }
    setCapturing(true)
    setError(null)
    try {
      await datasetsApi.createFromSource({
        name: name.trim(),
        source_id: Number(srcId),
        num_frames: numFrames,
        interval_seconds: interval,
        classes,
      })
      setName('')
      setShowForm(null)
      reload()
    } catch (e: any) {
      setError(e?.message ?? 'Capture failed')
    } finally {
      setCapturing(false)
    }
  }

  const remove = async (id: number) => {
    if (!confirm('Delete this dataset and its files?')) return
    await datasetsApi.delete(id)
    reload()
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-medium text-text-primary">Datasets</h2>
          <p className="text-xs text-text-tertiary mt-0.5">
            {datasets.length} dataset{datasets.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="xs"
            variant={showForm === 'source' ? 'secondary' : 'ghost'}
            onClick={() => { setShowForm(showForm === 'source' ? null : 'source'); setError(null) }}
            disabled={sources.length === 0}
            title={sources.length === 0 ? 'Add a source first' : 'Capture frames from a source'}
          >
            {showForm === 'source' ? 'Cancel' : 'From source'}
          </Button>
          <Button
            size="xs"
            variant={showForm === 'folder' ? 'secondary' : 'ghost'}
            onClick={() => { setShowForm(showForm === 'folder' ? null : 'folder'); setError(null) }}
            title="Pick a folder of images from your PC"
          >
            {showForm === 'folder' ? 'Cancel' : 'From folder'}
          </Button>
          <Button
            size="xs"
            variant={showForm === 'zip' ? 'secondary' : 'primary'}
            onClick={() => { setShowForm(showForm === 'zip' ? null : 'zip'); setError(null) }}
          >
            {showForm === 'zip' ? 'Cancel' : 'Import zip'}
          </Button>
        </div>
      </div>

      {showForm === 'zip' && (
        <div className="mb-3 rounded border border-border-subtle bg-bg-overlay p-3 space-y-3">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My traffic dataset"
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">
              YOLO-format zip
            </label>
            <input
              type="file"
              accept=".zip"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-xs text-text-secondary file:mr-3 file:rounded file:border-0 file:bg-accent-subtle file:px-3 file:py-1 file:text-xs file:text-accent file:cursor-pointer"
            />
            <p className="text-2xs text-text-tertiary">
              Expects <code>images/train/</code>, <code>images/val/</code>, <code>labels/</code> and either <code>data.yaml</code> or <code>classes.txt</code>.
            </p>
          </div>
          {error && <p className="text-xs text-danger-text">{error}</p>}
          <Button size="xs" onClick={upload} disabled={!file || !name.trim() || uploading}>
            {uploading ? 'Uploading…' : 'Upload'}
          </Button>
        </div>
      )}

      {showForm === 'source' && (
        <div className="mb-3 rounded border border-border-subtle bg-bg-overlay p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Lobby snapshots"
            />
            <Select
              label="Source"
              value={srcId}
              onChange={(e) => setSrcId(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="" disabled>Select a source…</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.type})</option>
              ))}
            </Select>
            <Input
              label="Frames"
              type="number"
              min={1}
              max={500}
              value={numFrames}
              onChange={(e) => setNumFrames(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
            />
            <Input
              label="Interval (seconds)"
              type="number"
              step={0.1}
              min={0}
              value={interval}
              onChange={(e) => setInterval(Math.max(0, Number(e.target.value) || 0))}
            />
            <div className="col-span-2">
              <Input
                label="Classes (comma-separated)"
                value={classesCsv}
                onChange={(e) => setClassesCsv(e.target.value)}
                placeholder="person, car, bicycle"
                hint="Used to seed classes.txt. Annotate the empty label files before training (e.g. with LabelStudio)."
              />
            </div>
          </div>
          {error && <p className="text-xs text-danger-text">{error}</p>}
          <Button
            size="xs"
            onClick={captureFromSource}
            disabled={capturing || !name.trim() || srcId === ''}
          >
            {capturing ? `Capturing ${numFrames} frames…` : `Capture ${numFrames} frames`}
          </Button>
        </div>
      )}

      {showForm === 'folder' && (
        <div className="mb-3 rounded border border-border-subtle bg-bg-overlay p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cats vs dogs"
            />
            <Input
              label="Classes (comma-separated)"
              value={folderClassesCsv}
              onChange={(e) => setFolderClassesCsv(e.target.value)}
              placeholder="cat, dog"
              hint="Seeds classes.txt. Annotate via the Annotate button after import."
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Folder of images</label>
            <input
              type="file"
              // @ts-expect-error — non-standard attributes for folder selection
              webkitdirectory=""
              directory=""
              multiple
              accept="image/*"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []).filter(
                  (f) => /\.(jpe?g|png|bmp|webp)$/i.test(f.name),
                )
                setFolderFiles(files)
              }}
              className="text-xs text-text-secondary file:mr-3 file:rounded file:border-0 file:bg-accent-subtle file:px-3 file:py-1 file:text-xs file:text-accent file:cursor-pointer"
            />
            <p className="text-2xs text-text-tertiary">
              {folderFiles.length > 0
                ? `${folderFiles.length} image${folderFiles.length !== 1 ? 's' : ''} selected — non-image files are skipped`
                : 'Pick a directory; sub-folders are flattened. Existing labels are ignored.'}
            </p>
          </div>
          {error && <p className="text-xs text-danger-text">{error}</p>}
          <Button
            size="xs"
            onClick={uploadFolder}
            disabled={uploading || !name.trim() || folderFiles.length === 0}
          >
            {uploading ? `Uploading ${folderFiles.length} images…` : `Import ${folderFiles.length} image${folderFiles.length !== 1 ? 's' : ''}`}
          </Button>
        </div>
      )}

      {datasets.length === 0 ? (
        <p className="text-xs text-text-tertiary py-3 text-center">No datasets yet</p>
      ) : (
        <div className="space-y-1">
          {datasets.map((d) => {
            const v = validations[d.id]
            return (
              <div key={d.id} className="rounded border border-border-subtle">
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-text-primary font-medium truncate">{d.name}</p>
                      {harvestingIds.has(d.id) && (
                        <span className="flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-2xs font-medium text-accent">
                          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                          Récolte en cours
                        </span>
                      )}
                    </div>
                    <p className="text-2xs text-text-tertiary mt-0.5">
                      {d.num_train} train · {d.num_val} val · {d.classes.length} class{d.classes.length !== 1 ? 'es' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-wrap gap-1 max-w-xs justify-end">
                      {d.classes.slice(0, 4).map((c) => (
                        <Badge key={c} variant="neutral">{c}</Badge>
                      ))}
                      {d.classes.length > 4 && (
                        <Badge variant="neutral">+{d.classes.length - 4}</Badge>
                      )}
                    </div>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => onAnnotate(d)}
                      title="Open the in-app YOLO annotator"
                    >
                      Annotate
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => validate(d.id)}
                      disabled={validatingId === d.id}
                    >
                      {validatingId === d.id ? 'Validating…' : 'Validate'}
                    </Button>
                    <Button size="xs" variant="danger" onClick={() => remove(d.id)}>Delete</Button>
                  </div>
                </div>
                {v && (
                  <div className="border-t border-border-subtle px-3 py-2 space-y-1.5 bg-bg-overlay">
                    <div className="flex items-center justify-between">
                      <Badge variant={v.ok ? 'success' : 'danger'} dot>
                        {v.ok ? 'Dataset OK' : 'Issues found'}
                      </Badge>
                      <button
                        onClick={() => dismissValidation(d.id)}
                        className="text-2xs text-text-tertiary hover:text-text-secondary"
                      >
                        Dismiss
                      </button>
                    </div>
                    <p className="text-2xs text-text-tertiary">
                      {v.num_train} train · {v.num_val} val · {v.classes.length} class{v.classes.length !== 1 ? 'es' : ''}
                    </p>
                    {v.errors.length > 0 && (
                      <ul className="text-xs text-danger-text space-y-0.5">
                        {v.errors.map((e, i) => <li key={i}>• {e}</li>)}
                      </ul>
                    )}
                    {v.warnings.length > 0 && (
                      <ul className="text-xs text-warning-text space-y-0.5">
                        {v.warnings.map((w, i) => <li key={i}>• {w}</li>)}
                      </ul>
                    )}
                    {v.errors.length === 0 && v.warnings.length === 0 && (
                      <p className="text-xs text-text-tertiary">No warnings or errors detected.</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ── New job form ─────────────────────────────────────────────────────────────

function NewJobForm({
  datasets,
  baseModels,
  userModels,
  device,
  onCreated,
  onCancel,
}: {
  datasets: Dataset[]
  baseModels: BaseModelOption[]
  userModels: BaseModelOption[]
  device: TrainingDeviceInfo | null
  onCreated: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [datasetId, setDatasetId] = useState<number | ''>(datasets[0]?.id ?? '')
  const [baseModel, setBaseModel] = useState(baseModels[0]?.value ?? 'yolov8n.pt')
  const [epochs, setEpochs] = useState(50)
  const [imgsz, setImgsz] = useState(640)
  const [batch, setBatch] = useState(-1)
  const [lr0, setLr0] = useState(0.01)
  const [dev, setDev] = useState<string>(device?.recommended ?? 'cpu')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim() || datasetId === '') return
    setSubmitting(true)
    setError(null)
    try {
      const payload: TrainingCreatePayload = {
        name: name.trim(),
        dataset_id: Number(datasetId),
        base_model: baseModel,
        config: { epochs, imgsz, batch, lr0, device: dev },
      }
      await trainingApi.create(payload)
      onCreated()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create job')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded border border-border-subtle bg-bg-overlay p-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Job name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-yolov8n-run"
        />
        <Select
          label="Dataset"
          value={datasetId}
          onChange={(e) => setDatasetId(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="" disabled>Select a dataset…</option>
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </Select>
        <Select
          label="Base model"
          value={baseModel}
          onChange={(e) => setBaseModel(e.target.value)}
        >
          <optgroup label="Built-in">
            {baseModels.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </optgroup>
          {userModels.length > 0 && (
            <optgroup label="Your models (resume / transfer learning)">
              {userModels.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </optgroup>
          )}
        </Select>
        <Select label="Device" value={dev} onChange={(e) => setDev(e.target.value)}>
          {(device?.devices ?? [{ id: 'cpu', name: 'CPU' }]).map((d) => (
            <option key={d.id} value={d.id}>{d.id} — {d.name}</option>
          ))}
        </Select>
        <Input
          label="Epochs"
          type="number"
          min={1}
          value={epochs}
          onChange={(e) => setEpochs(Number(e.target.value) || 1)}
        />
        <Input
          label="Image size"
          type="number"
          min={64}
          step={32}
          value={imgsz}
          onChange={(e) => setImgsz(Number(e.target.value) || 640)}
        />
        <Input
          label="Batch size  (-1 = auto)"
          type="number"
          value={batch}
          onChange={(e) => setBatch(Number(e.target.value))}
        />
        <Input
          label="Learning rate"
          type="number"
          step={0.0001}
          value={lr0}
          onChange={(e) => setLr0(Number(e.target.value) || 0.01)}
        />
      </div>

      {device && !device.cuda_available && (
        <p className="text-2xs text-warning-text">
          ⚠ No CUDA device detected — training will run on CPU and may be very slow.
        </p>
      )}

      {error && <p className="text-xs text-danger-text">{error}</p>}

      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={submitting || !name.trim() || datasetId === ''}>
          {submitting ? 'Creating…' : 'Start training'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

// ── Job detail (expanded row) ────────────────────────────────────────────────

function JobDetail({
  job,
  liveLogLine,
  logReloadKey,
}: {
  job: TrainingJob
  liveLogLine: string | null
  logReloadKey: number
}) {
  const last = job.metrics[job.metrics.length - 1] ?? {}
  const progress = job.progress as TrainingProgressShape | undefined
  const pct = progress?.total_epochs
    ? Math.min(100, Math.round((progress.epoch / progress.total_epochs) * 100))
    : job.status === 'completed' ? 100 : 0
  const hasLogPath = !!job.output_path

  return (
    <div className="border-t border-border-subtle bg-bg-overlay px-4 py-3 space-y-3">
      {(job.status === 'running' || job.status === 'completed') && (
        <div>
          <div className="flex items-center justify-between text-2xs text-text-tertiary mb-1">
            <span>
              Epoch {progress?.epoch ?? job.metrics.length} / {progress?.total_epochs ?? (Number(job.config?.['epochs']) || '?')}
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 w-full rounded bg-bg-raised overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <Metric label="box_loss"  value={num(last['box_loss'])} />
        <Metric label="cls_loss"  value={num(last['cls_loss'])} />
        <Metric label="mAP@0.5"   value={num(last['mAP50'] ?? last['map50'])} />
        <Metric label="mAP@.5-.95" value={num(last['mAP50-95'] ?? last['map50-95'] ?? last['map5095'])} />
      </div>

      <MetricsCharts metrics={job.metrics} />

      {hasLogPath && (
        <LogPanel jobId={job.id} liveLine={liveLogLine} reloadKey={logReloadKey} />
      )}

      <div className="grid grid-cols-2 gap-3 text-2xs text-text-tertiary">
        <span>Base model: <code className="text-text-secondary">{job.base_model}</code></span>
        <span>Started: {fmt(job.started_at)}</span>
        <span>Finished: {fmt(job.finished_at)}</span>
        {job.weights_path && (
          <span className="truncate">Weights: <code className="text-text-secondary">{job.weights_path}</code></span>
        )}
      </div>

      {job.status === 'completed' && job.weights_path && (
        <div className="flex items-center justify-between rounded border border-border-subtle px-3 py-2">
          <p className="text-2xs text-text-tertiary">Export trained model</p>
          <ExportButton jobId={job.id} />
        </div>
      )}

      {job.error && (
        <div className="rounded border border-danger/40 bg-danger-subtle px-3 py-2 text-xs text-danger-text">
          {job.error}
        </div>
      )}
    </div>
  )
}

interface TrainingProgressShape {
  epoch: number
  total_epochs: number
  metrics: Record<string, number>
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-2xs uppercase tracking-wider text-text-disabled">{label}</p>
      <p className="text-sm font-medium text-text-primary tabular-nums">{value}</p>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export function TrainingPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [jobs, setJobs] = useState<TrainingJob[]>([])
  const [baseModels, setBaseModels] = useState<BaseModelOption[]>([])
  const [userModels, setUserModels] = useState<BaseModelOption[]>([])
  const [device, setDevice] = useState<TrainingDeviceInfo | null>(null)
  const [showNewJob, setShowNewJob] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [liveLogLine, setLiveLogLine] = useState<string | null>(null)
  const [logReloadKey, setLogReloadKey] = useState(0)
  const [compareMode, setCompareMode] = useState(false)
  const [compareSelected, setCompareSelected] = useState<Set<number>>(new Set())
  const [compareOpen, setCompareOpen] = useState(false)
  const [annotatingDataset, setAnnotatingDataset] = useState<Dataset | null>(null)

  const toggleCompareJob = (id: number) => {
    setCompareSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const loadDatasets   = () => datasetsApi.list().then(setDatasets).catch(() => {})
  const loadJobs       = () => trainingApi.list().then(setJobs).catch(() => {})
  const loadUserModels = () => trainingApi.userModels().then(setUserModels).catch(() => {})

  useEffect(() => {
    loadDatasets()
    loadJobs()
    loadUserModels()
    sourcesApi.list().then(setSources).catch(() => {})
    workflowsApi.list().then(setWorkflows).catch(() => {})
    trainingApi.baseModels().then(setBaseModels).catch(() => {})
    trainingApi.deviceInfo().then(setDevice).catch(() => {})
  }, [])

  // Poll while any job is running (light fallback in case WS misses an event)
  useEffect(() => {
    const hasActive = jobs.some((j) => j.status === 'running' || j.status === 'queued')
    if (!hasActive) return
    const id = setInterval(loadJobs, 5000)
    return () => clearInterval(id)
  }, [jobs])

  // Wire WS to the first running job → patch live progress in state
  const runningJob = jobs.find((j) => j.status === 'running') ?? null
  useTrainingWs(runningJob?.id ?? null, (msg) => {
    if (!runningJob) return
    if (msg.type === 'log' && typeof msg.line === 'string') {
      setLiveLogLine(msg.line)
      return
    }
    if (msg.type === 'status') {
      // Bump key so LogPanel re-fetches the (now finalized) tail on transition
      setLogReloadKey((k) => k + 1)
    }
    setJobs((prev) => prev.map((j) => {
      if (j.id !== runningJob.id) return j
      if (msg.type === 'progress' && msg.epoch && msg.metrics) {
        const progress = {
          epoch: msg.epoch,
          total_epochs: msg.total_epochs ?? Number(j.config?.['epochs'] ?? 0),
          metrics: msg.metrics,
        }
        const history = [...j.metrics, { epoch: msg.epoch, ...msg.metrics }]
        return { ...j, progress, metrics: history }
      }
      if (msg.type === 'status' && msg.status) {
        // Status changed — reload to pick up server-authoritative fields
        loadJobs()
        if (msg.status === 'completed') loadUserModels()
        return { ...j, status: msg.status, error: msg.error ?? j.error }
      }
      return j
    }))
  })

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const cancel = async (id: number) => {
    await trainingApi.cancel(id).catch(() => {})
    loadJobs()
  }
  const remove = async (id: number) => {
    if (!confirm('Delete this training job and its outputs?')) return
    await trainingApi.delete(id).catch(() => {})
    loadJobs()
  }

  return (
    <div className="w-full p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Training</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Fine-tune YOLO models on your own datasets
          </p>
        </div>
        {device && (
          <Badge variant={device.cuda_available ? 'success' : 'neutral'} dot>
            {device.cuda_available
              ? `GPU · ${device.devices.find((d) => d.id.startsWith('cuda'))?.name ?? 'CUDA'}`
              : 'CPU only'}
          </Badge>
        )}
      </div>

      <DatasetsSection
        datasets={datasets}
        sources={sources}
        workflows={workflows}
        reload={loadDatasets}
        onAnnotate={setAnnotatingDataset}
      />

      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-medium text-text-primary">Training jobs</h2>
            <p className="text-xs text-text-tertiary mt-0.5">
              {jobs.length} job{jobs.length !== 1 ? 's' : ''} · runs sequentially (one at a time)
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {compareMode ? (
              <>
                <Button
                  size="xs"
                  variant="primary"
                  onClick={() => setCompareOpen(true)}
                  disabled={compareSelected.size < 1}
                >
                  Compare ({compareSelected.size})
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => { setCompareMode(false); setCompareSelected(new Set()) }}
                >
                  Done
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setCompareMode(true)}
                  disabled={jobs.filter((j) => j.metrics.length > 0).length < 2}
                  title="Overlay metric curves from 2+ runs"
                >
                  Compare
                </Button>
                <Button
                  size="xs"
                  variant={showNewJob ? 'secondary' : 'primary'}
                  onClick={() => setShowNewJob(!showNewJob)}
                  disabled={datasets.length === 0}
                >
                  {showNewJob ? 'Cancel' : 'New training'}
                </Button>
              </>
            )}
          </div>
        </div>

        {showNewJob && (
          <div className="mb-3">
            <NewJobForm
              datasets={datasets}
              baseModels={baseModels}
              userModels={userModels}
              device={device}
              onCreated={() => { setShowNewJob(false); loadJobs() }}
              onCancel={() => setShowNewJob(false)}
            />
          </div>
        )}

        {jobs.length === 0 ? (
          <p className="text-xs text-text-tertiary py-3 text-center">No training jobs yet</p>
        ) : (
          <div className="rounded border border-border-subtle overflow-hidden">
            {jobs.map((j, i) => {
              const datasetName = datasets.find((d) => d.id === j.dataset_id)?.name ?? '—'
              const isOpen = expanded.has(j.id)
              return (
                <div key={j.id} className={i > 0 ? 'border-t border-border-subtle' : ''}>
                  <div
                    className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-bg-overlay"
                    onClick={() => compareMode ? toggleCompareJob(j.id) : toggleExpand(j.id)}
                  >
                    {compareMode ? (
                      <input
                        type="checkbox"
                        className="accent-accent flex-shrink-0"
                        checked={compareSelected.has(j.id)}
                        onChange={() => toggleCompareJob(j.id)}
                        onClick={(e) => e.stopPropagation()}
                        disabled={j.metrics.length === 0}
                      />
                    ) : (
                      <span className="text-text-tertiary text-xs w-3">{isOpen ? '▾' : '▸'}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-text-primary font-medium truncate">{j.name}</p>
                      <p className="text-2xs text-text-tertiary mt-0.5">
                        {datasetName} · {j.base_model}
                      </p>
                    </div>
                    <Badge variant={STATUS_VARIANT[j.status]} dot>{j.status}</Badge>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {(j.status === 'queued' || j.status === 'running') && (
                        <Button size="xs" variant="ghost" onClick={() => cancel(j.id)}>Cancel</Button>
                      )}
                      {j.status !== 'running' && (
                        <Button size="xs" variant="danger" onClick={() => remove(j.id)}>Delete</Button>
                      )}
                    </div>
                  </div>
                  {isOpen && (
                    <JobDetail
                      job={j}
                      liveLogLine={runningJob?.id === j.id ? liveLogLine : null}
                      logReloadKey={logReloadKey}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {compareOpen && (
        <CompareModal
          jobs={jobs}
          selectedIds={Array.from(compareSelected)}
          onClose={() => setCompareOpen(false)}
        />
      )}

      {annotatingDataset && (
        <Annotator
          dataset={annotatingDataset}
          onClose={() => { setAnnotatingDataset(null); loadDatasets() }}
        />
      )}
    </div>
  )
}
