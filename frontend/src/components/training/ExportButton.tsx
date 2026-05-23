import { useState } from 'react'
import { Button } from '../ui/Button'
import { trainingApi } from '../../api/training'

type Format = 'onnx' | 'torchscript'

const LABELS: Record<Format, string> = {
  onnx:         'ONNX',
  torchscript:  'TorchScript',
}

export function ExportButton({ jobId }: { jobId: number }) {
  const [format, setFormat] = useState<Format>('onnx')
  const [busy, setBusy] = useState(false)
  const [doneFormat, setDoneFormat] = useState<Format | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await trainingApi.export(jobId, format)
      setDoneFormat(format)
    } catch (e: any) {
      setError(e?.message ?? 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={format}
        onChange={(e) => { setFormat(e.target.value as Format); setDoneFormat(null) }}
        className="h-7 rounded bg-bg-overlay border border-border px-2 text-xs text-text-primary cursor-pointer"
        disabled={busy}
      >
        {(Object.keys(LABELS) as Format[]).map((f) => (
          <option key={f} value={f}>{LABELS[f]}</option>
        ))}
      </select>
      <Button size="xs" variant="ghost" onClick={run} disabled={busy}>
        {busy ? 'Exporting…' : `Export ${LABELS[format]}`}
      </Button>
      {doneFormat === format && (
        <a
          href={trainingApi.exportDownloadUrl(jobId, format)}
          download
          className="text-2xs text-accent hover:underline"
        >
          Download .{format === 'torchscript' ? 'torchscript' : format}
        </a>
      )}
      {error && <span className="text-2xs text-danger-text">{error}</span>}
    </div>
  )
}
