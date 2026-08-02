/**
 * Drive sync engine. Local-first: the app never blocks on any of this.
 *
 * Cycle: silent token → ensure folder/file ids → pull + LWW merge →
 * upload pending report files → trash remotely-deleted ones → push doc.
 * Restore on a fresh install is just the first pull (merge into empty DB).
 */
import {
  DRIVE_APP_TAG,
  DRIVE_DB_FILENAME,
  DRIVE_FOLDER_NAME,
  DRIVE_REPORTS_FOLDER_NAME,
} from '../config'
import { db } from '../db/db'
import type { Report, SyncMeta } from '../db/schema'
import {
  clearDirty,
  DIRTY_EVENT,
  getReportBlob,
  getSyncMeta,
  isDirty,
  putRestoredBlob,
  saveSyncMeta,
  setReportDriveFileId,
} from '../db/repo'
import {
  AuthNeededError,
  clearToken,
  fetchAccountEmail,
  getAccessToken,
  isDriveConfigured,
} from './googleAuth'
import * as drive from './drive'
import { exportDoc, importMerge, type MergeStats } from './serialize'

export interface SyncResult {
  ok: boolean
  restored?: MergeStats
  foundRemote?: boolean
  error?: string
}

let inFlight: Promise<SyncResult> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

// ---------- helpers ----------

function extensionFor(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  return 'jpg'
}

function remoteFileName(r: Report): string {
  // Human-readable in Drive; the stable htId lives in appProperties.
  const safeTitle = r.title.replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 80)
  return `${r.reportDate} ${safeTitle} (${r.id.slice(0, 6)}).${extensionFor(r.mimeType)}`
}

async function verifyOrNull(token: string, fileId?: string): Promise<string | null> {
  if (!fileId) return null
  try {
    await drive.getFileMeta(token, fileId)
    return fileId
  } catch {
    return null
  }
}

/** Find-or-create the Drive folder layout; returns fresh ids. */
async function ensureIds(token: string, meta: SyncMeta) {
  let folderId = await verifyOrNull(token, meta.folderId)
  if (!folderId) {
    const found = await drive.searchFiles(
      token,
      `appProperties has { key='${DRIVE_APP_TAG.key}' and value='${DRIVE_APP_TAG.value}' } ` +
        `and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    )
    folderId =
      found[0]?.id ??
      (
        await drive.createFolder(token, DRIVE_FOLDER_NAME, {
          appProperties: { [DRIVE_APP_TAG.key]: DRIVE_APP_TAG.value },
        })
      ).id
  }

  let reportsFolderId = await verifyOrNull(token, meta.reportsFolderId)
  if (!reportsFolderId) {
    const found = await drive.searchFiles(
      token,
      `'${folderId}' in parents and name='${drive.q(DRIVE_REPORTS_FOLDER_NAME)}' ` +
        `and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    )
    reportsFolderId =
      found[0]?.id ?? (await drive.createFolder(token, DRIVE_REPORTS_FOLDER_NAME, { parentId: folderId })).id
  }

  let dbFileId = await verifyOrNull(token, meta.dbFileId)
  if (!dbFileId) {
    const found = await drive.searchFiles(
      token,
      `'${folderId}' in parents and name='${drive.q(DRIVE_DB_FILENAME)}' and trashed=false`,
    )
    dbFileId = found[0]?.id ?? null
  }

  return { folderId, reportsFolderId, dbFileId }
}

// ---------- the sync cycle ----------

async function runSync(interactive: boolean): Promise<SyncResult> {
  if (!isDriveConfigured()) return { ok: false, error: 'not-configured' }
  let meta = await getSyncMeta()
  if (meta.status === 'disconnected' && !interactive) return { ok: false, error: 'disconnected' }
  if (!navigator.onLine) return { ok: false, error: 'offline' }

  let token: string
  try {
    token = await getAccessToken(interactive)
  } catch (e) {
    if (meta.status !== 'disconnected') {
      await saveSyncMeta({ status: 'reconnect_needed' })
    }
    return { ok: false, error: e instanceof AuthNeededError ? 'auth-needed' : String(e) }
  }

  try {
    const ids = await ensureIds(token, meta)
    meta = await saveSyncMeta({
      folderId: ids.folderId,
      reportsFolderId: ids.reportsFolderId,
      dbFileId: ids.dbFileId ?? undefined,
    })

    // -- pull + merge (also = restore on fresh installs) --
    let remoteRevision = 0
    let restored: MergeStats | undefined
    const foundRemote = Boolean(ids.dbFileId)
    if (ids.dbFileId) {
      const blob = await drive.downloadFile(token, ids.dbFileId)
      let raw: unknown
      try {
        raw = JSON.parse(await blob.text())
      } catch {
        // Corrupt remote: never overwrite it blindly — surface and stop.
        await saveSyncMeta({ status: 'error', lastError: 'Backup file in Drive is unreadable' })
        return { ok: false, error: 'corrupt-remote' }
      }
      try {
        restored = await importMerge(raw)
        remoteRevision = (raw as { revision?: number }).revision ?? 0
      } catch {
        await saveSyncMeta({
          status: 'error',
          lastError: 'Backup file in Drive has an unexpected format',
        })
        return { ok: false, error: 'invalid-remote' }
      }
    }

    // -- upload report files that aren't backed up yet --
    const pending = await db.reports
      .filter((r) => !r.deletedAt && r.driveFileId === null)
      .toArray()
    for (const r of pending) {
      const blobRow = await getReportBlob(r.blobId)
      if (!blobRow) continue // file only exists on another device
      try {
        const uploaded = await drive.uploadMultipart(token, {
          name: remoteFileName(r),
          mimeType: r.mimeType,
          content: blobRow.blob,
          parentId: ids.reportsFolderId,
          appProperties: { htId: r.id, sha256: r.sha256 },
        })
        await setReportDriveFileId(r.id, uploaded.id)
      } catch {
        // Leave driveFileId null → retried next cycle.
      }
    }

    // -- trash remote files for deleted reports --
    const deleted = await db.reports.filter((r) => Boolean(r.deletedAt && r.driveFileId)).toArray()
    for (const r of deleted) {
      try {
        await drive.trashFile(token, r.driveFileId!)
      } catch {
        // 404 = already gone; fine either way.
      }
      await setReportDriveFileId(r.id, null)
    }

    // -- push the merged doc --
    const revision = Math.max(remoteRevision, meta.lastRevision ?? 0) + 1
    const doc = await exportDoc(revision, meta.deviceId)
    const uploaded = await drive.uploadMultipart(token, {
      fileId: ids.dbFileId ?? undefined,
      name: DRIVE_DB_FILENAME,
      mimeType: 'application/json',
      content: JSON.stringify(doc),
      parentId: ids.folderId,
    })
    clearDirty()

    const accountEmail = meta.accountEmail ?? (await fetchAccountEmail(token)) ?? undefined
    await saveSyncMeta({
      dbFileId: uploaded.id,
      lastRevision: revision,
      lastSyncAt: Date.now(),
      accountEmail,
      status: 'ok',
      lastError: undefined,
    })
    return { ok: true, restored, foundRemote }
  } catch (e) {
    await saveSyncMeta({ status: 'error', lastError: e instanceof Error ? e.message : String(e) })
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Single-flight sync. `interactive` only from a user tap (may open a popup). */
export function syncNow(interactive = false): Promise<SyncResult> {
  if (!inFlight) {
    inFlight = runSync(interactive).finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

/** Connect (or reconnect) from Settings — interactive, returns restore info. */
export function connectDrive(): Promise<SyncResult> {
  return syncNow(true)
}

/** Forget tokens and stop syncing. Local data stays. */
export async function disconnectDrive(): Promise<void> {
  clearToken()
  await saveSyncMeta({
    status: 'disconnected',
    lastError: undefined,
  })
}

/**
 * Blob-on-demand: local first, else download from Drive (restore path).
 * Returns null when unavailable (offline / auth needed / no remote copy).
 */
export async function ensureReportBlob(report: Report): Promise<Blob | null> {
  const local = await getReportBlob(report.blobId)
  if (local) return local.blob
  if (!report.driveFileId || !isDriveConfigured()) return null
  try {
    const token = await getAccessToken(false)
    const blob = await drive.downloadFile(token, report.driveFileId)
    const typed = blob.type ? blob : new Blob([blob], { type: report.mimeType })
    await putRestoredBlob(report.blobId, typed)
    return typed
  } catch {
    return null
  }
}

/** Count of reports whose binaries are not on this device but are in Drive. */
export async function countMissingBlobs(): Promise<number> {
  const reports = await db.reports.filter((r) => !r.deletedAt && r.driveFileId !== null).toArray()
  let missing = 0
  for (const r of reports) {
    if (!(await db.blobs.get(r.blobId))) missing++
  }
  return missing
}

/** "Download all reports for offline" — fetch every missing binary. */
export async function downloadAllBlobs(): Promise<{ downloaded: number; failed: number }> {
  const reports = await db.reports.filter((r) => !r.deletedAt && r.driveFileId !== null).toArray()
  let downloaded = 0
  let failed = 0
  for (const r of reports) {
    if (await db.blobs.get(r.blobId)) continue
    const blob = await ensureReportBlob(r)
    if (blob) downloaded++
    else failed++
  }
  return { downloaded, failed }
}

// ---------- triggers ----------

let triggersInstalled = false

export function initSyncTriggers(): void {
  if (triggersInstalled) return
  triggersInstalled = true

  // Launch (+2s so first paint wins).
  setTimeout(() => {
    void syncNow()
  }, 2000)

  // App going to background — good moment to flush.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && isDirty()) void syncNow()
  })

  // 30s debounce after any local mutation.
  window.addEventListener(DIRTY_EVENT, () => {
    if (!isDirty()) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      void syncNow()
    }, 30_000)
  })

  // Back online with unsent changes.
  window.addEventListener('online', () => {
    if (isDirty()) void syncNow()
  })
}
