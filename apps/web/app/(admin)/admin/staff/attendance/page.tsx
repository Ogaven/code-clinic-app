'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarCheck, Clock3, MapPin, Save, Users } from 'lucide-react'

const todayKampala = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala' }).format(new Date())
const fmtTime = (value?: string) => value ? new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' }) : '—'

export default function StaffAttendancePage() {
  const [employees, setEmployees] = useState<any[]>([]), [records, setRecords] = useState<any[]>([])
  const [from, setFrom] = useState(todayKampala), [to, setTo] = useState(todayKampala)
  const [userId, setUserId] = useState(''), [role, setRole] = useState(''), [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [message, setMessage] = useState('')
  const [config, setConfig] = useState({ enabled: false, latitude: 0, longitude: 0, radiusMetres: 200, maximumAccuracyMetres: 250 })
  const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('cc_token')}` })
  const load = useCallback(async () => {
    setLoading(true)
    const query = new URLSearchParams({ from, to }); if (userId) query.set('userId', userId); if (role) query.set('role', role); if (status) query.set('status', status)
    const [staffResponse, attendanceResponse, configResponse] = await Promise.all([fetch('/api-proxy/employees', { headers: headers() }), fetch(`/api-proxy/attendance/admin?${query}`, { headers: headers() }), fetch('/api-proxy/attendance/config', { headers: headers() })])
    if (staffResponse.ok) setEmployees(await staffResponse.json()); if (attendanceResponse.ok) setRecords(await attendanceResponse.json())
    if (configResponse.ok) { const value = await configResponse.json(); if (value.configured) setConfig({ enabled: value.enabled, latitude: value.latitude, longitude: value.longitude, radiusMetres: value.radiusMetres, maximumAccuracyMetres: value.maximumAccuracyMetres }) }
    setLoading(false)
  }, [from, to, userId, role, status])
  useEffect(() => { load() }, [load])

  const rows = useMemo(() => {
    if (from !== to) return records
    const byUser = new Map(records.map(record => [record.userId, record]))
    return employees.filter(employee => employee.isActive && (!userId || employee.id === userId) && (!role || employee.role === role)).map(employee => byUser.get(employee.id) || { id: `missing-${employee.id}`, userId: employee.id, attendanceDate: from, status: 'NO_RECORD', user: employee })
  }, [employees, records, from, to, userId, role])
  const present = rows.filter(row => row.status !== 'NO_RECORD').length, open = rows.filter(row => row.checkInAt && !row.checkOutAt).length

  async function saveConfig() {
    setSaving(true); setMessage('')
    const response = await fetch('/api-proxy/attendance/config', { method: 'PUT', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(config) })
    const data = await response.json(); setMessage(response.ok ? 'Geofence settings saved.' : data.error || 'Unable to save settings.'); setSaving(false)
  }

  return <div className="space-y-5">
    <div><h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Staff attendance</h1><p className="text-sm text-slate-500">Review recorded check-ins and manage the clinic location policy. Times use Africa/Kampala.</p></div>
    <section className="grid gap-3 md:grid-cols-3">{[['Staff in view', rows.length, Users], ['Attendance records', present, CalendarCheck], ['Open shifts', open, Clock3]].map(([label,value,Icon]: any) => <div key={label} className="rounded-2xl border bg-white p-4 shadow-sm dark:bg-white/5"><div className="flex items-center justify-between text-sm text-slate-500"><span>{label}</span><Icon size={17} className="text-cyan-600"/></div><p className="mt-2 text-2xl font-semibold dark:text-white">{value}</p></div>)}</section>
    <section className="rounded-2xl border bg-white p-4 shadow-sm dark:bg-white/5"><div className="grid gap-3 md:grid-cols-5"><label className="text-xs text-slate-500">From<input type="date" value={from} onChange={e => setFrom(e.target.value)} className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm dark:text-white"/></label><label className="text-xs text-slate-500">To<input type="date" value={to} onChange={e => setTo(e.target.value)} className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm dark:text-white"/></label><label className="text-xs text-slate-500">Staff<select value={userId} onChange={e => setUserId(e.target.value)} className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm dark:text-white"><option value="">All staff</option>{employees.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}</select></label><label className="text-xs text-slate-500">Role<select value={role} onChange={e => setRole(e.target.value)} className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm dark:text-white"><option value="">All roles</option>{['DOCTOR','RECEPTIONIST','ACCOUNTS','DEVELOPER'].map(value => <option key={value}>{value}</option>)}</select></label><label className="text-xs text-slate-500">Status<select value={status} onChange={e => setStatus(e.target.value)} className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm dark:text-white"><option value="">All statuses</option><option value="PRESENT">Present</option></select></label></div></section>
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-white/5"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase text-slate-500 dark:bg-white/5"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Staff member</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Check in</th><th className="px-4 py-3">Check out</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Location</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-b last:border-0 dark:text-white"><td className="px-4 py-3">{String(row.attendanceDate).slice(0,10)}</td><td className="px-4 py-3 font-medium">{row.user.firstName} {row.user.lastName}</td><td className="px-4 py-3 text-slate-500">{row.user.role}</td><td className="px-4 py-3">{fmtTime(row.checkInAt)}</td><td className="px-4 py-3">{fmtTime(row.checkOutAt)}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.status === 'NO_RECORD' ? 'bg-slate-100 text-slate-500 dark:bg-white/10' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300'}`}>{row.status === 'NO_RECORD' ? 'No record' : row.status}</span></td><td className="px-4 py-3 text-slate-500">{row.checkInLat == null ? 'Not supplied' : `${Number(row.checkInLat).toFixed(5)}, ${Number(row.checkInLng).toFixed(5)}`}</td></tr>)}{!loading && !rows.length && <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-500">No attendance records match these filters.</td></tr>}</tbody></table></div></section>
    <section className="rounded-2xl border bg-white p-5 shadow-sm dark:bg-white/5"><div className="flex items-center gap-2"><MapPin size={18} className="text-cyan-600"/><div><h2 className="font-semibold dark:text-white">Clinic geofence</h2><p className="text-xs text-slate-500">Foundation only: locations are recorded and shown for review; check-ins are not automatically blocked.</p></div></div><div className="mt-4 grid gap-3 md:grid-cols-5"><label className="flex items-center gap-2 text-sm dark:text-white"><input type="checkbox" checked={config.enabled} onChange={e => setConfig({...config, enabled:e.target.checked})}/>Enabled</label>{(['latitude','longitude','radiusMetres','maximumAccuracyMetres'] as const).map(key => <label key={key} className="text-xs text-slate-500">{{latitude:'Latitude',longitude:'Longitude',radiusMetres:'Radius (metres)',maximumAccuracyMetres:'Max accuracy (metres)'}[key]}<input type="number" value={config[key]} onChange={e => setConfig({...config,[key]:Number(e.target.value)})} className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm dark:text-white"/></label>)}</div><div className="mt-4 flex items-center gap-3"><button onClick={saveConfig} disabled={saving} className="flex items-center gap-2 rounded-xl bg-[#172568] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save size={15}/>{saving ? 'Saving…' : 'Save settings'}</button>{message && <p className="text-xs text-cyan-700 dark:text-cyan-300">{message}</p>}</div></section>
  </div>
}
