import { useEffect, useState } from 'react'
import { sourcesApi } from '../api/sources'
import type { Source, SourceType } from '../types'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'

type Form = { name: string; type: SourceType; uri: string }
const INITIAL: Form = { name: '', type: 'webcam', uri: '0' }

const sourceTypeLabel: Record<SourceType, string> = {
  webcam: 'Webcam',
  video:  'Video file',
  rtsp:   'RTSP stream',
  image:  'Image',
}

const uriPlaceholder: Record<SourceType, string> = {
  webcam: '0',
  video:  '/path/to/video.mp4',
  rtsp:   'rtsp://user:pass@192.168.1.1/stream',
  image:  '/path/to/image.jpg',
}

export function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<Form>(INITIAL)
  const [preview, setPreview] = useState<Record<number, string>>({})
  const [testResult, setTestResult] = useState<Record<number, { ok: boolean; msg: string }>>({})
  const [loading, setLoading] = useState(false)

  const load = () => sourcesApi.list().then(setSources).catch(() => {})

  useEffect(() => { load() }, [])

  const submit = async () => {
    setLoading(true)
    try {
      await sourcesApi.create({ ...form, enabled: true })
      setForm(INITIAL)
      setShowForm(false)
      load()
    } catch (e: any) {
      alert(e.message)
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
        ? { ok: true, msg: `${res.width} x ${res.height}` }
        : { ok: false, msg: res.error || 'Connection failed' },
    }))
  }

  return (
    <div className="p-6 space-y-5 max-w-4xl">
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
              onChange={(e) => setForm({ ...form, type: e.target.value as SourceType, uri: uriPlaceholder[e.target.value as SourceType] })}
            >
              {(Object.keys(sourceTypeLabel) as SourceType[]).map((t) => (
                <option key={t} value={t}>{sourceTypeLabel[t]}</option>
              ))}
            </Select>
            <div className="col-span-2">
              <Input
                label={form.type === 'webcam' ? 'Device index' : 'URI / path'}
                value={form.uri}
                onChange={(e) => setForm({ ...form, uri: e.target.value })}
                placeholder={uriPlaceholder[form.type]}
                className="font-mono"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <Button onClick={submit} disabled={loading || !form.name || !form.uri}>
              {loading ? 'Saving...' : 'Save source'}
            </Button>
            <Button variant="ghost" onClick={() => { setShowForm(false); setForm(INITIAL) }}>
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
            <p className="text-xs text-text-tertiary mt-1">Add a webcam, video file or RTSP stream to get started</p>
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
              {sources.map((s, i) => (
                <>
                  <tr
                    key={s.id}
                    className={i < sources.length - 1 ? 'border-b border-border-subtle' : ''}
                  >
                    <td className="px-5 py-3 text-sm text-text-primary font-medium">{s.name}</td>
                    <td className="px-5 py-3">
                      <Badge variant="neutral">{sourceTypeLabel[s.type as SourceType]}</Badge>
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
                </>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
