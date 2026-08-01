import { useMemo } from 'react'
import {
  CartesianGrid,
  Label,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { WeightEntry, Profile } from '../../db/schema'
import { bmi, bmiCategory, BMI_CATEGORY_LABEL, healthyWeightRangeKg } from '../../lib/bmi'
import { fromKg } from '../../lib/units'
import { fullDate, shortDate } from '../../lib/dates'

// Validated with dataviz palette checks on both light (#fff) and dark (#0f172a) surfaces.
const SERIES = '#0d9488'
const AXIS_INK = '#64748b' // slate-500 — readable on both surfaces

interface Point {
  date: string
  weight: number
  bmiValue: number | null
}

function ChartTooltip({
  active,
  payload,
  unit,
}: {
  active?: boolean
  payload?: { payload: Point }[]
  unit: string
}) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-lg bg-white px-3 py-2 text-xs shadow-md ring-1 ring-slate-900/10 dark:bg-slate-800 dark:ring-white/10">
      <div className="font-medium text-slate-500 dark:text-slate-400">{fullDate(p.date)}</div>
      <div className="mt-0.5 text-sm font-bold">
        {p.weight.toFixed(1)} {unit}
      </div>
      {p.bmiValue !== null && (
        <div className="text-slate-500 dark:text-slate-400">
          BMI {p.bmiValue.toFixed(1)} ·{' '}
          {BMI_CATEGORY_LABEL[bmiCategory(Number(p.bmiValue.toFixed(1)))]}
        </div>
      )}
    </div>
  )
}

/** Weight trend line with the healthy-BMI weight band for the user's height. */
export function WeightChart({
  entries, // ascending by date
  profile,
}: {
  entries: WeightEntry[]
  profile: Profile
}) {
  const unit = profile.weightUnit
  const heightCm = profile.heightCm

  const data: Point[] = useMemo(
    () =>
      entries.map((e) => ({
        date: e.date,
        weight: fromKg(e.weightKg, unit),
        bmiValue: heightCm ? bmi(e.weightKg, heightCm) : null,
      })),
    [entries, unit, heightCm],
  )

  const band = useMemo(() => {
    if (!heightCm) return null
    const { low, high } = healthyWeightRangeKg(heightCm)
    return { low: fromKg(low, unit), high: fromKg(high, unit) }
  }, [heightCm, unit])

  const domain = useMemo((): [number, number] => {
    const values = data.map((d) => d.weight)
    let min = Math.min(...values)
    let max = Math.max(...values)
    // If the healthy band is close to the data, include it in view.
    if (band) {
      if (band.high > min - (max - min) && band.high < max + (max - min)) {
        min = Math.min(min, band.high)
        max = Math.max(max, band.high)
      }
      if (band.low > min - (max - min) && band.low < max + (max - min)) {
        min = Math.min(min, band.low)
        max = Math.max(max, band.low)
      }
    }
    const pad = Math.max((max - min) * 0.1, 1)
    return [Math.floor(min - pad), Math.ceil(max + pad)]
  }, [data, band])

  if (data.length < 2) return null

  return (
    <div className="h-56 text-slate-200 dark:text-slate-700">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="currentColor" strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tick={{ fill: AXIS_INK, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: 'currentColor' }}
            minTickGap={40}
          />
          <YAxis
            domain={domain}
            tick={{ fill: AXIS_INK, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={46}
          />
          {band && (
            <ReferenceArea
              y1={band.low}
              y2={band.high}
              fill={SERIES}
              fillOpacity={0.08}
              ifOverflow="hidden"
            >
              <Label
                value="Healthy BMI range"
                position="insideTopRight"
                fill={AXIS_INK}
                fontSize={10}
              />
            </ReferenceArea>
          )}
          <Tooltip
            content={<ChartTooltip unit={unit} />}
            cursor={{ stroke: AXIS_INK, strokeWidth: 1, strokeDasharray: '3 3' }}
          />
          <Line
            type="monotone"
            dataKey="weight"
            stroke={SERIES}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: SERIES, stroke: 'var(--color-white, #fff)', strokeWidth: 2 }}
            animationDuration={300}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
