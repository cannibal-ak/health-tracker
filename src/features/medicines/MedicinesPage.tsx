import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Medicine } from '../../db/schema'
import { addMedicine, deleteMedicine, liveMedicines, updateMedicine } from '../../db/repo'
import { fullDate, todayISO } from '../../lib/dates'
import { Card, CardTitle } from '../../ui/Card'
import { Sheet } from '../../ui/Sheet'
import { EmptyState } from '../../ui/EmptyState'
import { Field, PrimaryButton, TextInput } from '../../ui/Field'
import { PlusIcon, TrashIcon } from '../../ui/Icons'

export function MedicinesPage() {
  const medicines = useLiveQuery(liveMedicines)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<Medicine | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [dose, setDose] = useState('')
  const [timing, setTiming] = useState('')
  const [reason, setReason] = useState('')
  const [startDate, setStartDate] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  if (!medicines) return null

  const active = medicines.filter((m) => m.active)
  const stopped = medicines.filter((m) => !m.active)

  const openAdd = () => {
    setEditing(null)
    setName('')
    setDose('')
    setTiming('')
    setReason('')
    setStartDate('')
    setNote('')
    setSheetOpen(true)
  }

  const openEdit = (m: Medicine) => {
    setEditing(m)
    setName(m.name)
    setDose(m.dose ?? '')
    setTiming(m.timing ?? '')
    setReason(m.reason ?? '')
    setStartDate(m.startDate ?? '')
    setNote(m.note ?? '')
    setSheetOpen(true)
  }

  const save = async () => {
    if (saving || !name.trim()) return
    if (startDate && (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || startDate > todayISO())) return
    setSaving(true)
    try {
      const data = {
        name: name.trim(),
        dose: dose.trim() || undefined,
        timing: timing.trim() || undefined,
        reason: reason.trim() || undefined,
        startDate: startDate || undefined,
        note: note.trim() || undefined,
      }
      if (editing) {
        await updateMedicine(editing.id, data)
      } else {
        await addMedicine({ ...data, active: true })
      }
      setSheetOpen(false)
    } finally {
      setSaving(false)
    }
  }

  const renderRow = (m: Medicine) => (
    <li key={m.id} className="flex items-center gap-2 py-3">
      <button className="min-w-0 flex-1 text-left" onClick={() => openEdit(m)}>
        <span className={`block truncate font-semibold ${m.active ? '' : 'text-slate-400 line-through'}`}>
          💊 {m.name}
          {m.dose ? ` · ${m.dose}` : ''}
        </span>
        <span className="block truncate text-xs text-slate-500">
          {[m.timing, m.reason, m.startDate ? `since ${fullDate(m.startDate)}` : null]
            .filter(Boolean)
            .join(' · ') || 'tap to add details'}
        </span>
      </button>
      <button
        aria-label={`${m.active ? 'Stop' : 'Resume'} ${m.name}`}
        onClick={() => void updateMedicine(m.id, { active: !m.active })}
        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
          m.active
            ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
            : 'bg-slate-100 text-slate-400 dark:bg-slate-800'
        }`}
      >
        {m.active ? 'Taking' : 'Stopped'}
      </button>
      <button
        aria-label={`Delete ${m.name}`}
        onClick={() => {
          if (confirm(`Delete "${m.name}" completely? Use "Stopped" to keep it in history.`))
            void deleteMedicine(m.id)
        }}
        className="shrink-0 rounded-full p-2 text-slate-400 hover:text-red-600"
      >
        <TrashIcon className="size-4" />
      </button>
    </li>
  )

  return (
    <div className="py-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Medicines</h1>
        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 rounded-full bg-brand-600 py-2 pr-4 pl-3 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <PlusIcon className="size-4" /> Add
        </button>
      </div>

      <p className="mb-4 rounded-xl bg-slate-100 p-3 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        A private record of what you take and why — the health chat uses it for context. It never
        replaces your doctor's or pharmacist's instructions.
      </p>

      {medicines.length === 0 ? (
        <Card>
          <EmptyState
            title="No medicines recorded"
            message="Add what you're currently taking — tablets, syrups, vitamins, supplements — with the dose and what it's for."
            action={
              <button
                onClick={openAdd}
                className="rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-700"
              >
                Add your first medicine
              </button>
            }
          />
        </Card>
      ) : (
        <>
          {active.length > 0 && (
            <Card className="mb-4">
              <CardTitle>Currently taking</CardTitle>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {active.map(renderRow)}
              </ul>
            </Card>
          )}
          {stopped.length > 0 && (
            <Card>
              <CardTitle>Stopped</CardTitle>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {stopped.map(renderRow)}
              </ul>
            </Card>
          )}
        </>
      )}

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={editing ? 'Edit medicine' : 'Add medicine'}
      >
        <Field label="Name">
          <TextInput
            type="text"
            placeholder="e.g. Vitamin D3, Metformin"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus={!editing}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dose (optional)">
            <TextInput
              type="text"
              placeholder="e.g. 500 mg"
              value={dose}
              onChange={(e) => setDose(e.target.value)}
            />
          </Field>
          <Field label="When (optional)">
            <TextInput
              type="text"
              placeholder="e.g. 1-0-1 after food"
              value={timing}
              onChange={(e) => setTiming(e.target.value)}
            />
          </Field>
        </div>
        <Field label="What is it for? (optional)">
          <TextInput
            type="text"
            placeholder="e.g. Vitamin D deficiency"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <Field label="Taking since (optional)">
          <TextInput
            type="date"
            value={startDate}
            max={todayISO()}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Field>
        <Field label="Note (optional)">
          <TextInput
            type="text"
            placeholder="e.g. prescribed by Dr. Sharma"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <PrimaryButton onClick={save} disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Save medicine'}
        </PrimaryButton>
      </Sheet>
    </div>
  )
}
