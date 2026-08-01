/**
 * Ask the browser to protect IndexedDB from storage-pressure eviction.
 * Especially relevant on iOS Safari; a no-op where unsupported.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true
      return await navigator.storage.persist()
    }
  } catch {
    // ignore — persistence is best-effort
  }
  return false
}

export interface StorageInfo {
  usageBytes: number
  quotaBytes: number
  persisted: boolean
}

export async function getStorageInfo(): Promise<StorageInfo | null> {
  try {
    if (!navigator.storage?.estimate) return null
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    const persisted = (await navigator.storage.persisted?.()) ?? false
    return { usageBytes: usage, quotaBytes: quota, persisted }
  } catch {
    return null
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
