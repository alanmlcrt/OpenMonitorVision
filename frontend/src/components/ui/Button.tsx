import clsx from 'clsx'

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'xs' | 'sm' | 'md'
}

const variants = {
  primary:   'bg-accent hover:bg-accent-hover text-white font-medium shadow-sm',
  secondary: 'bg-bg-raised hover:bg-bg-muted text-text-primary border border-border font-medium',
  ghost:     'hover:bg-bg-overlay text-text-secondary hover:text-text-primary',
  danger:    'bg-danger-subtle hover:bg-danger/20 text-danger-text border border-danger/20 font-medium',
}

const sizes = {
  xs: 'h-6 px-2 text-xs rounded',
  sm: 'h-7 px-3 text-sm rounded',
  md: 'h-8 px-4 text-sm rounded-md',
}

export function Button({ variant = 'primary', size = 'md', className, children, ...props }: Props) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 transition-colors duration-100',
        'disabled:opacity-40 disabled:cursor-not-allowed select-none whitespace-nowrap',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
