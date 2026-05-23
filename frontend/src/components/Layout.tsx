import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import clsx from 'clsx'
import { workflowsApi } from '../api/workflows'

const nav = [
  { to: '/',          label: 'Overview',   end: true  },
  { to: '/sources',   label: 'Sources',    end: false },
  { to: '/workflows', label: 'Workflows',  end: false },
  { to: '/live',      label: 'Live',       end: false },
  { to: '/events',    label: 'Events',     end: false },
  { to: '/satellite', label: 'Satellite',  end: false },
  { to: '/models',    label: 'Models',     end: false },
  { to: '/training',  label: 'Training',   end: false },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const [anyRunning, setAnyRunning] = useState(false)

  useEffect(() => {
    const poll = () =>
      workflowsApi.runningIds().then((r) => setAnyRunning(r.ids.length > 0)).catch(() => {})
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-base">
      <aside className="w-52 flex-shrink-0 flex flex-col border-r border-border-subtle">
        {/* Logo */}
        <div className="h-12 flex items-center px-4 border-b border-border-subtle">
          <div className="flex items-center gap-2.5">
            <div className="w-5 h-5 rounded bg-accent/20 flex items-center justify-center flex-shrink-0">
              <div className="w-2 h-2 rounded-sm bg-accent" />
            </div>
            <span className="text-sm font-semibold text-text-primary tracking-tight">
              OpenMonitorVision
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-2 space-y-px overflow-y-auto">
          <p className="px-2 pt-1 pb-2 text-2xs font-semibold uppercase tracking-widest text-text-disabled">
            Navigation
          </p>
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center h-8 px-2.5 rounded text-sm transition-colors duration-100',
                  isActive
                    ? 'bg-accent-subtle text-accent font-medium'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-overlay',
                )
              }
            >
              <span className="flex-1">{item.label}</span>
              {item.to === '/workflows' && anyRunning && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border-subtle">
          <p className="text-2xs text-text-disabled">Local Vision Platform</p>
        </div>
      </aside>

      <main className="h-full flex-1 min-w-0 overflow-y-auto bg-bg-base">
        {children}
      </main>
    </div>
  )
}
