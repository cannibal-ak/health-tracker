import type { Reminder } from '../db/schema'

/** RRULE fragment for the reminder's schedule (empty for one-off). */
function rrule(r: Reminder): string {
  const s = r.schedule
  const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
  switch (s.freq) {
    case 'daily':
      return 'RRULE:FREQ=DAILY'
    case 'every_n_days':
      return `RRULE:FREQ=DAILY;INTERVAL=${Math.max(1, s.n ?? 1)}`
    case 'weekly': {
      const days = (s.daysOfWeek ?? []).map((d) => BYDAY[d]).join(',')
      return days ? `RRULE:FREQ=WEEKLY;BYDAY=${days}` : 'RRULE:FREQ=WEEKLY'
    }
    case 'monthly':
      return `RRULE:FREQ=MONTHLY;BYMONTHDAY=${s.dayOfMonth ?? 1}`
    case 'once':
      return ''
  }
}

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * A calendar event with an alarm — the escape hatch for real OS-level
 * notifications, which a serverless PWA cannot schedule on its own.
 */
export function reminderToIcs(r: Reminder): string {
  const start = new Date(r.nextDue)
  const rule = rrule(r)
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Health Tracker//EN',
    'BEGIN:VEVENT',
    `UID:ht-${r.id}@health-tracker`,
    `DTSTAMP:${icsStamp(new Date(start))}`,
    `DTSTART:${icsStamp(start)}`,
    `SUMMARY:${r.title.replace(/[\n,;]/g, ' ')}`,
    ...(rule ? [rule] : []),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${r.title.replace(/[\n,;]/g, ' ')}`,
    'TRIGGER:PT0S',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

/** Share the .ics via the OS share sheet (iOS-friendly); download fallback. */
export async function shareReminderIcs(r: Reminder): Promise<void> {
  const file = new File([reminderToIcs(r)], `${r.title.slice(0, 30) || 'reminder'}.ics`, {
    type: 'text/calendar',
  })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: r.title })
      return
    } catch {
      // fall through to download (user may have cancelled — harmless)
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
