import type { MetricFlag } from '../../db/schema'

const STYLES: Record<MetricFlag, string> = {
  normal: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  low: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  high: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  unknown: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
}

const LABELS: Record<MetricFlag, string> = {
  normal: 'Normal',
  low: 'Low',
  high: 'High',
  unknown: 'No range',
}

export function FlagChip({ flag }: { flag: MetricFlag }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STYLES[flag]}`}
    >
      {LABELS[flag]}
    </span>
  )
}
