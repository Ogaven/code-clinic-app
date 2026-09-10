'use client'

import { useEffect, useRef } from 'react'

// Accessible modal shell — backdrop click closes, click inside the panel
// does not (native <select> option lists render as OS-level popups, not DOM
// children, so they never trigger this backdrop's click handler either),
// Escape closes, body scroll is locked while mounted, focus is trapped and
// cycles with Tab, and focus returns to whatever triggered the modal on
// close. Panel content that's taller than the viewport scrolls internally
// (max-h-[90vh] overflow-y-auto) instead of being cut off on mobile.
export default function Modal({
  onClose, labelledBy, className, children,
}: {
  onClose: () => void
  labelledBy?: string
  className?: string
  children: React.ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = original }
  }, [])

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const panel = panelRef.current

    const focusable = () => panel
      ? Array.from(panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )).filter(el => el.offsetParent !== null)
      : []

    ;(focusable()[0] ?? panel)?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (e.key === 'Tab') {
        const els = focusable()
        if (els.length === 0) return
        const first = els[0], last = els[els.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused.current?.focus?.()
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        className={className ?? 'w-full max-w-md max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-2xl shadow-2xl animate-fade-in outline-none'}
      >
        {children}
      </div>
    </div>
  )
}