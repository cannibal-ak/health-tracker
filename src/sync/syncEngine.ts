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
  markDirty,
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

/**
 * Find-or-create the Drive folder layout; returns fresh ids.
 * Search results are createdTime-ordered, and the search is re-run even when
 * a cached id verifies — two devices doing their first sync concurrently can
 * each create a folder/db file, and both must converge on the SAME (oldest)
 * canonical one. Extra db files are returned for merge-and-trash.
 */
async function ensureIds(token: string, meta: SyncMeta) {
  const folderSearch = await drive.searchFiles(
    token,
    `appProperties has { key='${DRIVE_APP_TAG.key}' and value='${DRIVE_APP_TAG.value}' } ` +
      `and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  )
  let folderId: string | null = folderSearch[0]?.id ?? null
  if (!folderId) folderId = (await verifyOrNull(token, meta.folderId)) ?? null
  if (!folderId) {
    folderId = (
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

  // Db file: search across ALL app-tagged folders (duplicates from a
  // first-connect race may live in a sibling folder) plus the canonical one.
  const dbSearch = new Map<string, drive.DriveFile>()
  for (const folder of folderSearch.length ? folderSearch : [{ id: folderId }]) {
    const found = await drive.searchFiles(
      token,
      `'${folder.id}' in parents and name='${drive.q(DRIVE_DB_FILENAME)}' and trashed=false`,
    )
    for (const f of found) dbSearch.set(f.id, f)
  }
  const dbFiles = [...dbSearch.values()].sort((a, b) =>
    (a.createdTime ?? '').localeCompare(b.createdTime ?? ''),
  )
  const dbFileId = dbFiles[0]?.id ?? (await verifyOrNull(token, meta.dbFileId))
  const duplicateDbFileIds = dbFiles.slice(1).map((f) => f.id)

  return { folderId, reportsFolderId, dbFileId, duplicateDbFileIds }
}

// ---------- the sync cycle ----------

async function runSync(interactive: boolean): Promise<SyncResult> {
  if (!isDriveConfigured()) return { ok: false, error: 'not-configured' }
  let meta = await getSyncMeta()
  if (meta.status === 'disconnected' && !interactive) return { ok: false, error: 'disconnected' }
  if (!navigator.onLine) return { ok: false, error: 'offline' }

  // Fence: if the user taps Disconnect while this cycle runs, no terminal
  // write may resurrect the connection.
  const stillConnected = async () =>
    interactive || (await getSyncMeta()).status !== 'disconnected'

  let token: string
  try {
    // After an auth failure (reconnect_needed), an interactive tap must not
    // be satisfied by a possibly-revoked cached token — force a fresh one.
    token = await getAccessToken(interactive, {
      ignoreCache: interactive && meta.status === 'reconnect_needed',
    })
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
    let pulledModifiedTime: string | undefined
    const foundRemote = Boolean(ids.dbFileId)

    const pullAndMerge = async (fileId: string): Promise<SyncResult | null> => {
      pulledModifiedTime = (await drive.getFileMeta(token, fileId)).modifiedTime
      const blob = await drive.downloadFile(token, fileId)
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
        remoteRevision = Math.max(remoteRevision, (raw as { revision?: number }).revision ?? 0)
      } catch {
        await saveSyncMeta({
          status: 'error',
          lastError: 'Backup file in Drive has an unexpected format',
        })
        return { ok: false, error: 'invalid-remote' }
      }
      return null
    }

    if (ids.dbFileId) {
      const failure = await pullAndMerge(ids.dbFileId)
      if (failure) return failure
    }

    // Duplicate db files from a first-connect race on another device:
    // absorb their records, then trash them so both devices converge.
    for (const dupId of ids.duplicateDbFileIds) {
      try {
        const blob = await drive.downloadFile(token, dupId)
        const raw: unknown = JSON.parse(await blob.text())
        const merged = await importMerge(raw)
        restored = { remoteWins: (restored?.remoteWins ?? 0) + merged.remoteWins }
        remoteRevision = Math.max(remoteRevision, (raw as { revision?: number }).revision ?? 0)
        await drive.trashFile(token, dupId)
      } catch {
        // Unreadable duplicate: leave it for manual inspection; never block sync.
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
        await setReportDriveFileId(r.id, null)
      } catch (e) {
        if (e instanceof drive.DriveError && e.status === 404) {
          // Already gone remotely — nothing left to trash.
          await setReportDriveFileId(r.id, null)
        }
        // Any other failure: keep driveFileId so the trash is retried
        // next cycle instead of permanently orphaning the file in Drive.
      }
    }

    // -- push the merged doc --
    // If another device pushed while this cycle ran, merge its doc first so
    // our upload doesn't silently drop that device's records.
    if (ids.dbFileId && pulledModifiedTime) {
      try {
        const nowMeta = await drive.getFileMeta(token, ids.dbFileId)
        if (nowMeta.modifiedTime !== pulledModifiedTime) {
          const failure = await pullAndMerge(ids.dbFileId)
          if (failure) return failure
        }
      } catch {
        // Meta check is best-effort; the push below still proceeds.
      }
    }

    const revision = Math.max(remoteRevision, meta.lastRevision ?? 0) + 1
    // Claim the dirty flag BEFORE the export snapshot: writes landing during
    // export or upload re-set it and correctly schedule another cycle.
    clearDirty()
    const doc = await exportDoc(revision, meta.deviceId)
    let uploaded: drive.DriveFile
    try {
      uploaded = await drive.uploadMultipart(token, {
        fileId: ids.dbFileId ?? undefined,
        name: DRIVE_DB_FILENAME,
        mimeType: 'application/json',
        content: JSON.stringify(doc),
        parentId: ids.folderId,
      })
    } catch (e) {
      markDirty() // restore the claim — this data never reached Drive
      throw e
    }

    if (!(await stillConnected())) return { ok: false, error: 'disconnected' }

    // Interactive connects may have switched Google accounts — re-fetch then.
    const accountEmail = interactive
      ? ((await fetchAccountEmail(token)) ?? meta.accountEmail)
      : (meta.accountEmail ?? (await fetchAccountEmail(token)) ?? undefined)
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
    // A revoked/expired token surfaces as Drive 401 — evict it and route the
    // UI to "reconnect" (with a working popup) instead of a dead-end error.
    if (e instanceof drive.DriveError && e.status === 401) {
      clearToken()
      if (await stillConnected()) await saveSyncMeta({ status: 'reconnect_needed' })
      return { ok: false, error: 'auth-needed' }
    }
    if (await stillConnected()) {
      await saveSyncMeta({ status: 'error', lastError: e instanceof Error ? e.message : String(e) })
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Single-flight sync. `interactive` only from a user tap (may open a popup). */
export function syncNow(interactive = false): Promise<SyncResult> {
  if (!inFlight) {
    const p = runSync(interactive).finally(() => {
      if (inFlight === p) inFlight = null
    })
    inFlight = p
    return p
  }
  if (!interactive) return inFlight
  // A user tap must not be swallowed by an in-flight SILENT cycle (it would
  // never show the popup). Acquire the token now — still inside the user
  // gesture window — then run a fresh cycle after the current one finishes;
  // that cycle picks the token up from cache.
  const auth = getAccessToken(true).catch(() => null)
  const prev = inFlight
  const chained = Promise.all([auth, prev.catch(() => undefined)]).then(() => runSync(true))
  const wrapped = chained.finally(() => {
    if (inFlight === wrapped) inFlight = null
  })
  inFlight = wrapped
  return wrapped
}

/** Connect (or reconnect) from Settings — interactive, returns restore info. */
export function connectDrive(): Promise<SyncResult> {
  return syncNow(true)
}

/** Forget tokens and stop syncing. Local data stays. */
export async function disconnectDrive(): Promise<void> {
  clearToken()
  // Clear account identity and remote ids — a later reconnect may use a
  // different Google account, and stale ids/email would misreport where
  // the data actually lives.
  await saveSyncMeta({
    status: 'disconnected',
    accountEmail: undefined,
    folderId: undefined,
    reportsFolderId: undefined,
    dbFileId: undefined,
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
