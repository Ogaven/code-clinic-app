'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, Search, Users, CalendarDays, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Kampala' })
}
function fmtTime(s: string) {
  return new Date(s).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala' })
}

interface PatientRow {
  id: string
  firstName: string
  lastName: string
  phone: string
  gender: string
  lastVisit: string        // ISO date of most recent appt
  nextAppt: string | null  // ISO date of next upcoming appt
  nextApptService: string  // service name
  activePlan: string | null
  totalVisits: number
}

export default function DoctorPatientsPage() {
  const [patients, setPatients] = useState<PatientRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  const fetchPatients = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const u = JSON.parse(localStorage.getItem('cc_user') || '{}')
      // Get this doctor's record
      const docRes = await fetch('/api-proxy/doctors', { headers: { Authorization: `Bearer ${token}` } })
      const docs   = await docRes.json()
      const me     = Array.isArray(docs) ? docs.find((d: any) => d.userId === u.id) : null
      if (!me) return

      // Fetch all appointments for this doctor (no date filter → all time)
      const apptRes = await fetch(`/api-proxy/scheduling/appointments?limit=500`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const apptData = await apptRes.json()
      const appts: any[] = Array.isArray(apptData) ? apptData : []

      const myAppts = appts.filter((a: any) => a.doctorId === me.id)
      const now = Date.now()

      // Group by patient
      const byPatient = new Map<string, any[]>()
      for (const a of myAppts) {
        if (!a.patient?.id) continue
        const pid = a.patient.id
        if (!byPatient.has(pid)) byPatient.set(pid, [])
        byPatient.get(pid)!.push(a)
      }

      const rows: PatientRow[] = []
      for (const [pid, apptList] of byPatient.entries()) {
        const sorted = apptList.sort((a: any, b: any) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
        const past   = sorted.filter((a: any) => new Date(a.startAt).getTime() < now)
        const future = sorted.filter((a: any) => new Date(a.startAt).getTime() >= now)
        const last   = past[past.length - 1] || sorted[0]
        const next   = future[0] || null
        const p      = last.patient

        // Check for active treatment plan — just flag if any appt has IN_OPERATORY / WITH_PROVIDER / CONFIRMED recent
        const activePlan = apptList.some((a: any) => ['IN_OPERATORY', 'WITH_PROVIDER', 'WAITING', 'ARRIVED'].includes(a.status))
          ? (last.service?.name || 'Active') : null

        rows.push({
          id:             pid,
          firstName:      p.firstName || '',
          lastName:       p.lastName  || '',
          phone:          p.phone     || '—',
          gender:         p.gender    || '',
          lastVisit:      last.startAt,
          nextAppt:       next ? next.startAt : null,
          nextApptService: next?.service?.name || '',
          activePlan,
          totalVisits:    past.length,
        })
      }

      // Sort by last visit desc
      rows.sort((a, b) => new Date(b.lastVisit).getTime() - new Date(a.lastVisit).getTime())
      setPatients(rows)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchPatients() }, [fetchPatients])

  const filtered = useMemo(() => {
    if (!search.trim()) return patients
    const q = search.toLowerCase()
    return patients.filter(p =>
      `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) ||
      p.phone.includes(q)
    )
  }, [patients, search])

  return (
    <div className="space-y-4 p-4 md:p-6 pb-24 md:pb-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/doctor/dashboard" className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 transition-colors">
          <ArrowLeft size={16} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800 dark:text-white">My Patients</h1>
          <p className="text-sm text-gray-400 mt-0.5">{loading ? 'Loading…' : `${filtered.length} patient${filtered.length !== 1 ? 's' : ''} seen`}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or phone…"
          className="w-full pl-9 pr-4 py-2.5 text-sm bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
        />
      </div>

      {/* Table / list */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3">
            {[1,2,3,4,5].map(i => <div key={i} className="h-14 bg-gray-100 dark:bg-white/5 rounded-xl animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <Users size={36} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">{search ? 'No patients match your search' : 'No patients found for your appointments'}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
            {filtered.map(p => (
              <div key={p.id} className="flex items-start gap-4 px-5 py-4 hover:bg-blue-50/20 dark:hover:bg-white/[0.03] transition-colors">

                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 dark:from-blue-900/40 dark:to-blue-800/40 flex items-center justify-center flex-shrink-0 font-bold text-blue-600 dark:text-blue-300 text-sm">
                  {p.firstName[0]}{p.lastName[0]}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <p className="text-sm font-bold text-gray-800 dark:text-white">{p.firstName} {p.lastName}</p>
                      <p className="text-xs text-gray-400">{p.phone} {p.gender ? `· ${p.gender}` : ''}</p>
                    </div>
                    {p.activePlan && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 flex-shrink-0">
                        Active
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                    <span className="flex items-center gap-1 text-[10px] text-gray-400">
                      <Activity size={10} className="text-gray-300" />
                      {p.totalVisits} visit{p.totalVisits !== 1 ? 's' : ''}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-gray-400">
                      <CalendarDays size={10} className="text-gray-300" />
                      Last: {fmtDate(p.lastVisit)}
                    </span>
                    {p.nextAppt && (
                      <span className="flex items-center gap-1 text-[10px] text-blue-500 font-semibold">
                        <CalendarDays size={10} />
                        Next: {fmtDate(p.nextAppt)} {fmtTime(p.nextAppt)} {p.nextApptService ? `· ${p.nextApptService}` : ''}
                      </span>
                    )}
                  </div>

                  {/* Action links */}
                  <div className="flex items-center gap-3 mt-2">
                    <Link href={`/patients/${p.id}`}
                      className="text-[10px] font-semibold text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 hover:underline">
                      Profile
                    </Link>
                    <Link href={`/patients/${p.id}?tab=dental`}
                      className="text-[10px] font-semibold text-blue-500 hover:underline">
                      Dental Chart →
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
