'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { Bell, Search, X, UserRound } from 'lucide-react'
import { getInitials } from '@/lib/utils'

export interface MobileHeaderUser {
  firstName: string
  lastName: string
  avatarUrl?: string | null
}

interface MobileHeaderProps {
  homeHref: string
  notificationsHref: string
  unread?: number
  user: MobileHeaderUser | null
  onProfileClick: () => void
  /** Real patient-search endpoint already used by the desktop header for this role. */
  searchEndpoint: string
  onSelectPatient: (patientId: string) => void
}

// Compact mobile top header — logo + search/notifications/profile only.
// Deliberately does not render any desktop nav links (see MobileBottomNav
// for primary navigation) so page content keeps maximum vertical space.
export default function MobileHeader({
  homeHref, notificationsHref, unread = 0, user, onProfileClick, searchEndpoint, onSelectPatient,
}: MobileHeaderProps) {
  const router = useRouter()
  const [searchOpen, setSearchOpen] = useState(false)
  const initials = user ? getInitials(user.firstName, user.lastName) : 'CC'

  return (
    <>
      <header
        className="xl:hidden sticky top-0 z-30 flex items-center gap-2 border-b border-gray-100 bg-white/90 px-4 backdrop-blur-xl dark:border-white/8 dark:bg-[#08162f]/90"
        style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(56px + env(safe-area-inset-top))' }}
      >
        <button onClick={() => router.push(homeHref)} aria-label="Code Clinic home" className="flex-shrink-0">
          <Image src="/logo.png" alt="Code Clinic" width={96} height={30} className="object-contain dark:brightness-0 dark:invert" priority />
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
            className="grid h-10 w-10 place-items-center rounded-full text-gray-500 active:bg-gray-100 dark:text-slate-300 dark:active:bg-white/10"
          >
            <Search size={19} />
          </button>
          <button
            onClick={() => router.push(notificationsHref)}
            aria-label="Notifications"
            className="relative grid h-10 w-10 place-items-center rounded-full text-gray-500 active:bg-gray-100 dark:text-slate-300 dark:active:bg-white/10"
          >
            <Bell size={19} />
            {unread > 0 && (
              <span className="absolute right-1.5 top-1.5 grid h-[16px] min-w-[16px] place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
          <button
            onClick={onProfileClick}
            aria-label="Profile"
            className="ml-0.5 grid h-10 w-10 place-items-center rounded-full active:opacity-80"
          >
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
            ) : (
              <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-clinic-navy to-clinic-blue text-[11px] font-bold text-white">
                {initials}
              </span>
            )}
          </button>
        </div>
      </header>

      {searchOpen && (
        <MobileSearchOverlay
          endpoint={searchEndpoint}
          onClose={() => setSearchOpen(false)}
          onSelect={id => { onSelectPatient(id); setSearchOpen(false) }}
        />
      )}
    </>
  )
}

interface PatientResult { id: string; primary: string; secondary: string }

function MobileSearchOverlay({ endpoint, onClose, onSelect }: {
  endpoint: string
  onClose: () => void
  onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PatientResult[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function search(value: string) {
    setQuery(value)
    if (value.trim().length < 2) { setResults([]); return }
    setSearching(true)
    try {
      const token = localStorage.getItem('cc_token')
      const res = await fetch(`${endpoint}?q=${encodeURIComponent(value.trim())}&limit=10`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        const patients = Array.isArray(data) ? data : data.data || []
        setResults(patients.map((p: any) => ({
          id: p.id, primary: `${p.firstName} ${p.lastName}`, secondary: p.phone || p.email || 'Patient record',
        })))
      }
    } catch { /* offline or transient — leave results empty, no crash */ } finally { setSearching(false) }
  }

  return (
    <div className="xl:hidden fixed inset-0 z-[120] flex flex-col bg-white dark:bg-[#08162f]" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-white/8">
        <Search size={18} className="flex-shrink-0 text-gray-400" />
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={e => search(e.target.value)}
          placeholder="Search patients…"
          className="h-11 flex-1 bg-transparent text-base text-gray-900 outline-none placeholder:text-gray-400 dark:text-white"
        />
        <button onClick={onClose} aria-label="Close search" className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full text-gray-400 active:bg-gray-100 dark:active:bg-white/10">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {query.trim().length < 2 ? (
          <p className="px-3 py-10 text-center text-sm text-gray-400">Start typing to find a patient.</p>
        ) : searching ? (
          <p className="px-3 py-10 text-center text-sm text-gray-400">Searching…</p>
        ) : results.length === 0 ? (
          <p className="px-3 py-10 text-center text-sm text-gray-400">No results found.</p>
        ) : results.map(r => (
          <button key={r.id} onClick={() => onSelect(r.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-gray-50 dark:active:bg-white/5">
            <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-cyan-100 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300">
              <UserRound size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-gray-800 dark:text-white">{r.primary}</span>
              <span className="block truncate text-xs text-gray-400">{r.secondary}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
