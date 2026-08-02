import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getProfile, saveProfile } from '../../db/repo'
import type { Profile } from '../../db/schema'
import {
  formatBytes,
  getStorageInfo,
  requestPersistentStorage,
  type StorageInfo,
} from '../../lib/persistence'
import { Card, CardTitle } from '../../ui/Card'
import { Field, Segmented, Select, TextInput } from '../../ui/Field'
import { ShareIcon } from '../../ui/Icons'
import { DriveCard } from './DriveCard'
import { AICard } from './AICard'
import { shareExportZip } from '../../lib/exportZip'

function ExportButton() {
  const [busy, setBusy] = useState(false)
  return (
    <button
      onClick={async () => {
        setBusy(true)
        try {
          await shareExportZip()
        } finally {
          setBusy(false)
        }
      }}
      disabled={busy}
      className="w-full rounded-xl border border-brand-600 px-4 py-3 font-semibold text-brand-600 disabled:opacity-40"
    >
      {busy ? 'Preparing…' : 'Export everything (ZIP)'}
    </button>
  )
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari legacy flag
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
  )
}

function isIOS(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
}

export function SettingsPage() {
  const profile = useLiveQuery(getProfile)
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [heightError, setHeightError] = useState<string | null>(null)

  useEffect(() => {
    void getStorageInfo().then(setStorage)
  }, [])

  if (!profile) return null

  // saveProfile merges partial changes against the stored profile in a
  // transaction — never spread the render-time snapshot here.
  const update = (changes: Partial<Profile>) => {
    void saveProfile(changes)
  }

  return (
    <div className="py-4">
      <h1 className="mb-4 text-2xl font-bold">Settings</h1>

      <Card className="mb-4">
        <CardTitle>Profile</CardTitle>
        <Field label="Name">
          <TextInput
            type="text"
            placeholder="Your name"
            defaultValue={profile.name ?? ''}
            onBlur={(e) => update({ name: e.target.value.trim() || undefined })}
          />
        </Field>
        <Field label="Height (cm)" hint="Needed for BMI — 170 cm = 5 ft 7 in">
          <TextInput
            type="number"
            inputMode="decimal"
            min="80"
            max="250"
            placeholder="e.g. 172"
            defaultValue={profile.heightCm ?? ''}
            onBlur={(e) => {
              const raw = e.target.value.trim()
              if (raw === '') {
                setHeightError(null)
                update({ heightCm: undefined })
                return
              }
              const v = parseFloat(raw)
              if (Number.isFinite(v) && v >= 80 && v <= 250) {
                setHeightError(null)
                update({ heightCm: v })
              } else {
                // Don't silently discard — tell the user and keep the old value.
                setHeightError('Height must be between 80 and 250 cm — not saved.')
              }
            }}
          />
          {heightError && (
            <span className="mt-1 block text-xs font-medium text-red-600">{heightError}</span>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Birth year">
            <TextInput
              type="number"
              inputMode="numeric"
              placeholder="e.g. 1994"
              min="1920"
              max={String(new Date().getFullYear())}
              defaultValue={profile.birthYear ?? ''}
              onBlur={(e) => {
                const v = parseInt(e.target.value, 10)
                update({ birthYear: v >= 1920 ? v : undefined })
              }}
            />
          </Field>
          <Field label="Sex">
            <Select
              value={profile.sex ?? ''}
              onChange={(e) =>
                update({ sex: (e.target.value || undefined) as Profile['sex'] })
              }
            >
              <option value="">—</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </Select>
          </Field>
        </div>
        <Field label="Weight unit">
          <Segmented
            value={profile.weightUnit}
            onChange={(weightUnit) => update({ weightUnit })}
            options={[
              { value: 'kg', label: 'Kilograms (kg)' },
              { value: 'lb', label: 'Pounds (lb)' },
            ]}
          />
        </Field>
      </Card>

      <DriveCard />

      <AICard />

      {!isStandalone() && (
        <Card className="mb-4">
          <CardTitle>Install this app</CardTitle>
          {isIOS() ? (
            <ol className="list-inside list-decimal space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
              <li>
                Tap the <ShareIcon className="inline size-4 align-text-bottom" /> Share button in
                Safari
              </li>
              <li>
                Scroll down and tap <b>Add to Home Screen</b>
              </li>
              <li>
                Tap <b>Add</b> — then open the app from your home screen
              </li>
            </ol>
          ) : (
            <ol className="list-inside list-decimal space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
              <li>Open the browser menu (⋮)</li>
              <li>
                Tap <b>Install app</b> (or <b>Add to Home screen</b>)
              </li>
            </ol>
          )}
          <p className="mt-3 text-xs text-slate-400">
            Important: use the installed app (not the browser tab) — your data lives inside it.
          </p>
        </Card>
      )}

      <Card className="mb-4">
        <CardTitle>Storage</CardTitle>
        {storage ? (
          <div className="text-sm text-slate-600 dark:text-slate-300">
            {storage.quotaBytes > 0 && storage.usageBytes / storage.quotaBytes > 0.8 && (
              <p className="mb-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                Storage is nearly full — deleting old reports (they stay in your Drive backup)
                frees space.
              </p>
            )}
            <div className="flex justify-between py-1">
              <span>Used</span>
              <span className="font-medium">{formatBytes(storage.usageBytes)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span>Available</span>
              <span className="font-medium">{formatBytes(storage.quotaBytes)}</span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span>Protected from cleanup</span>
              {storage.persisted ? (
                <span className="font-medium text-green-600 dark:text-green-400">Yes</span>
              ) : (
                <button
                  className="font-medium text-brand-600 underline"
                  onClick={async () => {
                    await requestPersistentStorage()
                    setStorage(await getStorageInfo())
                  }}
                >
                  Enable
                </button>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Storage info not available in this browser.</p>
        )}
      </Card>

      <Card className="mb-4">
        <CardTitle>Export</CardTitle>
        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
          One ZIP with all your data (JSON) and every report file. Keep it anywhere you like —
          it never includes your API keys.
        </p>
        <ExportButton />
      </Card>

      <Card>
        <CardTitle>About</CardTitle>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Health Tracker — your personal health companion.
        </p>
        <p className="mt-2 text-xs text-slate-400">
          Your data lives on your device and, if connected, in your own Google Drive. AI features
          run only with your own keys. Nothing here is medical advice.
        </p>
      </Card>
    </div>
  )
}
