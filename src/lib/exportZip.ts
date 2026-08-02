/**
 * "Export everything" escape hatch: one ZIP with the structured data
 * (same JSON as the Drive backup — no API keys by construction) plus
 * every report file. Works fully offline; shared via the OS sheet.
 */
import { zip, strToU8 } from 'fflate'
import { db } from '../db/db'
import { exportDoc } from '../sync/serialize'
import { getSyncMeta } from '../db/repo'

function extensionFor(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  return 'jpg'
}

export async function buildExportZip(): Promise<Blob> {
  const meta = await getSyncMeta()
  const doc = await exportDoc(meta.lastRevision ?? 0, meta.deviceId || 'local')

  const files: Record<string, Uint8Array> = {
    'health-data.json': strToU8(JSON.stringify(doc, null, 2)),
  }

  const reports = await db.reports.filter((r) => !r.deletedAt).toArray()
  for (const r of reports) {
    const blobRow = await db.blobs.get(r.blobId)
    if (!blobRow) continue
    const safeTitle = r.title.replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 60)
    const name = `Reports/${r.reportDate} ${safeTitle} (${r.id.slice(0, 6)}).${extensionFor(r.mimeType)}`
    files[name] = new Uint8Array(await blobRow.blob.arrayBuffer())
  }

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data)))
  })
  return new Blob([zipped as BlobPart], { type: 'application/zip' })
}

export async function shareExportZip(): Promise<void> {
  const blob = await buildExportZip()
  const stamp = new Date().toISOString().slice(0, 10)
  const file = new File([blob], `health-tracker-export-${stamp}.zip`, {
    type: 'application/zip',
  })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Health Tracker export' })
      return
    } catch {
      // user may have cancelled; fall through to download
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
