'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MoreSection } from '@/lib/mobileNav'

function hrefPath(href: string) { return href.split('?')[0] }
function isActive(pathname: string, href: string) {
  const p = hrefPath(href)
  return pathname === p || pathname.startsWith(p + '/')
}

interface MobileNavSheetProps {
  title: string
  sections: MoreSection[]
  pathname: string
  onClose: () => void
  accent: string
}

// Generalized compact mobile sheet used by every "menu" bottom-nav tab
// (Patients, AI Suite, CRM, Reports). Supports one level of drill-down
// (e.g. Patients -> Billing) by swapping its own content in place rather
// than opening a second modal — keeps a single open/close animation and a
// single backdrop, and reads like a native nested list (iOS Settings-style)
// instead of stacking sheets.
export default function MobileNavSheet({ title, sections, pathname, onClose, accent }: MobileNavSheetProps) {
  const [drillDown, setDrillDown] = useState<{ title: string; sections: MoreSection[] } | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (drillDown) setDrillDown(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, drillDown])

  const view = drillDown ?? { title, sections }

  return (
    <div className="xl:hidden fixed inset-0 z-[10001] flex items-end bg-slate-950/40 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={view.title}
        className="w-full max-h-[80vh] overflow-y-auto rounded-t-[28px] border-t border-gray-200/70 bg-white shadow-2xl animate-fade-in dark:border-white/10 dark:bg-[#0a1730]"
        style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="sticky top-0 relative flex items-center justify-between border-b border-gray-100 bg-white/95 px-5 py-4 backdrop-blur dark:border-white/10 dark:bg-[#0a1730]/95">
          <span className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-gray-200 dark:bg-white/15" aria-hidden />
          {drillDown ? (
            <button onClick={() => setDrillDown(null)} aria-label="Back" className="grid h-9 w-9 place-items-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10">
              <ChevronLeft size={18} />
            </button>
          ) : (
            <span className="w-9" aria-hidden />
          )}
          <strong className="text-sm font-bold text-gray-800 dark:text-white">{view.title}</strong>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10">
            <X size={18} />
          </button>
        </div>
        <div className="p-4 space-y-5">
          {view.sections.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-400 dark:text-slate-500">Nothing else to show here.</p>
          )}
          {view.sections.map(section => (
            <div key={section.heading}>
              <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500">{section.heading}</p>
              <div className="overflow-hidden rounded-2xl border border-gray-100 dark:border-white/8">
                {section.items.map((item, i) => {
                  const active = !item.children && isActive(pathname, item.href)
                  const Icon = item.icon
                  const rowClass = cn(
                    'flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-semibold transition-colors',
                    i > 0 && 'border-t border-gray-100 dark:border-white/8',
                    active ? 'bg-gray-50 dark:bg-white/5' : 'bg-white dark:bg-transparent hover:bg-gray-50 dark:hover:bg-white/5',
                  )
                  const content = (
                    <>
                      <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-xl" style={{ background: `${accent}14`, color: accent }}>
                        <Icon size={16} />
                      </span>
                      <span className="flex-1 text-gray-700 dark:text-slate-200">{item.label}</span>
                      {item.children && <ChevronRight size={16} className="text-gray-300 dark:text-slate-600" aria-hidden />}
                    </>
                  )
                  if (item.children) {
                    return (
                      <button
                        key={item.label}
                        onClick={() => setDrillDown({ title: item.label, sections: item.children! })}
                        className={rowClass}
                      >
                        {content}
                      </button>
                    )
                  }
                  return (
                    <Link key={item.href} href={item.href} onClick={onClose} className={rowClass}>
                      {content}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}