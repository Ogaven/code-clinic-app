'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, Search, Users, CalendarDays, Activity, Plus, X } from 'lucide-react'
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
  lastVisit: string
  nextAppt: string | null
  nextApptService: string
  activePlan: string | null
  totalVisits: number
}

interface AddPatientForm {
  firstName: string
  lastName: string
  phone: string
  email: string
  dateOfBirth: string
  gender: string
}

const BLANK_FORM: AddPatientForm = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  dateOfBirth: '',
  gender: '',
}

export default function DoctorPatientsPage() {
  const [patients, setPatients]   = useState<PatientRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [addOpen, setAddOpen]     = useState(false)
  const [form, setForm]           = useState<AddPatientForm>(BLANK_FORM)
  const [saving, setSaving]       = useState(false)
  const [toast, setToast]         = useState('')

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  const fetchPatients = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const u = JSON.parse(localStorage.getItem('cc_user') || '{}')
      const docRes = await fetch('/api-proxy/doctors', { headers: { Authorization: `Bearer ${token}` } })
      const docs   = await docRes.json()
      const me     = Array.isArray(docs) ? docs.find((d: any) => d.userId === u.id) : null
      if (!me) return

      const apptRes  = await fetch(`/api-proxy/scheduling/appointments?limit=500`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const apptData = await apptRes.json()
      const appts: any[] = Array.isArray(apptData) ? apptData : []
      const myAppts = appts.filter((a: any) => a.doctorId === me.id)
      const now = Date.now()

      const byPatient = new Map<string, any[]>()
      for (const a of myAppts) {
        if (!a.patient?.id) continue
        const pid = a.patient.id
        if (!byPatient.has(pid)) byPatient.set(pid, [])
        byPatient.get(pid)!.push(a)
      }

      const rows: PatientRow[] = []
      for (const [, apptList] of byPatient.entries()) {
        const sorted = apptList.sort((a: any, b: any) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
        const past   = sorted.filter((a: any) => new Date(a.startAt).getTime() < now)
        const future = sorted.filter((a: any) => new Date(a.startAt).getTime() >= now)
        const last   = past[past.length - 1] || sorted[0]
        const next   = future[0] || null
        const p      = last.patient
        const activePlan = apptList.some((a: any) => ['IN_OPERATORY','WITH_PROVIDER','WAITING','ARRIVED'].includes(a.status))
          ? (last.service?.name || 'Active') : null

        rows.push({
          id:              p.id,
          firstName:       p.firstName || '',
          lastName:        p.lastName  || '',
          phone:           p.phone     || '—',
          gender:          p.gender    || '',
          lastVisit:       last.startAt,
          nextAppt:        next ? next.startAt : null,
          nextApptService: next?.service?.name || '',
          activePlan,
          totalVisits:     past.length,
        })
      }

      rows.sort((a, b) => new Date(b.lastVisit).getTime() - new Date(a.lastVisit).getTime())
      setPatients(rows)
    } catch (e) { console.error(e) } finally { setLoading(false) }
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

  function setField(k: keyof AddPatientForm, v: string) {
    setForm(f => ({ ...f, [k]: v }))
  }

  async function handleAddPatient() {
    if (!form.firstName.trim() || !form.lastName.trim() || !token) return
    setSaving(true)
    try {
      const res = await fetch('/api-proxy/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          firstName:   form.firstName.trim(),
          lastName:    form.lastName.trim(),
          phone:       form.phone.trim() || undefined,
          email:       form.email.trim() || undefined,
          dateOfBirth: form.dateOfBirth || undefined,
          gender:      form.gender || undefined,
        }),
      })
      if (res.ok) {
        setAddOpen(false)
        setForm(BLANK_FORM)
        setToast('Patient added successfully!')
        setTimeout(() => setToast(''), 3000)
        fetchPatients()
      } else {
        const err = await res.json().catch(() => ({}))
        setToast(err.message || 'Failed to add patient')
        setTimeout(() => setToast(''), 4000)
      }
    } catch {
      setToast('Network error — please try again')
      setTimeout(() => setToast(''), 4000)
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4 p-4 md:p-6 pb-24 md:pb-6 animate-fade-in">

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-[99999] bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/doctor/dashboard"
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
          <ArrowLeft size={16} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800 dark:text-white">My Patients</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {loading ? 'Loading…' : `${filtered.length} patient${filtered.length !== 1 ? 's' : ''} seen`}
          </p>
        </div>
        <button onClick={() => setAddOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-700 text-white transition-colors min-h-[44px] shadow-sm">
          <Plus size={14} />
          <span className="hidden sm:inline">Add Patient</span>
          <span className="sm:hidden">Add</span>
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or phone…"
          className="w-full pl-9 pr-4 py-3 text-sm bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white min-h-[44px]"
          style={{ fontSize: 16 }}
        />
      </div>

      {/* Patient list */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3">
            {[1,2,3,4,5].map(i => <div key={i} className="h-20 bg-gray-100 dark:bg-white/5 rounded-xl animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <Users size={36} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">{search ? 'No patients match your search' : 'No patients found for your appointments'}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
            {filtered.map(p => (
              <div key={p.id} className="flex items-start gap-3 sm:gap-4 px-4 sm:px-5 py-4 hover:bg-blue-50/20 dark:hover:bg-white/[0.03] transition-colors">

                {/* Avatar */}
                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 dark:from-blue-900/40 dark:to-blue-800/40 flex items-center justify-center flex-shrink-0 font-bold text-blue-600 dark:text-blue-300 text-sm">
                  {p.firstName[0]}{p.lastName[0]}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <p className="text-sm font-bold text-gray-800 dark:text-white">{p.firstName} {p.lastName}</p>
                      <p className="text-xs text-gray-400">{p.phone}{p.gender ? ` · ${p.gender}` : ''}</p>
                    </div>
                    {p.activePlan && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 flex-shrink-0">
                        Active
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 sm:gap-4 mt-1.5 flex-wrap">
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
                        Next: {fmtDate(p.nextAppt)} {fmtTime(p.nextAppt)}{p.nextApptService ? ` · ${p.nextApptService}` : ''}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 mt-2">
                    <Link href={`/patients/${p.id}`}
                      className="text-[11px] font-semibold text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 hover:underline min-h-[32px] flex items-center">
                      View Full Profile
                    </Link>
                    <Link href={`/patients/${p.id}?tab=dental`}
                      className="text-[11px] font-semibold text-blue-500 hover:underline min-h-[32px] flex items-center">
                      Dental Chart →
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Add Patient Modal (bottom sheet on mobile) ──────────────────────── */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[92vh] flex flex-col">
            {/* Drag pill */}
            <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mt-3 mb-1 sm:hidden flex-shrink-0" />

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b dark:border-white/10 flex-shrink-0">
              <h2 className="font-bold text-gray-800 dark:text-white">Add New Patient</h2>
              <button onClick={() => { setAddOpen(false); setForm(BLANK_FORM) }}
                className="w-9 h-9 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Form */}
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">First Name *</label>
                  <input value={form.firstName} onChange={e => setField('firstName', e.target.value)}
                    placeholder="John"
                    className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">Last Name *</label>
                  <input value={form.lastName} onChange={e => setField('lastName', e.target.value)}
                    placeholder="Mukasa"
                    className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">Phone Number</label>
                <input value={form.phone} onChange={e => setField('phone', e.target.value)}
                  type="tel" placeholder="+256 700 000 000"
                  className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">Email</label>
                <input value={form.email} onChange={e => setField('email', e.target.value)}
                  type="email" placeholder="patient@email.com"
                  className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">Date of Birth</label>
                  <input value={form.dateOfBirth} onChange={e => setField('dateOfBirth', e.target.value)}
                    type="date"
                    className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">Gender</label>
                  <select value={form.gender} onChange={e => setField('gender', e.target.value)}
                    className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none">
                    <option value="">— select —</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 px-5 pb-6 sm:pb-4 pt-4 border-t dark:border-white/10 flex-shrink-0">
              <button onClick={() => { setAddOpen(false); setForm(BLANK_FORM) }}
                className="flex-1 px-4 py-3 text-sm text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-white/10 rounded-xl font-medium min-h-[44px]">
                Cancel
              </button>
              <button onClick={handleAddPatient}
                disabled={saving || !form.firstName.trim() || !form.lastName.trim()}
                className="flex-1 px-5 py-3 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50 transition-colors min-h-[44px]">
                {saving ? 'Adding…' : 'Add Patient'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
