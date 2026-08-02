import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Metric } from '../../db/schema'
import { addMetrics, deleteMetric, liveMetrics } from '../../db/repo'
import { METRICS, METRIC_BY_KEY } from '../../ai/referenceRanges'
import { metricGroupKey } from '../../lib/metricGroup'
import { fullDate, shortDate, todayISO } from '../../lib/dates'
import { Card, CardTitle } from '../../ui/Card'
import { Sheet } from '../../ui/Sheet'
import { EmptyState } from '../../ui/EmptyState'
import { Field, PrimaryButton, Select, TextInput } from '../../ui/Field'
import { ChevronRightIcon, FileIcon, PlusIcon, TrashIcon } from '../../ui/Icons'
import { FlagChip } from './FlagChip'

const SERIES = '#0d9488'
const AXIS_INK = '#64748b'

interface Group {
  key: string
  label: string
  unit: string
  latest: Metric
  entries: Metric[] // ascending by date
}

function groupMetrics(metrics: Metric[]): Group[] {
  const byKey = new Map<string, Metric[]>()
  for (const m of metrics) {
    const k = metricGroupKey(m)
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k)!.push(m)
  }
  return [...byKey.entries()].map(([key, list]) => {
    const asc = [...list].sort((a, b) => a.date.localeCompare(b.date))
    return {
      key,
      label: asc[asc.length - 1].label,
      unit: asc[asc.length - 1].unit,
      latest: asc[asc.length - 1],
      entries: asc,
    }
  })
}

function TrendChart({ group }: { group: Group }) {
  const def = METRIC_BY_KEY.get(group.entries[0].key)
  const data = group.entries.map((m) => ({ date: m.date, value: m.value, flag: m.flag }))
  const values = data.map((d) => d.value)
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (def?.low !== undefined) min = Math.min(min, def.low)
  if (def?.high !== undefined) max = Math.max(max, def.high)
  const pad = Math.max((max - min) * 0.15, 0.5)

  return (
    <div className="h-48 text-slate-200 dark:text-slate-700">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
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
            domain={[min - pad, max + pad]}
            tick={{ fill: AXIS_INK, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={50}
            tickFormatter={(v: number) => String(Number(v.toFixed(1)))}
          />
          {def && def.low !== undefined && def.high !== undefined && (
            <ReferenceArea
              y1={def.low}
              y2={def.high}
              fill={SERIES}
              fillOpacity={0.08}
              ifOverflow="hidden"
            />
          )}
          <Tooltip
            cursor={{ stroke: AXIS_INK, strokeWidth: 1, strokeDasharray: '3 3' }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded-lg bg-white px-3 py-2 text-xs shadow-md ring-1 ring-slate-900/10 dark:bg-slate-800 dark:ring-white/10">
                  <div className="font-medium text-slate-500 dark:text-slate-400">
                    {fullDate((payload[0].payload as { date: string }).date)}
                  </div>
                  <div className="text-sm font-bold">
                    {(payload[0].payload as { value: number }).value} {group.unit}
                  </div>
                </div>
              ) : null
            }
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={SERIES}
            strokeWidth={2}
            dot={{ r: 3, fill: SERIES, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function MetricsPage() {
  const metrics = useLiveQuery(liveMetrics)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  // Manual entry form
  const [manualKey, setManualKey] = useState(METRICS[0].key)
  const [manualValue, setManualValue] = useState('')
  const [manualDate, setManualDate] = useState(todayISO())

  const groups = useMemo(() => (metrics ? groupMetrics(metrics) : []), [metrics])
  const flagged = groups.filter((g) => g.latest.flag === 'high' || g.latest.flag === 'low')
  const open = groups.find((g) => g.key === openKey) ?? null

  if (!metrics) return null

  const saveManual = async () => {
    const def = METRIC_BY_KEY.get(manualKey)
    const v = parseFloat(manualValue)
    if (!def || !Number.isFinite(v)) return
    let flag: Metric['flag'] = 'unknown'
    if (def.low !== undefined && v < def.low) flag = 'low'
    else if (def.high !== undefined && v > def.high) flag = 'high'
    else if (def.low !== undefined || def.high !== undefined) flag = 'normal'
    await addMetrics([
      {
        key: def.key,
        label: def.label,
        value: v,
        unit: def.canonicalUnit,
        date: manualDate,
        reportId: null,
        source: 'manual',
        flag,
      },
    ])
    setAddOpen(false)
    setManualValue('')
  }

  return (
    <div className="py-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Health metrics</h1>
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 rounded-full bg-brand-600 py-2 pr-4 pl-3 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <PlusIcon className="size-4" /> Add value
        </button>
      </div>

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileIcon className="size-12" />}
            title="No metrics yet"
            message="Extract values from a report with AI (Reports tab) or add one manually — then watch your trends here."
          />
        </Card>
      ) : (
        <>
          {flagged.length > 0 && (
            <Card className="mb-4">
              <CardTitle>Needs attention</CardTitle>
              <p className="mb-2 text-xs text-slate-400">
                Latest values outside their reference range. Discuss with your doctor — this is
                not medical advice.
              </p>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {flagged.map((g) => (
                  <li key={g.key}>
                    <button
                      className="flex w-full items-center gap-2 py-2.5 text-left"
                      onClick={() => setOpenKey(g.key)}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{g.label}</span>
                      <span className="text-sm font-bold">
                        {g.latest.value} {g.unit}
                      </span>
                      <FlagChip flag={g.latest.flag} />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardTitle>All metrics</CardTitle>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {groups.map((g) => (
                <li key={g.key}>
                  <button
                    className="flex w-full items-center gap-2 py-3 text-left"
                    onClick={() => setOpenKey(g.key)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{g.label}</span>
                      <span className="text-xs text-slate-500">
                        {fullDate(g.latest.date)} · {g.entries.length} value
                        {g.entries.length === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className="text-sm font-bold">
                      {g.latest.value} {g.unit}
                    </span>
                    <FlagChip flag={g.latest.flag} />
                    <ChevronRightIcon className="size-4 shrink-0 text-slate-300" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {/* Per-metric detail sheet */}
      <Sheet open={open !== null} onClose={() => setOpenKey(null)} title={open?.label ?? ''}>
        {open && (
          <>
            {open.entries.length >= 2 ? (
              <TrendChart group={open} />
            ) : (
              <p className="py-4 text-center text-sm text-slate-500">
                One more value and you'll see a trend line.
              </p>
            )}
            {(() => {
              const def = METRIC_BY_KEY.get(open.entries[0].key)
              return def && (def.low !== undefined || def.high !== undefined) ? (
                <p className="mt-1 text-center text-xs text-slate-400">
                  General adult range: {def.low ?? '—'}–{def.high ?? '—'} {def.canonicalUnit}
                </p>
              ) : null
            })()}
            <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {[...open.entries].reverse().map((m) => (
                <li key={m.id} className="flex items-center gap-2 py-2.5">
                  <span className="flex-1 text-sm text-slate-500">{fullDate(m.date)}</span>
                  <span className="font-semibold">
                    {m.value} {m.unit}
                  </span>
                  <FlagChip flag={m.flag} />
                  <button
                    aria-label={`Delete value from ${m.date}`}
                    onClick={() => {
                      if (confirm(`Delete ${m.label} (${m.value} ${m.unit}) from ${fullDate(m.date)}?`))
                        void deleteMetric(m.id)
                    }}
                    className="rounded-full p-1.5 text-slate-400 hover:text-red-600"
                  >
                    <TrashIcon className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Sheet>

      {/* Manual entry sheet */}
      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Add a value">
        <Field label="Test">
          <Select value={manualKey} onChange={(e) => setManualKey(e.target.value)}>
            {METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Value (${METRIC_BY_KEY.get(manualKey)?.canonicalUnit ?? ''})`}>
          <TextInput
            type="number"
            inputMode="decimal"
            step="any"
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Date">
          <TextInput
            type="date"
            value={manualDate}
            max={todayISO()}
            onChange={(e) => setManualDate(e.target.value)}
          />
        </Field>
        <PrimaryButton onClick={saveManual} disabled={!parseFloat(manualValue)}>
          Save
        </PrimaryButton>
      </Sheet>
    </div>
  )
}
