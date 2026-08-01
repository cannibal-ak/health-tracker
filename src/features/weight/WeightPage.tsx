import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router'
import { deleteWeight, getProfile, liveWeights, upsertWeight } from '../../db/repo'
import { addDays, fullDate, todayISO } from '../../lib/dates'
import { bmi, bmiCategory, BMI_CATEGORY_LABEL, type BmiCategory } from '../../lib/bmi'
import { formatWeight, fromKg, toKg } from '../../lib/units'
import { Card, CardTitle } from '../../ui/Card'
import { Sheet } from '../../ui/Sheet'
import { EmptyState } from '../../ui/EmptyState'
import { Field, PrimaryButton, Segmented, TextInput } from '../../ui/Field'
import { PlusIcon, ScaleIcon, TrashIcon } from '../../ui/Icons'
import { WeightChart } from './WeightChart'

const CATEGORY_CHIP: Record<BmiCategory, string> = {
  healthy: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  underweight: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  overweight: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  obese: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

export function BmiChip({ value }: { value: number }) {
  // Classify the rounded value the user actually sees, so text and label agree.
  const shown = Number(value.toFixed(1))
  const cat = bmiCategory(shown)
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${CATEGORY_CHIP[cat]}`}
    >
      BMI {shown.toFixed(1)} · {BMI_CATEGORY_LABEL[cat]}
    </span>
  )
}

type Range = '30' | '90' | 'all'

export function WeightPage() {
  const profile = useLiveQuery(getProfile)
  const weights = useLiveQuery(liveWeights) // newest first
  const [sheetOpen, setSheetOpen] = useState(false)
  const [range, setRange] = useState<Range>('90')

  // Form state
  const [date, setDate] = useState(todayISO())
  const [weightInput, setWeightInput] = useState('')
  const [note, setNote] = useState('')

  const unit = profile?.weightUnit ?? 'kg'

  const chartEntries = useMemo(() => {
    if (!weights) return []
    const asc = [...weights].reverse()
    if (range === 'all') return asc
    const cutoff = addDays(todayISO(), -Number(range))
    return asc.filter((w) => w.date >= cutoff)
  }, [weights, range])

  if (!profile || !weights) return null

  const openLog = () => {
    setDate(todayISO())
    const latest = weights[0]
    setWeightInput(latest ? fromKg(latest.weightKg, unit).toFixed(1) : '')
    setNote('')
    setSheetOpen(true)
  }

  const save = async () => {
    const v = parseFloat(weightInput)
    if (!v || v <= 0 || !date) return
    await upsertWeight(date, toKg(v, unit), note.trim() || undefined)
    setSheetOpen(false)
  }

  return (
    <div className="py-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Weight</h1>
        <button
          onClick={openLog}
          className="flex items-center gap-1.5 rounded-full bg-brand-600 py-2 pr-4 pl-3 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <PlusIcon className="size-4" /> Log weight
        </button>
      </div>

      {weights.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ScaleIcon className="size-12" />}
            title="No entries yet"
            message="Log your weight regularly — every few days is plenty — and your trend will appear here."
            action={
              <PrimaryButton className="!w-auto px-6" onClick={openLog}>
                Log your first weight
              </PrimaryButton>
            }
          />
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <CardTitle>Trend</CardTitle>
              <Segmented
                value={range}
                onChange={setRange}
                options={[
                  { value: '30', label: '30d' },
                  { value: '90', label: '90d' },
                  { value: 'all', label: 'All' },
                ]}
              />
            </div>
            {chartEntries.length >= 2 ? (
              <WeightChart entries={chartEntries} profile={profile} />
            ) : (
              <p className="py-8 text-center text-sm text-slate-500">
                Add one more entry to see your trend.
              </p>
            )}
            {!profile.heightCm && (
              <p className="mt-2 text-xs text-slate-500">
                <Link to="/settings" className="font-medium text-brand-600 underline">
                  Set your height
                </Link>{' '}
                to see BMI and your healthy range on the chart.
              </p>
            )}
          </Card>

          <Card>
            <CardTitle>History</CardTitle>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {weights.map((w) => (
                <li key={w.id} className="flex items-center gap-3 py-3">
                  <div className="flex-1">
                    <div className="font-semibold">{formatWeight(w.weightKg, unit)}</div>
                    <div className="text-xs text-slate-500">
                      {fullDate(w.date)}
                      {w.note ? ` · ${w.note}` : ''}
                    </div>
                  </div>
                  {profile.heightCm && <BmiChip value={bmi(w.weightKg, profile.heightCm)} />}
                  <button
                    aria-label={`Delete entry for ${w.date}`}
                    onClick={() => {
                      if (confirm(`Delete the entry for ${fullDate(w.date)}?`))
                        void deleteWeight(w.id)
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

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Log weight">
        <Field label="Date">
          <TextInput
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label={`Weight (${unit})`}>
          <TextInput
            type="number"
            inputMode="decimal"
            step="0.1"
            min="1"
            placeholder={unit === 'kg' ? 'e.g. 72.5' : 'e.g. 159.8'}
            value={weightInput}
            onChange={(e) => setWeightInput(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Note (optional)">
          <TextInput
            type="text"
            placeholder="e.g. after morning run"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <PrimaryButton onClick={save} disabled={!parseFloat(weightInput)}>
          Save
        </PrimaryButton>
        <p className="mt-3 text-center text-xs text-slate-400">
          Logging on the same date updates that day's entry.
        </p>
      </Sheet>
    </div>
  )
}
