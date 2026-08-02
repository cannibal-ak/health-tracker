/**
 * Extraction pipeline: prepare document → provider call → Zod validation
 * (per-entry repair) → unit normalization → plausibility check → flagging.
 *
 * Output is a list of CANDIDATES for the human review screen — nothing is
 * written to the database until the user confirms.
 */
import type { MetricFlag, Report } from '../db/schema'
import { getAIConfig } from '../db/repo'
import { PROVIDERS } from './registry'
import { prepareReportDoc } from './docPrep'
import { METRIC_BY_KEY, normalizeUnit, type MetricDef } from './referenceRanges'
import {
  AIProviderError,
  extractedMetricSchema,
  extractionResultSchema,
  type ExtractionResult,
} from './types'

export interface MetricCandidate {
  key: string // canonical key or 'other'
  label: string
  /** Value in canonical unit when the key/unit is recognized; else as printed. */
  value: number
  unit: string
  labRefLow?: number
  labRefHigh?: number
  flag: MetricFlag
  /** Which range produced the flag. */
  flagSource: 'lab' | 'general' | 'none'
  /** Outside plausible bounds — probably a misread; user must check. */
  suspect: boolean
  rawText: string
}

export interface ExtractionOutcome {
  candidates: MetricCandidate[]
  testDate?: string
  labName?: string
  note?: string
}

function computeFlag(
  def: MetricDef | undefined,
  value: number,
  labLow?: number,
  labHigh?: number,
): { flag: MetricFlag; source: 'lab' | 'general' | 'none' } {
  if (labLow !== undefined || labHigh !== undefined) {
    if (labLow !== undefined && value < labLow) return { flag: 'low', source: 'lab' }
    if (labHigh !== undefined && value > labHigh) return { flag: 'high', source: 'lab' }
    return { flag: 'normal', source: 'lab' }
  }
  if (def && (def.low !== undefined || def.high !== undefined)) {
    if (def.low !== undefined && value < def.low) return { flag: 'low', source: 'general' }
    if (def.high !== undefined && value > def.high) return { flag: 'high', source: 'general' }
    return { flag: 'normal', source: 'general' }
  }
  return { flag: 'unknown', source: 'none' }
}

function toCandidate(raw: unknown): MetricCandidate | null {
  const parsed = extractedMetricSchema.safeParse(raw)
  if (!parsed.success) return null
  const m = parsed.data
  if (!Number.isFinite(m.value)) return null

  const def = METRIC_BY_KEY.get(m.key)
  const rawText = `${m.label}: ${m.value} ${m.unit}`

  if (!def) {
    // Unrecognized test — keep as printed under 'other'.
    const { flag, source } = computeFlag(undefined, m.value, m.refLow ?? undefined, m.refHigh ?? undefined)
    return {
      key: 'other',
      label: m.label,
      value: m.value,
      unit: m.unit,
      labRefLow: m.refLow ?? undefined,
      labRefHigh: m.refHigh ?? undefined,
      flag,
      flagSource: source,
      suspect: false,
      rawText,
    }
  }

  // Convert the printed value (and the lab's printed range) to canonical units.
  const converted = normalizeUnit(def, m.value, m.unit)
  if (converted === null) {
    // Unit not recognized — keep printed value but treat key as matched;
    // flag only by the lab's own range and mark for review.
    const { flag, source } = computeFlag(undefined, m.value, m.refLow ?? undefined, m.refHigh ?? undefined)
    return {
      key: def.key,
      label: def.label,
      value: m.value,
      unit: m.unit,
      labRefLow: m.refLow ?? undefined,
      labRefHigh: m.refHigh ?? undefined,
      flag,
      flagSource: source,
      suspect: true,
      rawText,
    }
  }

  const factor = converted / m.value || 1
  const labLow = m.refLow != null ? m.refLow * factor : undefined
  const labHigh = m.refHigh != null ? m.refHigh * factor : undefined
  const { flag, source } = computeFlag(def, converted, labLow, labHigh)

  return {
    key: def.key,
    label: def.label,
    value: Number(converted.toFixed(3)),
    unit: def.canonicalUnit,
    labRefLow: labLow !== undefined ? Number(labLow.toFixed(3)) : undefined,
    labRefHigh: labHigh !== undefined ? Number(labHigh.toFixed(3)) : undefined,
    flag,
    flagSource: source,
    suspect: converted < def.plausibleMin || converted > def.plausibleMax,
    rawText,
  }
}

/**
 * Recompute flag/suspect after the user edits a value in the review screen —
 * a corrected value must never keep the stale AI-computed flag.
 */
export function reflagCandidate(c: MetricCandidate, newValue: number): MetricCandidate {
  const def = METRIC_BY_KEY.get(c.key)
  const { flag, source } = computeFlag(def, newValue, c.labRefLow, c.labRefHigh)
  return {
    ...c,
    value: newValue,
    flag,
    flagSource: source,
    suspect: def ? newValue < def.plausibleMin || newValue > def.plausibleMax : false,
  }
}

export async function extractFromReport(report: Report): Promise<ExtractionOutcome> {
  const config = await getAIConfig()
  const providerId = config.activeProvider
  if (!providerId) throw new AIProviderError('Choose an AI provider in Settings first.')
  const provider = PROVIDERS[providerId]
  const key = config.keys[providerId]
  if (!key) throw new AIProviderError(`Add your ${provider.label} API key in Settings first.`)
  const model = config.models[providerId] || provider.defaultModel

  const { doc, note } = await prepareReportDoc(report, provider.supportsNativePdf)
  const rawResult = await provider.extract(doc, key, model)

  // Validate the envelope; individual metrics are repaired entry-by-entry
  // (one malformed row must not sink the batch).
  let result: ExtractionResult
  const parsed = extractionResultSchema.safeParse(rawResult)
  if (parsed.success) {
    result = parsed.data
  } else if (rawResult && typeof rawResult === 'object' && 'metrics' in rawResult) {
    result = {
      metrics: ((rawResult as { metrics: unknown[] }).metrics ??
        []) as ExtractionResult['metrics'],
    }
  } else {
    throw new AIProviderError('The AI response did not contain any metrics.')
  }

  const candidates = (result.metrics as unknown[])
    .map(toCandidate)
    .filter((c): c is MetricCandidate => c !== null)

  return {
    candidates,
    testDate: result.testDate ?? undefined,
    labName: result.labName ?? undefined,
    note,
  }
}
