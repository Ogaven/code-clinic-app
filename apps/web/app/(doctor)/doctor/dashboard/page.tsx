'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Activity, Bot, CalendarDays, CheckCircle2, Clock3, LogIn, LogOut, MapPin, Users } from 'lucide-react'
import LivePatientFlow from '@/components/scheduling/LivePatientFlow'

const API = '/api-proxy'
const terminal = new Set(['COMPLETED','CANCELLED','CANCELLED_RESCHEDULED','NO_SHOW','DEPARTED'])
const time = (value?: string) => value ? new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' }) : '—'

export default function DoctorDashboardPage() {
  const [doctor, setDoctor] = useState<any>(null)
  const [appointments, setAppointments] = useState<any[]>([])
  const [attendance, setAttendance] = useState<any>(null)
  const [geofence, setGeofence] = useState<any>(null)
  const [pipeline, setPipeline] = useState<any>(null)
  const [ai, setAi] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const token = localStorage.getItem('cc_token'), headers = { Authorization: `Bearer ${token}` }
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala' }).format(new Date())
    const requests = await Promise.allSettled([
      fetch(`${API}/doctors/me`, { headers }), fetch(`${API}/scheduling/appointments?startDate=${today}&endDate=${today}`, { headers }),
      fetch(`${API}/attendance/today`, { headers }), fetch(`${API}/attendance/config`, { headers }),
      fetch(`${API}/pipeline/treatment?period=month`, { headers }), fetch(`${API}/ai-suite/snapshot`, { headers }),
    ])
    const json = async (index: number) => requests[index].status === 'fulfilled' && (requests[index] as PromiseFulfilledResult<Response>).value.ok ? (requests[index] as PromiseFulfilledResult<Response>).value.json() : null
    setDoctor(await json(0)); const appts = await json(1); setAppointments(Array.isArray(appts) ? appts : appts?.appointments || [])
    setAttendance(await json(2)); setGeofence(await json(3)); setPipeline(await json(4)); setAi(await json(5))
  }, [])
  useEffect(() => { load() }, [load])

  async function attendanceAction(action: 'check-in' | 'check-out') {
    setBusy(true); setMessage('')
    try {
      let location: Record<string, number> = {}
      if ('geolocation' in navigator) location = await new Promise(resolve => navigator.geolocation.getCurrentPosition(p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }), () => resolve({}), { enableHighAccuracy: true, timeout: 8000 }))
      const token = localStorage.getItem('cc_token')
      const response = await fetch(`${API}/attendance/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...location, source: 'WEB' }) })
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Attendance update failed')
      setMessage(action === 'check-in' ? 'Checked in successfully.' : 'Checked out successfully.'); await load()
    } catch (error: any) { setMessage(error.message) } finally { setBusy(false) }
  }

  const current = useMemo(() => appointments.filter(a => !terminal.has(a.status)).sort((a,b) => +new Date(a.startAt) - +new Date(b.startAt)), [appointments])
  const active = appointments.filter(a => ['ARRIVED','WAITING','IN_OPERATORY','WITH_PROVIDER','IN_CHAIR'].includes(a.status)).length
  const completed = appointments.filter(a => ['SESSION_COMPLETE','CHECKOUT','DEPARTED','COMPLETED'].includes(a.status)).length
  const user = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('cc_user') || '{}') : {}
  const metrics = pipeline?.metrics || pipeline?.summary || {}

  return <div className="space-y-5">
    <section className="grid gap-4 xl:grid-cols-[1.4fr_.8fr]">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#111b55] via-[#173b83] to-[#1ca8d5] p-6 text-white shadow-xl">
        <div className="relative z-10 max-w-xl"><p className="text-sm text-cyan-100">Welcome back</p><h1 className="mt-1 text-3xl font-semibold">Dr. {doctor?.user?.firstName || user.firstName || 'Doctor'}</h1><p className="mt-2 text-sm text-blue-100">Your clinical day, patient flow, and follow-up signals in one workspace.</p>
          <div className="mt-6 flex flex-wrap gap-3"><Link href="/doctor/schedule?tab=appointments" className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#162663]">View my appointments</Link><Link href="/doctor/live-flow" className="rounded-xl border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold">Open live flow</Link></div>
        </div><Image src="/dental3d.png" alt="Dental care" width={260} height={200} className="absolute -bottom-10 right-0 hidden opacity-75 md:block"/>
      </div>
      <div className="rounded-3xl border bg-card p-5 shadow-sm"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Attendance today</p><h2 className="mt-1 text-xl font-semibold">{attendance?.currentlyCheckedIn ? 'You are checked in' : attendance?.checkedIn ? 'Shift completed' : 'Not checked in'}</h2></div><div className="rounded-xl bg-cyan-50 p-3 text-cyan-700 dark:bg-cyan-400/10"><Clock3 size={20}/></div></div>
        <div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div className="rounded-xl bg-muted/50 p-3"><span className="text-muted-foreground">In</span><p className="font-semibold">{time(attendance?.attendance?.checkInAt)}</p></div><div className="rounded-xl bg-muted/50 p-3"><span className="text-muted-foreground">Out</span><p className="font-semibold">{time(attendance?.attendance?.checkOutAt)}</p></div></div>
        <button disabled={busy || Boolean(attendance?.attendance?.checkOutAt)} onClick={() => attendanceAction(attendance?.currentlyCheckedIn ? 'check-out' : 'check-in')} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#172568] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{attendance?.currentlyCheckedIn ? <LogOut size={16}/> : <LogIn size={16}/>} {busy ? 'Updating…' : attendance?.currentlyCheckedIn ? 'Check out' : 'Check in'}</button>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><MapPin size={13}/>{geofence?.enabled ? 'Clinic geofence enabled; location is recorded for review.' : 'Location is recorded when browser permission is available.'}</p>{message && <p className="mt-2 text-xs font-medium text-cyan-700 dark:text-cyan-300">{message}</p>}
      </div>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
      ['Today’s patients', appointments.length, CalendarDays], ['Active now', active, Activity], ['Completed', completed, CheckCircle2], ['Pipeline at risk', metrics.moneyAtRisk == null ? '—' : `UGX ${Number(metrics.moneyAtRisk).toLocaleString()}`, Users],
    ].map(([label,value,Icon]: any) => <div key={label} className="rounded-2xl border bg-card p-4 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{label}</p><Icon size={17} className="text-cyan-600"/></div><p className="mt-2 text-2xl font-semibold">{value}</p></div>)}</section>

    <section className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-3xl border bg-card p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="font-semibold">Up next</h2><Link href="/doctor/schedule?tab=appointments" className="text-xs font-semibold text-cyan-600">See all</Link></div><div className="mt-4 space-y-3">{current.slice(0,4).map(a => <div key={a.id} className="flex items-center gap-3 rounded-xl bg-muted/45 p-3"><div className="w-16 text-sm font-semibold text-cyan-700">{time(a.startAt)}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{a.patient?.firstName} {a.patient?.lastName}</p><p className="truncate text-xs text-muted-foreground">{a.service?.name || 'Appointment'} · {a.status}</p></div></div>)}{!current.length && <p className="py-8 text-center text-sm text-muted-foreground">No remaining appointments today.</p>}</div></div>
      <div className="rounded-3xl border bg-card p-5 shadow-sm"><div className="flex items-center gap-2"><Bot size={18} className="text-violet-600"/><h2 className="font-semibold">AI Suite summary</h2></div><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-violet-50 p-4 dark:bg-violet-400/10"><p className="text-xs text-muted-foreground">Follow-ups</p><p className="mt-1 text-2xl font-semibold">{ai?.followUps?.pending ?? ai?.pendingFollowUps ?? '—'}</p></div><div className="rounded-xl bg-cyan-50 p-4 dark:bg-cyan-400/10"><p className="text-xs text-muted-foreground">Confirmations</p><p className="mt-1 text-2xl font-semibold">{ai?.confirmations?.pending ?? ai?.pendingConfirmations ?? '—'}</p></div></div><Link href="/doctor/ai-suite/followup-dashboard" className="mt-4 inline-flex text-sm font-semibold text-cyan-600">Open Doctor AI Suite →</Link></div>
    </section>

    {doctor?.id && <section className="overflow-hidden rounded-3xl border bg-card shadow-sm"><div className="border-b px-5 py-4"><h2 className="font-semibold">Live patient flow</h2><p className="text-xs text-muted-foreground">Only patients assigned to your workspace are shown.</p></div><div className="min-h-[560px]"><LivePatientFlow doctorId={doctor.id} patientBasePath="/doctor/patients"/></div></section>}
  </div>
}
