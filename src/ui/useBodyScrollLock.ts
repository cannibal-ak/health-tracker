import { useEffect } from 'react'

/**
 * Lock body scrolling while an overlay is open. `overflow: hidden` alone
 * does not work on iOS Safari — pin the body and restore scroll on close.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const scrollY = window.scrollY
    const { position, top, width, overflow } = document.body.style
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.position = position
      document.body.style.top = top
      document.body.style.width = width
      document.body.style.overflow = overflow
      window.scrollTo(0, scrollY)
    }
  }, [active])
}
