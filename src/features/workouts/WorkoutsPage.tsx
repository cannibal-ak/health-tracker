import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Workout } from '../../db/schema'
import { deleteWorkout, liveWorkouts } from '../../db/repo'
import { addDays, fullDate, shortDate, startOfWeek, todayISO } from '../../lib/dates'
import { Card, CardTitle } from '../../ui/Card'
import { Sheet } from '../../ui/Sheet'
import { EmptyState } from '../../ui/EmptyState'
import { DumbbellIcon, PlusIcon, TrashIcon } from '../../ui/Icons'
import { WorkoutForm } from './WorkoutForm'
import { TYPE_META, workoutSummary, workoutTitle } from './workoutMeta'

const SERIES = '#0d9488'
const AXIS_INK = '#64748b'

interface WeekPoint {
  week: string // Monday ISO date
  count: number
}

function WeeklyChart({ workouts }: { workouts: Workout[] }) {
  const data: WeekPoint[] = useMemo(() => {
    const thisWeek = startOfWeek(todayISO())
    const weeks: WeekPoint[] = []
    for (let i = 7; i >= 0; i--) {
      weeks.push({ week: addDays(thisWeek, -7 * i), count: 0 })
    }
    const index = new Map(weeks.map((w) => [w.week, w]))
    for (const w of workouts) {
      const bucket = index.get(startOfWeek(w.date))
      if (bucket) bucket.count++
    }
    return weeks
  }, [workouts])

  const max = Math.max(...data.map((d) => d.count))
  if (max === 0) return null

  return (
    <div className="h-36 text-slate-200 dark:text-slate-700">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -30 }}>
          <CartesianGrid stroke="currentColor" strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="week"
            tickFormatter={shortDate}
            tick={{ fill: AXIS_INK, fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: 'currentColor' }}
            interval="preserveStartEnd"
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: AXIS_INK, fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(100,116,139,0.08)' }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded-lg bg-white px-3 py-2 text-xs shadow-md ring-1 ring-slate-900/10 dark:bg-slate-800 dark:ring-white/10">
                  <div className="font-medium text-slate-500 dark:text-slate-400">
                    Week of {shortDate((payload[0].payload as WeekPoint).week)}
                  </div>
                  <div className="text-sm font-bold">
                    {(payload[0].payload as WeekPoint).count} workout
                    {(payload[0].payload as WeekPoint).count === 1 ? '' : 's'}
                  </div>
                </div>
              ) : null
            }
          />
          <Bar
            dataKey="count"
            fill={SERIES}
            radius={[4, 4, 0, 0]}
            maxBarSize={22}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function WorkoutsPage() {
  const workouts = useLiveQuery(liveWorkouts) // newest first
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<Workout | undefined>(undefined)

  const thisWeek = useMemo(() => {
    if (!workouts) return { count: 0, minutes: 0 }
    const monday = startOfWeek(todayISO())
    const inWeek = workouts.filter((w) => w.date >= monday)
    return {
      count: inWeek.length,
      minutes: inWeek.reduce((sum, w) => sum + (w.durationMin ?? 0), 0),
    }
  }, [workouts])

  /** Consecutive weeks (ending this week or last) with at least one workout. */
  const streak = useMemo(() => {
    if (!workouts?.length) return 0
    const weeksWith = new Set(workouts.map((w) => startOfWeek(w.date)))
    let n = 0
    let week = startOfWeek(todayISO())
    // Current week may still be in progress — start counting from last week if empty.
    if (!weeksWith.has(week)) week = addDays(week, -7)
    while (weeksWith.has(week)) {
      n++
      week = addDays(week, -7)
    }
    return n
  }, [workouts])

  if (!workouts) return null

  const lastGym = workouts.find((w) => w.type === 'gym')

  const openAdd = () => {
    setEditing(undefined)
    setSheetOpen(true)
  }

  return (
    <div className="py-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Workouts</h1>
        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 rounded-full bg-brand-600 py-2 pr-4 pl-3 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <PlusIcon className="size-4" /> Log workout
        </button>
      </div>

      {workouts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<DumbbellIcon className="size-12" />}
            title="No workouts yet"
            message="Gym, runs, walks or outdoor games — log anything you do and watch your consistency grow."
            action={
              <button
                onClick={openAdd}
                className="rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-700"
              >
                Log your first workout
              </button>
            }
          />
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <div className="grid grid-cols-3 divide-x divide-slate-100 text-center dark:divide-slate-800">
              <div>
                <div className="text-2xl font-extrabold">{thisWeek.count}</div>
                <div className="text-xs text-slate-500">this week</div>
              </div>
              <div>
                <div className="text-2xl font-extrabold">
                  {thisWeek.minutes > 0 ? thisWeek.minutes : '—'}
                </div>
                <div className="text-xs text-slate-500">minutes</div>
              </div>
              <div>
                <div className="text-2xl font-extrabold">
                  {streak > 0 ? `${streak}w` : '—'}
                </div>
                <div className="text-xs text-slate-500">week streak</div>
              </div>
            </div>
            <WeeklyChart workouts={workouts} />
          </Card>

          <Card>
            <CardTitle>History</CardTitle>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {workouts.map((w) => (
                <li key={w.id} className="flex items-center gap-3 py-3">
                  <button
                    className="flex flex-1 items-center gap-3 text-left"
                    onClick={() => {
                      setEditing(w)
                      setSheetOpen(true)
                    }}
                  >
                    <span className="text-2xl">{TYPE_META[w.type].emoji}</span>
                    <span className="flex-1">
                      <span className="block font-semibold">{workoutTitle(w)}</span>
                      <span className="block text-xs text-slate-500">
                        {fullDate(w.date)}
                        {workoutSummary(w) ? ` · ${workoutSummary(w)}` : ''}
                      </span>
                    </span>
                  </button>
                  <button
                    aria-label={`Delete ${workoutTitle(w)} on ${w.date}`}
                    onClick={() => {
                      if (confirm(`Delete "${workoutTitle(w)}" on ${fullDate(w.date)}?`))
                        void deleteWorkout(w.id)
                    }}
                    className="rounded-full p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                  >
                    <TrashIcon className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={editing ? 'Edit workout' : 'Log workout'}
      >
        <WorkoutForm
          existing={editing}
          lastGym={lastGym}
          onSaved={() => setSheetOpen(false)}
        />
      </Sheet>
    </div>
  )
}
