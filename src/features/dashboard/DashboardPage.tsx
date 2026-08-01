import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router'
import { getProfile, liveWeights } from '../../db/repo'
import { bmi } from '../../lib/bmi'
import { formatWeight, fromKg } from '../../lib/units'
import { fullDate } from '../../lib/dates'
import { Card } from '../../ui/Card'
import { ChevronRightIcon, PlusIcon, ScaleIcon } from '../../ui/Icons'
import { BmiChip } from '../weight/WeightPage'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function DashboardPage() {
  const profile = useLiveQuery(getProfile)
  const weights = useLiveQuery(liveWeights)

  if (!profile || !weights) return null

  const latest = weights[0]
  const previous = weights[1]
  const unit = profile.weightUnit
  const deltaKg = latest && previous ? latest.weightKg - previous.weightKg : null

  const needsProfile = !profile.heightCm

  return (
    <div className="py-4">
      <h1 className="mb-1 text-2xl font-bold">
        {greeting()}
        {profile.name ? `, ${profile.name.split(' ')[0]}` : ''}
      </h1>
      <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">
        Your health, in one place — private, on your device.
      </p>

      {needsProfile && (
        <Link to="/settings">
          <Card className="mb-4 !bg-brand-600 text-white transition-transform active:scale-[0.99]">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="font-bold">Finish setting up</div>
                <div className="text-sm text-brand-100">
                  Add your height to unlock BMI tracking and your healthy range.
                </div>
              </div>
              <ChevronRightIcon className="size-5 shrink-0" />
            </div>
          </Card>
        </Link>
      )}

      <Card className="mb-4">
        {latest ? (
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                Current weight
              </span>
              <span className="text-xs text-slate-400">{fullDate(latest.date)}</span>
            </div>
            <div className="mt-2 flex items-end gap-3">
              <span className="text-4xl font-extrabold tracking-tight">
                {fromKg(latest.weightKg, unit).toFixed(1)}
                <span className="ml-1 text-lg font-semibold text-slate-400">{unit}</span>
              </span>
              {deltaKg !== null && Math.abs(deltaKg) >= 0.05 && (
                <span
                  className={`mb-1 text-sm font-semibold ${
                    deltaKg < 0 ? 'text-green-600 dark:text-green-400' : 'text-slate-500'
                  }`}
                >
                  {deltaKg > 0 ? '+' : '−'}
                  {formatWeight(Math.abs(deltaKg), unit)}
                </span>
              )}
            </div>
            {profile.heightCm && (
              <div className="mt-3">
                <BmiChip value={bmi(latest.weightKg, profile.heightCm)} />
              </div>
            )}
            <Link
              to="/weight"
              className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm font-medium hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              View trend & history
              <ChevronRightIcon className="size-4 text-slate-400" />
            </Link>
          </div>
        ) : (
          <div className="flex flex-col items-center py-6 text-center">
            <ScaleIcon className="mb-3 size-10 text-slate-300 dark:text-slate-600" />
            <p className="mb-1 font-semibold">Start tracking your weight</p>
            <p className="mb-4 max-w-xs text-sm text-slate-500 dark:text-slate-400">
              Your BMI and trends will appear here once you log your first entry.
            </p>
            <Link
              to="/weight"
              className="flex items-center gap-1.5 rounded-full bg-brand-600 py-2.5 pr-5 pl-4 text-sm font-semibold text-white hover:bg-brand-700"
            >
              <PlusIcon className="size-4" /> Log weight
            </Link>
          </div>
        )}
      </Card>

      <p className="mt-6 text-center text-xs text-slate-400 dark:text-slate-500">
        Workouts, health reports, AI insights and reminders are on the way.
      </p>
    </div>
  )
}
