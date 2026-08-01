/**
 * Single source of truth for every entity in the app.
 * All synced entities carry id/createdAt/updatedAt and an optional
 * deletedAt tombstone so Drive sync can propagate deletions.
 */

/** Calendar date in 'YYYY-MM-DD' (local time). */
export type ISODate = string

export interface BaseEntity {
  id: string
  createdAt: number // ms epoch
  updatedAt: number // ms epoch
  deletedAt?: number // ms epoch — soft delete tombstone
}

// ---------- Weight ----------

export interface WeightEntry extends BaseEntity {
  date: ISODate // one entry per day (upsert by date)
  weightKg: number // always stored in kg; converted at the UI edge
  note?: string
}

// ---------- Workouts ----------

export type WorkoutType = 'gym' | 'run' | 'sport' | 'walk' | 'other'
export type Intensity = 'light' | 'moderate' | 'hard'

export interface WorkoutExercise {
  name: string
  sets?: number
  reps?: number
  weightKg?: number
  note?: string
}

export interface Workout extends BaseEntity {
  date: ISODate
  type: WorkoutType
  title?: string
  durationMin?: number
  /** Gym sessions: per-exercise detail. */
  exercises?: WorkoutExercise[]
  /** Runs / walks. */
  distanceKm?: number
  /** Outdoor games: sport name (cricket, football, badminton …). */
  sport?: string
  intensity?: Intensity
  note?: string
}

// ---------- Reports ----------

export type ReportCategory = 'blood_test' | 'imaging' | 'prescription' | 'other'
export type ExtractionStatus = 'none' | 'pending' | 'reviewed' | 'failed'

export interface Report extends BaseEntity {
  title: string
  reportDate: ISODate
  category: ReportCategory
  tags: string[]
  mimeType: string
  sizeBytes: number
  sha256: string
  blobId: string
  /** Set only after a successful Drive upload — null means "not backed up yet". */
  driveFileId: string | null
  extractionStatus: ExtractionStatus
}

/** Heavy binaries, kept out of the synced JSON doc. Not tombstoned (hard-deleted with their report). */
export interface FileBlob {
  id: string
  blob: Blob
  /** Small JPEG preview (first PDF page / downscaled photo) for fast lists. */
  thumb?: Blob
}

// ---------- Metrics (extracted from reports or entered manually) ----------

export type MetricFlag = 'low' | 'normal' | 'high' | 'unknown'

export interface Metric extends BaseEntity {
  /** Canonical key from ai/referenceRanges.ts, or 'other'. */
  key: string
  label: string
  /** Always stored in the canonical unit for the key. */
  value: number
  unit: string
  date: ISODate
  reportId: string | null // null = manual entry
  source: 'ai' | 'manual'
  /** The lab's own printed reference range, when available. */
  labRefLow?: number
  labRefHigh?: number
  flag: MetricFlag
  /** What the lab actually printed, preserved verbatim. */
  rawText?: string
}

// ---------- Reminders ----------

export interface ReminderSchedule {
  freq: 'once' | 'daily' | 'weekly' | 'monthly' | 'every_n_days'
  time: string // 'HH:mm'
  daysOfWeek?: number[] // 0=Sun … 6=Sat, for weekly
  dayOfMonth?: number // for monthly
  n?: number // for every_n_days
}

export interface Reminder extends BaseEntity {
  title: string
  notes?: string
  schedule: ReminderSchedule
  nextDue: string // ISO datetime
  lastDone?: string
  snoozedUntil?: string
  enabled: boolean
}

// ---------- Guidance chat ----------

export interface ChatMessage extends BaseEntity {
  role: 'user' | 'assistant'
  text: string
}

// ---------- Settings (key-value singletons) ----------

export interface Profile {
  name?: string
  heightCm?: number
  birthYear?: number
  sex?: 'male' | 'female' | 'other'
  weightUnit: 'kg' | 'lb'
  glucoseUnit: 'mg/dL' | 'mmol/L'
}

export type ProviderId = 'openai' | 'gemini' | 'anthropic'

/** NEVER included in Drive export — see sync/serialize.ts whitelist. */
export interface AIConfig {
  activeProvider: ProviderId | null
  keys: Partial<Record<ProviderId, string>>
  models: Partial<Record<ProviderId, string>>
}

/** Local-only sync state. */
export interface SyncMeta {
  folderId?: string
  reportsFolderId?: string
  dbFileId?: string
  lastSyncAt?: number
  lastRevision?: number
  accountEmail?: string
  deviceId: string
  status: 'disconnected' | 'ok' | 'reconnect_needed' | 'error'
  lastError?: string
}

export interface SettingsRow {
  key: string
  value: unknown
}

export const DEFAULT_PROFILE: Profile = {
  weightUnit: 'kg',
  glucoseUnit: 'mg/dL',
}
