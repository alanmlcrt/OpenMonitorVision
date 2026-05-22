import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { YoloModel } from '../types'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'

export function ModelsPage() {
  const [models, setModels] = useState<YoloModel[]>([])
  const [name, setName] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () => api.get<YoloModel[]>('/models').then(setModels).catch(() => {})

  useEffect(() => { load() }, [])

  const upload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) return
    const displayName = name.trim() || file.name
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch(`/api/models?name=${encodeURIComponent(displayName)}`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) throw new Error(await res.text())
      setName('')
      if (fileRef.current) fileRef.current.value = ''
      load()
    } catch (e: any) {
      alert(e.message)
    } finally {
      setUploading(false)
    }
  }

  const remove = async (id: number) => {
    if (!confirm('Delete this model?')) return
    await api.delete(`/models/${id}`)
    load()
  }

  return (
    <div className="w-full p-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Models</h1>
        <p className="text-sm text-text-secondary mt-0.5">Manage YOLO model weights</p>
      </div>

      {/* Upload */}
      <Card>
        <h3 className="text-sm font-medium text-text-primary mb-4">Upload model</h3>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Display name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="YOLOv8n custom"
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">File (.pt)</label>
            <input
              ref={fileRef}
              type="file"
              accept=".pt,.onnx"
              className="h-8 text-xs text-text-secondary file:mr-3 file:h-8 file:rounded file:border-0 file:bg-bg-raised file:px-3 file:text-xs file:text-text-primary file:cursor-pointer file:transition-colors hover:file:bg-bg-muted"
            />
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={upload} disabled={uploading}>
            {uploading ? 'Uploading...' : 'Upload'}
          </Button>
        </div>
      </Card>

      {/* Model list */}
      <Card padding="none">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="px-5 py-2.5 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider">Name</th>
              <th className="px-5 py-2.5 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider">File</th>
              <th className="px-5 py-2.5 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider">Default</th>
              <th className="px-5 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {/* Built-in */}
            <tr className="border-b border-border-subtle">
              <td className="px-5 py-3 text-sm text-text-primary">YOLOv8n</td>
              <td className="px-5 py-3 text-xs font-mono text-text-tertiary">yolov8n.pt</td>
              <td className="px-5 py-3">
                <Badge variant="accent">Built-in</Badge>
              </td>
              <td className="px-5 py-3" />
            </tr>

            {models.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-sm text-text-tertiary">
                  No custom models uploaded
                </td>
              </tr>
            )}

            {models.map((m, i) => (
              <tr
                key={m.id}
                className={i < models.length - 1 ? 'border-b border-border-subtle' : ''}
              >
                <td className="px-5 py-3 text-sm text-text-primary">{m.name}</td>
                <td className="px-5 py-3 text-xs font-mono text-text-tertiary">{m.filename}</td>
                <td className="px-5 py-3">
                  {m.is_default && <Badge variant="success">Default</Badge>}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button size="xs" variant="danger" onClick={() => remove(m.id)}>Delete</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="text-xs text-text-tertiary">
        Models are stored in <code className="font-mono bg-bg-overlay px-1 py-0.5 rounded">backend/data/models/</code>.
        Use the model path in the YOLO Detect node config.
      </p>
    </div>
  )
}
