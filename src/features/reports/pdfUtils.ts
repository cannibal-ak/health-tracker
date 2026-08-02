/**
 * pdf.js helpers. The library is imported lazily so the ~400KB worker/lib
 * only loads when the user actually touches a PDF.
 */
import { canvasToJpeg } from '../../lib/images'

type PdfJs = typeof import('pdfjs-dist')

let pdfjsPromise: Promise<PdfJs> | null = null

async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist')
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      return pdfjs
    })()
  }
  return pdfjsPromise
}

export interface PdfDoc {
  numPages: number
  /** Render one page (1-based) to a canvas sized so its width is `targetWidth` px. */
  renderPage(pageNo: number, targetWidth: number): Promise<HTMLCanvasElement>
  destroy(): void
}

export async function openPdf(blob: Blob): Promise<PdfDoc> {
  const pdfjs = await loadPdfJs()
  const data = await blob.arrayBuffer()
  const doc = await pdfjs.getDocument({ data }).promise
  return {
    numPages: doc.numPages,
    async renderPage(pageNo, targetWidth) {
      const page = await doc.getPage(pageNo)
      const base = page.getViewport({ scale: 1 })
      const scale = targetWidth / base.width
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
      return canvas
    },
    destroy() {
      void doc.loadingTask.destroy()
    },
  }
}

/** First page of a PDF as a small JPEG thumbnail. */
export async function pdfThumbnail(blob: Blob, width = 320): Promise<Blob> {
  const doc = await openPdf(blob)
  try {
    const canvas = await doc.renderPage(1, width)
    return await canvasToJpeg(canvas, 0.8)
  } finally {
    doc.destroy()
  }
}
