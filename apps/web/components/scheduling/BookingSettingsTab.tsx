'use client'

import { useEffect, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { cn } from '@/lib/utils'

const API = '/api-proxy'
function hdr() {
  const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  return { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }
}

export default function BookingSettingsTab() {
  const [allowOverlapping, setAllowOverlapping] = useState(false)
  const [loading,          setLoading]          = useState(true)
  const [saving,           setSaving]           = useState(false)
  const [toast,            setToast]            = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    fetch(`${API}/scheduling/booking-settings`, { headers: hdr() })
      .then(r => r.json())
      .then(d => { if (typeof d.allowOverlapping === 'boolean') setAllowOverlapping(d.allowOverlapping) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`${API}/scheduling/booking-settings`, {
        method: 'POST',
        headers: hdr(),
        body: JSON.stringify({ allowOverlapping }),
      })
      if (res.ok) {
        setToast({ msg: 'Settings saved', ok: true })
        // Notify calendar to reload its setting
        window.dispatchEvent(new Event('bookingSettingsUpdated'))
      } else {
        setToast({ msg: 'Failed to save', ok: false })
      }
    } catch {
      setToast({ msg: 'Network error', ok: false })
    } finally {
      setSaving(false)
      setTimeout(() => setToast(null), 3000)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin text-cyan-500" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-xl space-y-6 overflow-y-auto">
      {toast && (
        <div className={cn(
          'fixed top-5 right-5 z-50 text-white text-sm font-semibold px-4 py-3 rounded-2xl shadow-xl',
          toast.ok ? 'bg-emerald-600' : 'bg-red-600',
        )}>
          {toast.msg}
        </div>
      )}

      <div>
        <h2 className="text-sm font-black text-gray-800 dark:text-white mb-1">Booking Rules</h2>
        <p className="text-xs text-gray-400 dark:text-white/40">
          Control how appointments are validated when booking or rescheduling.
        </p>
      </div>

      {/* Allow overlapping toggle */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-800 dark:text-white mb-0.5">
            Allow multiple appointments in same time slot
          </p>
          <p className="text-xs text-gray-400 dark:text-white/40 leading-relaxed">
            When enabled, a doctor can have more than one patient booked at the same time
            (e.g. Dr. Steven with 3 patients at 9:00 AM). When disabled, the system will
            block any booking that overlaps an existing appointment.
          </p>
          <p className={cn(
            'mt-2 text-[11px] font-bold',
            allowOverlapping ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-white/30',
          )}>
            {allowOverlapping ? '● Overlapping bookings allowed' : '○ Conflict checking active (default)'}
          </p>
        </div>
        <button
          onClick={() => setAllowOverlapping(v => !v)}
          className={cn(
            'relative flex-shrink-0 w-11 h-[22px] rounded-full transition-all',
            allowOverlapping ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-white/20',
          )}
          aria-label="Toggle overlapping appointments"
        >
          <span className={cn(
            'absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-all',
            allowOverlapping ? 'left-[23px]' : 'left-[3px]',
          )} />
        </button>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white text-sm transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60"
        style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 4px 14px rgba(41,171,226,0.3)' }}
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        Save Settings
      </button>
    </div>
  )
}
