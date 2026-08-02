import { useState } from 'react'
import type { Report } from '../../db/schema'
import { reflagCandidate, type ExtractionOutcome, type MetricCandidate } from '../../ai/extraction'
import { addMetrics, updateReport } from '../../db/repo'
import { todayISO } from '../../lib/dates'
import { Field, PrimaryButton, TextInput } from '../../ui/Field'
import { TrashIcon } from '../../ui/Icons'
import { FlagChip } from './FlagChip'

/**
 * The human safety valve: AI-extracted values become real metric rows only
 * after the user reviews (and optionally edits) them here.
 */
export function ExtractionReview({
  report,
  outcome,
  onDone,
}: {
  report: Report
  outcome: ExtractionOutcome
  onDone: () => void
}) {
  const [rows, setRows] = useState<MetricCandidate[]>(outcome.candidates)
  // The AI's testDate is untrusted: accept it only as a valid, non-future
  // YYYY-MM-DD — otherwise fall back to the report's own date.
  const [date, setDate] = useState(() => {
    const t = outcome.testDate
    return t && /^\d{4}-\d{2}-\d{2}$/.test(t) && t <= todayISO() ? t : report.reportDate
  })
  const [saving, setSaving] = useState(false)

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= todayISO()

  const setValue = (i: number, raw: string) => {
    const v = parseFloat(raw)
    if (!Number.isFinite(v)) return
    // Re-flag against the same ranges — an edited value must not keep the old chip.
    setRows((rs) => rs.map((r, j) => (j === i ? reflagCandidate(r, v) : r)))
  }

  const save = async () => {
    if (saving || !dateValid) return
    setSaving(true)
    try {
      await addMetrics(
        rows.map((r) => ({
          key: r.key,
          label: r.label,
          value: r.value,
          unit: r.unit,
          date,
          reportId: report.id,
          source: 'ai' as const,
          labRefLow: r.labRefLow,
          labRefHigh: r.labRefHigh,
          flag: r.flag,
          rawText: r.rawText,
        })),
      )
      await updateReport(report.id, { extractionStatus: 'reviewed' })
      onDone()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        {outcome.labName ? `${outcome.labName} · ` : ''}
        Check each value against your paper report before saving — AI can misread.
      </p>
      {outcome.note && (
        <p className="mb-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          {outcome.note}
        </p>
      )}

      <Field label="Test date">
        <TextInput type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
      </Field>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          No values were found in this report.
        </p>
      ) : (
        <ul className="mb-4 divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r, i) => (
            <li key={i} className="py-2.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.label}</span>
                <FlagChip flag={r.flag} />
                <button
                  aria-label={`Remove ${r.label}`}
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  className="rounded-full p-1.5 text-slate-400 hover:text-red-600"
                >
                  <TrashIcon className="size-4" />
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <TextInput
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={String(r.value)}
                  onChange={(e) => setValue(i, e.target.value)}
                  className="!w-28 !px-2.5 !py-1.5 !text-sm"
                />
                <span className="text-xs text-slate-500">{r.unit}</span>
                {(r.labRefLow !== undefined || r.labRefHigh !== undefined) && (
                  <span className="text-xs text-slate-400">
                    ref {r.labRefLow ?? '—'}–{r.labRefHigh ?? '—'}
                    {r.flagSource === 'lab' ? ' (lab)' : ''}
                  </span>
                )}
              </div>
              {r.suspect && (
                <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                  ⚠ This value looks unusual — double-check it against the report.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {!dateValid && (
        <p className="mb-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          Pick a valid test date (not in the future).
        </p>
      )}
      <PrimaryButton onClick={save} disabled={saving || rows.length === 0 || !dateValid}>
        {saving ? 'Saving…' : `Save ${rows.length} value${rows.length === 1 ? '' : 's'}`}
      </PrimaryButton>
      <p className="mt-3 text-center text-xs text-slate-400">
        General reference ranges are for information only — not medical advice.
      </p>
    </div>
  )
}
