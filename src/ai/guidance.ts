/**
 * Guidance chat: builds a compact context from the user's own data and
 * enforces wellness-only framing. Also parses workouts described in chat
 * ("chat-to-log") — saved only after the user confirms.
 */
import { z } from 'zod'
import { db } from '../db/db'
import type { ChatMsg } from './types'
import { getAIConfig, getProfile } from '../db/repo'
import { PROVIDERS } from './registry'
import { AIProviderError, parseJsonLoose } from './types'
import { bmi, bmiCategory, BMI_CATEGORY_LABEL } from '../lib/bmi'
import { addDays, todayISO } from '../lib/dates'
import { workoutSummary, workoutTitle } from '../features/workouts/workoutMeta'

async function activeProvider() {
  const config = await getAIConfig()
  const id = config.activeProvider
  if (!id) throw new AIProviderError('Choose an AI provider in Settings first.')
  const provider = PROVIDERS[id]
  const key = config.keys[id]
  if (!key) throw new AIProviderError(`Add your ${provider.label} API key in Settings first.`)
  return { provider, key, model: config.models[id] || provider.defaultModel }
}

export async function buildGuidanceSystemPrompt(): Promise<string> {
  const profile = await getProfile()
  const today = todayISO()

  const weights = (await db.weights.orderBy('date').filter((w) => !w.deletedAt).toArray()).filter(
    (w) => w.date >= addDays(today, -90),
  )
  const workouts = (await db.workouts.orderBy('date').filter((w) => !w.deletedAt).toArray()).filter(
    (w) => w.date >= addDays(today, -14),
  )
  const metrics = await db.metrics.filter((m) => !m.deletedAt).toArray()
  const reminders = await db.reminders.filter((r) => !r.deletedAt && r.enabled).toArray()
  const reports = (await db.reports.filter((r) => !r.deletedAt).toArray()).sort((a, b) =>
    b.reportDate.localeCompare(a.reportDate),
  )
  const medicines = await db.medicines.filter((m) => !m.deletedAt).toArray()

  const lines: string[] = []
  lines.push(`Today: ${today}`)
  if (profile.name) lines.push(`Name: ${profile.name}`)
  if (profile.heightCm) lines.push(`Height: ${profile.heightCm} cm`)
  if (profile.birthYear) lines.push(`Age: ~${new Date().getFullYear() - profile.birthYear}`)
  if (profile.sex) lines.push(`Sex: ${profile.sex}`)

  if (weights.length) {
    const latest = weights[weights.length - 1]
    const first = weights[0]
    let w = `Weight: ${latest.weightKg.toFixed(1)} kg (${latest.date})`
    if (weights.length > 1)
      w += `, ${first.weightKg.toFixed(1)} kg 90 days ago (${(latest.weightKg - first.weightKg >= 0 ? '+' : '') + (latest.weightKg - first.weightKg).toFixed(1)} kg)`
    if (profile.heightCm) {
      const b = bmi(latest.weightKg, profile.heightCm)
      w += `, BMI ${b.toFixed(1)} (${BMI_CATEGORY_LABEL[bmiCategory(Number(b.toFixed(1)))]})`
    }
    lines.push(w)
  }

  if (workouts.length) {
    lines.push('Workouts (last 14 days):')
    for (const w of workouts.slice(-14)) {
      const ex = w.exercises?.length
        ? ` — ${w.exercises.map((e) => `${e.name}${e.sets ? ` ${e.sets}x${e.reps ?? '?'}` : ''}${e.weightKg ? ` @${e.weightKg}kg` : ''}`).join(', ')}`
        : ''
      lines.push(`- ${w.date}: ${workoutTitle(w)} (${workoutSummary(w) || w.type})${ex}`)
    }
  } else {
    lines.push('Workouts: none logged in the last 14 days')
  }

  // Recent history per metric key (up to 3 values, oldest→newest) so the
  // assistant can talk about trends, not just the latest number.
  const byKey = new Map<string, (typeof metrics)[number][]>()
  for (const m of [...metrics].sort((a, b) => a.date.localeCompare(b.date))) {
    const k = m.key === 'other' ? `other:${m.label}:${m.unit}` : m.key
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k)!.push(m)
  }
  if (byKey.size) {
    lines.push('Health metrics (user-confirmed, from their own reports; oldest→newest):')
    for (const list of byKey.values()) {
      const recent = list.slice(-3)
      const label = recent[recent.length - 1].label
      const unit = recent[recent.length - 1].unit
      const seq = recent.map((m) => `${m.value} (${m.date}, ${m.flag})`).join(' → ')
      lines.push(`- ${label} [${unit}]: ${seq}`)
    }
  }

  if (reports.length) {
    lines.push('Uploaded checkup reports (metadata only — file contents are NOT included here):')
    for (const r of reports.slice(0, 15)) {
      const read =
        r.extractionStatus === 'reviewed'
          ? 'values extracted into metrics above'
          : 'NOT yet read by AI'
      lines.push(`- ${r.reportDate}: "${r.title}" (${r.category}) — ${read}`)
    }
  } else {
    lines.push('Uploaded checkup reports: none yet')
  }

  if (medicines.length) {
    const active = medicines.filter((m) => m.active)
    const stopped = medicines.filter((m) => !m.active)
    if (active.length) {
      lines.push('Current medicines / supplements (as recorded by the user):')
      for (const m of active) {
        const bits = [m.dose, m.timing, m.reason ? `for ${m.reason}` : null, m.startDate ? `since ${m.startDate}` : null]
          .filter(Boolean)
          .join(', ')
        lines.push(`- ${m.name}${bits ? ` — ${bits}` : ''}${m.note ? ` (${m.note})` : ''}`)
      }
    }
    if (stopped.length) {
      lines.push(`Previously taken (stopped): ${stopped.map((m) => m.name).join(', ')}`)
    }
  }

  if (reminders.length) {
    lines.push(`Active reminders: ${reminders.map((r) => r.title).join('; ')}`)
  }

  return `You are a friendly personal wellness companion inside a private health-tracking app. The user is the only person using this app; the data below is their own.

STRICT RULES:
- General wellness information only: diet, hydration, recovery, stretching, sleep, training habits.
- You are NOT a doctor. Never diagnose, never interpret lab values as a diagnosis, never suggest starting, stopping, changing the dose of, or replacing ANY medicine — not even supplements. Questions about drug interactions, side effects, or dosing get one answer: ask the prescribing doctor or a pharmacist.
- If a metric is flagged high/low or the user describes symptoms, advise them to discuss it with a doctor.
- The report LIST below shows what the user uploaded, but you cannot see inside the files. If they ask about a report marked "NOT yet read by AI", tell them to open the Reports tab and tap the ✨ AI button on it — then its values will appear in your data.
- When the user tells you what they trained today, give practical diet suggestions (protein, hydration, timing), recovery care for the trained muscle groups (rest, stretching, sleep), and what to watch out for.
- If asked to summarize their health, structure it as short sections: overall picture, weight & activity, lab values worth attention (with dates), medicines as recorded, and 2-3 practical suggestions — ending with what to bring up at the next doctor visit. Stay factual to the data; no diagnoses.
- Ground advice in their actual data below when relevant. Keep answers short, warm and practical — this is a phone chat. Use plain text, no markdown tables.

USER DATA:
${lines.join('\n')}`
}

/**
 * Providers (Anthropic especially) require user-first, strictly-alternating
 * history. The rolling 50-message cap can leave an assistant message first
 * (or adjacent same-role turns after a failed send) — normalize here.
 */
function normalizeHistory(history: ChatMsg[]): ChatMsg[] {
  const out: ChatMsg[] = []
  for (const m of history) {
    if (out.length === 0 && m.role !== 'user') continue // drop leading assistant turns
    const prev = out[out.length - 1]
    if (prev && prev.role === m.role) {
      prev.text = `${prev.text}\n\n${m.text}` // merge consecutive same-role turns
    } else {
      out.push({ ...m })
    }
  }
  return out
}

export async function sendGuidanceMessage(history: ChatMsg[]): Promise<string> {
  const { provider, key, model } = await activeProvider()
  const system = await buildGuidanceSystemPrompt()
  return provider.chat(system, normalizeHistory(history), key, model)
}

// ---------- Chat-to-log: parse a workout described in a chat message ----------

const workoutParseSchema = z
  .object({
    found: z.boolean(),
    type: z.string().nullish(),
    title: z.string().nullish(),
    durationMin: z.number().nullish(),
    distanceKm: z.number().nullish(),
    sport: z.string().nullish(),
    intensity: z.string().nullish(),
    exercises: z
      .array(
        z
          .object({
            name: z.string(),
            sets: z.number().nullish(),
            reps: z.number().nullish(),
            weightKg: z.number().nullish(),
          })
          .passthrough(),
      )
      .nullish(),
  })
  .passthrough()

export interface ParsedWorkout {
  type: 'gym' | 'run' | 'sport' | 'walk' | 'other'
  title?: string
  durationMin?: number
  distanceKm?: number
  sport?: string
  intensity?: 'light' | 'moderate' | 'hard'
  exercises?: { name: string; sets?: number; reps?: number; weightKg?: number }[]
}

const WORKOUT_HINT =
  /\b(gym|workout|trained|training|lifted|bench|squat|deadlift|press|curl|ran|run|running|jog|walk|walked|cycled|cycling|swam|swim|played|badminton|cricket|football|tennis|yoga|km|reps?|sets?)\b/i

/** Cheap keyword gate so we don't burn an AI call on every message. */
export function mightDescribeWorkout(text: string): boolean {
  return WORKOUT_HINT.test(text)
}

export async function parseWorkoutFromText(text: string): Promise<ParsedWorkout | null> {
  const { provider, key, model } = await activeProvider()
  const system = `Extract a workout the user PERFORMED (past tense) from their message, if any. Reply with STRICT JSON only:
{"found": true|false, "type": "gym"|"run"|"sport"|"walk"|"other", "title": "...", "durationMin": 0, "distanceKm": 0, "sport": "...", "intensity": "light"|"moderate"|"hard", "exercises": [{"name":"...","sets":0,"reps":0,"weightKg":0}]}
Omit or null any field not mentioned. "found" is false for questions, plans, or future intentions. Weights in kg (convert from lb if needed).`
  const reply = await provider.chat(system, [{ role: 'user', text }], key, model)
  const parsed = workoutParseSchema.safeParse(parseJsonLoose(reply))
  if (!parsed.success || !parsed.data.found) return null
  const d = parsed.data
  const type = (['gym', 'run', 'sport', 'walk', 'other'] as const).includes(
    d.type as ParsedWorkout['type'],
  )
    ? (d.type as ParsedWorkout['type'])
    : 'other'
  return {
    type,
    title: d.title ?? undefined,
    durationMin: d.durationMin ?? undefined,
    distanceKm: d.distanceKm ?? undefined,
    sport: d.sport ?? undefined,
    intensity: (['light', 'moderate', 'hard'] as const).includes(
      d.intensity as 'light' | 'moderate' | 'hard',
    )
      ? (d.intensity as 'light' | 'moderate' | 'hard')
      : undefined,
    exercises: d.exercises?.map((e) => ({
      name: e.name,
      sets: e.sets ?? undefined,
      reps: e.reps ?? undefined,
      weightKg: e.weightKg ?? undefined,
    })),
  }
}
