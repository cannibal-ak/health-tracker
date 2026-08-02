import Dexie, { type EntityTable } from 'dexie'
import type {
  ChatMessage,
  FileBlob,
  Medicine,
  Metric,
  Reminder,
  Report,
  SettingsRow,
  WeightEntry,
  Workout,
} from './schema'

export const db = new Dexie('health-tracker') as Dexie & {
  weights: EntityTable<WeightEntry, 'id'>
  workouts: EntityTable<Workout, 'id'>
  reports: EntityTable<Report, 'id'>
  blobs: EntityTable<FileBlob, 'id'>
  metrics: EntityTable<Metric, 'id'>
  reminders: EntityTable<Reminder, 'id'>
  chats: EntityTable<ChatMessage, 'id'>
  medicines: EntityTable<Medicine, 'id'>
  settings: EntityTable<SettingsRow, 'key'>
}

db.version(1).stores({
  weights: 'id, date, updatedAt',
  workouts: 'id, date, updatedAt',
  reports: 'id, reportDate, updatedAt',
  blobs: 'id',
  metrics: 'id, key, date, reportId, updatedAt',
  reminders: 'id, nextDue, updatedAt',
  chats: 'id, updatedAt',
  settings: 'key',
})

// v2: medicines. Existing stores keep their data — Dexie only adds the new one.
db.version(2).stores({
  medicines: 'id, updatedAt',
})
