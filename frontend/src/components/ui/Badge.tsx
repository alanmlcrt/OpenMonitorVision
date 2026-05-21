import clsx from 'clsx'

interface Props {
  children: React.ReactNode
  variant?: 'success' | 'danger' | 'accent' | 'warning' | 'neutral'
  dot?: boolean
  className?: string
}

const variants = {
  success: 'bg-success-subtle text-success-text',
  danger:  'bg-danger-subtle text-danger-text',
  accent:  'bg-accent-subtle text-accent',
  warning: 'bg-warning-subtle text-warning-text',
  neutral: 'bg-bg-raised text-text-secondary',
}

const dots = {
  success: 'bg-success',
  danger:  'bg-danger-text',
  accent:  'bg-accent',
  warning: 'bg-warning',
  neutral: 'bg-text-tertiary',
}

export function Badge({ children, variant = 'neutral', dot = false, className }: Props) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-medium tracking-wide',
      variants[variant],
      className,
    )}>
      {dot && (
        <span className={clsx('inline-block w-1.5 h-1.5 rounded-full flex-shrink-0', dots[variant])} />
      )}
      {children}
    </span>
  )
}
