import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'

const MAX_LINES = 1000

export function LogPanel({
  jobId,
  liveLine,
  reloadKey,
}: {
  jobId: number
  liveLine: string | null     // most recent WS log line, parent passes it in
  reloadKey: number           // bump to force re-fetch (e.g. after status change)
}) {
  const [lines, setLines] = useState<string[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [loading, setLoading] = useState(true)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Initial / on-demand history fetch
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.get<{ lines: string[] }>(`/training/${jobId}/log?tail=500`)
      .then((d) => { if (!cancelled) setLines(d.lines ?? []) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [jobId, reloadKey])

  // Append a single line on every push from the WS
  useEffect(() => {
    if (liveLine == null) return
    setLines((prev) => {
      const next = prev.length >= MAX_LINES
        ? [...prev.slice(prev.length - MAX_LINES + 1), liveLine]
        : [...prev, liveLine]
      return next
    })
  }, [liveLine])

  // Auto-scroll to bottom
  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [lines, autoScroll])

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    setAutoScroll(nearBottom)
  }

  return (
    <div className="rounded border border-border-subtle bg-bg-base">
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-1.5">
        <p className="text-2xs uppercase tracking-wider text-text-disabled">
          Logs · {lines.length} line{lines.length !== 1 ? 's' : ''}
        </p>
        <div className="flex items-center gap-3 text-2xs text-text-tertiary">
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-accent"
            />
            <span>Follow</span>
          </label>
          <button
            type="button"
            onClick={() => setLines([])}
            className="hover:text-text-secondary"
          >
            Clear view
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-48 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-text-secondary"
      >
        {loading && lines.length === 0 ? (
          <p className="text-text-tertiary">Loading…</p>
        ) : lines.length === 0 ? (
          <p className="text-text-tertiary">No logs yet.</p>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
