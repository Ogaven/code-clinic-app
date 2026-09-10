'use client'

import { useCallback, useEffect, useState } from 'react'
import { Clock3, LogIn, LogOut, MapPin } from 'lucide-react'

const API = '/api-proxy'
const time = (value?: string) =>
  value ? new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' }) : '—'

// Shared staff Check In / Check Out card — same GET /attendance/today,
// GET /attendance/config, POST /attendance/check-in, POST /attendance/
// check-out already used by the Doctor dashboard (apps/api/src/routes/
// attendance.ts). Self-contained (fetches its own data) so any role's
// dashboard can drop it in without wiring. Duplicate-check-in prevention
// and the single-open-session rule are enforced server-side (unique
// userId+attendanceDate constraint / updateMany on the open session) — this
// component only surfaces the resulting state and error messages, it does
// not re-implement those rules. Geofence config is read and shown as
// informational context only, matching the existing Doctor dashboard
// behaviour — the API does not currently reject check-ins outside the
// radius, so this component doesn't claim to enforce something the backend
// doesn't.
export default function AttendanceCard() {
  const [attendance, setAttendance] = useState<any>(null)
  const [geofence, setGeofence] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const token = localStorage.getItem('cc_token')
    const headers = { Authorization: `Bearer ${token}` }
    const [today, config] = await Promise.allSettled([
      fetch(`${API}/attendance/today`, { headers }),
      fetch(`${API}/attendance/config`, { headers }),
    ])
    if (today.status === 'fulfilled' && today.value.ok) setAttendance(await today.value.json())
    if (config.status === 'fulfilled' && config.value.ok) setGeofence(await config.value.json())
  }, [])

  useEffect(() => { load() }, [load])

  async function attendanceAction(action: 'check-in' | 'check-out') {
    setBusy(true)
    setMessage('')
    try {
      let location: Record<string, number> = {}
      if ('geolocation' in navigator) {
        location = await new Promise(resolve =>
          navigator.geolocation.getCurrentPosition(
            p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
            () => resolve({}),
            { enableHighAccuracy: true, timeout: 8000 },
          ))
      }
      const token = localStorage.getItem('cc_token')
      const response = await fetch(`${API}/attendance/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...location, source: 'WEB' }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Attendance update failed')
      setMessage(action === 'check-in' ? 'Checked in successfully.' : 'Checked out successfully.')
      await load()
    } catch (error: any) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-3xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Attendance today</p>
          <h2 className="mt-1 text-xl font-semibold">
            {attendance?.currentlyCheckedIn ? 'You are checked in' : attendance?.checkedIn ? 'Shift completed' : 'Not checked in'}
          </h2>
        </div>
        <div className="rounded-xl bg-cyan-50 p-3 text-cyan-700 dark:bg-cyan-400/10"><Clock3 size={20} /></div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-muted/50 p-3"><span className="text-muted-foreground">In</span><p className="font-semibold">{time(attendance?.attendance?.checkInAt)}</p></div>
        <div className="rounded-xl bg-muted/50 p-3"><span className="text-muted-foreground">Out</span><p className="font-semibold">{time(attendance?.attendance?.checkOutAt)}</p></div>
      </div>
      <button
        disabled={busy || Boolean(attendance?.attendance?.checkOutAt)}
        onClick={() => attendanceAction(attendance?.currentlyCheckedIn ? 'check-out' : 'check-in')}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#172568] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
        {attendance?.currentlyCheckedIn ? <LogOut size={16} /> : <LogIn size={16} />} {busy ? 'Updating…' : attendance?.currentlyCheckedIn ? 'Check out' : 'Check in'}
      </button>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <MapPin size={13} />{geofence?.enabled ? 'Clinic geofence enabled; location is recorded for review.' : 'Location is recorded when browser permission is available.'}
      </p>
      {message && <p className="mt-2 text-xs font-medium text-cyan-700 dark:text-cyan-300">{message}</p>}
    </div>
  )
}