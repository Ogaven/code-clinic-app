'use client'

import { useState, useEffect } from 'react'
import { RefreshCw, Link2, Unlink, Check, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SyncSettings {
  calendarId:  string
  daysBack:    number
  daysForward: number
}

interface SyncResult {
  created: number; updated: number; errors: number; total: number; message: string
}

export default function GoogleCalendarTab() {
  const API   = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const [connected,    setConnected]    = useState(false)
  const [checking,     setChecking]     = useState(true)
  const [syncing,      setSyncing]      = useState(false)
  const [lastResult,   setLastResult]   = useState<SyncResult | null>(null)
  const [toast,        setToast]        = useState<{ msg: string; ok: boolean } | null>(null)
  const [settings,     setSettings]     = useState<SyncSettings>({
    calendarId: 'primary', daysBack: 1, daysForward: 30,
  })

  useEffect(() => {
    checkStatus()

    // Handle OAuth callback redirect
    const params = new URLSearchParams(window.location.search)
    const gcal   = params.get('gcal')
    if (gcal === 'connected') {
      showToast('Google Calendar connected successfully!', true)
      window.history.replaceState({}, '', window.location.pathname)
      checkStatus()
    } else if (gcal === 'error') {
      const reason = params.get('reason') || 'Unknown error'
      showToast(`Connection failed: ${reason}`, false)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  async function checkStatus() {
    setChecking(true)
    try {
      const res  = await fetch(`${API}/integrations/google-calendar/status`, { headers })
      const data = await res.json()
      setConnected(data.connected)
    } catch { setConnected(false) } finally { setChecking(false) }
  }

  function handleConnect() {
    const returnTo = encodeURIComponent(window.location.pathname)
    window.location.href = `${API}/integrations/google-calendar/auth?token=${token}&returnTo=${returnTo}`
  }

  async function handleDisconnect() {
    try {
      await fetch(`${API}/integrations/google-calendar/disconnect`, { method: 'DELETE', headers })
      setConnected(false)
      setLastResult(null)
      showToast('Google Calendar disconnected', true)
    } catch { showToast('Failed to disconnect', false) }
  }

  async function handleSync() {
    setSyncing(true)
    setLastResult(null)
    try {
      const res = await fetch(`${API}/integrations/google-calendar/sync`, {
        method: 'POST', headers,
        body: JSON.stringify(settings),
      })
      const data = await res.json()
      if (res.ok) {
        setLastResult(data)
        showToast(data.message, true)
      } else {
        if (res.status === 401) {
          setConnected(false)
          showToast('Session expired — please reconnect Google Calendar', false)
        } else {
          showToast(data.error || 'Sync failed', false)
        }
      }
    } catch { showToast('Network error during sync', false) } finally { setSyncing(false) }
  }

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 5000)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
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

      <div className="max-w-xl space-y-6">

        {/* Header */}
        <div>
          <h2 className="text-lg font-bold text-clinic-navy dark:text-white">Google Calendar</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Sync Code Clinic appointments with Google Calendar in one click
          </p>
        </div>

        {/* Connection card */}
        <div className={cn(
          'rounded-2xl border p-5 transition-all',
          connected
            ? 'border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/5'
            : 'border-gray-200 dark:border-white/10 bg-white dark:bg-white/5',
        )}>
          <div className="flex items-center gap-4">
            {/* Google logo */}
            <div className={cn(
              'w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm flex-shrink-0',
              connected ? 'bg-white dark:bg-white/10' : 'bg-gray-100 dark:bg-white/8',
            )}>
              <svg width="28" height="28" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.29-8.16 2.29-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
            </div>

            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-gray-800 dark:text-gray-100">Google Calendar</span>
                {checking ? (
                  <Loader2 size={13} className="animate-spin text-gray-400" />
                ) : connected ? (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold">
                    <Check size={10} /> Connected
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/10 text-gray-400 text-[10px] font-bold">
                    Not connected
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {connected
                  ? 'Ready to sync. Appointments will appear in your Google Calendar.'
                  : 'Connect your Google account to enable two-way calendar sync.'}
              </p>
            </div>

            <div className="flex gap-2 flex-shrink-0">
              {connected ? (
                <>
                  <button onClick={handleSync} disabled={syncing}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-clinic-blue text-white hover:bg-blue-400 transition-all disabled:opacity-60">
                    {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    {syncing ? 'Syncing…' : 'Sync now'}
                  </button>
                  <button onClick={handleDisconnect}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-red-50 dark:bg-red-500/10 text-red-500 hover:bg-red-100 dark:hover:bg-red-500/20 transition-all">
                    <Unlink size={12} />
                    Disconnect
                  </button>
                </>
              ) : (
                <button onClick={handleConnect} disabled={checking}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                  <Link2 size={14} />
                  Connect Google
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Last sync result */}
        {lastResult && (
          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/5 p-4">
            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400 mb-2">Last Sync Result</p>
            <div className="flex gap-4 text-xs">
              <div className="text-center">
                <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{lastResult.created}</p>
                <p className="text-gray-500 dark:text-gray-400">Created</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-black text-blue-600 dark:text-blue-400">{lastResult.updated}</p>
                <p className="text-gray-500 dark:text-gray-400">Updated</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-black text-gray-600 dark:text-gray-300">{lastResult.total}</p>
                <p className="text-gray-500 dark:text-gray-400">Total</p>
              </div>
              {lastResult.errors > 0 && (
                <div className="text-center">
                  <p className="text-2xl font-black text-red-500">{lastResult.errors}</p>
                  <p className="text-gray-500 dark:text-gray-400">Errors</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sync settings (only when connected) */}
        {connected && (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300">Sync Settings</h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Calendar ID</label>
                <input
                  value={settings.calendarId}
                  onChange={e => setSettings(s => ({ ...s, calendarId: e.target.value }))}
                  placeholder="primary"
                  className={[
                    'w-full px-3 py-2.5 text-sm border rounded-xl transition-all',
                    'border-gray-200 bg-gray-50 text-gray-800',
                    'focus:outline-none focus:ring-2 focus:ring-clinic-blue/20 focus:border-clinic-blue focus:bg-white',
                    'dark:border-white/10 dark:bg-white/5 dark:text-gray-100',
                  ].join(' ')}
                />
                <p className="text-[10px] text-gray-400 mt-1">Use <code>primary</code> for default</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Sync window</label>
                <div className="flex items-center gap-2">
                  <input type="number" min="0" max="90"
                    value={settings.daysBack}
                    onChange={e => setSettings(s => ({ ...s, daysBack: +e.target.value }))}
                    className={[
                      'w-16 px-2 py-2.5 text-sm border rounded-xl text-center transition-all',
                      'border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-100',
                      'focus:outline-none focus:ring-2 focus:ring-clinic-blue/20',
                    ].join(' ')}
                  />
                  <span className="text-xs text-gray-400">days back /</span>
                  <input type="number" min="1" max="365"
                    value={settings.daysForward}
                    onChange={e => setSettings(s => ({ ...s, daysForward: +e.target.value }))}
                    className={[
                      'w-16 px-2 py-2.5 text-sm border rounded-xl text-center transition-all',
                      'border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-100',
                      'focus:outline-none focus:ring-2 focus:ring-clinic-blue/20',
                    ].join(' ')}
                  />
                  <span className="text-xs text-gray-400">ahead</span>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
