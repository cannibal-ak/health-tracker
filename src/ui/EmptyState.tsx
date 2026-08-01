import type { ReactNode } from 'react'

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode
  title: string
  message: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      {icon && <div className="mb-1 text-slate-300 dark:text-slate-600">{icon}</div>}
      <p className="font-semibold">{title}</p>
      <p className="max-w-xs text-sm text-slate-500 dark:text-slate-400">{message}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
