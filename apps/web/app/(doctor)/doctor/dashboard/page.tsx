'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Calendar, Users, CheckCircle2, Clock, TrendingUp,
  ChevronRight, Stethoscope, AlertTriangle, Activity,
} from 'lucide-react'
import { cn, formatUGX } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'

// ── Status config ─────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Scheduled', CONFIRMED: 'Confirmed', CHECKED_IN: 'Checked In',
  IN_CHAIR: 'In Chair', WITH_PROVIDER: 'With Provider', READY_CHECKOUT: 'Ready Checkout',
  COMPLETED: 'Done', CANCELLED: 'Cancelled', NO_SHOW: 'No Show',
}
const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  PENDING:        { bg: 'bg-slate-100', text: 'text-slate-600' },
  CONFIRMED:      { bg: 'bg-blue-100',  text: 'text-blue-700' },
  CHECKED_IN:     { bg: 'bg-yellow-100', text: 'text-yellow-700' },
  IN_CHAIR:       { bg: 'bg-orange-100', text: 'text-orange-700' },
  WITH_PROVIDER:  { bg: 'bg-teal-100',  text: 'text-teal-700' },
  READY_CHECKOUT: { bg: 'bg-purple-100', text: 'text-purple-700' },
  COMPLETED:      { bg: 'bg-green-100', text: 'text-green-700' },
  CANCELLED:      { bg: 'bg-gray-100',  text: 'text-gray-500' },
  NO_SHOW:        { bg: 'bg-red-50',    text: 'text-red-500' },
}
const STATUS_NEXT: Record<string, string> = {
  CONFIRMED: 'CHECKED_IN', CHECKED_IN: 'IN_CHAIR',
  IN_CHAIR: 'WITH_PROVIDER', WITH_PROVIDER: 'READY_CHECKOUT',
  READY_CHECKOUT: 'COMPLETED',
}
const STATUS_NEXT_LABEL: Record<string, string> = {
  CONFIRMED: 'Check In', CHECKED_IN: 'Seat in Chair',
  IN_CHAIR: 'With Provider', WITH_PROVIDER: 'Ready Checkout',
  READY_CHECKOUT: 'Complete',
}

function getGreeting() {
  const h = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Kampala' })).getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

// ── Appointment card ──────────────────────────────────────────
function ApptCard({ appt, onRefresh }: { appt: any; onRefresh: () => void }) {
  const [loading, setLoading] = useState(false)
  const startTime = new Date(appt.startAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala' })
  const endTime = new Date(appt.endAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala' })
  const sc = STATUS_COLOR[appt.status] || STATUS_COLOR.PENDING
  const nextStatus = STATUS_NEXT[appt.status]
  const isActive = ['CHECKED_IN', 'IN_CHAIR', 'WITH_PROVIDER'].includes(appt.status)

  async function advance() {
    if (!nextStatus) return
    setLoading(true)
    try {
      const token = localStorage.getItem('cc_token')
      await fetch(`/api-proxy/scheduling/appointments/${appt.id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      onRefresh()
    } finally { setLoading(false) }
  }

  return (
    <div className={cn(
      'rounded-2xl border bg-white shadow-sm p-4 transition-all hover:shadow-md',
      isActive ? 'border-teal-200 ring-1 ring-teal-100' : 'border-gray-100',
    )}>
      <div className="flex items-start gap-3">
        <Avatar
          firstName={appt.patient?.firstName}
          lastName={appt.patient?.lastName}
          colour={appt.service?.colour || '#29ABE2'}
          size="md"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <p className="font-bold text-gray-900 text-sm">{appt.patient?.firstName} {appt.patient?.lastName}</p>
              <p className="text-xs text-gray-400 mt-0.5">{appt.service?.name}</p>
            </div>
            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0', sc.bg, sc.text)}>
              {STATUS_LABEL[appt.status] || appt.status}
            </span>
          </div>

          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <Clock size={11} /> {startTime} – {endTime}
            </span>
            <Link href={`/patients/${appt.patient?.id}?tab=dental`}
              className="flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:underline">
              🦷 View Chart
            </Link>
            <Link href={`/patients/${appt.patient?.id}`}
              className="text-[11px] font-bold text-gray-400 hover:underline">
              Full Profile
            </Link>
          </div>

          {nextStatus && !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(appt.status) && (
            <button
              onClick={advance}
              disabled={loading}
              className="mt-3 w-full py-1.5 rounded-xl text-xs font-bold text-white transition-all hover:opacity-90 disabled:opacity-60"
              style={{ background: isActive ? '#0D9488' : '#3B82F6' }}>
              {loading ? 'Updating...' : `→ ${STATUS_NEXT_LABEL[appt.status]}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────
export default function DoctorDashboard() {
  const [user, setUser]         = useState<any>(null)
  const [doctor, setDoctor]     = useState<any>(null)
  const [todayAppts, setToday]  = useState<any[]>([])
  const [upcomingAppts, setUpcoming] = useState<any[]>([])
  const [myPatients, setPatients]    = useState<any[]>([])
  const [stats, setStats]       = useState({ total: 0, completed: 0, pending: 0, inProgress: 0 })
  const [loading, setLoading]   = useState(true)

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  async function fetchAll() {
    try {
      const [appts, upcoming, patients, doctors] = await Promise.all([
        fetch('/api-proxy/scheduling/appointments?today=true', { headers: authH }).then(r => r.json()),
        fetch('/api-proxy/scheduling/appointments?upcoming=true', { headers: authH }).then(r => r.json()),
        fetch('/api-proxy/patients?limit=10&my=true', { headers: authH }).then(r => r.json()),
        fetch('/api-proxy/doctors', { headers: authH }).then(r => r.json()),
      ])

      const u = JSON.parse(localStorage.getItem('cc_user') || '{}')
      setUser(u)

      // Find current user's doctor record
      const myDoctor = Array.isArray(doctors)
        ? doctors.find((d: any) => d.userId === u.id || d.firstName === u.firstName)
        : null
      setDoctor(myDoctor)

      // Filter appointments for this doctor
      const myId = myDoctor?.id
      const todayList = Array.isArray(appts)
        ? (myId ? appts.filter((a: any) => a.doctor?.id === myId || a.doctorId === myId) : appts)
        : []
      const upcomingList = Array.isArray(upcoming)
        ? (myId ? upcoming.filter((a: any) => a.doctor?.id === myId || a.doctorId === myId) : upcoming)
        : []

      setToday(todayList)
      setUpcoming(upcomingList)
      setPatients(Array.isArray(patients) ? patients.slice(0, 8) : [])
      setStats({
        total:      todayList.length,
        completed:  todayList.filter((a: any) => a.status === 'COMPLETED').length,
        pending:    todayList.filter((a: any) => ['PENDING', 'CONFIRMED'].includes(a.status)).length,
        inProgress: todayList.filter((a: any) => ['CHECKED_IN', 'IN_CHAIR', 'WITH_PROVIDER', 'READY_CHECKOUT'].includes(a.status)).length,
      })
    } catch (e) {
      console.error(e)
    } finally { setLoading(false) }
  }

  useEffect(() => {
    fetchAll()
    const t = setInterval(fetchAll, 30000)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-full min-h-[60vh]">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-400">Loading your dashboard...</p>
      </div>
    </div>
  )

  const docColour = doctor?.colour || '#29ABE2'

  return (
    <div className="p-5 space-y-5 max-w-[1400px] mx-auto animate-fade-in">

      {/* ── Hero ─────────────────────────────────────────────── */}
      <div className="rounded-3xl p-6 text-white relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, #1A237E, ${docColour})`, boxShadow: `0 16px 48px ${docColour}40` }}>
        <div className="relative z-10">
          <p className="text-blue-200 text-sm font-medium mb-1">{getGreeting()},</p>
          <h1 className="text-3xl font-black mb-1">Dr. {user?.firstName} {user?.lastName}</h1>
          <p className="text-blue-200 text-sm">{doctor?.specialisation || 'Dental Practitioner'} · Code Clinic</p>
          <div className="flex flex-wrap gap-4 mt-4 text-sm">
            <span className="bg-white/15 rounded-xl px-3 py-1.5 font-semibold">{stats.total} appointments today</span>
            <span className="bg-white/15 rounded-xl px-3 py-1.5 font-semibold">{stats.inProgress} in progress</span>
            <span className="bg-white/15 rounded-xl px-3 py-1.5 font-semibold">{stats.completed} completed</span>
          </div>
        </div>
        {/* Decorative circle */}
        <div className="absolute -right-12 -top-12 w-48 h-48 rounded-full opacity-10 border-4 border-white" />
        <div className="absolute -right-4 -bottom-16 w-64 h-64 rounded-full opacity-10 border-4 border-white" />
      </div>

      {/* ── KPI Row ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Calendar, label: "Today's Patients", value: stats.total, color: '#29ABE2', sub: 'scheduled' },
          { icon: Activity, label: 'In Progress', value: stats.inProgress, color: '#F97316', sub: 'in clinic' },
          { icon: CheckCircle2, label: 'Completed', value: stats.completed, color: '#10B981', sub: 'today' },
          { icon: Clock, label: 'Waiting', value: stats.pending, color: '#6366F1', sub: 'to be seen' },
        ].map((k, i) => (
          <div key={i} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm hover:shadow-md transition-all">
            <div className="flex items-start justify-between mb-2">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{k.label}</p>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: k.color + '20' }}>
                <k.icon size={14} style={{ color: k.color }} />
              </div>
            </div>
            <p className="text-2xl font-black" style={{ color: k.color }}>{k.value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Main grid ─────────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">

        {/* LEFT: Today's Appointments */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Today&apos;s Appointments</h2>
            <Link href="/scheduling" className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1">
              Full Schedule <ChevronRight size={12} />
            </Link>
          </div>

          {todayAppts.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
              <Calendar size={32} className="mx-auto mb-3 text-gray-200" />
              <p className="text-sm font-medium text-gray-400">No appointments today</p>
              <p className="text-xs text-gray-300 mt-1">Enjoy the quiet time!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {todayAppts.map(appt => (
                <ApptCard key={appt.id} appt={appt} onRefresh={fetchAll} />
              ))}
            </div>
          )}

          {/* Upcoming this week */}
          {upcomingAppts.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
                <h3 className="text-sm font-bold text-gray-800">Upcoming This Week</h3>
              </div>
              <div className="divide-y divide-gray-50">
                {upcomingAppts.slice(0, 5).map(a => {
                  const d = new Date(a.startAt)
                  const dateStr = d.toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Kampala' })
                  const t = d.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala' })
                  return (
                    <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                      <div className="w-1.5 h-8 rounded-full flex-shrink-0" style={{ background: a.service?.colour || docColour }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{a.patient?.firstName} {a.patient?.lastName}</p>
                        <p className="text-xs text-gray-400 truncate">{a.service?.name}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-bold text-blue-600">{t}</p>
                        <p className="text-[10px] text-gray-400">{dateStr}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: My Patients + Quick Stats */}
        <div className="space-y-4">

          {/* My Recent Patients */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
              <div className="flex items-center gap-2">
                <Users size={14} className="text-blue-500" />
                <h3 className="text-sm font-bold text-gray-800">My Patients</h3>
              </div>
              <Link href="/patients" className="text-xs text-blue-600 font-semibold hover:underline">View all</Link>
            </div>
            {myPatients.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-gray-400">No patient records yet</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {myPatients.map((p: any) => (
                  <Link key={p.id} href={`/patients/${p.id}?tab=dental`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                    <Avatar firstName={p.firstName} lastName={p.lastName} colour={docColour} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{p.firstName} {p.lastName}</p>
                      <p className="text-xs text-gray-400 truncate">{p.phone}</p>
                    </div>
                    <Stethoscope size={12} className="text-gray-300 flex-shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Treatment Progress this week */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-50">
              <TrendingUp size={14} className="text-green-500" />
              <h3 className="text-sm font-bold text-gray-800">Today&apos;s Progress</h3>
            </div>
            <div className="px-4 py-4 space-y-3">
              {([
                { label: 'Seen', value: stats.completed, total: stats.total, color: '#10B981' },
                { label: 'In Progress', value: stats.inProgress, total: stats.total, color: '#F97316' },
                { label: 'Still Waiting', value: stats.pending, total: stats.total, color: '#6366F1' },
              ]).map(item => (
                <div key={item.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-500 font-medium">{item.label}</span>
                    <span className="font-bold" style={{ color: item.color }}>{item.value}/{item.total}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-2 rounded-full transition-all duration-500"
                      style={{ width: `${item.total > 0 ? Math.round((item.value / item.total) * 100) : 0}%`, background: item.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Links */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs font-black text-gray-400 uppercase tracking-wider mb-3">Quick Access</p>
            <div className="space-y-2">
              {[
                { href: '/scheduling', label: '📅 Schedule', sub: 'Full calendar view' },
                { href: '/patients', label: '👥 All Patients', sub: 'Search patient records' },
              ].map(l => (
                <Link key={l.href} href={l.href}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 hover:bg-blue-50 transition-colors group">
                  <div>
                    <p className="text-sm font-semibold text-gray-800 group-hover:text-blue-700">{l.label}</p>
                    <p className="text-[10px] text-gray-400">{l.sub}</p>
                  </div>
                  <ChevronRight size={14} className="text-gray-300 group-hover:text-blue-500" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
