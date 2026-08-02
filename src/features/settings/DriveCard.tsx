import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSyncMeta } from '../../db/repo'
import { isDriveConfigured } from '../../sync/googleAuth'
import {
  connectDrive,
  countMissingBlobs,
  disconnectDrive,
  downloadAllBlobs,
  syncNow,
} from '../../sync/syncEngine'
import { Card, CardTitle } from '../../ui/Card'
import { PrimaryButton } from '../../ui/Field'

function timeAgo(ms?: number): string {
  if (!ms) return 'never'
  const mins = Math.round((Date.now() - ms) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  return `${Math.round(hrs / 24)} d ago`
}

export function DriveCard() {
  const meta = useLiveQuery(getSyncMeta)
  const missing = useLiveQuery(countMissingBlobs)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (!meta) return null

  const connected = meta.status !== 'disconnected'

  const doConnect = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await connectDrive()
      if (r.ok) {
        setMessage(
          r.foundRemote && r.restored && r.restored.remoteWins > 0
            ? `Backup found — restored ${r.restored.remoteWins} item${r.restored.remoteWins === 1 ? '' : 's'} from Drive.`
            : r.foundRemote
              ? 'Connected. Your data is in sync.'
              : 'Connected. First backup created in your Drive.',
        )
      } else if (r.error === 'auth-needed') {
        setMessage('Google sign-in was closed before finishing. Try again.')
      } else if (r.error === 'offline') {
        setMessage('You appear to be offline — connect when back online.')
      } else {
        setMessage(`Could not connect: ${r.error}`)
      }
    } finally {
      setBusy(false)
    }
  }

  const doBackupNow = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await syncNow(true)
      setMessage(r.ok ? 'Backed up ✓' : `Backup failed: ${r.error}`)
    } finally {
      setBusy(false)
    }
  }

  const doDownloadAll = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await downloadAllBlobs()
      setMessage(
        r.failed > 0
          ? `Downloaded ${r.downloaded}, ${r.failed} failed — try again later.`
          : `All report files are now on this device (${r.downloaded} downloaded).`,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mb-4">
      <CardTitle>Google Drive backup</CardTitle>

      {!isDriveConfigured() ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Backup isn't set up yet. This app backs up your data to a{' '}
          <b>"Health Tracker Data"</b> folder in your own Google Drive, so a lost or new phone can
          restore everything. Setting it up needs a one-time (free) Google Cloud step — ask Claude
          to walk you through it.
        </p>
      ) : !connected ? (
        <>
          <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
            Back up everything to a private folder in your own Google Drive. Used this app
            before? Connecting restores your previous data automatically.
          </p>
          <PrimaryButton onClick={doConnect} disabled={busy}>
            {busy ? 'Connecting…' : 'Connect Google Drive'}
          </PrimaryButton>
        </>
      ) : (
        <div className="text-sm">
          <div className="flex justify-between py-1">
            <span className="text-slate-500">Status</span>
            {meta.status === 'ok' ? (
              <span className="font-medium text-green-600 dark:text-green-400">
                Backed up · {timeAgo(meta.lastSyncAt)}
              </span>
            ) : meta.status === 'reconnect_needed' ? (
              <span className="font-medium text-amber-600 dark:text-amber-400">
                Backup paused — reconnect
              </span>
            ) : (
              <span className="font-medium text-red-600 dark:text-red-400">Error</span>
            )}
          </div>
          {meta.accountEmail && (
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Account</span>
              <span className="font-medium">{meta.accountEmail}</span>
            </div>
          )}
          {meta.status !== 'ok' && meta.lastError && (
            <p className="mt-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              {meta.lastError}
            </p>
          )}
          <div className="mt-3 space-y-2">
            <PrimaryButton onClick={doBackupNow} disabled={busy}>
              {busy
                ? 'Working…'
                : meta.status === 'reconnect_needed'
                  ? 'Reconnect & back up'
                  : 'Back up now'}
            </PrimaryButton>
            {(missing ?? 0) > 0 && (
              <button
                onClick={doDownloadAll}
                disabled={busy}
                className="w-full rounded-xl border border-brand-600 px-4 py-3 font-semibold text-brand-600 disabled:opacity-40"
              >
                Download {missing} report file{missing === 1 ? '' : 's'} for offline
              </button>
            )}
            <button
              onClick={() => {
                if (confirm('Stop backing up to Google Drive? Your data stays on this device.'))
                  void disconnectDrive()
              }}
              disabled={busy}
              className="w-full rounded-xl px-4 py-2 text-sm font-medium text-slate-400 hover:text-red-600"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}

      {message && (
        <p className="mt-3 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {message}
        </p>
      )}
    </Card>
  )
}
