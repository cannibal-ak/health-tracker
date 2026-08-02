import { useEffect, useState } from 'react'
import type { Intensity, Workout, WorkoutExercise, WorkoutType } from '../../db/schema'
import { addWorkout, updateWorkout } from '../../db/repo'
import { todayISO } from '../../lib/dates'
import { Field, PrimaryButton, Segmented, TextInput } from '../../ui/Field'
import { TrashIcon, PlusIcon } from '../../ui/Icons'
import { WORKOUT_TYPES } from './workoutMeta'

interface ExerciseRow {
  name: string
  sets: string
  reps: string
  weight: string
}

const emptyRow: ExerciseRow = { name: '', sets: '', reps: '', weight: '' }

function toRows(exercises?: WorkoutExercise[]): ExerciseRow[] {
  if (!exercises?.length) return [{ ...emptyRow }]
  return exercises.map((e) => ({
    name: e.name,
    sets: e.sets?.toString() ?? '',
    reps: e.reps?.toString() ?? '',
    weight: e.weightKg?.toString() ?? '',
  }))
}

function fromRows(rows: ExerciseRow[]): WorkoutExercise[] {
  return rows
    .filter((r) => r.name.trim())
    .map((r) => ({
      name: r.name.trim(),
      sets: parseInt(r.sets, 10) || undefined,
      reps: parseInt(r.reps, 10) || undefined,
      weightKg: parseFloat(r.weight) || undefined,
    }))
}

export function WorkoutForm({
  existing,
  lastGym,
  onSaved,
}: {
  /** When set, the form edits this workout instead of creating one. */
  existing?: Workout
  /** Most recent gym workout, offered as a "repeat" template. */
  lastGym?: Workout
  onSaved: () => void
}) {
  const [type, setType] = useState<WorkoutType>(existing?.type ?? 'gym')
  const [date, setDate] = useState(existing?.date ?? todayISO())
  const [title, setTitle] = useState(existing?.title ?? '')
  const [duration, setDuration] = useState(existing?.durationMin?.toString() ?? '')
  const [distance, setDistance] = useState(existing?.distanceKm?.toString() ?? '')
  const [sport, setSport] = useState(existing?.sport ?? '')
  const [intensity, setIntensity] = useState<Intensity | ''>(existing?.intensity ?? '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [rows, setRows] = useState<ExerciseRow[]>(toRows(existing?.exercises))

  // Reset when switching between add/edit targets.
  useEffect(() => {
    setType(existing?.type ?? 'gym')
    setDate(existing?.date ?? todayISO())
    setTitle(existing?.title ?? '')
    setDuration(existing?.durationMin?.toString() ?? '')
    setDistance(existing?.distanceKm?.toString() ?? '')
    setSport(existing?.sport ?? '')
    setIntensity(existing?.intensity ?? '')
    setNote(existing?.note ?? '')
    setRows(toRows(existing?.exercises))
  }, [existing])

  const setRow = (i: number, patch: Partial<ExerciseRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const [saving, setSaving] = useState(false)

  // Per-type validity: only fields the current type actually shows count.
  const valid = (() => {
    switch (type) {
      case 'gym':
        return fromRows(rows).length > 0 || Boolean(title.trim())
      case 'sport':
        return sport.trim().length > 0
      case 'run':
      case 'walk':
        return Boolean(parseFloat(distance) || parseInt(duration, 10))
      case 'other':
        return Boolean(title.trim())
    }
  })()

  const save = async () => {
    if (saving) return
    const data = {
      date,
      type,
      title: title.trim() || undefined,
      durationMin: parseInt(duration, 10) || undefined,
      exercises: type === 'gym' ? fromRows(rows) : undefined,
      distanceKm: type === 'run' || type === 'walk' ? parseFloat(distance) || undefined : undefined,
      sport: type === 'sport' ? sport.trim() || undefined : undefined,
      intensity: intensity || undefined,
      note: note.trim() || undefined,
    }
    setSaving(true)
    try {
      if (existing) await updateWorkout(existing.id, data)
      else await addWorkout(data)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Field label="Type">
        <div className="grid grid-cols-5 gap-1.5">
          {WORKOUT_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setType(t.value)}
              className={`flex flex-col items-center gap-0.5 rounded-xl border px-1 py-2 text-xs font-medium ${
                type === t.value
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                  : 'border-slate-200 text-slate-500 dark:border-slate-700'
              }`}
            >
              <span className="text-lg">{t.emoji}</span>
              {t.label}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <TextInput
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Duration (min)">
          <TextInput
            type="number"
            inputMode="numeric"
            min="1"
            placeholder="45"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </Field>
      </div>

      {type === 'gym' && (
        <>
          <Field label="Session name (optional)">
            <TextInput
              type="text"
              placeholder="e.g. Chest + triceps"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Exercises
            </span>
            {!existing && lastGym?.exercises?.length ? (
              <button
                type="button"
                className="text-xs font-semibold text-brand-600"
                onClick={() => {
                  setRows(toRows(lastGym.exercises))
                  if (lastGym.title) setTitle(lastGym.title)
                }}
              >
                Repeat last session
              </button>
            ) : null}
          </div>
          <div className="mb-2 space-y-2">
            <div className="grid grid-cols-[1fr_52px_52px_64px_28px] gap-1.5 px-1 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
              <span>Exercise</span>
              <span>Sets</span>
              <span>Reps</span>
              <span>Kg</span>
              <span />
            </div>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_52px_52px_64px_28px] items-center gap-1.5">
                <TextInput
                  type="text"
                  placeholder="Bench press"
                  value={r.name}
                  onChange={(e) => setRow(i, { name: e.target.value })}
                  className="!px-2.5 !py-2 !text-sm"
                />
                <TextInput
                  type="number"
                  inputMode="numeric"
                  placeholder="3"
                  value={r.sets}
                  onChange={(e) => setRow(i, { sets: e.target.value })}
                  className="!px-2 !py-2 !text-center !text-sm"
                />
                <TextInput
                  type="number"
                  inputMode="numeric"
                  placeholder="10"
                  value={r.reps}
                  onChange={(e) => setRow(i, { reps: e.target.value })}
                  className="!px-2 !py-2 !text-center !text-sm"
                />
                <TextInput
                  type="number"
                  inputMode="decimal"
                  placeholder="40"
                  value={r.weight}
                  onChange={(e) => setRow(i, { weight: e.target.value })}
                  className="!px-2 !py-2 !text-center !text-sm"
                />
                <button
                  type="button"
                  aria-label="Remove exercise"
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  className="p-1 text-slate-300 hover:text-red-500 dark:text-slate-600"
                >
                  <TrashIcon className="size-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRows((rs) => [...rs, { ...emptyRow }])}
              className="flex items-center gap-1 text-sm font-semibold text-brand-600"
            >
              <PlusIcon className="size-4" /> Add exercise
            </button>
          </div>
        </>
      )}

      {(type === 'run' || type === 'walk') && (
        <Field label="Distance (km)">
          <TextInput
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            placeholder="5.0"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
          />
        </Field>
      )}

      {type === 'sport' && (
        <Field label="Sport">
          <TextInput
            type="text"
            placeholder="e.g. Badminton, cricket, football"
            value={sport}
            onChange={(e) => setSport(e.target.value)}
          />
        </Field>
      )}

      {type === 'other' && (
        <Field label="What did you do?">
          <TextInput
            type="text"
            placeholder="e.g. Yoga, cycling, swimming"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
      )}

      <Field label="Intensity">
        <Segmented
          value={intensity || 'none'}
          onChange={(v) => setIntensity(v === 'none' ? '' : (v as Intensity))}
          options={[
            { value: 'none', label: '—' },
            { value: 'light', label: 'Light' },
            { value: 'moderate', label: 'Moderate' },
            { value: 'hard', label: 'Hard' },
          ]}
        />
      </Field>

      <Field label="Note (optional)">
        <TextInput
          type="text"
          placeholder="How did it feel?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>

      <PrimaryButton onClick={save} disabled={saving || !valid || !date || date > todayISO()}>
        {saving ? 'Saving…' : existing ? 'Save changes' : 'Save workout'}
      </PrimaryButton>
    </div>
  )
}
