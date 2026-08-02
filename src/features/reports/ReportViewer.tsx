import { useEffect, useRef, useState } from 'react'
import type { Report } from '../../db/schema'
import { ensureReportBlob } from '../../sync/syncEngine'
import { canvasToJpeg } from '../../lib/images'
import { fullDate } from '../../lib/dates'
import { XIcon } from '../../ui/Icons'
import { useBodyScrollLock } from '../../ui/useBodyScrollLock'
import { openPdf } from './pdfUtils'

const MAX_RENDER_PAGES = 30

/**
 * Full-screen viewer. PDF pages are rendered one at a time and kept as
 * JPEG <img> elements — live canvases would exhaust iOS Safari's canvas
 * memory budget on multi-page documents.
 */
export function ReportViewer({ report, onClose }: { report: Report; onClose: () => void }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageBroken, setImageBroken] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pageInfo, setPageInfo] = useState<{ rendered: number; total: number } | null>(null)
  const pagesRef = useRef<HTMLDivElement>(null)

  useBodyScrollLock(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    const objectUrls: string[] = []
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
      if (blob.type === 'application/pdf') {
        try {
          const doc = await openPdf(blob)
          destroyPdf = doc.destroy
          const total = Math.min(doc.numPages, MAX_RENDER_PAGES)
          const width = Math.min(window.innerWidth, 800) * Math.min(window.devicePixelRatio, 2)
          for (let i = 1; i <= total; i++) {
            if (cancelled) return
            const canvas = await doc.renderPage(i, width)
            const jpeg = await canvasToJpeg(canvas, 0.85)
            canvas.width = 0 // release canvas memory immediately
            canvas.height = 0
            if (cancelled) return
            const url = URL.createObjectURL(jpeg)
            objectUrls.push(url)
            const img = document.createElement('img')
            img.src = url
            img.className = 'w-full rounded-lg bg-white shadow'
            img.alt = `Page ${i}`
            pagesRef.current?.appendChild(img)
            setPageInfo({ rendered: i, total: doc.numPages })
          }
        } catch (e) {
          if (!cancelled) setError(`Could not open this PDF. ${e instanceof Error ? e.message : ''}`)
        }
      } else {
        const url = URL.createObjectURL(blob)
        objectUrls.push(url)
        setImageUrl(url)
      }
    })()

    return () => {
      cancelled = true
      objectUrls.forEach((u) => URL.revokeObjectURL(u))
      destroyPdf?.()
    }
  }, [report])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={report.title}
      className="fixed inset-0 z-50 flex flex-col bg-slate-950/95"
    >
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

      <div className="flex-1 overflow-auto px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {error && (
          <div className="mx-auto mt-16 max-w-xs rounded-xl bg-red-50 p-4 text-center text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}
        {imageUrl && !imageBroken && (
          <img
            src={imageUrl}
            alt={report.title}
            onError={() => setImageBroken(true)}
            className="mx-auto max-w-full rounded-lg"
          />
        )}
        {imageBroken && (
          <div className="mx-auto mt-16 max-w-xs rounded-xl bg-amber-50 p-4 text-center text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            This photo format can't be displayed by this browser (often HEIC from an iPhone).
            Re-add the report as a JPEG or PNG to view it everywhere.
          </div>
        )}
        <div ref={pagesRef} className="mx-auto max-w-3xl space-y-3" />
        {pageInfo && pageInfo.total > MAX_RENDER_PAGES && pageInfo.rendered >= MAX_RENDER_PAGES && (
          <p className="py-3 text-center text-xs text-slate-400">
            Showing the first {MAX_RENDER_PAGES} of {pageInfo.total} pages.
          </p>
        )}
        {!error && !imageUrl && !imageBroken && (!pageInfo || pageInfo.rendered < Math.min(pageInfo.total, MAX_RENDER_PAGES)) && (
          <p className="py-8 text-center text-sm text-slate-400">
            {pageInfo ? `Rendering page ${pageInfo.rendered + 1}…` : 'Opening…'}
          </p>
        )}
      </div>
    </div>
  )
}
