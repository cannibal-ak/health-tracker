import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router'
import type { Report, ReportCategory } from '../../db/schema'
import { addReport, deleteReport, liveReports, updateReport } from '../../db/repo'
import { fullDate, todayISO } from '../../lib/dates'
import { downscaleImage } from '../../lib/images'
import { formatBytes } from '../../lib/persistence'
import { extractFromReport, type ExtractionOutcome } from '../../ai/extraction'
import { Card, CardTitle } from '../../ui/Card'
import { Sheet } from '../../ui/Sheet'
import { EmptyState } from '../../ui/EmptyState'
import { Field, PrimaryButton, Select, TextInput } from '../../ui/Field'
import { ChevronRightIcon, FileIcon, PlusIcon, TrashIcon } from '../../ui/Icons'
import { ExtractionReview } from '../metrics/ExtractionReview'
import { pdfThumbnail } from './pdfUtils'
import { ReportThumb } from './ReportThumb'
import { ReportViewer } from './ReportViewer'

const CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: 'blood_test', label: 'Blood test' },
  { value: 'imaging', label: 'Imaging / scan' },
  { value: 'prescription', label: 'Prescription' },
  { value: 'other', label: 'Other' },
]

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label])) as Record<
  ReportCategory,
  string
>

function titleFromFilename(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim()
  return base.length > 2 ? base : ''
}

export function ReportsPage() {
  const reports = useLiveQuery(liveReports)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<ReportCategory | 'all'>('all')
  const [viewing, setViewing] = useState<Report | null>(null)

  // Upload/edit sheet state
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<Report | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [thumb, setThumb] = useState<Blob | undefined>(undefined)
  const [thumbErr, setThumbErr] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayISO())
  const [category, setCategory] = useState<ReportCategory>('blood_test')
  const [tags, setTags] = useState('')
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pickSeq = useRef(0)

  // AI extraction
  const [extractingId, setExtractingId] = useState<string | null>(null)
  const [review, setReview] = useState<{ report: Report; outcome: ExtractionOutcome } | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  const runExtraction = async (r: Report) => {
    if (extractingId) return
    setAiError(null)
    setExtractingId(r.id)
    try {
      const outcome = await extractFromReport(r)
      setReview({ report: r, outcome })
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Extraction failed')
    } finally {
      setExtractingId(null)
    }
  }

  const filtered = useMemo(() => {
    if (!reports) return []
    const q = search.trim().toLowerCase()
    return reports.filter((r) => {
      if (catFilter !== 'all' && r.category !== catFilter) return false
      if (!q) return true
      return (
        r.title.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
      )
    })
  }, [reports, search, catFilter])

  if (!reports) return null

  const openAdd = () => {
    setEditing(null)
    setFile(null)
    setThumb(undefined)
    setThumbErr(false)
    setTitle('')
    setDate(todayISO())
    setCategory('blood_test')
    setTags('')
    setSheetOpen(true)
  }

  const openEdit = (r: Report) => {
    setEditing(r)
    setFile(null)
    setThumb(undefined)
    setThumbErr(false)
    setTitle(r.title)
    setDate(r.reportDate)
    setCategory(r.category)
    setTags(r.tags.join(', '))
    setSheetOpen(true)
  }

  const MAX_FILE_BYTES = 25 * 1024 * 1024

  const onPickFile = async (f: File) => {
    if (f.size > MAX_FILE_BYTES) {
      setFile(null)
      setThumb(undefined)
      setThumbErr(false)
      setAiError(`That file is ${formatBytes(f.size)} — the limit is 25 MB.`)
      return
    }
    setAiError(null)
    // Sequence guard: a slow thumbnail for a previously picked file must not
    // overwrite the thumbnail of the one picked after it.
    const seq = ++pickSeq.current
    setFile(f)
    setThumb(undefined)
    setThumbErr(false)
    if (!title) setTitle(titleFromFilename(f.name))
    try {
      let t: Blob | undefined
      if (f.type === 'application/pdf') t = await pdfThumbnail(f)
      else if (f.type.startsWith('image/')) t = await downscaleImage(f, 320, 0.8)
      if (seq === pickSeq.current && t) setThumb(t)
    } catch {
      // Thumbnail is best-effort; the list falls back to a file icon.
      if (seq === pickSeq.current) setThumbErr(true)
    }
  }

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= todayISO()

  const save = async () => {
    if (saving || !dateValid) return
    const tagList = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    setSaving(true)
    try {
      if (editing) {
        await updateReport(editing.id, {
          title: title.trim(),
          reportDate: date,
          category,
          tags: tagList,
        })
      } else if (file) {
        // Photos are re-encoded to JPEG at ingest: smaller, and viewable on
        // every device (iPhone HEIC originals are not). Fall back to the
        // original if the browser can't decode the format.
        let toStore: Blob & { type: string } = file
        if (file.type.startsWith('image/') && file.type !== 'image/jpeg') {
          try {
            toStore = await downscaleImage(file, 3000, 0.9)
          } catch {
            toStore = file
          }
        }
        await addReport({
          title: title.trim() || file.name,
          reportDate: date,
          category,
          tags: tagList,
          file: toStore,
          thumb,
        })
      }
      setSheetOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="py-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reports</h1>
        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 rounded-full bg-brand-600 py-2 pr-4 pl-3 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <PlusIcon className="size-4" /> Add report
        </button>
      </div>

      {reports.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileIcon className="size-12" />}
            title="No reports yet"
            message="Keep every checkup in one place — photograph a paper report or add a PDF from your files."
            action={
              <button
                onClick={openAdd}
                className="rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-700"
              >
                Add your first report
              </button>
            }
          />
        </Card>
      ) : (
        <>
          <Link
            to="/metrics"
            className="mb-3 flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-sm font-medium shadow-sm ring-1 ring-slate-900/5 hover:bg-slate-50 dark:bg-slate-900 dark:ring-white/10 dark:hover:bg-slate-800"
          >
            📊 Health metrics & trends
            <ChevronRightIcon className="size-4 text-slate-400" />
          </Link>

          {aiError && (
            <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {aiError}
            </p>
          )}

          <div className="mb-3">
            <TextInput
              type="search"
              placeholder="Search title or tags…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
            {(['all', ...CATEGORIES.map((c) => c.value)] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCatFilter(c)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                  catFilter === c
                    ? 'bg-brand-600 text-white'
                    : 'bg-white text-slate-500 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700'
                }`}
              >
                {c === 'all' ? 'All' : CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>

          <Card>
            <CardTitle>
              {filtered.length} report{filtered.length === 1 ? '' : 's'}
            </CardTitle>
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">Nothing matches.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-3">
                    <button
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => setViewing(r)}
                    >
                      <ReportThumb blobId={r.blobId} alt="" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{r.title}</span>
                        <span className="block text-xs text-slate-500">
                          {fullDate(r.reportDate)} · {CATEGORY_LABEL[r.category]} ·{' '}
                          {formatBytes(r.sizeBytes)}
                        </span>
                        {r.tags.length > 0 && (
                          <span className="mt-0.5 block truncate text-xs text-brand-600">
                            {r.tags.map((t) => `#${t}`).join(' ')}
                          </span>
                        )}
                      </span>
                    </button>
                    <button
                      aria-label={`Extract values from ${r.title} with AI`}
                      onClick={() => void runExtraction(r)}
                      disabled={extractingId !== null}
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        extractingId === r.id
                          ? 'animate-pulse text-brand-600'
                          : r.extractionStatus === 'reviewed'
                            ? 'text-green-600'
                            : 'text-slate-400 hover:text-brand-600'
                      }`}
                    >
                      {extractingId === r.id
                        ? 'Reading…'
                        : r.extractionStatus === 'reviewed'
                          ? '✓ AI'
                          : '✨ AI'}
                    </button>
                    <button
                      aria-label={`Edit ${r.title}`}
                      onClick={() => openEdit(r)}
                      className="rounded-full px-2 py-1 text-xs font-semibold text-slate-400 hover:text-brand-600"
                    >
                      Edit
                    </button>
                    <button
                      aria-label={`Delete ${r.title}`}
                      onClick={() => {
                        if (
                          confirm(
                            `Delete "${r.title}"? The file will be removed from this device.`,
                          )
                        )
                          void deleteReport(r.id)
                      }}
                      className="rounded-full p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                    >
                      <TrashIcon className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={editing ? 'Edit report' : 'Add report'}
      >
        {!editing && (
          <Field label="File" hint="Photograph the paper report or pick a PDF/photo.">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onPickFile(f)
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 px-4 py-4 text-left text-sm dark:border-slate-600"
            >
              {file ? (
                <>
                  {thumb ? (
                    <ThumbPreview blob={thumb} />
                  ) : (
                    <FileIcon className="size-8 text-slate-400" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{file.name}</span>
                    <span className="text-xs text-slate-500">
                      {formatBytes(file.size)}
                      {thumbErr ? ' · preview unavailable' : ''}
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <PlusIcon className="size-6 text-slate-400" />
                  <span className="text-slate-500">Choose a photo or PDF…</span>
                </>
              )}
            </button>
          </Field>
        )}
        <Field label="Title">
          <TextInput
            type="text"
            placeholder="e.g. Annual checkup — lipid panel"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Report date">
            <TextInput
              type="date"
              value={date}
              max={todayISO()}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Category">
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value as ReportCategory)}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Tags (optional)" hint="Comma-separated, e.g. diabetes, dr-sharma">
          <TextInput
            type="text"
            placeholder="tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </Field>
        {!dateValid && (
          <p className="mb-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
            Pick a valid report date (not in the future).
          </p>
        )}
        <PrimaryButton
          onClick={save}
          disabled={saving || !dateValid || (!editing && !file) || (!title.trim() && !file)}
        >
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Save report'}
        </PrimaryButton>
      </Sheet>

      <Sheet
        open={review !== null}
        onClose={() => setReview(null)}
        title="Review extracted values"
      >
        {review && (
          <ExtractionReview
            report={review.report}
            outcome={review.outcome}
            onDone={() => setReview(null)}
          />
        )}
      </Sheet>

      {viewing && <ReportViewer report={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

function ThumbPreview({ blob }: { blob: Blob }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return <img src={url} alt="" className="size-12 rounded-lg object-cover" />
}
