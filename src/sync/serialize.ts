/**
 * Export/import of the synced JSON document (health-data.json).
 *
 * The export whitelist is the privacy boundary: blobs (binaries), aiConfig
 * (API keys) and syncMeta (device-local state) are NEVER part of the doc.
 */
import { z } from 'zod'
import { db } from '../db/db'
import type {
  ChatMessage,
  Metric,
  Profile,
  Reminder,
  Report,
  WeightEntry,
  Workout,
} from '../db/schema'

export const SCHEMA_VERSION = 1
const TOMBSTONE_KEEP_MS = 90 * 24 * 3600 * 1000

// ---------- Zod schemas (tolerant: unknown extra keys pass through) ----------

const base = {
  id: z.string().min(1),
  createdAt: z.number(),
  updatedAt: z.number(),
  deletedAt: z.number().optional(),
}

const weightSchema = z
  .object({ ...base, date: z.string(), weightKg: z.number(), note: z.string().optional() })
  .passthrough()

const exerciseSchema = z
  .object({
    name: z.string(),
    sets: z.number().optional(),
    reps: z.number().optional(),
    weightKg: z.number().optional(),
    note: z.string().optional(),
  })
  .passthrough()

const workoutSchema = z
  .object({
    ...base,
    date: z.string(),
    type: z.enum(['gym', 'run', 'sport', 'walk', 'other']),
    title: z.string().optional(),
    durationMin: z.number().optional(),
    exercises: z.array(exerciseSchema).optional(),
    distanceKm: z.number().optional(),
    sport: z.string().optional(),
    intensity: z.enum(['light', 'moderate', 'hard']).optional(),
    note: z.string().optional(),
  })
  .passthrough()

const reportSchema = z
  .object({
    ...base,
    title: z.string(),
    reportDate: z.string(),
    category: z.enum(['blood_test', 'imaging', 'prescription', 'other']),
    tags: z.array(z.string()),
    mimeType: z.string(),
    sizeBytes: z.number(),
    sha256: z.string(),
    blobId: z.string(),
    driveFileId: z.string().nullable(),
    extractionStatus: z.enum(['none', 'pending', 'reviewed', 'failed']),
  })
  .passthrough()

const metricSchema = z
  .object({
    ...base,
    key: z.string(),
    label: z.string(),
    value: z.number(),
    unit: z.string(),
    date: z.string(),
    reportId: z.string().nullable(),
    source: z.enum(['ai', 'manual']),
    labRefLow: z.number().optional(),
    labRefHigh: z.number().optional(),
    flag: z.enum(['low', 'normal', 'high', 'unknown']),
    rawText: z.string().optional(),
  })
  .passthrough()

const reminderSchema = z
  .object({
    ...base,
    title: z.string(),
    notes: z.string().optional(),
    schedule: z
      .object({
        freq: z.enum(['once', 'daily', 'weekly', 'monthly', 'every_n_days']),
        time: z.string(),
        daysOfWeek: z.array(z.number()).optional(),
        dayOfMonth: z.number().optional(),
        n: z.number().optional(),
      })
      .passthrough(),
    nextDue: z.string(),
    lastDone: z.string().optional(),
    snoozedUntil: z.string().optional(),
    enabled: z.boolean(),
  })
  .passthrough()

const chatSchema = z
  .object({ ...base, role: z.enum(['user', 'assistant']), text: z.string() })
  .passthrough()

const profileSchema = z
  .object({
    value: z
      .object({
        name: z.string().optional(),
        heightCm: z.number().optional(),
        birthYear: z.number().optional(),
        sex: z.enum(['male', 'female', 'other']).optional(),
        weightUnit: z.enum(['kg', 'lb']),
        glucoseUnit: z.enum(['mg/dL', 'mmol/L']),
      })
      .passthrough(),
    updatedAt: z.number(),
  })
  .passthrough()

export const healthDocSchema = z
  .object({
    schemaVersion: z.number(),
    revision: z.number(),
    exportedAt: z.number(),
    deviceId: z.string(),
    profile: profileSchema.nullable(),
    weights: z.array(weightSchema),
    workouts: z.array(workoutSchema),
    reports: z.array(reportSchema),
    metrics: z.array(metricSchema),
    reminders: z.array(reminderSchema),
    chats: z.array(chatSchema),
  })
  .passthrough()

/**
 * Static shape of the doc (schema types). The Zod schema above is the
 * runtime validator; `.passthrough()` keeps forward-compatible extra keys,
 * which is why we don't use z.infer here.
 */
export interface HealthDoc {
  schemaVersion: number
  revision: number
  exportedAt: number
  deviceId: string
  profile: { value: Profile; updatedAt: number } | null
  weights: WeightEntry[]
  workouts: Workout[]
  reports: Report[]
  metrics: Metric[]
  reminders: Reminder[]
  chats: ChatMessage[]
}

// ---------- Pure merge (exported for tests) ----------

interface Stamped {
  id: string
  updatedAt: number
  deletedAt?: number
}

/**
 * Per-record last-write-wins by updatedAt. Ties keep local. Returns the
 * merged list and how many records the remote side changed/added locally.
 */
export function mergeRecords<T extends Stamped>(
  local: T[],
  remote: T[],
): { merged: T[]; remoteWins: number } {
  const byId = new Map<string, T>()
  for (const r of local) byId.set(r.id, r)
  let remoteWins = 0
  for (const r of remote) {
    const l = byId.get(r.id)
    if (!l || r.updatedAt > l.updatedAt) {
      byId.set(r.id, r)
      remoteWins++
    }
  }
  return { merged: [...byId.values()], remoteWins }
}

function pruneTombstones<T extends Stamped>(rows: T[], now: number): T[] {
  return rows.filter((r) => !r.deletedAt || now - r.deletedAt < TOMBSTONE_KEEP_MS)
}

// ---------- Export / import against Dexie ----------

export async function exportDoc(revision: number, deviceId: string): Promise<HealthDoc> {
  const now = Date.now()
  const [weights, workouts, reports, metrics, reminders, chats, profileRow] = await Promise.all([
    db.weights.toArray(),
    db.workouts.toArray(),
    db.reports.toArray(),
    db.metrics.toArray(),
    db.reminders.toArray(),
    db.chats.toArray(),
    db.settings.get('profile'),
  ])
  return {
    schemaVersion: SCHEMA_VERSION,
    revision,
    exportedAt: now,
    deviceId,
    profile: profileRow
      ? {
          value: profileRow.value as Profile,
          updatedAt: (profileRow as { updatedAt?: number }).updatedAt ?? 0,
        }
      : null,
    weights: pruneTombstones(weights, now),
    workouts: pruneTombstones(workouts, now),
    reports: pruneTombstones(reports, now),
    metrics: pruneTombstones(metrics, now),
    reminders: pruneTombstones(reminders, now),
    chats: pruneTombstones(chats, now),
  }
}

export interface MergeStats {
  remoteWins: number
}

/**
 * Validate `raw` and merge it into the local DB (LWW per record).
 * Throws if the document does not parse — never writes in that case.
 */
export async function importMerge(raw: unknown): Promise<MergeStats> {
  const doc = healthDocSchema.parse(raw) as unknown as HealthDoc
  let remoteWins = 0

  interface StampedTable {
    toArray(): Promise<unknown[]>
    bulkPut(rows: unknown[]): Promise<unknown>
  }

  const mergeTable = async (table: StampedTable, rows: unknown[]): Promise<void> => {
    const local = (await table.toArray()) as Stamped[]
    const { merged, remoteWins: wins } = mergeRecords(local, rows as Stamped[])
    remoteWins += wins
    if (wins > 0) await table.bulkPut(merged)
  }

  await db.transaction(
    'rw',
    [db.weights, db.workouts, db.reports, db.metrics, db.reminders, db.chats, db.settings],
    async () => {
      await mergeTable(db.weights as unknown as StampedTable, doc.weights)
      await mergeTable(db.workouts as unknown as StampedTable, doc.workouts)
      await mergeTable(db.reports as unknown as StampedTable, doc.reports)
      await mergeTable(db.metrics as unknown as StampedTable, doc.metrics)
      await mergeTable(db.reminders as unknown as StampedTable, doc.reminders)
      await mergeTable(db.chats as unknown as StampedTable, doc.chats)

      // Profile: single row, LWW by its updatedAt stamp.
      if (doc.profile) {
        const localRow = (await db.settings.get('profile')) as
          | { key: string; value: unknown; updatedAt?: number }
          | undefined
        const localStamp = localRow?.updatedAt ?? 0
        if (doc.profile.updatedAt > localStamp) {
          await db.settings.put({
            key: 'profile',
            value: doc.profile.value,
            updatedAt: doc.profile.updatedAt,
          } as never)
          remoteWins++
        }
      }
    },
  )

  return { remoteWins }
}
