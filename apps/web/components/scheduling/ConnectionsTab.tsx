'use client'

import { useState, useEffect } from 'react'
import {
  RefreshCw, Link2, Unlink, Check, X, Loader2, AlertTriangle,
  Video, ChevronRight, Upload, ToggleLeft, ToggleRight, ExternalLink,
  CalendarDays,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── tiny shared helpers ────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-black text-gray-800 dark:text-white">{title}</h2>
      <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">{subtitle}</p>
    </div>
  )
}

function ComingSoonBadge() {
  return (
    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/10 text-gray-400 dark:text-white/40">
      Coming soon
    </span>
  )
}

function IntegrationCard({
  logo, name, description, children, disabled = false,
}: {
  logo: React.ReactNode; name: string; description: string; children: React.ReactNode; disabled?: boolean
}) {
  return (
    <div className={cn(
      'flex items-center gap-4 p-4 rounded-2xl border transition-all',
      disabled
        ? 'border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-white/3 opacity-60'
        : 'border-gray-200 dark:border-white/10 bg-white dark:bg-white/5',
    )}>
      <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-white dark:bg-white/10 shadow-sm flex-shrink-0 border border-gray-100 dark:border-white/10">
        {logo}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="font-bold text-sm text-gray-800 dark:text-white">{name}</span>
        </div>
        <p className="text-xs text-gray-400 dark:text-white/40">{description}</p>
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

// ── Logos ──────────────────────────────────────────────────────────────────────

function GoogleLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.29-8.16 2.29-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  )
}

function OutlookLogo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#0078D4"/>
      <path d="M7 7h5.5a3 3 0 010 6H7V7z" fill="white" opacity="0.9"/>
      <rect x="7" y="14" width="10" height="3" rx="1" fill="white" opacity="0.7"/>
    </svg>
  )
}

function ZoomLogo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#2D8CFF"/>
      <path d="M4 8.5h9.5a2 2 0 012 2v3a2 2 0 01-2 2H4a2 2 0 01-2-2v-3a2 2 0 012-2z" fill="white"/>
      <path d="M15.5 10.5l4-2v7l-4-2v-3z" fill="white"/>
    </svg>
  )
}

function TeamsLogo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#6264A7"/>
      <circle cx="14" cy="8" r="2.5" fill="white"/>
      <path d="M11 14.5C11 12.567 12.567 11 14.5 11H17c1.657 0 3 1.343 3 3v1H11v-.5z" fill="white" opacity="0.9"/>
      <circle cx="8" cy="9.5" r="2" fill="white" opacity="0.8"/>
      <path d="M5 16.5C5 15.12 6.12 14 7.5 14H9c1.38 0 2.5 1.12 2.5 2.5V17H5v-.5z" fill="white" opacity="0.7"/>
    </svg>
  )
}

// ── Sync Preferences modal ─────────────────────────────────────────────────────

function SyncPreferencesModal({
  syncType,
  setSyncType,
  onSave,
  onClose,
}: {
  syncType: 'one-way' | 'two-way'
  setSyncType: (v: 'one-way' | 'two-way') => void
  onSave: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-[#0e2045] rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/8">
          <h3 className="text-sm font-black text-gray-800 dark:text-white">Sync Preferences</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-white/70 transition-colors"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          {([
            { value: 'one-way', label: 'Default Sync (One-way Sync)', badge: 'Recommended', desc: 'Code Clinic appointments are pushed to Google Calendar. Changes in Google Calendar do not affect clinic bookings.' },
            { value: 'two-way', label: 'Two-way Sync', badge: null, desc: 'Appointments are synced in both directions. Clinic events appear in Google Calendar and Google Calendar events block clinic availability.' },
          ] as const).map(opt => (
            <button key={opt.value} onClick={() => setSyncType(opt.value)}
              className={cn(
                'w-full text-left p-4 rounded-xl border-2 transition-all',
                syncType === opt.value
                  ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-900/20'
                  : 'border-gray-200 dark:border-white/10 hover:border-cyan-300 dark:hover:border-cyan-700',
              )}>
              <div className="flex items-center gap-2 mb-1">
                <div className={cn(
                  'w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all',
                  syncType === opt.value ? 'border-cyan-500' : 'border-gray-300 dark:border-white/30',
                )}>
                  {syncType === opt.value && <div className="w-2 h-2 rounded-full bg-cyan-500" />}
                </div>
                <span className="text-sm font-bold text-gray-800 dark:text-white">{opt.label}</span>
                {opt.badge && (
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                    {opt.badge}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 dark:text-white/40 pl-6">{opt.desc}</p>
            </button>
          ))}
        </div>
        <div className="px-5 pb-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 dark:text-white/70 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
            Cancel
          </button>
          <button onClick={onSave}
            className="px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ConnectionsTab() {
  const API = '/api-proxy'
  function authH() {
    const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    return { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }
  }

  // Google Calendar state
  const [gcConnected,    setGcConnected]    = useState(false)
  const [gcEmail,        setGcEmail]        = useState<string | null>(null)
  const [checking,       setChecking]       = useState(true)
  const [syncing,        setSyncing]        = useState(false)
  const [toast,          setToast]          = useState<{ msg: string; ok: boolean } | null>(null)

  // Sync preferences modal
  const [showSyncModal,  setShowSyncModal]  = useState(false)
  const [syncType,       setSyncType]       = useState<'one-way' | 'two-way'>('one-way')

  // Organic booking
  const [organicDisabled, setOrganicDisabled] = useState(false)
  const [primaryFeed,    setPrimaryFeed]    = useState('book_online')

  useEffect(() => {
    checkGcStatus()
    // Handle OAuth callback redirect
    const params = new URLSearchParams(window.location.search)
    const gcal   = params.get('gcal')
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
    } catch { setGcConnected(false) } finally { setChecking(false) }
  }

  async function handleGcConnect() {
    try {
      const returnTo = encodeURIComponent(window.location.pathname)
      const res  = await fetch(`${API}/integrations/google-calendar/auth-url?returnTo=${returnTo}`, { headers: authH() })
      const data = await res.json()
      if (data.url) window.location.href = data.url
      else showToast(data.error || 'Could not generate auth URL', false)
    } catch { showToast('Network error — please try again', false) }
  }

  async function handleGcDisconnect() {
    try {
      await fetch(`${API}/integrations/google-calendar/disconnect`, { method: 'DELETE', headers: authH() })
      setGcConnected(false); setGcEmail(null)
      showToast('Google Calendar disconnected', true)
    } catch { showToast('Failed to disconnect', false) }
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch(`${API}/integrations/google-calendar/sync`, {
        method: 'POST', headers: authH(), body: JSON.stringify({ calendarId: 'primary', daysBack: 1, daysForward: 30 }),
      })
      const data = await res.json()
      if (res.ok) showToast(data.message || 'Sync complete', true)
      else { if (res.status === 401) { setGcConnected(false); showToast('Session expired — reconnect Google Calendar', false) } else showToast(data.error || 'Sync failed', false) }
    } catch { showToast('Network error during sync', false) } finally { setSyncing(false) }
  }

  function showToast(msg: string, ok: boolean) { setToast({ msg, ok }); setTimeout(() => setToast(null), 5000) }

  function saveSyncPrefs() { setShowSyncModal(false); showToast('Sync preferences saved', true) }

  return (
    <div className="flex-1 overflow-y-auto">

      {/* Toast */}
      {toast && (
        <div className={cn(
          'fixed top-5 right-5 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-semibold text-white shadow-xl max-w-sm',
          toast.ok ? 'bg-emerald-500' : 'bg-red-500',
        )}>
          {toast.ok ? <Check size={16} /> : <X size={16} />}
          {toast.msg}
        </div>
      )}

      {/* Sync Preferences modal */}
      {showSyncModal && (
        <SyncPreferencesModal
          syncType={syncType}
          setSyncType={setSyncType}
          onSave={saveSyncPrefs}
          onClose={() => setShowSyncModal(false)}
        />
      )}

      <div className="p-6 space-y-10 max-w-2xl">

        {/* ── Section 1: Calendars ─────────────────────────────── */}
        <section>
          <SectionHeader
            title="Calendars"
            subtitle="Connect your third-party calendar(s) to check availability, update appointments and avoid double bookings"
          />

          <div className="space-y-3">
            {/* Google Calendar */}
            <IntegrationCard
              logo={<GoogleLogo size={26} />}
              name="Google Calendar"
              description={gcConnected
                ? (gcEmail ? `Connected as ${gcEmail}` : 'Connected — appointments sync automatically')
                : 'Sync Code Clinic appointments with your Google Calendar'
              }>
              {checking ? (
                <Loader2 size={15} className="animate-spin text-gray-400" />
              ) : gcConnected ? (
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold">
                    <Check size={10} /> Connected
                  </span>
                  <button onClick={handleGcDisconnect}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold text-red-500 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 transition-colors">
                    <Unlink size={11} /> Disconnect
                  </button>
                </div>
              ) : (
                <button onClick={handleGcConnect}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white transition-all hover:-translate-y-0.5"
                  style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                  <Link2 size={12} /> Connect
                </button>
              )}
            </IntegrationCard>

            {/* Outlook Calendar */}
            <IntegrationCard disabled
              logo={<OutlookLogo />}
              name="Outlook Calendar"
              description="Connect your Office 365 or Outlook.com calendar">
              <ComingSoonBadge />
            </IntegrationCard>

            {/* iCloud Calendar */}
            <IntegrationCard disabled
              logo={
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <rect width="24" height="24" rx="4" fill="#555"/>
                  <path d="M12 5c-2.5 0-4.5 2-4.5 4.5 0 .3.03.6.08.88C6.1 10.8 5 12.3 5 14c0 2.2 1.8 4 4 4h6c2.2 0 4-1.8 4-4 0-1.7-1.06-3.14-2.57-3.65A4.5 4.5 0 0012 5z" fill="white" opacity="0.9"/>
                </svg>
              }
              name="iCloud Calendar"
              description="Sync with your Apple iCloud calendar">
              <ComingSoonBadge />
            </IntegrationCard>
          </div>

          {/* Calendar Configuration — shown only when Google Calendar is connected */}
          {gcConnected && (
            <div className="mt-5 bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-50 dark:border-white/5">
                <p className="text-xs font-black uppercase tracking-widest text-gray-400 dark:text-white/40">Calendar Configuration</p>
              </div>

              {/* Linked Calendar */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-50 dark:border-white/5">
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-white">Linked Calendar</p>
                  <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5 flex items-center gap-1.5">
                    <GoogleLogo size={13} />
                    {gcEmail || 'Google Account'} — Primary Calendar
                  </p>
                </div>
                <button onClick={() => setShowSyncModal(true)}
                  className="text-xs font-bold text-cyan-600 dark:text-cyan-400 hover:underline flex items-center gap-1">
                  Edit <ChevronRight size={12} />
                </button>
              </div>

              {/* Conflict Calendars */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-50 dark:border-white/5">
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-white">Conflict Calendars</p>
                  <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5 flex items-center gap-1.5">
                    <GoogleLogo size={13} />
                    {gcEmail || 'Google Account'} — prevents double bookings
                  </p>
                </div>
                <button onClick={() => setShowSyncModal(true)}
                  className="text-xs font-bold text-cyan-600 dark:text-cyan-400 hover:underline flex items-center gap-1">
                  Edit <ChevronRight size={12} />
                </button>
              </div>

              {/* Sync now + Advanced settings */}
              <div className="flex items-center justify-between px-5 py-3">
                <button onClick={() => setShowSyncModal(true)}
                  className="text-xs font-bold text-gray-500 dark:text-white/50 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors flex items-center gap-1">
                  Advanced Settings <ExternalLink size={11} />
                </button>
                <button onClick={handleSync} disabled={syncing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white disabled:opacity-60 transition-all hover:-translate-y-0.5"
                  style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                  {syncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  {syncing ? 'Syncing…' : 'Sync Now'}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ── Section 2: Video Conferencing ─────────────────────── */}
        <section>
          <SectionHeader
            title="Video Conferencing"
            subtitle="Automatically generate unique meeting links whenever an appointment is scheduled"
          />

          <div className="space-y-3">
            {/* Google Meet */}
            <div className="space-y-2">
              {!gcConnected && (
                <div className="flex items-start gap-3 p-3.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-xl">
                  <AlertTriangle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Google Meet requires Google Calendar to be connected</p>
                    <button onClick={handleGcConnect}
                      className="mt-1.5 text-xs font-bold text-amber-700 dark:text-amber-400 underline hover:no-underline transition-all">
                      Connect Google Calendar →
                    </button>
                  </div>
                </div>
              )}
              <IntegrationCard
                logo={
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M4 8C4 6.9 4.9 6 6 6h12c1.1 0 2 .9 2 2v8c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V8z" fill="#00832D"/>
                    <path d="M15 10.5l5-3v9l-5-3v-3z" fill="#00AC47"/>
                    <path d="M4 8C4 6.9 4.9 6 6 6h9v4H4V8z" fill="#00832D" opacity="0.7"/>
                  </svg>
                }
                name="Google Meet"
                description="Automatically add a Meet link to each video appointment"
                disabled={!gcConnected}>
                {gcConnected ? (
                  <button
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white transition-all hover:-translate-y-0.5"
                    style={{ background: 'linear-gradient(135deg,#00832D,#00AC47)' }}>
                    <Video size={12} /> Enable
                  </button>
                ) : (
                  <ComingSoonBadge />
                )}
              </IntegrationCard>
            </div>

            {/* Zoom */}
            <IntegrationCard disabled
              logo={<ZoomLogo />}
              name="Zoom"
              description="Generate Zoom meeting links for virtual appointments">
              <ComingSoonBadge />
            </IntegrationCard>

            {/* Microsoft Teams */}
            <IntegrationCard disabled
              logo={<TeamsLogo />}
              name="Microsoft Teams"
              description="Create Teams meeting links for each appointment">
              <ComingSoonBadge />
            </IntegrationCard>
          </div>
        </section>

        {/* ── Section 3: Google Organic Booking ─────────────────── */}
        <section>
          <SectionHeader
            title="Google Organic Booking"
            subtitle="Allow patients to book directly from Google Search results"
          />

          {/* Info box */}
          <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/40 rounded-xl text-xs text-blue-700 dark:text-blue-400 space-y-1.5">
            <p className="font-bold">Before you start</p>
            <ul className="space-y-1 pl-3 list-disc">
              <li><strong>Verify Location Details</strong> — Ensure your Google Business Profile address matches what patients see in Google Maps</li>
              <li><strong>Match Descriptions</strong> — Service names and descriptions should match those in your Google Business listing</li>
              <li>Organic booking links are managed through Google Reserve — approval can take 1–2 weeks</li>
            </ul>
          </div>

          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 divide-y divide-gray-50 dark:divide-white/5">

            {/* Toggle */}
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-white">Disable Google Organic Booking</p>
                <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">Turn off to stop showing your clinic in Google's booking module</p>
              </div>
              <button onClick={() => setOrganicDisabled(d => !d)} className="flex-shrink-0">
                {organicDisabled
                  ? <ToggleRight size={30} className="text-cyan-500" />
                  : <ToggleLeft  size={30} className="text-gray-300 dark:text-white/30" />
                }
              </button>
            </div>

            {/* Primary Action Feed */}
            <div className="px-5 py-4">
              <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-2 block">Primary Action Feed</label>
              <select value={primaryFeed} onChange={e => setPrimaryFeed(e.target.value)}
                className="w-full sm:w-64 px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:border-cyan-500 transition-all">
                <option value="book_online">Book Online</option>
                <option value="schedule_appointment">Schedule Appointment</option>
                <option value="request_appointment">Request Appointment</option>
                <option value="get_quote">Get a Quote</option>
              </select>
              <p className="text-[11px] text-gray-400 dark:text-white/30 mt-1.5">This is the primary call-to-action shown in Google Search results</p>
            </div>

            {/* Services Feed */}
            <div className="px-5 py-4">
              <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-2 block">Services Feed</label>
              <p className="text-xs text-gray-400 dark:text-white/40 mb-3">Upload a services feed to make individual services bookable directly from Google</p>
              <div className="flex items-center gap-3">
                <div className="flex-1 max-w-xs px-3 py-2.5 text-sm border-2 border-dashed border-gray-300 dark:border-white/20 rounded-xl text-gray-400 dark:text-white/30 text-center">
                  services-feed.csv or .xml
                </div>
                <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
                  style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                  <Upload size={14} /> Upload
                </button>
              </div>
            </div>

          </div>
        </section>

      </div>
    </div>
  )
}
