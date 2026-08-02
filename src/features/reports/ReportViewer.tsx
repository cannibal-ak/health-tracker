import { useEffect, useRef, useState } from 'react'
import type { Report } from '../../db/schema'
import { ensureReportBlob } from '../../sync/syncEngine'
import { fullDate } from '../../lib/dates'
import { XIcon } from '../../ui/Icons'
import { openPdf } from './pdfUtils'

const MAX_RENDER_PAGES = 30

/** Full-screen viewer: images via object URL, PDFs rendered page-by-page. */
export function ReportViewer({ report, onClose }: { report: Report; onClose: () => void }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pageInfo, setPageInfo] = useState<{ rendered: number; total: number } | null>(null)
  const pagesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    let destroyPdf: (() => void) | null = null

    void (async () => {
      // Local first; falls back to downloading from Drive when connected.
      const blob = await ensureReportBlob(report)
      if (cancelled) return
      if (!blob) {
        setError(
          report.driveFileId
            ? 'This file is in your Drive backup but could not be downloaded right now. Check your connection and Drive status in Settings.'
            : 'The file for this report is missing on this device.',
        )
        return
      }
      const row = { blob }
      if (row.blob.type === 'application/pdf') {
        try {
          const doc = await openPdf(row.blob)
          destroyPdf = doc.destroy
          const total = Math.min(doc.numPages, MAX_RENDER_PAGES)
          const width = Math.min(window.innerWidth, 800) * (window.devicePixelRatio > 1 ? 2 : 1)
          for (let i = 1; i <= total; i++) {
            if (cancelled) return
            const canvas = await doc.renderPage(i, width)
            canvas.className = 'w-full rounded-lg bg-white shadow'
            pagesRef.current?.appendChild(canvas)
            setPageInfo({ rendered: i, total: doc.numPages })
          }
        } catch (e) {
          if (!cancelled) setError(`Could not open this PDF. ${e instanceof Error ? e.message : ''}`)
        }
      } else {
        objectUrl = URL.createObjectURL(row.blob)
        setImageUrl(objectUrl)
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      destroyPdf?.()
    }
  }, [report])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/95">
      <div className="pt-safe flex items-center gap-3 px-4 py-3 text-white">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{report.title}</div>
          <div className="text-xs text-slate-400">{fullDate(report.reportDate)}</div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close viewer"
          className="rounded-full bg-white/10 p-2 hover:bg-white/20"
        >
          <XIcon className="size-5" />
        </button>
      </div>

      <div className="pb-safe flex-1 overflow-auto px-3 pb-4">
        {error && (
          <div className="mx-auto mt-16 max-w-xs rounded-xl bg-red-50 p-4 text-center text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}
        {imageUrl && (
          <img src={imageUrl} alt={report.title} className="mx-auto max-w-full rounded-lg" />
        )}
        <div ref={pagesRef} className="mx-auto max-w-3xl space-y-3" />
        {pageInfo && pageInfo.total > MAX_RENDER_PAGES && pageInfo.rendered >= MAX_RENDER_PAGES && (
          <p className="py-3 text-center text-xs text-slate-400">
            Showing the first {MAX_RENDER_PAGES} of {pageInfo.total} pages.
          </p>
        )}
        {!error && !imageUrl && (!pageInfo || pageInfo.rendered < Math.min(pageInfo.total, MAX_RENDER_PAGES)) && (
          <p className="py-8 text-center text-sm text-slate-400">
            {pageInfo ? `Rendering page ${pageInfo.rendered + 1}…` : 'Opening…'}
          </p>
        )}
      </div>
    </div>
  )
}
