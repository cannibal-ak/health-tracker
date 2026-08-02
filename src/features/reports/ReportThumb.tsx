import { useEffect, useState } from 'react'
import { getReportBlob } from '../../db/repo'
import { FileIcon } from '../../ui/Icons'

/** Small thumbnail for a report row; falls back to a file icon. */
export function ReportThumb({ blobId, alt }: { blobId: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    void getReportBlob(blobId).then((row) => {
      if (cancelled) return
      const source = row?.thumb ?? (row?.blob.type.startsWith('image/') ? row.blob : null)
      if (source) {
        objectUrl = URL.createObjectURL(source)
        setUrl(objectUrl)
      }
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [blobId])

  if (!url) {
    return (
      <div className="flex size-12 items-center justify-center rounded-lg bg-slate-100 text-slate-400 dark:bg-slate-800">
        <FileIcon className="size-6" />
      </div>
    )
  }
  return <img src={url} alt={alt} className="size-12 rounded-lg object-cover" />
}
