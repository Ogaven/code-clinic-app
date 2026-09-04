'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { CalendarDays, Clock3, LogIn, LogOut, MapPin, TrendingUp, UserCheck } from 'lucide-react'
import { cn, formatUGX } from '@/lib/utils'
import LivePatientFlow from '@/components/scheduling/LivePatientFlow'
import Avatar from '@/components/ui/Avatar'
import AiSuiteSnapshotCard from '@/components/receptionist/AiSuiteSnapshotCard'

const API = '/api-proxy'
const terminal = new Set(['COMPLETED','CANCELLED','CANCELLED_RESCHEDULED','NO_SHOW','DEPARTED'])
const time = (value?: string) => value ? new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' }) : '—'

// Same appointment-status vocabulary as the Admin dashboard's "Appointments
// This Week" card (apps/web/app/(admin)/dashboard/page.tsx) and the real
// AppointmentStatus enum (packages/database/prisma/schema.prisma) — no
// invented statuses. "Completed" here means the visit is genuinely over
// (DEPARTED/COMPLETED), not mid-checkout — mid-checkout appointments are
// already counted by the Live Flow summary's "Checkout" stage below, so
// this avoids the same appointment being read as "done" in two places.
const APPT_SEGMENTS = [
  { key: 'CONFIRMED', label: 'Confirmed', color: '#2563EB', match: (s: string) => s === 'CONFIRMED' },
  { key: 'PENDING', label: 'Pending', color: '#D97706', match: (s: string) => s === 'PENDING' },
  { key: 'COMPLETED', label: 'Completed', color: '#059669', match: (s: string) => s === 'COMPLETED' || s === 'DEPARTED' },
  { key: 'NO_SHOW', label: 'No-show', color: '#DC2626', match: (s: string) => s === 'NO_SHOW' },
]

// Same grouping as TreatmentPipelineBoard's STATUSES / the Admin dashboard's
// PIPELINE_STATUSES (apps/web/components/treatment-pipeline/TreatmentPipelineBoard.tsx)
// — the shared Treatment Plan status vocabulary, not a new one.
const PIPELINE_SEGMENTS = [
  { key: 'Planned', label: 'Planned', color: '#1D4ED8' },
  { key: 'In Progress', label: 'In Progress', color: '#D97706' },
  { key: 'Completed', label: 'Completed', color: '#059669' },
  { key: 'On Hold', label: 'On Hold', color: '#CA8A04' },
  { key: 'Declined', label: 'Declined', color: '#E11D48' },
  { key: 'Cancelled', label: 'Cancelled', color: '#9CA3AF' },
]

// Same 4-stage grouping as the real <LivePatientFlow /> component
// (apps/web/components/scheduling/LivePatientFlow.tsx) and the Admin
// dashboard's Patient Live Flow card — reused, not reinvented.
const FLOW_STAGES = [
  { key: 'arrived', label: 'Arrived', statuses: ['ARRIVED', 'CHECKED_IN'], color: '#3B82F6' },
  { key: 'waiting', label: 'Waiting', statuses: ['WAITING'], color: '#EAB308' },
  { key: 'session', label: 'In Session', statuses: ['IN_OPERATORY', 'IN_CHAIR', 'WITH_PROVIDER'], color: '#F97316' },
  { key: 'checkout', label: 'Checkout', statuses: ['READY_CHECKOUT'], color: '#A855F7' },
]

// Upcoming Appointments timeline geometry — same pixel-based approach as the
// Admin dashboard's timeline (hour labels and pills scroll together inside a
// horizontal scroller, not percentage-based).
const DAY_START_HOUR = 8, DAY_END_HOUR = 18, HOUR_PX = 84
const TIMELINE_WIDTH = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_PX
const HOUR_MARKS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
const pxOf = (t: number) => {
  const d = new Date(t)
  const hourFloat = d.getHours() + d.getMinutes() / 60
  return Math.max(0, Math.min(TIMELINE_WIDTH, (hourFloat - DAY_START_HOUR) * HOUR_PX))
}

// ── Shared visual primitives (same language as the Admin dashboard's
// DistributionBar / ChipLegend, expressed in this app's card/border/muted
// tokens for consistency with the rest of this page). ──────────────────────
function DistributionBar({ segments, total }: { segments: { color: string; count: number }[]; total: number }) {
  const denom = Math.max(total, 1)
  return (
    <div className="flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
      {segments.filter(s => s.count > 0).map((s, i) => <div key={i} style={{ width: `${(s.count / denom) * 100}%`, background: s.color }} />)}
    </div>
  )
}
function ChipLegend({ items, loading }: { items: { label: string; count: number; color: string }[]; loading: boolean }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
      {items.map(it => (
        <span key={it.label} className="inline-flex items-center gap-1 text-[10px]">
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: it.color }} />
          <span className="text-muted-foreground">{it.label}</span>
          <span className="font-bold text-foreground">{loading ? '—' : it.count}</span>
        </span>
      ))}
    </div>
  )
}

export default function DoctorDashboardPage() {
  const [doctor, setDoctor] = useState<any>(null)
  const [appointments, setAppointments] = useState<any[]>([])
  const [attendance, setAttendance] = useState<any>(null)
  const [geofence, setGeofence] = useState<any>(null)
  const [pipeline, setPipeline] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const token = localStorage.getItem('cc_token'), headers = { Authorization: `Bearer ${token}` }
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala' }).format(new Date())
    const requests = await Promise.allSettled([
      fetch(`${API}/doctors/me`, { headers }), fetch(`${API}/scheduling/appointments?startDate=${today}&endDate=${today}`, { headers }),
      fetch(`${API}/attendance/today`, { headers }), fetch(`${API}/attendance/config`, { headers }),
      fetch(`${API}/pipeline/treatment?period=month`, { headers }),
    ])
    const json = async (index: number) => requests[index].status === 'fulfilled' && (requests[index] as PromiseFulfilledResult<Response>).value.ok ? (requests[index] as PromiseFulfilledResult<Response>).value.json() : null
    setDoctor(await json(0)); const appts = await json(1); setAppointments(Array.isArray(appts) ? appts : appts?.appointments || [])
    setAttendance(await json(2)); setGeofence(await json(3)); setPipeline(await json(4))
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
  const user = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('cc_user') || '{}') : {}
  const metrics = pipeline?.metrics || pipeline?.summary || {}
  const plans: any[] = pipeline?.plans || []

  const apptCounts = APPT_SEGMENTS.map(s => ({ ...s, count: appointments.filter(a => s.match(a.status)).length }))
  const pipelineCounts = PIPELINE_SEGMENTS.map(s => ({ ...s, count: plans.filter(p => p.status === s.key).length }))
  const pipelineTotal = plans.length
  const flowCounts = FLOW_STAGES.map(s => ({ ...s, count: appointments.filter(a => s.statuses.includes(a.status)).length }))
  const flowTotal = flowCounts.reduce((s, f) => s + f.count, 0)

  const futureAppts = current
    .filter(a => new Date(a.startAt).getTime() >= Date.now() && a.status !== 'CANCELLED' && a.status !== 'CANCELLED_RESCHEDULED')
    .slice(0, 8)
  const nowPx = pxOf(Date.now())

  return <div className="space-y-4">
    <section className="grid gap-4 xl:grid-cols-[1.4fr_.8fr]">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#111b55] via-[#173b83] to-[#1ca8d5] p-5 text-white shadow-xl sm:p-6">
        <div className="relative z-10 max-w-xl">
          <p className="text-sm text-cyan-100">Welcome back</p>
          <h1 className="mt-0.5 text-2xl font-semibold text-white sm:text-3xl">Dr. {doctor?.user?.firstName || user.firstName || 'Doctor'}</h1>
          <p className="mt-1.5 text-sm text-blue-100">Your clinical day, patient flow, and follow-up signals in one workspace.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/doctor/schedule?tab=appointments" className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#162663]">View my appointments</Link>
            <Link href="/doctor/flow" className="rounded-xl border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold">Open live flow</Link>
          </div>
        </div>
        <Image src="/dental3d.png" alt="Dental care" width={400} height={308} className="pointer-events-none absolute -bottom-8 right-1 hidden h-auto opacity-90 md:block md:w-[30%] md:max-w-[230px] lg:-bottom-10 lg:w-[32%] lg:max-w-[270px] xl:w-[36%] xl:max-w-[320px]"/>
      </div>
      <div className="rounded-3xl border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Attendance today</p><h2 className="mt-1 text-xl font-semibold">{attendance?.currentlyCheckedIn ? 'You are checked in' : attendance?.checkedIn ? 'Shift completed' : 'Not checked in'}</h2></div><div className="rounded-xl bg-cyan-50 p-3 text-cyan-700 dark:bg-cyan-400/10"><Clock3 size={20}/></div></div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div className="rounded-xl bg-muted/50 p-3"><span className="text-muted-foreground">In</span><p className="font-semibold">{time(attendance?.attendance?.checkInAt)}</p></div><div className="rounded-xl bg-muted/50 p-3"><span className="text-muted-foreground">Out</span><p className="font-semibold">{time(attendance?.attendance?.checkOutAt)}</p></div></div>
        <button disabled={busy || Boolean(attendance?.attendance?.checkOutAt)} onClick={() => attendanceAction(attendance?.currentlyCheckedIn ? 'check-out' : 'check-in')} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#172568] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{attendance?.currentlyCheckedIn ? <LogOut size={16}/> : <LogIn size={16}/>} {busy ? 'Updating…' : attendance?.currentlyCheckedIn ? 'Check out' : 'Check in'}</button>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><MapPin size={13}/>{geofence?.enabled ? 'Clinic geofence enabled; location is recorded for review.' : 'Location is recorded when browser permission is available.'}</p>{message && <p className="mt-2 text-xs font-medium text-cyan-700 dark:text-cyan-300">{message}</p>}
      </div>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between"><p className="text-sm font-semibold">Appointments <span className="font-normal text-muted-foreground">· Today</span></p><span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-cyan-50 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300"><CalendarDays size={15}/></span></div>
        <div className="mt-2 flex items-center gap-3"><p className="text-2xl font-bold leading-none">{appointments.length}</p><div className="h-7 w-px flex-shrink-0 bg-border"/><DistributionBar segments={apptCounts} total={appointments.length}/></div>
        <ChipLegend items={apptCounts} loading={false}/>
        <Link href="/doctor/schedule?tab=appointments" className="mt-3 inline-flex text-xs font-semibold text-cyan-600">View appointments →</Link>
      </div>

      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between"><p className="text-sm font-semibold">Treatment Pipeline <span className="font-normal text-muted-foreground">· This month</span></p><span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300"><TrendingUp size={15}/></span></div>
        <div className="mt-2 flex items-center gap-3"><p className="text-2xl font-bold leading-none">{pipeline ? pipelineTotal : '—'}</p><div className="h-7 w-px flex-shrink-0 bg-border"/><DistributionBar segments={pipelineCounts} total={pipelineTotal}/></div>
        <ChipLegend items={pipelineCounts} loading={!pipeline}/>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          <span>{metrics.conversionRate ?? 0}% conversion this month</span>
          <span>·</span>
          <span>{formatUGX(metrics.moneyAtRisk || 0)} at risk (all time)</span>
        </div>
        <Link href="/doctor/reports/treatment-pipeline" className="mt-3 inline-flex text-xs font-semibold text-cyan-600">Open pipeline →</Link>
      </div>

      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between"><p className="text-sm font-semibold">Patient Live Flow <span className="font-normal text-muted-foreground">· Live now</span></p><span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"><UserCheck size={15}/></span></div>
        <div className="mt-2 flex items-center gap-3"><p className="text-2xl font-bold leading-none">{flowTotal}</p><div className="h-7 w-px flex-shrink-0 bg-border"/><p className="text-[10px] font-medium leading-tight text-muted-foreground">active in<br/>my flow now</p></div>
        <div className="mt-3.5 flex items-center">
          {flowCounts.map((s, i) => (
            <div key={s.key} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <div className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: s.count > 0 ? s.color : '#D1D5DB' }}>{s.count}</div>
                <span className="whitespace-nowrap text-[9px] font-medium text-muted-foreground">{s.label}</span>
              </div>
              {i < flowCounts.length - 1 && <div className="mx-1 mb-4 h-0.5 flex-1 rounded-full" style={{ background: s.color, opacity: 0.25 }}/>}
            </div>
          ))}
        </div>
        <Link href="/doctor/flow" className="mt-3.5 inline-flex text-xs font-semibold text-cyan-600">Open live flow →</Link>
      </div>
    </section>

    <section className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-3xl border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Upcoming Appointments</h2><Link href="/doctor/schedule?tab=appointments" className="text-xs font-semibold text-cyan-600">See all</Link></div>
        {futureAppts.length === 0 ? (
          <div className="flex h-36 flex-col items-center justify-center gap-1 text-center"><CalendarDays size={20} className="text-muted-foreground/40"/><p className="text-xs font-medium text-muted-foreground">No more appointments today.</p></div>
        ) : (
          <div className="no-scrollbar mt-4 w-full overflow-x-auto">
            <div style={{ width: TIMELINE_WIDTH, minWidth: '100%' }} className="relative">
              <div className="relative h-4">
                {HOUR_MARKS.map(h => <span key={h} className="absolute -translate-x-1/2 whitespace-nowrap text-[9px] font-medium text-muted-foreground" style={{ left: (h - DAY_START_HOUR) * HOUR_PX }}>{h > 12 ? h - 12 : h}{h >= 12 ? 'PM' : 'AM'}</span>)}
              </div>
              <div className="relative mt-1 rounded-xl bg-muted/40" style={{ height: 112 }}>
                {HOUR_MARKS.map(h => <div key={h} className="absolute bottom-0 top-0 border-l border-border/60" style={{ left: (h - DAY_START_HOUR) * HOUR_PX }}/>)}
                {nowPx >= 0 && nowPx <= TIMELINE_WIDTH && (
                  <div className="absolute bottom-0 top-0 z-10 w-px bg-cyan-500 dark:bg-cyan-400" style={{ left: nowPx }}><span className="absolute -top-1.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-cyan-500 dark:bg-cyan-400"/></div>
                )}
                {futureAppts.map((a, i) => {
                  const left = pxOf(new Date(a.startAt).getTime())
                  const right = a.endAt ? pxOf(new Date(a.endAt).getTime()) : left + 84
                  const width = Math.max(right - left, 76)
                  const top = 8 + (i % 3) * 33
                  const t = new Date(a.startAt).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
                  return (
                    <div key={a.id} className={cn('absolute flex items-center gap-1.5 overflow-hidden rounded-full py-1 pl-1 pr-2.5 text-white shadow-sm', i === 0 && 'ring-2 ring-cyan-500 ring-offset-1 dark:ring-cyan-400 dark:ring-offset-slate-900')}
                      style={{ left, top, width, background: a.service?.colour || '#29ABE2' }} title={`${t} · ${a.patient?.firstName} ${a.patient?.lastName} · ${a.service?.name || 'Appointment'}`}>
                      <Avatar firstName={a.patient?.firstName || ''} lastName={a.patient?.lastName || ''} size="xs" colour="rgba(255,255,255,0.3)"/>
                      <span className="truncate text-[10px] font-bold">{a.patient?.firstName}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
      <AiSuiteSnapshotCard inboxHref="/doctor/ai-suite/followup-dashboard"/>
    </section>

    {doctor?.id && <section className="overflow-hidden rounded-3xl border bg-card shadow-sm"><div className="border-b px-5 py-4"><h2 className="font-semibold">Live patient flow</h2><p className="text-xs text-muted-foreground">Only patients assigned to your workspace are shown.</p></div><div className="min-h-[420px]"><LivePatientFlow doctorId={doctor.id} patientBasePath="/doctor/patients"/></div></section>}
  </div>
}