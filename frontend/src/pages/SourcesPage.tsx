import { Fragment, useEffect, useState } from 'react'
import { sourcesApi } from '../api/sources'
import type { Source, SourceType } from '../types'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'

type Form = { name: string; type: SourceType; uri: string }
const INITIAL: Form = { name: '', type: 'webcam', uri: '0' }

type IpCamForm = {
  protocol: 'http' | 'rtsp'
  host: string
  port: string
  path: string
  username: string
  password: string
}
const INITIAL_IP: IpCamForm = { protocol: 'http', host: '', port: '8080', path: '/video', username: '', password: '' }

function buildIpCameraUri(ip: IpCamForm): string {
  if (!ip.host) return ''
  const auth = ip.username
    ? `${ip.username}${ip.password ? ':' + ip.password : ''}@`
    : ''
  const path = ip.path.startsWith('/') ? ip.path : '/' + ip.path
  return `${ip.protocol}://${auth}${ip.host}:${ip.port}${path}`
}

const sourceTypeLabel: Record<SourceType, string> = {
  webcam:       'Webcam',
  video:        'Video file',
  rtsp:         'RTSP stream',
  image:        'Image',
  stream:       'Web stream',
  ip_camera:    'IP Camera',
  image_url:    'Image URL (snapshot)',
  image_folder: 'Image folder (sequence)',
  satellite:    'Satellite metadata',
}

const uriPlaceholder: Record<SourceType, string> = {
  webcam:       '0',
  video:        '/path/to/video.mp4',
  rtsp:         'rtsp://user:pass@192.168.1.1/stream',
  image:        '/path/to/image.jpg',
  stream:       'https://www.youtube.com/watch?v=… or https://twitch.tv/channel',
  ip_camera:    'http://192.168.1.100:8080/video',
  image_url:    'https://camera.example.com/snapshot.jpg',
  image_folder: '/path/to/folder/of/images',
  satellite:    'satellite://metadata',
}

const uriDefaultOnTypeChange: Record<SourceType, string> = {
  webcam:       '0',
  video:        '',
  rtsp:         '',
  image:        '',
  stream:       '',
  ip_camera:    '',
  image_url:    '',
  image_folder: '',
  satellite:    'satellite://metadata',
}

// ── Platform detection ───────────────────────────────────────────────────────

interface Platform {
  name: string
  color: string
  icon: string
}

const PLATFORM_PATTERNS: Array<{ re: RegExp; platform: Platform }> = [
  { re: /youtube\.com|youtu\.be/i,  platform: { name: 'YouTube',     color: '#ef4444', icon: '▶' } },
  { re: /twitch\.tv/i,              platform: { name: 'Twitch',      color: '#a855f7', icon: '◉' } },
  { re: /vimeo\.com/i,              platform: { name: 'Vimeo',       color: '#22d3ee', icon: '▶' } },
  { re: /dailymotion\.com/i,        platform: { name: 'Dailymotion', color: '#f59e0b', icon: '▶' } },
  { re: /twitter\.com|x\.com/i,     platform: { name: 'X (Twitter)', color: '#94a3b8', icon: '✕' } },
  { re: /tiktok\.com/i,             platform: { name: 'TikTok',      color: '#ec4899', icon: '♪' } },
  { re: /instagram\.com/i,          platform: { name: 'Instagram',   color: '#e879f9', icon: '◎' } },
  { re: /kick\.com/i,               platform: { name: 'Kick',        color: '#22c55e', icon: '◉' } },
]

function detectPlatform(uri: string): Platform | null {
  for (const { re, platform } of PLATFORM_PATTERNS) {
    if (re.test(uri)) return platform
  }
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    return { name: 'Web stream', color: '#64748b', icon: '◎' }
  }
  return null
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<Form>(INITIAL)
  const [ipCam, setIpCam] = useState<IpCamForm>(INITIAL_IP)
  const [formError, setFormError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Record<number, string>>({})
  const [testResult, setTestResult] = useState<Record<number, { ok: boolean; msg: string }>>({})
  const [loading, setLoading] = useState(false)

  const load = () => sourcesApi.list().then(setSources).catch(() => {})

  useEffect(() => { load() }, [])

  const submit = async () => {
    setLoading(true)
    setFormError(null)
    try {
      await sourcesApi.create({ ...form, enabled: true })
      setForm(INITIAL)
      setShowForm(false)
      load()
    } catch (e: unknown) {
      setFormError((e as Error).message ?? 'Failed to save source')
    } finally {
      setLoading(false)
    }
  }

  const toggle = async (s: Source) => {
    await sourcesApi.update(s.id, { enabled: !s.enabled })
    load()
  }

  const remove = async (id: number) => {
    if (!confirm('Delete this source?')) return
    await sourcesApi.delete(id)
    load()
  }

  const getPreview = async (id: number) => {
    try {
      const res = await sourcesApi.preview(id)
      setPreview((p) => ({ ...p, [id]: res.frame }))
    } catch {
      alert('Cannot capture preview frame')
    }
  }

  const runTest = async (s: Source) => {
    const res = await sourcesApi.test(s.id)
    setTestResult((t) => ({
      ...t,
      [s.id]: res.ok
        ? { ok: true, msg: `${res.width} × ${res.height}` }
        : { ok: false, msg: res.error || 'Connection failed' },
    }))
  }

  const updateIpCam = (patch: Partial<IpCamForm>) => {
    setIpCam((prev) => {
      const next = { ...prev, ...patch }
      setForm((f) => ({ ...f, uri: buildIpCameraUri(next) }))
      return next
    })
  }

  const formPlatform = form.type === 'stream' ? detectPlatform(form.uri) : null

  return (
    <div className="w-full p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Sources</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            {sources.length} source{sources.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <Button
          variant={showForm ? 'secondary' : 'primary'}
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? 'Cancel' : 'Add source'}
        </Button>
      </div>

      {showForm && (
        <Card>
          <h3 className="text-sm font-medium text-text-primary mb-4">New source</h3>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Front door camera"
            />
            <Select
              label="Type"
              value={form.type}
              onChange={(e) => {
                const t = e.target.value as SourceType
                if (t === 'ip_camera') {
                  const fresh = INITIAL_IP
                  setIpCam(fresh)
                  setForm({ ...form, type: t, uri: buildIpCameraUri(fresh) })
                } else {
                  setForm({ ...form, type: t, uri: uriDefaultOnTypeChange[t] })
                }
              }}
            >
              {(Object.keys(sourceTypeLabel) as SourceType[]).map((t) => (
                <option key={t} value={t}>{sourceTypeLabel[t]}</option>
              ))}
            </Select>

            {form.type === 'ip_camera' ? (
              <div className="col-span-2 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Select
                    label="Protocol"
                    value={ipCam.protocol}
                    onChange={(e) => {
                      const proto = e.target.value as 'http' | 'rtsp'
                      updateIpCam({ protocol: proto, port: proto === 'rtsp' ? '554' : '8080' })
                    }}
                  >
                    <option value="http">HTTP (MJPEG)</option>
                    <option value="rtsp">RTSP</option>
                  </Select>
                  <Input
                    label="Port"
                    value={ipCam.port}
                    onChange={(e) => updateIpCam({ port: e.target.value })}
                    placeholder={ipCam.protocol === 'rtsp' ? '554' : '8080'}
                  />
                </div>
                <Input
                  label="IP / Hostname"
                  value={ipCam.host}
                  onChange={(e) => updateIpCam({ host: e.target.value })}
                  placeholder="192.168.1.100"
                />
                <Input
                  label="Stream path"
                  value={ipCam.path}
                  onChange={(e) => updateIpCam({ path: e.target.value })}
                  placeholder="/video"
                  className="font-mono"
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Username (optional)"
                    value={ipCam.username}
                    onChange={(e) => updateIpCam({ username: e.target.value })}
                    placeholder="admin"
                  />
                  <Input
                    label="Password (optional)"
                    type="password"
                    value={ipCam.password}
                    onChange={(e) => updateIpCam({ password: e.target.value })}
                  />
                </div>
                {form.uri && (
                  <div className="rounded-lg border border-border-subtle bg-bg-overlay px-3 py-2">
                    <p className="text-2xs font-medium text-text-secondary mb-1">Constructed URI</p>
                    <p className="text-xs font-mono text-text-primary break-all">{form.uri}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="col-span-2 space-y-1.5">
                <Input
                  label={
                    form.type === 'webcam'        ? 'Device index'
                    : form.type === 'stream'      ? 'Stream URL'
                    : form.type === 'image_url'   ? 'Snapshot URL'
                    : form.type === 'image_folder' ? 'Folder path'
                    : 'URI / path'
                  }
                  value={form.uri}
                  onChange={(e) => setForm({ ...form, uri: e.target.value })}
                  placeholder={uriPlaceholder[form.type]}
                  className="font-mono"
                />

                {form.type === 'image_url' && (
                  <p className="text-2xs text-text-tertiary">
                    URL that returns a JPEG/PNG on each GET — typical of old IP cameras or public webcam snapshots. Polled at the workflow FPS.
                  </p>
                )}
                {form.type === 'image_folder' && (
                  <p className="text-2xs text-text-tertiary">
                    Absolute path to a directory of images. Cycled in lexicographic order, looping. Useful for replaying captured datasets through a workflow.
                  </p>
                )}

                {/* Platform detection badge + hints for stream type */}
                {form.type === 'stream' && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {formPlatform ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
                        style={{ background: `${formPlatform.color}20`, color: formPlatform.color }}
                      >
                        <span>{formPlatform.icon}</span>
                        {formPlatform.name} detected
                      </span>
                    ) : (
                      <span className="text-xs text-text-tertiary">
                        Paste a YouTube, Twitch, Vimeo or any supported URL
                      </span>
                    )}
                    <span className="text-xs text-text-disabled">
                      Supports ~1800 sites via yt-dlp
                    </span>
                  </div>
                )}

                {/* Stream type — extra notes */}
                {form.type === 'stream' && (
                  <div className="rounded-lg border border-border-subtle bg-bg-overlay px-3 py-2 space-y-1">
                    <p className="text-2xs font-medium text-text-secondary">Notes</p>
                    <ul className="space-y-0.5 text-2xs text-text-tertiary">
                      <li>• The first frame may take 3–10 s while the URL is resolved</li>
                      <li>• Live streams (Twitch, YouTube Live) have ~10–30 s of HLS buffer latency</li>
                      <li>• Private or subscriber-only content requires browser cookies (not supported)</li>
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {formError && (
            <p className="mt-3 text-xs text-danger-text">{formError}</p>
          )}
          <div className="flex gap-2 mt-4">
            <Button onClick={submit} disabled={loading || !form.name || (form.type === 'ip_camera' ? !ipCam.host : !form.uri)}>
              {loading ? 'Saving...' : 'Save source'}
            </Button>
            <Button variant="ghost" onClick={() => { setShowForm(false); setForm(INITIAL); setIpCam(INITIAL_IP); setFormError(null) }}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Table */}
      {sources.length === 0 ? (
        <Card>
          <div className="py-8 text-center">
            <p className="text-sm text-text-secondary">No sources yet</p>
            <p className="text-xs text-text-tertiary mt-1">
              Add a webcam, video file, RTSP stream, or any YouTube / Twitch URL
            </p>
          </div>
        </Card>
      ) : (
        <Card padding="none">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="px-5 py-2.5 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider">Name</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider">Type</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider">URI</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider">Status</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider">Test</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {sources.map((s, i) => {
                const platform = s.type === 'stream' ? detectPlatform(s.uri) : null
                return (
                  <Fragment key={s.id}>
                    <tr
                      className={i < sources.length - 1 ? 'border-b border-border-subtle' : ''}
                    >
                      <td className="px-5 py-3 text-sm text-text-primary font-medium">{s.name}</td>
                      <td className="px-5 py-3">
                        {platform ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                            style={{ background: `${platform.color}20`, color: platform.color }}
                          >
                            <span>{platform.icon}</span>
                            {platform.name}
                          </span>
                        ) : (
                          <Badge variant="neutral">{sourceTypeLabel[s.type as SourceType] ?? s.type}</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs font-mono text-text-tertiary max-w-xs truncate">
                        {s.uri}
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant={s.enabled ? 'success' : 'neutral'} dot>
                          {s.enabled ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-xs">
                        {testResult[s.id] ? (
                          <span className={testResult[s.id].ok ? 'text-success-text' : 'text-danger-text'}>
                            {testResult[s.id].msg}
                          </span>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <Button size="xs" variant="ghost" onClick={() => runTest(s)}>Test</Button>
                          <Button size="xs" variant="ghost" onClick={() => getPreview(s.id)}>Preview</Button>
                          <Button size="xs" variant="ghost" onClick={() => toggle(s)}>
                            {s.enabled ? 'Disable' : 'Enable'}
                          </Button>
                          <Button size="xs" variant="danger" onClick={() => remove(s.id)}>Delete</Button>
                        </div>
                      </td>
                    </tr>
                    {preview[s.id] && (
                      <tr key={`preview-${s.id}`} className="border-b border-border-subtle bg-bg-overlay">
                        <td colSpan={6} className="px-5 py-3">
                          <img
                            src={`data:image/jpeg;base64,${preview[s.id]}`}
                            alt="preview"
                            className="rounded max-h-52 object-contain border border-border-subtle"
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
