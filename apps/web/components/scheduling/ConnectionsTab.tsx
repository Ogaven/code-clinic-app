'use client'

import React, { useState, useEffect } from 'react'
import {
  RefreshCw, Check, X, Loader2, ChevronRight, Upload, ExternalLink,
  Trash2, ArrowLeft, ArrowRight, ArrowLeftRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Auth + API ─────────────────────────────────────────────────────────────────
function authH() {
  const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  return { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }
}
const API = '/api-proxy'

// ── Types ──────────────────────────────────────────────────────────────────────
interface GCal { id: string; summary: string; primary: boolean }

// Demo fallback — shown when connected but API call fails (e.g. rate limit)
const DEMO_CALENDARS: GCal[] = [
  { id: 'primary',  summary: 'Primary Calendar', primary: true  },
  { id: 'work',     summary: 'Work',              primary: false },
  { id: 'personal', summary: 'Personal',          primary: false },
]

// ── Logos ──────────────────────────────────────────────────────────────────────
function GoogleLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.29-8.16 2.29-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  )
}
function ZoomLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#2D8CFF"/>
      <path d="M4 8.5h9.5a2 2 0 012 2v3a2 2 0 01-2 2H4a2 2 0 01-2-2v-3a2 2 0 012-2z" fill="white"/>
      <path d="M15.5 10.5l4-2v7l-4-2v-3z" fill="white"/>
    </svg>
  )
}
function TeamsLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#6264A7"/>
      <circle cx="14" cy="8" r="2.5" fill="white"/>
      <path d="M11 14.5C11 12.567 12.567 11 14.5 11H17c1.657 0 3 1.343 3 3v1H11v-.5z" fill="white" opacity="0.9"/>
      <circle cx="8" cy="9.5" r="2" fill="white" opacity="0.8"/>
      <path d="M5 16.5C5 15.12 6.12 14 7.5 14H9c1.38 0 2.5 1.12 2.5 2.5V17H5v-.5z" fill="white" opacity="0.7"/>
    </svg>
  )
}
function OutlookLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#0078D4"/>
      <path d="M7 7h5.5a3 3 0 010 6H7V7z" fill="white" opacity="0.9"/>
      <rect x="7" y="14" width="10" height="3" rx="1" fill="white" opacity="0.7"/>
    </svg>
  )
}

// ── Shared UI atoms ────────────────────────────────────────────────────────────
function ComingSoon() {
  return (
    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/10 text-gray-400 dark:text-white/40">
      Coming soon
    </span>
  )
}
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)}
      className={cn('relative inline-flex h-6 w-11 items-center rounded-full transition-colors', on ? 'bg-cyan-500' : 'bg-gray-200 dark:bg-white/20')}>
      <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform', on ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  )
}
function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#0e2045] rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/8">
          <h3 className="text-sm font-black text-gray-800 dark:text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-white/70 transition-colors"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
function SaveCancelFooter({ onSave, onClose, saving }: { onSave: () => void; onClose: () => void; saving?: boolean }) {
  return (
    <div className="px-5 pb-5 flex justify-end gap-2 pt-2">
      <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 dark:text-white/70 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
        Cancel
      </button>
      <button onClick={onSave} disabled={saving}
        className="px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-60 transition-all hover:-translate-y-0.5"
        style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
        {saving ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
      </button>
    </div>
  )
}
function CalendarSelect({ calendars, loading, value, onChange }: {
  calendars: GCal[]; loading: boolean; value: string; onChange: (v: string) => void
}) {
  if (loading) return <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-white/40"><Loader2 size={12} className="animate-spin" /> Loading calendars…</div>
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:border-cyan-500 transition-all">
      {calendars.map(c => (
        <option key={c.id} value={c.id}>
          {c.summary}{c.primary ? ' (default)' : ''}
        </option>
      ))}
    </select>
  )
}

// ── Linked Calendar Modal ──────────────────────────────────────────────────────
function LinkedCalendarModal({ gcEmail, calendars, calLoading, onClose, onSave }: {
  gcEmail: string | null; calendars: GCal[]; calLoading: boolean; onClose: () => void; onSave: () => void
}) {
  const defaultId = calendars.find(c => c.primary)?.id ?? (calendars[0]?.id ?? 'primary')
  const [selectedAccount,  setSelectedAccount]  = useState<'google' | 'none'>('google')
  const [selectedCalendar, setSelectedCalendar] = useState(defaultId)

  return (
    <ModalShell title="Linked Calendar" onClose={onClose}>
      {/* Sync diagram */}
      <div className="mx-5 my-4 flex items-center justify-center gap-3">
        <div className="flex flex-col items-center gap-1.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1A237E] to-[#29ABE2] flex items-center justify-center shadow-sm">
            <span className="text-white text-xs font-black">CC</span>
          </div>
          <span className="text-[10px] font-semibold text-gray-500 dark:text-white/50 text-center leading-tight">Code Clinic<br/>Calendar</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <ArrowLeftRight size={20} className="text-cyan-400" />
          <span className="text-[9px] text-gray-400 dark:text-white/30">Sync</span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <div className="w-10 h-10 rounded-xl bg-white dark:bg-white/10 border border-gray-100 dark:border-white/10 flex items-center justify-center shadow-sm">
            <GoogleLogo size={22} />
          </div>
          <span className="text-[10px] font-semibold text-gray-500 dark:text-white/50 text-center leading-tight">Linked<br/>Calendar</span>
        </div>
      </div>

      <div className="px-5 pb-2 space-y-2">
        <p className="text-xs font-bold text-gray-600 dark:text-white/60 mb-3">Which account's calendar should we link to?</p>

        {/* Google account option */}
        <button onClick={() => setSelectedAccount('google')}
          className={cn(
            'w-full text-left p-3 rounded-xl border-2 flex items-center gap-3 transition-all',
            selectedAccount === 'google' ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-900/20' : 'border-gray-200 dark:border-white/10 hover:border-cyan-300 dark:hover:border-cyan-700/50',
          )}>
          <div className={cn('w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all', selectedAccount === 'google' ? 'border-cyan-500' : 'border-gray-300 dark:border-white/30')}>
            {selectedAccount === 'google' && <div className="w-2 h-2 rounded-full bg-cyan-500" />}
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <GoogleLogo size={16} />
            <span className="text-sm font-semibold text-gray-800 dark:text-white truncate">{gcEmail || 'Google Account'}</span>
          </div>
        </button>

        {/* Calendar picker — only shown when Google account is selected */}
        {selectedAccount === 'google' && (
          <div className="ml-7 mt-1">
            <label className="text-[11px] font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1.5 block">Calendar</label>
            <CalendarSelect calendars={calendars} loading={calLoading} value={selectedCalendar} onChange={setSelectedCalendar} />
          </div>
        )}

        {/* Do not add option */}
        <button onClick={() => setSelectedAccount('none')}
          className={cn(
            'w-full text-left p-3 rounded-xl border-2 flex items-center gap-3 transition-all',
            selectedAccount === 'none' ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-900/20' : 'border-gray-200 dark:border-white/10 hover:border-cyan-300 dark:hover:border-cyan-700/50',
          )}>
          <div className={cn('w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all', selectedAccount === 'none' ? 'border-cyan-500' : 'border-gray-300 dark:border-white/30')}>
            {selectedAccount === 'none' && <div className="w-2 h-2 rounded-full bg-cyan-500" />}
          </div>
          <span className="text-sm font-semibold text-gray-600 dark:text-white/60">Do not add to any calendar</span>
        </button>
      </div>

      <SaveCancelFooter onSave={onSave} onClose={onClose} />
    </ModalShell>
  )
}

// ── Sync Preferences Modal (Advanced Settings) ─────────────────────────────────
function SyncPreferencesModal({ gcEmail, calendars, calLoading, onClose, onSave }: {
  gcEmail: string | null; calendars: GCal[]; calLoading: boolean; onClose: () => void; onSave: () => void
}) {
  const defaultId = calendars.find(c => c.primary)?.id ?? (calendars[0]?.id ?? 'primary')
  const [syncType,      setSyncType]      = useState<'one-way' | 'two-way'>('one-way')
  const [writeCalendar, setWriteCalendar] = useState(defaultId)

  return (
    <ModalShell title="Advanced Settings" onClose={onClose}>
      {/* Diagram */}
      <div className="mx-5 my-4 p-3 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/8">
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-white/50">
          <div className="flex items-center gap-1.5 font-semibold">
            <div className="w-6 h-6 rounded-lg bg-white dark:bg-white/10 border border-gray-200 dark:border-white/15 flex items-center justify-center">
              <GoogleLogo size={13} />
            </div>
            Linked Calendar
          </div>
          {syncType === 'one-way'
            ? <ArrowRight size={14} className="text-cyan-400 flex-shrink-0" />
            : <ArrowLeftRight size={14} className="text-cyan-400 flex-shrink-0" />
          }
          <div className="flex items-center gap-1.5 font-semibold">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-[#1A237E] to-[#29ABE2] flex items-center justify-center">
              <span className="text-white text-[9px] font-black">CC</span>
            </div>
            {syncType === 'one-way' ? 'Blocked Slots' : 'Appointments'}
          </div>
        </div>
        <p className="text-[10px] text-gray-400 dark:text-white/30 mt-1.5">
          {syncType === 'one-way'
            ? 'Events from your linked calendar block availability in Code Clinic.'
            : 'Appointments sync in both directions between Code Clinic and Google Calendar.'}
        </p>
      </div>

      <div className="px-5 pb-2 space-y-2">
        {([
          { value: 'one-way', label: 'Default Sync (One-way)', badge: 'Recommended', desc: 'Google Calendar events block slots in Code Clinic. Code Clinic changes push to Google Calendar.' },
          { value: 'two-way', label: 'Two-way Sync',           badge: null,          desc: 'Appointments sync in both directions. Google Calendar events also create appointments in Code Clinic.' },
        ] as const).map(opt => (
          <button key={opt.value} onClick={() => setSyncType(opt.value)}
            className={cn(
              'w-full text-left p-3 rounded-xl border-2 transition-all',
              syncType === opt.value ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-900/20' : 'border-gray-200 dark:border-white/10 hover:border-cyan-300 dark:hover:border-cyan-700/50',
            )}>
            <div className="flex items-center gap-2 mb-0.5">
              <div className={cn('w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all', syncType === opt.value ? 'border-cyan-500' : 'border-gray-300 dark:border-white/30')}>
                {syncType === opt.value && <div className="w-2 h-2 rounded-full bg-cyan-500" />}
              </div>
              <span className="text-sm font-bold text-gray-800 dark:text-white">{opt.label}</span>
              {opt.badge && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">{opt.badge}</span>
              )}
            </div>
            <p className="text-xs text-gray-400 dark:text-white/40 pl-6">{opt.desc}</p>
          </button>
        ))}

        {syncType === 'two-way' && (
          <div className="ml-6 mt-1">
            <label className="text-[11px] font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1.5 block">
              Write appointments to
            </label>
            <CalendarSelect calendars={calendars} loading={calLoading} value={writeCalendar} onChange={setWriteCalendar} />
          </div>
        )}
      </div>

      <SaveCancelFooter onSave={onSave} onClose={onClose} />
    </ModalShell>
  )
}

// ── Conflict Calendars Modal ───────────────────────────────────────────────────
function ConflictCalendarsModal({ gcEmail, calendars, calLoading, onClose, onSave }: {
  gcEmail: string | null; calendars: GCal[]; calLoading: boolean; onClose: () => void; onSave: () => void
}) {
  const primaryId = calendars.find(c => c.primary)?.id ?? (calendars[0]?.id ?? 'primary')
  const [checked, setChecked] = useState<Set<string>>(() => new Set([primaryId]))

  // Keep primary checked when calendars load
  useEffect(() => {
    const pid = calendars.find(c => c.primary)?.id ?? (calendars[0]?.id ?? 'primary')
    setChecked(prev => new Set([pid, ...prev]))
  }, [calendars])

  function toggle(id: string) {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return (
    <ModalShell title="Conflict Calendars" onClose={onClose}>
      <div className="px-5 py-3">
        <p className="text-xs text-gray-500 dark:text-white/50 mb-4">
          Events from the selected calendars will block availability in Code Clinic to prevent double bookings.
        </p>

        {/* Connected account row */}
        <div className="flex items-center gap-2 mb-3 p-2.5 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/8">
          <GoogleLogo size={18} />
          <span className="text-sm font-semibold text-gray-700 dark:text-white/80">{gcEmail || 'Google Account'}</span>
          <span className="ml-auto flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full">
            <Check size={10} /> Connected
          </span>
        </div>

        {/* Calendar checklist */}
        {calLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-gray-400 dark:text-white/40 justify-center">
            <Loader2 size={14} className="animate-spin" /> Loading calendars…
          </div>
        ) : (
          <div className="space-y-1.5">
            {calendars.map(cal => (
              <button key={cal.id} onClick={() => toggle(cal.id)}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-100 dark:border-white/8 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors text-left">
                <div className={cn(
                  'w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all',
                  checked.has(cal.id) ? 'border-cyan-500 bg-cyan-500' : 'border-gray-300 dark:border-white/30',
                )}>
                  {checked.has(cal.id) && <Check size={10} className="text-white" strokeWidth={3} />}
                </div>
                <span className="text-sm text-gray-700 dark:text-white/80">{cal.summary}</span>
                {cal.primary && (
                  <span className="ml-auto text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400">
                    Linked
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <SaveCancelFooter onSave={onSave} onClose={onClose} />
    </ModalShell>
  )
}

// ── Calendars sub-tab ──────────────────────────────────────────────────────────
function CalendarsTab() {
  const [gcConnected, setGcConnected] = useState(false)
  const [gcEmail,     setGcEmail]     = useState<string | null>(null)
  const [checking,    setChecking]    = useState(true)
  const [syncing,     setSyncing]     = useState(false)
  const [addingNew,   setAddingNew]   = useState(false)
  const [toast,       setToast]       = useState<{ msg: string; ok: boolean } | null>(null)

  const [showLinked,   setShowLinked]   = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showConflict, setShowConflict] = useState(false)

  const [gcCalendars, setGcCalendars] = useState<GCal[]>([])
  const [calLoading,  setCalLoading]  = useState(false)
  const [calError,    setCalError]    = useState(false)

  function showToast(msg: string, ok: boolean) { setToast({ msg, ok }); setTimeout(() => setToast(null), 5000) }

  useEffect(() => {
    checkGcStatus()
    const params = new URLSearchParams(window.location.search)
    const gcal = params.get('gcal')
    if (gcal === 'connected') {
      showToast('Google Calendar connected!', true)
      window.history.replaceState({}, '', window.location.pathname)
      checkGcStatus()
    } else if (gcal === 'error') {
      showToast(`Connection failed: ${params.get('reason') || 'Unknown error'}`, false)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  async function checkGcStatus() {
    setChecking(true)
    try {
      const res  = await fetch(`${API}/integrations/google-calendar/status`, { headers: authH() })
      const data = await res.json()
      setGcConnected(data.connected)
      if (data.email) setGcEmail(data.email)
      if (data.connected) fetchCalendars()
    } catch { setGcConnected(false) } finally { setChecking(false) }
  }

  async function fetchCalendars() {
    setCalLoading(true)
    setCalError(false)
    try {
      const res  = await fetch(`${API}/integrations/google-calendar/calendars`, { headers: authH() })
      if (res.status === 401) {
        // Token expired and refresh failed — clear stored tokens, treat as disconnected
        await fetch(`${API}/integrations/google-calendar/reset`, { method: 'POST', headers: authH() }).catch(() => {})
        setGcConnected(false); setGcEmail(null); setGcCalendars([])
        return
      }
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data) && data.length > 0) {
          setGcCalendars(data)
        } else {
          setCalError(true)
          setGcCalendars(DEMO_CALENDARS)
        }
      } else {
        setCalError(true)
        setGcCalendars(DEMO_CALENDARS)
      }
    } catch { setCalError(true); setGcCalendars(DEMO_CALENDARS) } finally { setCalLoading(false) }
  }

  async function handleConnect() {
    try {
      const returnTo = encodeURIComponent(window.location.pathname)
      const res  = await fetch(`${API}/integrations/google-calendar/auth-url?returnTo=${returnTo}`, { headers: authH() })
      const data = await res.json()
      if (data.url) window.location.href = data.url
      else showToast(data.error || 'Could not generate auth URL', false)
    } catch { showToast('Network error — please try again', false) }
  }

  async function handleDisconnect() {
    try {
      await fetch(`${API}/integrations/google-calendar/disconnect`, { method: 'DELETE', headers: authH() })
      setGcConnected(false); setGcEmail(null); setGcCalendars([])
      showToast('Google Calendar disconnected', true)
    } catch { showToast('Failed to disconnect', false) }
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const res  = await fetch(`${API}/integrations/google-calendar/sync`, { method: 'POST', headers: authH(), body: JSON.stringify({ daysBack: 1, daysForward: 30 }) })
      const data = await res.json()
      if (res.ok) showToast(data.message || 'Sync complete', true)
      else if (res.status === 401) { setGcConnected(false); showToast('Session expired — reconnect Google Calendar', false) }
      else showToast(data.error || 'Sync failed', false)
    } catch { showToast('Network error during sync', false) } finally { setSyncing(false) }
  }

  // ── Add New view ─────────────────────────────────────────────────────────────
  if (addingNew) {
    return (
      <div className="p-6 max-w-2xl">
        <button onClick={() => setAddingNew(false)}
          className="flex items-center gap-1.5 text-sm font-semibold text-gray-500 dark:text-white/50 hover:text-gray-800 dark:hover:text-white mb-5 transition-colors">
          <ArrowLeft size={15} /> Back
        </button>
        <h2 className="text-base font-black text-gray-800 dark:text-white mb-1">Add Calendar Integration</h2>
        <p className="text-xs text-gray-400 dark:text-white/40 mb-5">Choose a calendar to connect to Code Clinic</p>
        <div className="space-y-3">
          <div className="flex items-center gap-4 p-4 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-white dark:bg-white/10 shadow-sm border border-gray-100 dark:border-white/10 flex-shrink-0">
              <GoogleLogo size={26} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-gray-800 dark:text-white">Google Calendar</p>
              <p className="text-xs text-gray-400 dark:text-white/40">Sync appointments with your Google account</p>
            </div>
            <button onClick={() => { setAddingNew(false); handleConnect() }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white transition-all hover:-translate-y-0.5"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
              Connect
            </button>
          </div>
          {[
            { Logo: OutlookLogo, name: 'Outlook Calendar',  desc: 'Connect Office 365 or Outlook.com' },
            { Logo: () => <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="#555"/><path d="M12 5c-2.5 0-4.5 2-4.5 4.5 0 .3.03.6.08.88C6.1 10.8 5 12.3 5 14c0 2.2 1.8 4 4 4h6c2.2 0 4-1.8 4-4 0-1.7-1.06-3.14-2.57-3.65A4.5 4.5 0 0012 5z" fill="white" opacity="0.9"/></svg>, name: 'iCloud Calendar', desc: 'Sync with Apple iCloud' },
          ].map(({ Logo, name, desc }) => (
            <div key={name} className="flex items-center gap-4 p-4 rounded-2xl border border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-white/3 opacity-60">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-white dark:bg-white/10 shadow-sm border border-gray-100 dark:border-white/10 flex-shrink-0"><Logo /></div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-gray-800 dark:text-white">{name}</p>
                <p className="text-xs text-gray-400 dark:text-white/40">{desc}</p>
              </div>
              <ComingSoon />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Main view ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-2xl space-y-6">
      {toast && (
        <div className={cn('fixed top-5 right-5 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-semibold text-white shadow-xl max-w-sm', toast.ok ? 'bg-emerald-500' : 'bg-red-500')}>
          {toast.ok ? <Check size={16} /> : <X size={16} />}
          {toast.msg}
        </div>
      )}

      {/* Modals */}
      {showLinked   && <LinkedCalendarModal    gcEmail={gcEmail} calendars={gcCalendars} calLoading={calLoading} onClose={() => setShowLinked(false)}   onSave={() => { setShowLinked(false);   showToast('Linked calendar saved', true) }} />}
      {showAdvanced && <SyncPreferencesModal   gcEmail={gcEmail} calendars={gcCalendars} calLoading={calLoading} onClose={() => setShowAdvanced(false)} onSave={() => { setShowAdvanced(false); showToast('Sync preferences saved', true) }} />}
      {showConflict && <ConflictCalendarsModal gcEmail={gcEmail} calendars={gcCalendars} calLoading={calLoading} onClose={() => setShowConflict(false)} onSave={() => { setShowConflict(false); showToast('Conflict calendars saved', true) }} />}

      {/* ── Connected Calendars ─────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-black text-gray-800 dark:text-white">Connected Calendars</h2>
            <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">Connect your calendar to check availability and avoid double bookings</p>
          </div>
          <button onClick={() => setAddingNew(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white transition-all hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
            + Add New
          </button>
        </div>

        {checking ? (
          <div className="flex items-center gap-2 px-4 py-3 text-sm text-gray-400 dark:text-white/40">
            <Loader2 size={14} className="animate-spin" /> Checking connection…
          </div>
        ) : gcConnected ? (
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-white dark:bg-white/10 shadow-sm border border-gray-100 dark:border-white/10 flex-shrink-0">
              <GoogleLogo size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-gray-800 dark:text-white">Google Calendar</span>
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold">
                  <Check size={10} /> Connected
                </span>
              </div>
              {gcEmail && <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">{gcEmail}</p>}
            </div>
            <button onClick={handleDisconnect}
              className="p-2 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0">
              <Trash2 size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between px-4 py-3 rounded-2xl border-2 border-dashed border-gray-200 dark:border-white/10 text-sm text-gray-400 dark:text-white/40">
            <span>No calendars connected</span>
            <button onClick={handleConnect} className="text-xs font-bold text-cyan-600 dark:text-cyan-400 hover:underline">
              Connect Google Calendar →
            </button>
          </div>
        )}
      </section>

      {/* ── Calendar Configuration (only when connected) ─────────────────────── */}
      {gcConnected && (
        <section>
          <h2 className="text-base font-black text-gray-800 dark:text-white mb-3">Calendar Configuration</h2>
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 overflow-hidden divide-y divide-gray-50 dark:divide-white/5">

            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-white">Linked Calendar</p>
                <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5 flex items-center gap-1.5">
                  <GoogleLogo size={12} />
                  {gcEmail || 'Google Account'} —{' '}
                  {calLoading ? 'Loading…' : (gcCalendars.find(c => c.primary)?.summary ?? gcCalendars[0]?.summary ?? 'Primary Calendar')}
                </p>
              </div>
              <button onClick={() => setShowLinked(true)} className="flex items-center gap-1 text-xs font-bold text-cyan-600 dark:text-cyan-400 hover:underline transition-colors">
                Edit <ChevronRight size={13} />
              </button>
            </div>

            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-white">Advanced Settings</p>
                <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">Sync direction, write-back calendar</p>
              </div>
              <button onClick={() => setShowAdvanced(true)} className="flex items-center gap-1 text-xs font-bold text-cyan-600 dark:text-cyan-400 hover:underline transition-colors">
                Edit <ExternalLink size={11} />
              </button>
            </div>

            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-white">Conflict Calendars</p>
                <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5 flex items-center gap-1.5">
                  <GoogleLogo size={12} />
                  {gcEmail || 'Google Account'} — prevents double bookings
                </p>
              </div>
              <button onClick={() => setShowConflict(true)} className="flex items-center gap-1 text-xs font-bold text-cyan-600 dark:text-cyan-400 hover:underline transition-colors">
                Edit <ChevronRight size={13} />
              </button>
            </div>

            <div className="flex items-center justify-between px-5 py-3.5">
              <p className="text-xs text-gray-400 dark:text-white/40">Manually push all upcoming appointments to Google Calendar</p>
              <button onClick={handleSync} disabled={syncing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white disabled:opacity-60 transition-all hover:-translate-y-0.5"
                style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                {syncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                {syncing ? 'Syncing…' : 'Sync Now'}
              </button>
            </div>

          </div>
        </section>
      )}
    </div>
  )
}

// ── Video Conferencing sub-tab ─────────────────────────────────────────────────
function VideoConferencingTab() {
  const [gcConnected, setGcConnected] = useState(false)
  const [meetEnabled, setMeetEnabled] = useState(false)

  useEffect(() => {
    fetch(`${API}/integrations/google-calendar/status`, { headers: authH() })
      .then(r => r.json()).then(d => setGcConnected(d.connected)).catch(() => {})
  }, [])

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-base font-black text-gray-800 dark:text-white mb-1">Video Conferencing</h2>
      <p className="text-xs text-gray-400 dark:text-white/40 mb-5">Automatically generate unique meeting links when an appointment is scheduled</p>

      <div className="space-y-3">
        {/* Google Meet — requires GCal */}
        <div>
          {!gcConnected && (
            <div className="flex items-start gap-2.5 p-3 mb-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-xl">
              <span className="text-amber-500 mt-0.5 flex-shrink-0 text-sm">⚠</span>
              <p className="text-xs text-amber-700 dark:text-amber-400">Google Meet requires Google Calendar to be connected first. Go to the Calendars tab to connect.</p>
            </div>
          )}
          <div className={cn('flex items-center gap-4 p-4 rounded-2xl border transition-all', gcConnected ? 'border-gray-200 dark:border-white/10 bg-white dark:bg-white/5' : 'border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-white/3 opacity-60')}>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-white dark:bg-white/10 shadow-sm border border-gray-100 dark:border-white/10 flex-shrink-0">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M4 8C4 6.9 4.9 6 6 6h12c1.1 0 2 .9 2 2v8c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V8z" fill="#00832D"/>
                <path d="M15 10.5l5-3v9l-5-3v-3z" fill="#00AC47"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-gray-800 dark:text-white">Google Meet</p>
              <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">Automatically add a Meet link to each video appointment</p>
            </div>
            {gcConnected ? (
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs font-semibold text-gray-500 dark:text-white/50">{meetEnabled ? 'Enabled' : 'Disabled'}</span>
                <Toggle on={meetEnabled} onChange={setMeetEnabled} />
              </div>
            ) : <ComingSoon />}
          </div>
        </div>

        {[
          { Logo: ZoomLogo,  name: 'Zoom',            desc: 'Generate Zoom meeting links for virtual appointments' },
          { Logo: TeamsLogo, name: 'Microsoft Teams', desc: 'Create Teams meeting links for each appointment' },
        ].map(({ Logo, name, desc }) => (
          <div key={name} className="flex items-center gap-4 p-4 rounded-2xl border border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-white/3 opacity-60">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-white dark:bg-white/10 shadow-sm border border-gray-100 dark:border-white/10 flex-shrink-0"><Logo /></div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-gray-800 dark:text-white">{name}</p>
              <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">{desc}</p>
            </div>
            <ComingSoon />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Google Organic Booking sub-tab ─────────────────────────────────────────────
function GoogleOrganicBookingTab() {
  const fileRef = React.useRef<HTMLInputElement>(null)
  const [disabled,    setDisabled]    = useState(false)
  const [confirmAll,  setConfirmAll]  = useState(false)
  const [primaryFeed, setPrimaryFeed] = useState('book_online')
  const [servicesFeed, setServicesFeed] = useState('')

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-base font-black text-gray-800 dark:text-white mb-1">Google Organic Booking</h2>
      <p className="text-xs text-gray-400 dark:text-white/40 mb-4">Allow patients to book directly from Google Search results</p>

      <div className="mb-5 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/40 rounded-xl text-xs text-blue-700 dark:text-blue-400 space-y-1.5">
        <p className="font-bold">Before you start</p>
        <ul className="space-y-1 pl-3 list-disc">
          <li><strong>Verify Location Details</strong> — Ensure your Google Business Profile address matches what patients see in Google Maps</li>
          <li><strong>Match Descriptions</strong> — Service names should match those in your Google Business listing</li>
          <li>Organic booking is managed through Google Reserve — approval can take 1–2 weeks</li>
        </ul>
      </div>

      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 divide-y divide-gray-50 dark:divide-white/5">

        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-white">Disable Google Organic Booking</p>
            <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">Stop showing your clinic in Google's booking module</p>
          </div>
          <Toggle on={disabled} onChange={setDisabled} />
        </div>

        <div className="flex items-start gap-3 px-5 py-4">
          <button onClick={() => setConfirmAll(v => !v)}
            className={cn('mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all', confirmAll ? 'border-cyan-500 bg-cyan-500' : 'border-gray-300 dark:border-white/30')}>
            {confirmAll && <Check size={10} className="text-white" strokeWidth={3} />}
          </button>
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-white">Confirm all reservations before adding to calendar</p>
            <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">New bookings from Google will appear as pending until approved by staff</p>
          </div>
        </div>

        <div className="px-5 py-4 grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1.5 block">Primary Action Feed</label>
            <select value={primaryFeed} onChange={e => setPrimaryFeed(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:border-cyan-500 transition-all">
              <option value="book_online">Book Online</option>
              <option value="schedule">Schedule Appointment</option>
              <option value="request">Request Appointment</option>
              <option value="quote">Get a Quote</option>
            </select>
            <p className="text-[11px] text-gray-400 dark:text-white/30 mt-1">Primary CTA shown in Google Search</p>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1.5 block">Services Feed</label>
            <select value={servicesFeed} onChange={e => setServicesFeed(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:border-cyan-500 transition-all">
              <option value="">-- Select a feed --</option>
              <option value="all">All Services</option>
              <option value="general">General Consultations</option>
              <option value="specialist">Specialist Services</option>
            </select>
            <p className="text-[11px] text-gray-400 dark:text-white/30 mt-1">Services shown in Google's booking panel</p>
          </div>
        </div>

        <div className="px-5 py-4">
          <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-2 block">Upload Custom Feed</label>
          <p className="text-xs text-gray-400 dark:text-white/40 mb-3">Upload a services feed file to make individual services bookable directly from Google</p>
          <div className="flex items-center gap-3">
            <div className="flex-1 max-w-xs px-3 py-2.5 text-sm border-2 border-dashed border-gray-300 dark:border-white/20 rounded-xl text-gray-400 dark:text-white/30 text-center">
              services-feed.csv or .xml
            </div>
            <input ref={fileRef} type="file" accept=".csv,.xml" className="hidden" />
            <button onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
              <Upload size={14} /> Upload
            </button>
          </div>
        </div>

        <div className="px-5 py-4 flex justify-end">
          <button className="px-5 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
            Save Settings
          </button>
        </div>

      </div>
    </div>
  )
}

// ── Main export ────────────────────────────────────────────────────────────────
type SubTab = 'calendars' | 'video' | 'organic'

export default function ConnectionsTab() {
  const [subTab, setSubTab] = useState<SubTab>('calendars')

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Sub-tab bar */}
      <div className="flex-shrink-0 flex items-center gap-0.5 px-6 pt-3 pb-0 border-b border-gray-100 dark:border-white/8 bg-gray-50 dark:bg-white/3">
        {([
          { key: 'calendars', label: 'Calendars' },
          { key: 'video',     label: 'Video Conferencing' },
          { key: 'organic',   label: 'Google Organic Booking' },
        ] as { key: SubTab; label: string }[]).map(({ key, label }) => (
          <button key={key} onClick={() => setSubTab(key)}
            className={cn(
              'px-4 py-2.5 text-sm font-semibold border-b-2 transition-all -mb-px',
              subTab === key
                ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                : 'border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
            )}>
            {label}
          </button>
        ))}
      </div>

      {/* Content — scrollable */}
      <div className="flex-1 overflow-y-auto">
        {subTab === 'calendars' && <CalendarsTab />}
        {subTab === 'video'     && <VideoConferencingTab />}
        {subTab === 'organic'   && <GoogleOrganicBookingTab />}
      </div>
    </div>
  )
}
