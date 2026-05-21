import clsx from 'clsx'

interface Props {
  children: React.ReactNode
  className?: string
  padding?: 'sm' | 'md' | 'none'
}

const paddings = {
  none: '',
  sm:   'p-3',
  md:   'p-5',
}

export function Card({ children, className, padding = 'md' }: Props) {
  return (
    <div className={clsx(
      'rounded-lg bg-bg-surface border border-border-subtle shadow-card',
      paddings[padding],
      className,
    )}>
      {children}
    </div>
  )
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('flex items-center justify-between mb-4', className)}>
      {children}
    </div>
  )
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-medium text-text-primary">{children}</h3>
}
