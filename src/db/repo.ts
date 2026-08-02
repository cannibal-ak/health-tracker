/**
 * All writes go through this module — components never touch Dexie tables
 * directly for mutations. Every write stamps updatedAt and marks the DB
 * dirty so the sync engine (phase 4) knows a backup is needed.
 */
import { db } from './db'
import {
  DEFAULT_PROFILE,
  type AIConfig,
  type BaseEntity,
  type ISODate,
  type Profile,
  type Report,
  type ReportCategory,
  type WeightEntry,
  type Workout,
} from './schema'
import { newId } from '../lib/id'
import { sha256 } from '../lib/hash'

const DIRTY_KEY = 'ht-dirty'
export const DIRTY_EVENT = 'ht-dirty-changed'

/** Flag that local data changed since the last successful Drive sync. */
export function markDirty(): void {
  localStorage.setItem(DIRTY_KEY, '1')
  window.dispatchEvent(new Event(DIRTY_EVENT))
}

export function clearDirty(): void {
  localStorage.removeItem(DIRTY_KEY)
  window.dispatchEvent(new Event(DIRTY_EVENT))
}

export function isDirty(): boolean {
  return localStorage.getItem(DIRTY_KEY) === '1'
}

export function stampNew<T extends object>(data: T): T & BaseEntity {
  const now = Date.now()
  return { id: newId(), createdAt: now, updatedAt: now, ...data }
}

// ---------- Weights ----------

/** One entry per calendar day: updates the existing entry if present. */
export async function upsertWeight(date: ISODate, weightKg: number, note?: string): Promise<void> {
  const existing = await db.weights.where('date').equals(date).first()
  if (existing && !existing.deletedAt) {
    await db.weights.update(existing.id, { weightKg, note, updatedAt: Date.now() })
  } else if (existing) {
    // Revive a tombstoned entry for this date.
    await db.weights.update(existing.id, {
      weightKg,
      note,
      deletedAt: undefined,
      updatedAt: Date.now(),
    })
  } else {
    await db.weights.add(stampNew({ date, weightKg, note }))
  }
  markDirty()
}

export async function deleteWeight(id: string): Promise<void> {
  await db.weights.update(id, { deletedAt: Date.now(), updatedAt: Date.now() })
  markDirty()
}

// ---------- Workouts ----------

export async function addWorkout(data: Omit<Workout, keyof BaseEntity>): Promise<string> {
  const w = stampNew(data)
  await db.workouts.add(w)
  markDirty()
  return w.id
}

export async function updateWorkout(
  id: string,
  changes: Partial<Omit<Workout, keyof BaseEntity>>,
): Promise<void> {
  await db.workouts.update(id, { ...changes, updatedAt: Date.now() })
  markDirty()
}

export async function deleteWorkout(id: string): Promise<void> {
  await db.workouts.update(id, { deletedAt: Date.now(), updatedAt: Date.now() })
  markDirty()
}

// ---------- Reports ----------

export interface NewReportInput {
  title: string
  reportDate: ISODate
  category: ReportCategory
  tags: string[]
  file: Blob & { type: string }
  thumb?: Blob
}

/** Store a report: binary in `blobs`, metadata (synced) in `reports`. */
export async function addReport(input: NewReportInput): Promise<string> {
  const blobId = newId()
  const report = stampNew({
    title: input.title,
    reportDate: input.reportDate,
    category: input.category,
    tags: input.tags,
    mimeType: input.file.type || 'application/octet-stream',
    sizeBytes: input.file.size,
    sha256: await sha256(input.file),
    blobId,
    driveFileId: null,
    extractionStatus: 'none' as const,
  })
  await db.transaction('rw', db.reports, db.blobs, async () => {
    await db.blobs.add({ id: blobId, blob: input.file, thumb: input.thumb })
    await db.reports.add(report)
  })
  markDirty()
  return report.id
}

export async function updateReport(
  id: string,
  changes: Partial<Pick<Report, 'title' | 'reportDate' | 'category' | 'tags' | 'extractionStatus'>>,
): Promise<void> {
  await db.reports.update(id, { ...changes, updatedAt: Date.now() })
  markDirty()
}

/**
 * Soft-delete the report (tombstone syncs; phase 4 trashes the Drive copy)
 * but hard-delete the local binary to reclaim space immediately.
 */
export async function deleteReport(id: string): Promise<void> {
  const report = await db.reports.get(id)
  if (!report) return
  await db.transaction('rw', db.reports, db.blobs, async () => {
    await db.reports.update(id, { deletedAt: Date.now(), updatedAt: Date.now() })
    await db.blobs.delete(report.blobId)
  })
  markDirty()
}

export function liveReports(): Promise<Report[]> {
  return db.reports
    .orderBy('reportDate')
    .reverse()
    .filter((r) => !r.deletedAt)
    .toArray()
}

export async function getReportBlob(blobId: string) {
  return db.blobs.get(blobId)
}

// ---------- Settings ----------

export async function getProfile(): Promise<Profile> {
  const row = await db.settings.get('profile')
  return { ...DEFAULT_PROFILE, ...((row?.value as Profile) ?? {}) }
}

export async function saveProfile(profile: Profile): Promise<void> {
  await db.settings.put({ key: 'profile', value: profile })
  markDirty()
}

/** AI config is local-only (never synced) but read/written through the same table. */
export async function getAIConfig(): Promise<AIConfig> {
  const row = await db.settings.get('aiConfig')
  return (row?.value as AIConfig) ?? { activeProvider: null, keys: {}, models: {} }
}

export async function saveAIConfig(config: AIConfig): Promise<void> {
  await db.settings.put({ key: 'aiConfig', value: config })
  // deliberately NOT markDirty() — aiConfig is never part of the synced doc
}

// ---------- Query helpers (reads; usable inside useLiveQuery) ----------

export function liveWeights(): Promise<WeightEntry[]> {
  return db.weights
    .orderBy('date')
    .reverse()
    .filter((w) => !w.deletedAt)
    .toArray()
}

export function liveWorkouts(): Promise<Workout[]> {
  return db.workouts
    .orderBy('date')
    .reverse()
    .filter((w) => !w.deletedAt)
    .toArray()
}
