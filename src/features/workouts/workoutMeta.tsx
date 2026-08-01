import type { WorkoutType, Workout } from '../../db/schema'

export const WORKOUT_TYPES: { value: WorkoutType; label: string; emoji: string }[] = [
  { value: 'gym', label: 'Gym', emoji: '🏋️' },
  { value: 'run', label: 'Run', emoji: '🏃' },
  { value: 'sport', label: 'Sport', emoji: '🏸' },
  { value: 'walk', label: 'Walk', emoji: '🚶' },
  { value: 'other', label: 'Other', emoji: '💪' },
]

export const TYPE_META = Object.fromEntries(WORKOUT_TYPES.map((t) => [t.value, t])) as Record<
  WorkoutType,
  (typeof WORKOUT_TYPES)[number]
>

/** One-line human summary, e.g. "5 exercises · 45 min" or "5.2 km · 32 min". */
export function workoutSummary(w: Workout): string {
  const parts: string[] = []
  if (w.type === 'gym' && w.exercises?.length) {
    parts.push(`${w.exercises.length} exercise${w.exercises.length > 1 ? 's' : ''}`)
  }
  if ((w.type === 'run' || w.type === 'walk') && w.distanceKm) {
    parts.push(`${w.distanceKm} km`)
  }
  if (w.type === 'sport' && w.sport) parts.push(w.sport)
  if (w.durationMin) parts.push(`${w.durationMin} min`)
  if (w.intensity) parts.push(w.intensity)
  return parts.join(' · ')
}

/** Display name for a workout: explicit title, else derived from type. */
export function workoutTitle(w: Workout): string {
  if (w.title) return w.title
  if (w.type === 'sport' && w.sport) return w.sport
  return TYPE_META[w.type].label
}
