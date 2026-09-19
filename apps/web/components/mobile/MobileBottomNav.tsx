'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getMobileNav, MORE_ICON, type MobileRole, type MoreSection } from '@/lib/mobileNav'
import MobileNavSheet from './MobileNavSheet'

function hrefPath(href: string) { return href.split('?')[0] }
function isActive(pathname: string, href: string) {
  const p = hrefPath(href)
  return pathname === p || pathname.startsWith(p + '/')
}
function sectionsActive(sections: MoreSection[], pathname: string): boolean {
  return sections.some(s => s.items.some(i => i.children ? sectionsActive(i.children, pathname) : isActive(pathname, i.href)))
}

interface MobileBottomNavProps {
  role: MobileRole
  perms: Record<string, boolean>
  accent?: string // clinic-navy by default; kept overridable, never randomized per-role
}

// Native-style fixed bottom tab bar. Safe-area aware (iPhone home indicator),
// glass/blur surface, minimum 44px touch targets. Deliberately does NOT
// squeeze the desktop floating pill nav down — this is its own component,
// only ever rendered below the xl breakpoint (see role layout.tsx files).
//
// None of the three roles has a "Home" tab or a "More" button: the Code
// Clinic logo in MobileHeader is the Home control, and every destination that
// used to live behind a catch-all "More" sheet now lives behind one of the
// primary tabs' own menu (see lib/mobileNav.ts, where every role's `more` is
// `[]`). The legacy MoreSheet below is kept only so a future role/config with
// a non-empty `more` array still renders correctly — `showMoreButton` is
// false for all current roles.
export default function MobileBottomNav({ role, perms, accent = '#1A237E' }: MobileBottomNavProps) {
  const pathname = usePathname()
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const nav = getMobileNav(role, perms)
  const openTab = nav.primary.find(t => t.key === openMenuKey)
  const showMoreButton = nav.more.length > 0

  return (
    <>
      <nav
        aria-label="Primary"
        // z-[10000]: must sit above the pre-existing SarahChatbot floating
        // widget (fixed bottom-right, z-index:9999 — see components/SarahChatbot.tsx
        // and its Doctor/Receptionist variants). Without this, on phone-width
        // viewports the widget's bubble physically overlaps the rightmost
        // nav tab and steals its taps — confirmed via real-browser testing,
        // not just a visual glitch. This only reorders stacking; the widget
        // itself (position, drag behavior) is untouched.
        className="xl:hidden fixed bottom-0 left-0 right-0 z-[10000] px-2"
        style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto flex max-w-md items-stretch justify-around gap-0.5 rounded-[26px] border border-gray-200/70 bg-white/85 px-1 py-1.5 shadow-[0_8px_30px_rgba(15,23,42,0.12)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#0a1730]/85">
          {nav.primary.map(tab => {
            const active = tab.type === 'link' ? isActive(pathname, tab.href) : sectionsActive(tab.sections, pathname)
            const Icon = tab.icon
            const label = tab.type === 'link' && tab.shortLabel ? tab.shortLabel : tab.label
            const inner = (
              <>
                {active && (
                  <span className="absolute inset-1 rounded-2xl" style={{ background: `${accent}14` }} aria-hidden />
                )}
                <Icon
                  size={20}
                  strokeWidth={active ? 2.25 : 1.9}
                  className={cn('relative', !active && 'text-gray-400 dark:text-slate-500')}
                  style={active ? { color: accent } : undefined}
                />
                <span
                  className={cn('relative whitespace-nowrap text-[10px] font-semibold leading-none', !active && 'text-gray-400 dark:text-slate-500')}
                  style={active ? { color: accent } : undefined}
                >
                  {label}
                </span>
              </>
            )
            const className = 'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-2 transition-colors'
            if (tab.type === 'link') {
              return (
                <Link key={tab.key} href={tab.href} aria-current={active ? 'page' : undefined} aria-label={tab.label} className={className}>
                  {inner}
                </Link>
              )
            }
            return (
              <button
                key={tab.key}
                onClick={() => setOpenMenuKey(tab.key)}
                aria-haspopup="dialog"
                aria-expanded={openMenuKey === tab.key}
                aria-label={tab.label}
                className={className}
              >
                {inner}
              </button>
            )
          })}
          {showMoreButton && (
            <button
              onClick={() => setMoreOpen(true)}
              className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-2 text-gray-400 dark:text-slate-500"
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
            >
              <MORE_ICON size={20} strokeWidth={1.9} />
              <span className="text-[10px] font-semibold leading-none">More</span>
            </button>
          )}
        </div>
      </nav>

      {openTab?.type === 'menu' && (
        <MobileNavSheet
          title={openTab.label}
          sections={openTab.sections}
          pathname={pathname}
          onClose={() => setOpenMenuKey(null)}
          accent={accent}
        />
      )}

      {showMoreButton && moreOpen && (
        <MoreSheet sections={nav.more} pathname={pathname} onClose={() => setMoreOpen(false)} accent={accent} />
      )}
    </>
  )
}

// Unchanged legacy "More" sheet — still used by RECEPTIONIST/DOCTOR, whose
// nav config keeps a non-empty `more` array this pass. ADMIN's `more` is
// always `[]` (see lib/mobileNav.ts), so `showMoreButton` never renders this
// for ADMIN and this code path is untouched from before.
function MoreSheet({ sections, pathname, onClose, accent }: {
  sections: MoreSection[]
  pathname: string
  onClose: () => void
  accent: string
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="xl:hidden fixed inset-0 z-[10001] flex items-end bg-slate-950/40 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="More"
        className="w-full max-h-[80vh] overflow-y-auto rounded-t-[28px] border-t border-gray-200/70 bg-white shadow-2xl animate-fade-in dark:border-white/10 dark:bg-[#0a1730]"
        style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="sticky top-0 relative flex items-center justify-between border-b border-gray-100 bg-white/95 px-5 py-4 backdrop-blur dark:border-white/10 dark:bg-[#0a1730]/95">
          <span className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-gray-200 dark:bg-white/15" aria-hidden />
          <strong className="text-sm font-bold text-gray-800 dark:text-white">More</strong>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10">
            <X size={18} />
          </button>
        </div>
        <div className="p-4 space-y-5">
          {sections.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-400 dark:text-slate-500">Nothing else to show here.</p>
          )}
          {sections.map(section => (
            <div key={section.heading}>
              <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500">{section.heading}</p>
              <div className="overflow-hidden rounded-2xl border border-gray-100 dark:border-white/8">
                {section.items.map((item, i) => {
                  const active = isActive(pathname, item.href)
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      className={cn(
                        'flex items-center gap-3 px-4 py-3.5 text-sm font-semibold transition-colors',
                        i > 0 && 'border-t border-gray-100 dark:border-white/8',
                        active ? 'bg-gray-50 dark:bg-white/5' : 'bg-white dark:bg-transparent hover:bg-gray-50 dark:hover:bg-white/5',
                      )}
                    >
                      <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-xl" style={{ background: `${accent}14`, color: accent }}>
                        <Icon size={16} />
                      </span>
                      <span className="text-gray-700 dark:text-slate-200">{item.label}</span>
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