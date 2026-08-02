import type { Reminder, ReminderSchedule } from '../db/schema'

export function isDue(r: Reminder, now: Date): boolean {
  if (!r.enabled) return false
  if (r.snoozedUntil && new Date(r.snoozedUntil) > now) return false
  return new Date(r.nextDue) <= now
}

/**
 * Next due datetime (ISO) strictly after `after`, honoring the schedule.
 * Pure function — unit-testable, no Date.now() inside.
 */
export function computeNextDue(schedule: ReminderSchedule, after: Date): string {
  const [h, m] = schedule.time.split(':').map(Number)

  const at = (d: Date): Date => {
    const x = new Date(d)
    x.setHours(h, m, 0, 0)
    return x
  }

  let candidate = at(after)
  if (candidate <= after) {
    candidate.setDate(candidate.getDate() + 1)
  }

  switch (schedule.freq) {
    case 'once':
    case 'daily':
      return candidate.toISOString()

    case 'every_n_days': {
      const n = Math.max(1, schedule.n ?? 1)
      // First occurrence at/after `after` on the n-day grid anchored today.
      const base = at(after)
      if (base > after) return base.toISOString()
      base.setDate(base.getDate() + n)
      return base.toISOString()
    }

    case 'weekly': {
      const days = (schedule.daysOfWeek?.length ? schedule.daysOfWeek : [candidate.getDay()]).sort()
      for (let i = 0; i < 8; i++) {
        const probe = at(after)
        probe.setDate(probe.getDate() + i)
        if (probe > after && days.includes(probe.getDay())) return probe.toISOString()
      }
      return candidate.toISOString()
    }

    case 'monthly': {
      const dom = schedule.dayOfMonth ?? 1
      const probe = new Date(after)
      probe.setHours(h, m, 0, 0)
      probe.setDate(Math.min(dom, daysInMonth(probe)))
      if (probe <= after) {
        probe.setDate(1)
        probe.setMonth(probe.getMonth() + 1)
        probe.setDate(Math.min(dom, daysInMonth(probe)))
        probe.setHours(h, m, 0, 0)
      }
      return probe.toISOString()
    }
  }
}

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

/**
 * Next due AFTER completing the task today. Anchors past end-of-today so a
 * task done at 07:30 can never re-arm for 08:00 the same day (which would
 * collapse an every-N-days cycle to under an hour).
 */
export function computeNextAfterDone(schedule: ReminderSchedule, now: Date): string {
  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)
  return computeNextDue(schedule, endOfToday)
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function describeSchedule(s: ReminderSchedule): string {
  switch (s.freq) {
    case 'once':
      return `Once at ${s.time}`
    case 'daily':
      return `Daily at ${s.time}`
    case 'every_n_days':
      return `Every ${s.n ?? 1} days at ${s.time}`
    case 'weekly': {
      const days = (s.daysOfWeek ?? []).map((d) => DAY_NAMES[d]).join(', ')
      return `${days || 'Weekly'} at ${s.time}`
    }
    case 'monthly':
      return `Monthly on day ${s.dayOfMonth ?? 1} at ${s.time}`
  }
}
