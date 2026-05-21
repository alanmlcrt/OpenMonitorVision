interface Props {
  label: string
  value: string | number
  sub?: string
}

export function Stat({ label, value, sub }: Props) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-text-secondary font-medium">{label}</p>
      <p className="text-2xl font-semibold text-text-primary tracking-tight">{value}</p>
      {sub && <p className="text-xs text-text-tertiary">{sub}</p>}
    </div>
  )
}
