import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Reminder, ReminderSchedule } from '../../db/schema'
import { addReminder, deleteReminder, liveReminders, updateReminder } from '../../db/repo'
import { computeNextAfterDone, computeNextDue, describeSchedule } from '../../lib/reminderSchedule'
import { shareReminderIcs } from '../../lib/ics'
import { Card } from '../../ui/Card'
import { Sheet } from '../../ui/Sheet'
import { EmptyState } from '../../ui/EmptyState'
import { Field, PrimaryButton, Segmented, TextInput } from '../../ui/Field'
import { PlusIcon, ShareIcon, TrashIcon } from '../../ui/Icons'

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export async function markReminderDone(r: Reminder): Promise<void> {
  if (r.schedule.freq === 'once') {
    await updateReminder(r.id, { enabled: false, lastDone: new Date().toISOString() })
  } else {
    await updateReminder(r.id, {
      lastDone: new Date().toISOString(),
      // Done today = covered today; advance to the next occurrence AFTER today.
      nextDue: computeNextAfterDone(r.schedule, new Date()),
      snoozedUntil: undefined,
    })
  }
}

export async function snoozeReminder(r: Reminder, hours = 3): Promise<void> {
  await updateReminder(r.id, {
    snoozedUntil: new Date(Date.now() + hours * 3600_000).toISOString(),
  })
}

function dueLabel(r: Reminder): string {
  const due = new Date(r.nextDue)
  const now = new Date()
  if (due <= now) return 'Due now'
  const mins = Math.max(1, Math.round((due.getTime() - now.getTime()) / 60000))
  if (mins < 60) return `in ${mins} min`
  if (mins < 60 * 24) return `in ${Math.round(mins / 60)} h`
  return due.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

export function RemindersPage() {
  const reminders = useLiveQuery(liveReminders)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<Reminder | null>(null)

  // Form state
  const [title, setTitle] = useState('')
  const [freq, setFreq] = useState<ReminderSchedule['freq']>('daily')
  const [time, setTime] = useState('08:00')
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 3, 5])
  const [dayOfMonth, setDayOfMonth] = useState('1')
  const [everyN, setEveryN] = useState('2')
  const [saving, setSaving] = useState(false)

  if (!reminders) return null

  const openAdd = () => {
    setEditing(null)
    setTitle('')
    setFreq('daily')
    setTime('08:00')
    setDaysOfWeek([1, 3, 5])
    setDayOfMonth('1')
    setEveryN('2')
    setSheetOpen(true)
  }

  const openEdit = (r: Reminder) => {
    setEditing(r)
    setTitle(r.title)
    setFreq(r.schedule.freq)
    setTime(r.schedule.time)
    setDaysOfWeek(r.schedule.daysOfWeek ?? [1, 3, 5])
    setDayOfMonth(String(r.schedule.dayOfMonth ?? 1))
    setEveryN(String(r.schedule.n ?? 2))
    setSheetOpen(true)
  }

  const save = async () => {
    if (saving || !title.trim() || !/^\d{2}:\d{2}$/.test(time)) return
    const schedule: ReminderSchedule = {
      freq,
      time,
      daysOfWeek: freq === 'weekly' ? daysOfWeek : undefined,
      dayOfMonth: freq === 'monthly' ? Math.min(31, Math.max(1, parseInt(dayOfMonth, 10) || 1)) : undefined,
      n: freq === 'every_n_days' ? Math.max(1, parseInt(everyN, 10) || 1) : undefined,
    }
    if (freq === 'weekly' && daysOfWeek.length === 0) return
    setSaving(true)
    try {
      if (editing) {
        // Recompute nextDue only when the schedule actually changed — a
        // title-only edit must not dismiss a currently-due occurrence.
        const scheduleChanged = JSON.stringify(schedule) !== JSON.stringify(editing.schedule)
        await updateReminder(editing.id, {
          title: title.trim(),
          schedule,
          ...(scheduleChanged
            ? { nextDue: computeNextDue(schedule, new Date()), snoozedUntil: undefined }
            : {}),
          // Preserve the on/off state — editing must not silently re-enable.
          enabled: editing.enabled,
        })
      } else {
        await addReminder({
          title: title.trim(),
          schedule,
          nextDue: computeNextDue(schedule, new Date()),
          enabled: true,
        })
      }
      setSheetOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="py-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reminders</h1>
        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 rounded-full bg-brand-600 py-2 pr-4 pl-3 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <PlusIcon className="size-4" /> New
        </button>
      </div>

      <p className="mb-4 rounded-xl bg-slate-100 p-3 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        This app can't wake your phone on its own — due reminders appear when you open it. For
        alarm-style alerts, tap <ShareIcon className="inline size-3.5 align-text-top" /> on a
        reminder to add it to your phone's calendar.
      </p>

      {reminders.length === 0 ? (
        <Card>
          <EmptyState
            title="No reminders yet"
            message="Log weight weekly, drink water, book your next checkup — set gentle nudges for the things that keep you on track."
            action={
              <button
                onClick={openAdd}
                className="rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-700"
              >
                Create your first reminder
              </button>
            }
          />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {reminders.map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-3">
                <button className="min-w-0 flex-1 text-left" onClick={() => openEdit(r)}>
                  <span className={`block truncate font-semibold ${r.enabled ? '' : 'text-slate-400 line-through'}`}>
                    {r.title}
                  </span>
                  <span className="text-xs text-slate-500">
                    {describeSchedule(r.schedule)}
                    {r.enabled ? ` · ${dueLabel(r)}` : ' · off'}
                  </span>
                </button>
                <button
                  aria-label={`Toggle ${r.title}`}
                  onClick={() => void updateReminder(r.id, { enabled: !r.enabled })}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    r.enabled
                      ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
                      : 'bg-slate-100 text-slate-400 dark:bg-slate-800'
                  }`}
                >
                  {r.enabled ? 'On' : 'Off'}
                </button>
                <button
                  aria-label={`Add ${r.title} to calendar`}
                  onClick={() => void shareReminderIcs(r)}
                  className="rounded-full p-2 text-slate-400 hover:text-brand-600"
                >
                  <ShareIcon className="size-4" />
                </button>
                <button
                  aria-label={`Delete ${r.title}`}
                  onClick={() => {
                    if (confirm(`Delete reminder "${r.title}"?`)) void deleteReminder(r.id)
                  }}
                  className="rounded-full p-2 text-slate-400 hover:text-red-600"
                >
                  <TrashIcon className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={editing ? 'Edit reminder' : 'New reminder'}
      >
        <Field label="What should we remind you about?">
          <TextInput
            type="text"
            placeholder="e.g. Log your weight"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus={!editing}
          />
        </Field>
        <Field label="Repeat">
          <Segmented
            value={freq}
            onChange={setFreq}
            options={[
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'every_n_days', label: 'Every N' },
              { value: 'monthly', label: 'Monthly' },
            ]}
          />
        </Field>
        {freq === 'weekly' && (
          <Field label="On days">
            <div className="flex gap-1">
              {DAY_LABELS.map((d, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() =>
                    setDaysOfWeek((ds) =>
                      ds.includes(i) ? ds.filter((x) => x !== i) : [...ds, i].sort(),
                    )
                  }
                  className={`size-9 rounded-full text-sm font-semibold ${
                    daysOfWeek.includes(i)
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </Field>
        )}
        {freq === 'every_n_days' && (
          <Field label="Every how many days?">
            <TextInput
              type="number"
              inputMode="numeric"
              min="1"
              max="90"
              value={everyN}
              onChange={(e) => setEveryN(e.target.value)}
            />
          </Field>
        )}
        {freq === 'monthly' && (
          <Field label="Day of month">
            <TextInput
              type="number"
              inputMode="numeric"
              min="1"
              max="31"
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(e.target.value)}
            />
          </Field>
        )}
        <Field label="At time">
          <TextInput type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <PrimaryButton
          onClick={save}
          disabled={saving || !title.trim() || (freq === 'weekly' && daysOfWeek.length === 0)}
        >
          {saving ? 'Saving…' : 'Save reminder'}
        </PrimaryButton>
      </Sheet>
    </div>
  )
}
