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
  type ChatMessage,
  type ISODate,
  type Metric,
  type Profile,
  type Reminder,
  type Report,
  type ReportCategory,
  type SyncMeta,
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

/**
 * One entry per calendar day: updates the existing entry if present.
 * Runs in a transaction so a double-tap can't create duplicate rows.
 */
export async function upsertWeight(date: ISODate, weightKg: number, note?: string): Promise<void> {
  await db.transaction('rw', db.weights, async () => {
    const existing = await db.weights.where('date').equals(date).first()
    if (existing) {
      await db.weights.update(existing.id, {
        weightKg,
        note,
        deletedAt: undefined, // revives a tombstoned entry for this date
        updatedAt: Date.now(),
      })
    } else {
      await db.weights.add(stampNew({ date, weightKg, note }))
    }
  })
  markDirty()
}

/** Live (non-deleted) entry for one date, if any — used to prefill the form. */
export async function getWeightForDate(date: ISODate): Promise<WeightEntry | undefined> {
  const row = await db.weights.where('date').equals(date).first()
  return row && !row.deletedAt ? row : undefined
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

/**
 * Partial update, merged against the CURRENT stored profile inside a
 * transaction — two quick field edits must not clobber each other via
 * stale render-time snapshots.
 */
export async function saveProfile(changes: Partial<Profile>): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const row = await db.settings.get('profile')
    const current = { ...DEFAULT_PROFILE, ...((row?.value as Profile) ?? {}) }
    await db.settings.put({
      key: 'profile',
      value: { ...current, ...changes },
      // updatedAt on the row drives the LWW merge for the profile during sync.
      updatedAt: Date.now(),
    } as never)
  })
  markDirty()
}

// ---------- Metrics ----------

export async function addMetrics(metrics: Omit<Metric, keyof BaseEntity>[]): Promise<void> {
  await db.metrics.bulkAdd(metrics.map((m) => stampNew(m)))
  markDirty()
}

export async function updateMetric(
  id: string,
  changes: Partial<Omit<Metric, keyof BaseEntity>>,
): Promise<void> {
  await db.metrics.update(id, { ...changes, updatedAt: Date.now() })
  markDirty()
}

export async function deleteMetric(id: string): Promise<void> {
  await db.metrics.update(id, { deletedAt: Date.now(), updatedAt: Date.now() })
  markDirty()
}

export function liveMetrics(): Promise<Metric[]> {
  return db.metrics
    .orderBy('date')
    .reverse()
    .filter((m) => !m.deletedAt)
    .toArray()
}

// ---------- Reminders ----------

export async function addReminder(data: Omit<Reminder, keyof BaseEntity>): Promise<void> {
  await db.reminders.add(stampNew(data))
  markDirty()
}

export async function updateReminder(
  id: string,
  changes: Partial<Omit<Reminder, keyof BaseEntity>>,
): Promise<void> {
  await db.reminders.update(id, { ...changes, updatedAt: Date.now() })
  markDirty()
}

export async function deleteReminder(id: string): Promise<void> {
  await db.reminders.update(id, { deletedAt: Date.now(), updatedAt: Date.now() })
  markDirty()
}

export function liveReminders(): Promise<Reminder[]> {
  return db.reminders
    .orderBy('nextDue')
    .filter((r) => !r.deletedAt)
    .toArray()
}

// ---------- Guidance chat ----------

const CHAT_CAP = 50

export async function appendChatMessage(role: 'user' | 'assistant', text: string): Promise<void> {
  await db.transaction('rw', db.chats, async () => {
    await db.chats.add(stampNew({ role, text }))
    // Rolling window: tombstone the oldest beyond the cap.
    const live = await db.chats.orderBy('updatedAt').filter((c) => !c.deletedAt).toArray()
    for (const old of live.slice(0, Math.max(0, live.length - CHAT_CAP))) {
      await db.chats.update(old.id, { deletedAt: Date.now(), updatedAt: Date.now() })
    }
  })
  markDirty()
}

export async function clearChat(): Promise<void> {
  const now = Date.now()
  await db.chats
    .filter((c) => !c.deletedAt)
    .modify({ deletedAt: now, updatedAt: now })
  markDirty()
}

export async function liveChat(): Promise<ChatMessage[]> {
  // createdAt is not an index on chats — sort in memory (≤50 rows).
  const rows = await db.chats.filter((c) => !c.deletedAt).toArray()
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

// ---------- Sync-internal report updates ----------

/**
 * Record a successful Drive upload. Bumps updatedAt + dirty so other
 * devices learn the driveFileId through the next doc push (otherwise
 * they would re-upload a duplicate).
 */
export async function setReportDriveFileId(id: string, driveFileId: string | null): Promise<void> {
  await db.reports.update(id, { driveFileId, updatedAt: Date.now() })
  markDirty()
}

/** Store a blob downloaded back from Drive (restore path). No dirty flag. */
export async function putRestoredBlob(blobId: string, blob: Blob, thumb?: Blob): Promise<void> {
  await db.blobs.put({ id: blobId, blob, thumb })
}

// ---------- Sync meta (device-local, never exported) ----------

/** Read-only (safe inside useLiveQuery). deviceId is '' until first save. */
export async function getSyncMeta(): Promise<SyncMeta> {
  const row = await db.settings.get('syncMeta')
  return (row?.value as SyncMeta) ?? { deviceId: '', status: 'disconnected' }
}

export async function saveSyncMeta(changes: Partial<SyncMeta>): Promise<SyncMeta> {
  const current = await getSyncMeta()
  const next = { ...current, ...changes }
  if (!next.deviceId) next.deviceId = newId()
  await db.settings.put({ key: 'syncMeta', value: next })
  return next
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
