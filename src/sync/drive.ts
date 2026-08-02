/** Thin fetch wrappers for the Google Drive REST v3 API (no gapi client). */

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

export class DriveError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'DriveError'
    this.status = status
  }
}

async function driveFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new DriveError(r.status, `Drive ${r.status}: ${body.slice(0, 300)}`)
  }
  return r
}

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  appProperties?: Record<string, string>
  modifiedTime?: string
  createdTime?: string
}

/** Results sorted oldest-first so concurrent devices pick the same canonical file. */
export async function searchFiles(token: string, q: string): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,appProperties,modifiedTime,createdTime)',
    orderBy: 'createdTime',
    pageSize: '100',
    spaces: 'drive',
  })
  const r = await driveFetch(`${API}/files?${params}`, token)
  const j = (await r.json()) as { files: DriveFile[] }
  return j.files
}

/** files.get — verifies existence; throws DriveError(404) when gone. */
export async function getFileMeta(token: string, fileId: string): Promise<DriveFile> {
  const r = await driveFetch(
    `${API}/files/${fileId}?fields=id,name,mimeType,appProperties,trashed,modifiedTime`,
    token,
  )
  const meta = (await r.json()) as DriveFile & { trashed?: boolean }
  if (meta.trashed) throw new DriveError(404, 'File is in trash')
  return meta
}

export async function createFolder(
  token: string,
  name: string,
  opts?: { parentId?: string; appProperties?: Record<string, string> },
): Promise<DriveFile> {
  const r = await driveFetch(`${API}/files?fields=id,name,mimeType`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: opts?.parentId ? [opts.parentId] : undefined,
      appProperties: opts?.appProperties,
    }),
  })
  return (await r.json()) as DriveFile
}

export async function downloadFile(token: string, fileId: string): Promise<Blob> {
  const r = await driveFetch(`${API}/files/${fileId}?alt=media`, token)
  return r.blob()
}

/**
 * Create or update a file with metadata + content in one multipart request.
 * Pass `fileId` to update (PATCH), omit to create.
 */
export async function uploadMultipart(
  token: string,
  opts: {
    fileId?: string
    name: string
    mimeType: string
    content: Blob | string
    parentId?: string
    appProperties?: Record<string, string>
  },
): Promise<DriveFile> {
  const meta: Record<string, unknown> = {
    name: opts.name,
    mimeType: opts.mimeType,
    appProperties: opts.appProperties,
  }
  // parents is only allowed on create.
  if (!opts.fileId && opts.parentId) meta.parents = [opts.parentId]

  const boundary = `ht-${crypto.randomUUID()}`
  const head =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${opts.mimeType}\r\n\r\n`
  const tail = `\r\n--${boundary}--`
  const body = new Blob([head, opts.content, tail])

  const url = opts.fileId
    ? `${UPLOAD}/files/${opts.fileId}?uploadType=multipart&fields=id,name`
    : `${UPLOAD}/files?uploadType=multipart&fields=id,name`

  const r = await driveFetch(url, token, {
    method: opts.fileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  return (await r.json()) as DriveFile
}

export async function trashFile(token: string, fileId: string): Promise<void> {
  await driveFetch(`${API}/files/${fileId}`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  })
}

/** Escape a value for a Drive query single-quoted string. */
export function q(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}
