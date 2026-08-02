/** Turn a report's binary into a PreparedDoc for the chosen provider. */
import type { Report } from '../db/schema'
import { ensureReportBlob } from '../sync/syncEngine'
import { downscaleImage } from '../lib/images'
import { openPdf } from '../features/reports/pdfUtils'
import { canvasToJpeg } from '../lib/images'
import { AIProviderError, type PreparedDoc } from './types'

const MAX_PDF_BYTES = 15 * 1024 * 1024 // stay under provider inline limits
const MAX_PAGES = 10
const PAGE_WIDTH = 1400 // px — readable lab tables without huge payloads
const PHOTO_EDGE = 2000

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = reader.result as string
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export interface PrepInfo {
  doc: PreparedDoc
  note?: string
}

export async function prepareReportDoc(
  report: Report,
  supportsNativePdf: boolean,
): Promise<PrepInfo> {
  const blob = await ensureReportBlob(report)
  if (!blob) {
    throw new AIProviderError(
      'The report file is not available on this device (check Drive connection in Settings).',
    )
  }

  if (report.mimeType === 'application/pdf') {
    if (supportsNativePdf && blob.size <= MAX_PDF_BYTES) {
      return { doc: { kind: 'pdf', pdfBase64: await blobToBase64(blob) } }
    }
    // Render pages to JPEGs (provider can't take PDFs, or file too large).
    const pdf = await openPdf(blob)
    try {
      const total = Math.min(pdf.numPages, MAX_PAGES)
      const images: string[] = []
      for (let i = 1; i <= total; i++) {
        const canvas = await pdf.renderPage(i, PAGE_WIDTH)
        images.push(await blobToBase64(await canvasToJpeg(canvas, 0.85)))
      }
      return {
        doc: { kind: 'images', images },
        note:
          pdf.numPages > MAX_PAGES
            ? `Only the first ${MAX_PAGES} of ${pdf.numPages} pages were sent to the AI.`
            : undefined,
      }
    } finally {
      pdf.destroy()
    }
  }

  // Photo: downscale to keep the payload mobile-friendly.
  const scaled = await downscaleImage(blob, PHOTO_EDGE, 0.85)
  return { doc: { kind: 'images', images: [await blobToBase64(scaled)] } }
}
