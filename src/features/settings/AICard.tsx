import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { ProviderId } from '../../db/schema'
import { getAIConfig, saveAIConfig } from '../../db/repo'
import { PROVIDERS, PROVIDER_LIST } from '../../ai/registry'
import { Card, CardTitle } from '../../ui/Card'
import { Field, TextInput } from '../../ui/Field'

export function AICard() {
  const config = useLiveQuery(getAIConfig)
  const [keyDraft, setKeyDraft] = useState('')
  const [modelDraft, setModelDraft] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const active = config?.activeProvider ?? null
  const provider = active ? PROVIDERS[active] : null

  // Sync drafts when the selected provider changes.
  useEffect(() => {
    if (!config || !config.activeProvider) return
    setKeyDraft(config.keys[config.activeProvider] ?? '')
    setModelDraft(config.models[config.activeProvider] ?? '')
    setStatus(null)
  }, [config?.activeProvider]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!config) return null

  const selectProvider = (id: ProviderId) => {
    void saveAIConfig({ ...config, activeProvider: id })
  }

  const saveAndVerify = async () => {
    if (!active || !provider) return
    const key = keyDraft.trim()
    const model = modelDraft.trim()
    setBusy(true)
    setStatus(null)
    try {
      await saveAIConfig({
        ...config,
        keys: { ...config.keys, [active]: key || undefined },
        models: { ...config.models, [active]: model || undefined },
      })
      if (key) {
        await provider.validateKey(key)
        setStatus('✓ Key verified and saved (stored only on this device).')
      } else {
        setStatus('Key removed.')
      }
    } catch (e) {
      setStatus(`✗ ${e instanceof Error ? e.message : 'Verification failed'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mb-4">
      <CardTitle>AI assistant</CardTitle>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        Reads values from your reports and powers the health chat. Bring your own API key — it
        stays on this device and is sent only to the provider you choose.
      </p>

      <Field label="Provider">
        <div className="grid grid-cols-3 gap-1.5">
          {PROVIDER_LIST.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => selectProvider(p.id)}
              className={`rounded-xl border px-2 py-2.5 text-xs font-semibold ${
                active === p.id
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                  : 'border-slate-200 text-slate-500 dark:border-slate-700'
              }`}
            >
              {p.label}
              {config.keys[p.id] ? ' ✓' : ''}
            </button>
          ))}
        </div>
      </Field>

      {provider && (
        <>
          <Field
            label={`${provider.label} API key`}
            hint={`Get one at ${provider.keyHelpUrl.replace('https://', '')}`}
          >
            <TextInput
              type="password"
              autoComplete="off"
              placeholder={provider.keyPlaceholder}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
            />
          </Field>
          <Field label="Model" hint="Leave empty for the recommended default.">
            <TextInput
              type="text"
              placeholder={provider.defaultModel}
              value={modelDraft}
              onChange={(e) => setModelDraft(e.target.value)}
            />
          </Field>
          <button
            onClick={saveAndVerify}
            disabled={busy}
            className="w-full rounded-xl bg-brand-600 px-4 py-3 font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
          >
            {busy ? 'Verifying…' : 'Save & verify key'}
          </button>
        </>
      )}

      {status && (
        <p
          className={`mt-3 rounded-lg p-2.5 text-xs ${
            status.startsWith('✗')
              ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
              : 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
          }`}
        >
          {status}
        </p>
      )}
    </Card>
  )
}
