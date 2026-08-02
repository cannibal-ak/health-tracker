import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router'
import { db } from '../../db/db'
import { addWorkout, appendChatMessage, clearChat, liveChat } from '../../db/repo'
import {
  mightDescribeWorkout,
  parseWorkoutFromText,
  sendGuidanceMessage,
  type ParsedWorkout,
} from '../../ai/guidance'
import { AIProviderError } from '../../ai/types'
import { todayISO } from '../../lib/dates'
import { TrashIcon } from '../../ui/Icons'

const ACK_KEY = 'ht-guidance-ack'

export function GuidancePage() {
  const messages = useLiveQuery(liveChat)
  const aiConfig = useLiveQuery(() => db.settings.get('aiConfig'))
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingWorkout, setPendingWorkout] = useState<ParsedWorkout | null>(null)
  const [savingWorkout, setSavingWorkout] = useState(false)
  const [acked, setAcked] = useState(() => localStorage.getItem(ACK_KEY) === '1')
  const bottomRef = useRef<HTMLDivElement>(null)
  const parseSeq = useRef(0)

  const configured = Boolean(
    (aiConfig?.value as { activeProvider?: string | null } | undefined)?.activeProvider,
  )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages?.length, busy])

  if (!messages) return null

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setError(null)
    setInput('')
    setPendingWorkout(null)
    setBusy(true)
    try {
      await appendChatMessage('user', text)
      const history = [...messages.map((m) => ({ role: m.role, text: m.text })), { role: 'user' as const, text }]
      const reply = await sendGuidanceMessage(history)
      await appendChatMessage('assistant', reply)
      // Chat-to-log: if the message looks like a workout description, parse it
      // in the background and offer to save (never saved without a tap).
      // Sequence guard: only the LATEST message's parse may set the chip.
      if (mightDescribeWorkout(text)) {
        const seq = ++parseSeq.current
        void parseWorkoutFromText(text)
          .then((w) => {
            if (seq === parseSeq.current) setPendingWorkout(w)
          })
          .catch(() => {})
      }
    } catch (e) {
      setError(e instanceof AIProviderError ? e.message : 'Something went wrong — try again.')
    } finally {
      setBusy(false)
    }
  }

  const saveParsedWorkout = async () => {
    if (!pendingWorkout || savingWorkout) return
    setSavingWorkout(true)
    try {
      await addWorkout({ date: todayISO(), ...pendingWorkout })
      setPendingWorkout(null)
      await appendChatMessage('assistant', '📋 Saved that workout to your log — nice work!')
    } finally {
      setSavingWorkout(false)
    }
  }

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] flex-col py-4">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Health chat</h1>
        {messages.length > 0 && (
          <button
            aria-label="Clear conversation"
            onClick={() => {
              if (confirm('Clear this conversation?')) void clearChat()
            }}
            className="rounded-full p-2 text-slate-400 hover:text-red-600"
          >
            <TrashIcon className="size-4" />
          </button>
        )}
      </div>

      <p className="mb-3 rounded-xl bg-slate-100 px-3 py-2 text-[11px] leading-snug text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        General wellness information only — not medical advice. For anything concerning, talk to
        a doctor.
      </p>

      {!configured ? (
        <div className="rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-slate-900/5 dark:bg-slate-900 dark:ring-white/10">
          <p className="mb-1 font-semibold">Set up your AI assistant first</p>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            Add an API key in Settings, then ask things like "I did chest and triceps today —
            what should I eat?"
          </p>
          <Link
            to="/settings"
            className="inline-block rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-700"
          >
            Open Settings
          </Link>
        </div>
      ) : !acked ? (
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5 dark:bg-slate-900 dark:ring-white/10">
          <p className="mb-2 font-semibold">Before we chat</p>
          <ul className="mb-4 list-inside list-disc space-y-1 text-sm text-slate-500 dark:text-slate-400">
            <li>This chat gives general wellness suggestions, not medical advice.</li>
            <li>Your health data and messages are sent to the AI provider you configured.</li>
            <li>Always confirm anything important with a doctor.</li>
          </ul>
          <button
            onClick={() => {
              localStorage.setItem(ACK_KEY, '1')
              setAcked(true)
            }}
            className="w-full rounded-xl bg-brand-600 px-4 py-3 font-semibold text-white hover:bg-brand-700"
          >
            Got it
          </button>
        </div>
      ) : (
        <>
          <div className="flex-1 space-y-3 overflow-y-auto pb-2">
            {messages.length === 0 && (
              <div className="py-8 text-center text-sm text-slate-400">
                Try: "Did legs today — squats 4x8 at 60kg and lunges. What should I eat tonight?"
              </div>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'ml-auto rounded-br-md bg-brand-600 text-white'
                    : 'mr-auto rounded-bl-md bg-white shadow-sm ring-1 ring-slate-900/5 dark:bg-slate-800 dark:ring-white/10'
                }`}
              >
                {m.text}
              </div>
            ))}
            {busy && (
              <div className="mr-auto animate-pulse rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-sm text-slate-400 shadow-sm ring-1 ring-slate-900/5 dark:bg-slate-800 dark:ring-white/10">
                Thinking…
              </div>
            )}
            {error && (
              <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                {error}
              </p>
            )}
            <div ref={bottomRef} />
          </div>

          {pendingWorkout && (
            <div className="mb-2 flex items-center gap-2 rounded-xl bg-brand-50 p-3 text-sm dark:bg-brand-900/30">
              <span className="min-w-0 flex-1">
                Log this as a <b>{pendingWorkout.type}</b> workout
                {pendingWorkout.title ? ` (${pendingWorkout.title})` : ''}?
              </span>
              <button
                onClick={() => void saveParsedWorkout()}
                disabled={savingWorkout}
                className="shrink-0 rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                {savingWorkout ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => setPendingWorkout(null)}
                className="shrink-0 rounded-full px-2 py-1.5 text-xs font-semibold text-slate-500"
              >
                Dismiss
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void send()}
              placeholder="Ask about diet, recovery, training…"
              className="min-w-0 flex-1 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
            />
            <button
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              className="shrink-0 rounded-full bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </>
      )}
    </div>
  )
}
