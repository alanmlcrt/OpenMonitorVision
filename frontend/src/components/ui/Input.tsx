import clsx from 'clsx'

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
}

export function Input({ label, hint, error, className, id, ...props }: Props) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-text-secondary">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={clsx(
          'h-8 w-full rounded bg-bg-overlay border px-3 text-sm text-text-primary',
          'placeholder:text-text-tertiary',
          'transition-colors duration-100',
          'focus:outline-none focus:ring-2 focus:ring-accent-ring focus:border-accent/50',
          error
            ? 'border-danger/50 focus:ring-danger/20'
            : 'border-border hover:border-border-strong',
          className,
        )}
        {...props}
      />
      {hint && !error && <p className="text-xs text-text-tertiary">{hint}</p>}
      {error && <p className="text-xs text-danger-text">{error}</p>}
    </div>
  )
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
}

export function Select({ label, id, className, children, ...props }: SelectProps) {
  const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={selectId} className="text-xs font-medium text-text-secondary">
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={clsx(
          'h-8 w-full rounded bg-bg-overlay border border-border px-3 text-sm text-text-primary',
          'focus:outline-none focus:ring-2 focus:ring-accent-ring focus:border-accent/50',
          'hover:border-border-strong transition-colors duration-100',
          'cursor-pointer',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    </div>
  )
}
