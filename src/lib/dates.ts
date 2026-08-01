import type { ISODate } from '../db/schema'

/** Today's local calendar date as 'YYYY-MM-DD'. */
export function todayISO(): ISODate {
  return toISODate(new Date())
}

export function toISODate(d: Date): ISODate {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parse 'YYYY-MM-DD' as a local-time Date at midnight. */
export function fromISODate(date: ISODate): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = fromISODate(date)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

/** 'Mon 14 Jul' style short label. */
export function shortDate(date: ISODate): string {
  return fromISODate(date).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
}

export function fullDate(date: ISODate): string {
  return fromISODate(date).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Monday of the week containing `date` (fitness weeks start Monday). */
export function startOfWeek(date: ISODate): ISODate {
  const d = fromISODate(date)
  const day = (d.getDay() + 6) % 7 // Mon=0 … Sun=6
  d.setDate(d.getDate() - day)
  return toISODate(d)
}
