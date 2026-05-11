'use client'

import { Component, useCallback, useEffect, useRef, useState } from 'react'
import {
  Search, Plus, Phone, Mail, Calendar, ChevronLeft, ChevronRight,
  X, User, Upload, Download, ExternalLink, Camera,
  CheckCircle2, AlertCircle,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn, formatUGX } from '@/lib/utils'

// ── Error boundary ───────────────────────────────────────────────
class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) { super(props); this.state = { hasError: false } }
  static getDerivedStateFromError() { return { hasError: true } }
  render() {
    if (this.state.hasError) return (
      <div className="flex flex-col items-center justify-center h-full py-20 text-gray-400">
        <User size={40} className="mb-3 opacity-30" />
        <p className="font-semibold">Something went wrong loading patients.</p>
        <button onClick={() => this.setState({ hasError: false })} className="mt-3 text-sm text-cyan-600 hover:underline">Try again</button>
      </div>
    )
    return this.props.children
  }
}

// ── Types ────────────────────────────────────────────────────────
interface Patient {
  id: string; patientId?: string; firstName: string; lastName: string; phone: string
  email?: string; gender?: string; dob?: string; isActive: boolean
  accountBalance: number; createdAt: string
  _count?: { appointments: number; treatmentPlans?: number }
  avatarUrl?: string | null
}

// ── Helpers ──────────────────────────────────────────────────────
function patientCode(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return `CC-${String(h % 100000).padStart(5, '0')}`
}

const COLORS = ['#29ABE2','#9B59B6','#2ECC71','#E8A838','#E74C3C','#1ABC9C','#F39C12','#3498DB']
function avatarColor(name: string) {
  let h = 0; for (const c of name) h = c.charCodeAt(0) + ((h << 5) - h)
  return COLORS[Math.abs(h) % COLORS.length]
}

const GENDER_LABELS: Record<string, string> = { MALE: 'Male', FEMALE: 'Female', OTHER: 'Other' }

const MEDICAL_CONDITIONS = [
  'Diabetes','Hypertension','Ulcers','Heart Disease','Asthma',
  'HIV/AIDS','Hepatitis B','Kidney Disease','Blood Disorder',
  'Epilepsy','Arthritis','Cancer',
]

const EMPTY_FORM = {
  firstName: '', lastName: '', phone: '', email: '', gender: 'FEMALE', dob: '',
  address: '', district: '',
  nextOfKinName: '', nextOfKinPhone: '', nextOfKinRelation: '',
  allergies: '',
  medicalHistory: [] as string[],
}

// ── Page ─────────────────────────────────────────────────────────
export default function PatientsPage() {
  const API   = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  const [patients,         setPatients]         = useState<Patient[]>([])
  const [loading,          setLoading]          = useState(true)
  const [search,           setSearch]           = useState('')
  const [page,             setPage]             = useState(1)
  const [total,            setTotal]            = useState(0)
  const [selected,         setSelected]         = useState<Patient | null>(null)
  const [appts,            setAppts]            = useState<any[]>([])
  const [showAdd,          setShowAdd]          = useState(false)
  const [activeFilter,     setActiveFilter]     = useState<'all'|'new_today'|'this_month'|'has_balance'|'has_plan'|'male'|'female'>('all')
  const [toast,            setToast]            = useState<{ msg: string; type: 'ok'|'err' } | null>(null)
  const [importing,        setImporting]        = useState(false)
  const [exporting,        setExporting]        = useState(false)
  const [uploadingAvatar,  setUploadingAvatar]  = useState(false)
  const [avatarPreview,    setAvatarPreview]    = useState<string | null>(null)
  const [form,             setForm]             = useState(EMPTY_FORM)
  const [saving,           setSaving]           = useState(false)
  const [formError,        setFormError]        = useState('')

  const csvInputRef    = useRef<HTMLInputElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const limit = 20

  // ── Data fetching ────────────────────────────────────────────
  const fetchPatients = useCallback(async (q = search, p = page, filter = activeFilter) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String((p - 1) * limit) })
      if (q) params.set('q', q)
      if (filter && filter !== 'all') params.set('filter', filter)
      const res = await fetch(`${API}/patients?${params}`, { headers: authH })
      if (res.ok) {
        const data = await res.json()
        setPatients(Array.isArray(data) ? data : data.data || [])
        setTotal(data.total || (Array.isArray(data) ? data.length : 0))
      }
    } catch { setPatients([]) } finally { setLoading(false) }
  }, [token]) // eslint-disable-line

  useEffect(() => { fetchPatients() }, []) // eslint-disable-line

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); fetchPatients(search, 1, activeFilter) }, 300)
    return () => clearTimeout(t)
  }, [search, activeFilter]) // eslint-disable-line

  const totalPages = Math.ceil(total / limit)

  async function selectPatient(p: Patient) {
    setSelected(p)
    setAvatarPreview(null)
    setAppts([])
    try {
      const start = new Date(); start.setFullYear(start.getFullYear() - 2)
      const end   = new Date(); end.setFullYear(end.getFullYear() + 1)
      const qs = `patientId=${p.id}&startDate=${start.toISOString().slice(0,10)}&endDate=${end.toISOString().slice(0,10)}`
      const res = await fetch(`${API}/scheduling/appointments?${qs}`, { headers: authH })
      if (res.ok) {
        const json = await res.json()
        setAppts(Array.isArray(json) ? json : json.appointments || json.data || [])
      }
    } catch { setAppts([]) }
  }

  // ── Add patient ──────────────────────────────────────────────
  async function addPatient() {
    if (!form.firstName || !form.lastName || !form.phone) { setFormError('Name and phone are required'); return }
    setSaving(true); setFormError('')
    try {
      const body: Record<string, unknown> = { ...form }
      if (!body.email)             delete body.email
      if (!body.dob)               delete body.dob
      if (!body.nextOfKinPhone)    delete body.nextOfKinPhone
      if (!body.nextOfKinName)     delete body.nextOfKinName
      if (!body.nextOfKinRelation) delete body.nextOfKinRelation
      if (!body.allergies)         delete body.allergies

      const res = await fetch(`${API}/patients`, {
        method: 'POST', headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        fetchPatients(); setShowAdd(false); setForm(EMPTY_FORM)
        showToast('Patient added', 'ok')
      } else { const d = await res.json(); setFormError(d.error || 'Failed to add patient') }
    } catch { setFormError('Network error') } finally { setSaving(false) }
  }

  // ── Avatar upload ────────────────────────────────────────────
  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !selected) return
    const preview = URL.createObjectURL(file)
    setAvatarPreview(preview)
    setUploadingAvatar(true)
    try {
      const fd = new FormData(); fd.append('avatar', file)
      const res = await fetch(`${API}/patients/${selected.id}/avatar`, {
        method: 'POST', headers: authH, body: fd,
      })
      if (res.ok) {
        const { avatarUrl } = await res.json() as { avatarUrl: string }
        setSelected(s => s ? { ...s, avatarUrl } : s)
        setPatients(ps => ps.map(p => p.id === selected.id ? { ...p, avatarUrl } : p))
        showToast('Photo updated', 'ok')
      } else { showToast('Photo upload failed', 'err'); setAvatarPreview(null) }
    } catch { showToast('Photo upload failed', 'err'); setAvatarPreview(null) }
    finally { setUploadingAvatar(false); if (avatarInputRef.current) avatarInputRef.current.value = '' }
  }

  // ── CSV import ───────────────────────────────────────────────
  function handleCSVImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const text  = ev.target?.result as string
        const lines = text.trim().split('\n')
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''))
        let imported = 0; let failed = 0
        for (const row of lines.slice(1)) {
          const vals = row.split(',').map(v => v.trim().replace(/"/g, ''))
          const obj: Record<string, string> = {}
          headers.forEach((h, i) => { obj[h] = vals[i] || '' })
          const payload = {
            firstName: obj.firstname || obj['first name'] || obj.name?.split(' ')[0] || '',
            lastName:  obj.lastname  || obj['last name']  || obj.name?.split(' ')[1] || '',
            phone:     obj.phone     || obj.telephone     || obj.mobile || '',
            email:     obj.email     || '',
            gender:    (obj.gender   || 'FEMALE').toUpperCase(),
            dob:       obj.dob       || obj['date of birth'] || '',
          }
          if (!payload.firstName || !payload.phone) { failed++; continue }
          try {
            const res = await fetch(`${API}/patients`, {
              method: 'POST', headers: { ...authH, 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
            if (res.ok) imported++; else failed++
          } catch { failed++ }
        }
        fetchPatients()
        showToast(`Imported ${imported} patients${failed > 0 ? `, ${failed} skipped` : ''}`, imported > 0 ? 'ok' : 'err')
      } catch { showToast('Invalid CSV format', 'err') }
      finally { setImporting(false); if (csvInputRef.current) csvInputRef.current.value = '' }
    }
    reader.readAsText(file)
  }

  // ── CSV export ───────────────────────────────────────────────
  function exportCSV() {
    setExporting(true)
    const headers = ['ID', 'First Name', 'Last Name', 'Phone', 'Email', 'Gender', 'Date of Birth', 'Appointments', 'Balance', 'Registered']
    const rows = patients.map(p => [
      (p.patientId ?? patientCode(p.id)), p.firstName, p.lastName, p.phone, p.email || '', p.gender || '',
      p.dob ? new Date(p.dob).toLocaleDateString() : '',
      p._count?.appointments || 0, p.accountBalance || 0,
      new Date(p.createdAt).toLocaleDateString(),
    ])
    const csv  = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url
    a.download = `patients_${new Date().toISOString().slice(0,10)}.csv`
    a.click(); URL.revokeObjectURL(url)
    setExporting(false)
    showToast(`Exported ${patients.length} patients`, 'ok')
  }

  function showToast(msg: string, type: 'ok'|'err') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const inputCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all'
  const activeAvatarSrc = avatarPreview || selected?.avatarUrl || null

  return (
    <ErrorBoundary>
    <div className="h-[calc(100vh-4.5rem)] flex bg-slate-50 dark:bg-transparent">

      {/* Toast */}
      {toast && (
        <div className={cn(
          'fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-xl text-sm font-bold',
          toast.type === 'ok' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white',
        )}>
          {toast.type === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {toast.msg}
        </div>
      )}

      {/* ── Patient list ──────────────────────────────────────── */}
      <div className={cn(
        'flex flex-col border-r border-gray-100 dark:border-white/8 bg-white dark:bg-white/[0.03] transition-all',
        selected ? 'hidden sm:flex sm:w-[440px] sm:flex-shrink-0' : 'flex-1',
      )}>

        {/* Header */}
        <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-gray-100 dark:border-white/8">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-lg font-black text-gray-800 dark:text-white">Patients</h1>
              <p className="text-xs text-gray-400 dark:text-white/40">{total} total</p>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={handleCSVImport} />
              <button
                onClick={() => csvInputRef.current?.click()} disabled={importing}
                className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5 transition-all disabled:opacity-50">
                <Upload size={13} />
                {importing ? 'Importing...' : 'Import CSV'}
              </button>
              <button
                onClick={exportCSV} disabled={exporting}
                className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5 transition-all disabled:opacity-50">
                <Download size={13} />
                Export
              </button>
              <button onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
                style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
                <Plus size={13} /> <span className="hidden sm:inline">Add Patient</span><span className="sm:hidden">Add</span>
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, phone, email, or CC-XXXX..."
              className="w-full pl-8 pr-4 py-2 text-sm bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl dark:text-white dark:placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all" />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-1.5">
            {([
              { key: 'all',         label: 'All' },
              { key: 'new_today',   label: 'Today' },
              { key: 'this_month',  label: 'This Month' },
              { key: 'has_balance', label: 'Has Balance' },
              { key: 'has_plan',    label: 'Active Plan' },
              { key: 'male',        label: 'Male' },
              { key: 'female',      label: 'Female' },
            ] as { key: typeof activeFilter; label: string }[]).map(({ key, label }) => (
              <button key={key} onClick={() => setActiveFilter(key)}
                className={cn('px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all',
                  activeFilter === key
                    ? 'bg-cyan-500 text-white'
                    : 'bg-gray-100 dark:bg-white/8 text-gray-500 dark:text-white/50 hover:bg-gray-200 dark:hover:bg-white/12')}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : patients.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400">
              <User size={28} className="mb-2 text-gray-200 dark:text-white/10" />
              <p className="text-sm">No patients found</p>
            </div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 dark:bg-[#0e1f4d] z-10 border-b border-gray-100 dark:border-white/8">
                  <tr>
                    <th className="text-left px-5 py-3 text-[11px] font-black text-gray-400 dark:text-white/40 uppercase tracking-wide">Patient</th>
                    <th className="text-left px-4 py-3 text-[11px] font-black text-gray-400 dark:text-white/40 uppercase tracking-wide">Phone</th>
                    <th className="text-left px-4 py-3 text-[11px] font-black text-gray-400 dark:text-white/40 uppercase tracking-wide hidden md:table-cell">Balance</th>
                    <th className="text-right px-4 py-3 text-[11px] font-black text-gray-400 dark:text-white/40 uppercase tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                  {patients.map(p => (
                    <tr key={p.id} onClick={() => selectPatient(p)}
                      className={cn(
                        'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors',
                        selected?.id === p.id && 'bg-cyan-50 dark:bg-cyan-900/20 border-l-4 border-l-cyan-500',
                      )}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          {p.avatarUrl ? (
                            <img src={p.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                              style={{ background: avatarColor(`${p.firstName || ''}${p.lastName || ''}`) }}>
                              {(p.firstName || '?')[0]}{(p.lastName || '')[0]}
                            </div>
                          )}
                          <div>
                            <p className="font-semibold text-gray-800 dark:text-white">{p.firstName} {p.lastName}</p>
                            <p className="text-[11px] font-mono text-cyan-600 dark:text-cyan-400">{p.patientId ?? patientCode(p.id)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-gray-700 dark:text-white/70">
                          <Phone size={11} className="text-cyan-500 flex-shrink-0" />
                          <span className="text-xs">{p.phone}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className={cn('text-xs font-semibold', p.accountBalance > 0 ? 'text-red-600' : 'text-gray-400')}>
                          {p.accountBalance > 0 ? formatUGX(p.accountBalance) : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                          p.isActive
                            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-500')}>
                          {p.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 dark:border-white/8 bg-gray-50 dark:bg-white/[0.02]">
                  <p className="text-xs text-gray-400">{(page-1)*limit+1}–{Math.min(page*limit,total)} of {total}</p>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { const np = page - 1; setPage(np); fetchPatients(search, np) }} disabled={page === 1}
                      className="p-1.5 rounded-lg border border-gray-200 dark:border-white/10 text-gray-400 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
                      <ChevronLeft size={13} />
                    </button>
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(n => (
                      <button key={n} onClick={() => { setPage(n); fetchPatients(search, n) }}
                        className={cn('w-7 h-7 rounded-lg text-xs font-semibold transition-colors',
                          page === n
                            ? 'bg-cyan-500 text-white'
                            : 'border border-gray-200 dark:border-white/10 text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5')}>
                        {n}
                      </button>
                    ))}
                    <button onClick={() => { const np = page + 1; setPage(np); fetchPatients(search, np) }} disabled={page === totalPages}
                      className="p-1.5 rounded-lg border border-gray-200 dark:border-white/10 text-gray-400 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
                      <ChevronRight size={13} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Patient detail panel ──────────────────────────────── */}
      {selected && (
        <div className="fixed inset-0 z-30 bg-slate-50 dark:bg-[#080f2a] overflow-y-auto sm:relative sm:inset-auto sm:z-auto sm:flex-1 sm:bg-slate-50 sm:dark:bg-transparent p-4 sm:p-6">
          <div className="max-w-lg space-y-4">

            {/* Profile card */}
            <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm p-5">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-4">

                  {/* Clickable avatar — opens file picker */}
                  <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                  <button
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={uploadingAvatar}
                    className="relative group w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0 focus:outline-none"
                    title="Click to change photo">
                    {activeAvatarSrc ? (
                      <img src={activeAvatarSrc} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white text-xl font-black"
                        style={{ background: avatarColor(`${selected.firstName}${selected.lastName}`) }}>
                        {selected.firstName?.[0]}{selected.lastName?.[0]}
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl">
                      {uploadingAvatar
                        ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : <Camera size={18} className="text-white" />
                      }
                    </div>
                  </button>

                  <div>
                    <h2 className="text-lg font-black text-gray-800 dark:text-white">{selected.firstName} {selected.lastName}</h2>
                    <p className="text-xs font-mono text-cyan-600 dark:text-cyan-400">{selected.patientId ?? patientCode(selected.id)}</p>
                    <p className="text-sm text-gray-400 dark:text-white/40 mt-0.5">
                      {GENDER_LABELS[selected.gender || ''] || 'N/A'} · {selected.dob ? new Date().getFullYear() - new Date(selected.dob).getFullYear() + ' yrs' : 'Age N/A'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Link
                    href={`/patients/${selected.id}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-md"
                    style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                    <ExternalLink size={12} />
                    Full Profile
                  </Link>
                  <button onClick={() => setSelected(null)}
                    className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
                    <X size={16} className="text-gray-400" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 bg-gray-50 dark:bg-white/5 rounded-xl px-3 py-2">
                  <Phone size={13} className="text-cyan-500 flex-shrink-0" />
                  <span className="text-sm text-gray-700 dark:text-white/70 truncate">{selected.phone}</span>
                </div>
                <div className="flex items-center gap-2 bg-gray-50 dark:bg-white/5 rounded-xl px-3 py-2">
                  <Mail size={13} className="text-cyan-500 flex-shrink-0" />
                  <span className="text-sm text-gray-700 dark:text-white/70 truncate">{selected.email || 'No email'}</span>
                </div>
                {selected.accountBalance > 0 && (
                  <div className="col-span-2 flex items-center gap-2 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">
                    <span className="text-xs text-red-600 dark:text-red-400 font-bold">
                      Outstanding Balance: {formatUGX(selected.accountBalance)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Appointment history */}
            <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-50 dark:border-white/8">
                <h3 className="text-sm font-bold text-gray-800 dark:text-white">Appointment History</h3>
              </div>
              {appts.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <Calendar size={24} className="mx-auto mb-2 text-gray-200 dark:text-white/10" />
                  <p className="text-sm text-gray-400 dark:text-white/40">No appointments found</p>
                </div>
              ) : appts.map((a: any) => {
                if (!a?.id) return null
                const d = a.startAt ? new Date(a.startAt) : new Date()
                const statusColor: Record<string, string> = {
                  PENDING:        'text-slate-600 bg-slate-50 dark:bg-slate-900/20',
                  CONFIRMED:      'text-blue-600 bg-blue-50 dark:bg-blue-900/20',
                  CHECKED_IN:     'text-yellow-700 bg-yellow-50 dark:bg-yellow-900/20',
                  IN_CHAIR:       'text-orange-600 bg-orange-50 dark:bg-orange-900/20',
                  WITH_PROVIDER:  'text-teal-600 bg-teal-50 dark:bg-teal-900/20',
                  READY_CHECKOUT: 'text-purple-600 bg-purple-50 dark:bg-purple-900/20',
                  COMPLETED:      'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20',
                  NO_SHOW:        'text-red-500 bg-red-50 dark:bg-red-900/20',
                  CANCELLED:      'text-gray-400 bg-gray-50 dark:bg-gray-900/20',
                }
                return (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 dark:border-white/5 last:border-0">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[10px] font-black flex-shrink-0"
                      style={{ background: a.service?.colour || '#29ABE2' }}>
                      {d.getDate()}<br />{d.toLocaleDateString('en-UG', { month: 'short' })}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">{a.service?.name || 'Appointment'}</p>
                      <p className="text-xs text-gray-400 dark:text-white/40">
                        {a.doctor?.user?.firstName ? `Dr. ${a.doctor.user.firstName}` : 'Doctor'} · {d.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true })}
                      </p>
                    </div>
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', statusColor[a.status] || 'bg-gray-50 text-gray-500')}>{a.status}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Add patient modal ─────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-[#152040] rounded-3xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-black text-gray-800 dark:text-white">New Patient</h2>
              <button onClick={() => setShowAdd(false)}
                className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
                <X size={16} className="text-gray-400" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Basic info */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1">First Name *</label>
                  <input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} className={inputCls} placeholder="John" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1">Last Name *</label>
                  <input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} className={inputCls} placeholder="Doe" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1">Phone *</label>
                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={inputCls} placeholder="+256 700 000 000" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1">Email</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={inputCls} placeholder="email@example.com" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1">Gender</label>
                  <select value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))} className={inputCls}>
                    <option value="FEMALE" className="dark:bg-gray-800">Female</option>
                    <option value="MALE" className="dark:bg-gray-800">Male</option>
                    <option value="OTHER" className="dark:bg-gray-800">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1">Date of Birth</label>
                  <input type="date" value={form.dob} onChange={e => setForm(f => ({ ...f, dob: e.target.value }))} className={inputCls} />
                </div>
              </div>

              {/* Residence */}
              <div className="pt-1">
                <p className="text-[10px] font-black text-gray-400 dark:text-white/30 uppercase tracking-widest mb-2">Residence</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1">Street / Estate</label>
                    <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className={inputCls} placeholder="Street / Estate" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1">District</label>
                    <input value={form.district} onChange={e => setForm(f => ({ ...f, district: e.target.value }))} className={inputCls} placeholder="e.g. Kampala" />
                  </div>
                </div>
              </div>

              {/* Next of Kin */}
              <div className="pt-1">
                <p className="text-[10px] font-black text-gray-400 dark:text-white/30 uppercase tracking-widest mb-2">Next of Kin</p>
                <div className="space-y-2">
                  <input value={form.nextOfKinName} onChange={e => setForm(f => ({ ...f, nextOfKinName: e.target.value }))} className={inputCls} placeholder="Full name" />
                  <div className="grid grid-cols-2 gap-3">
                    <input value={form.nextOfKinPhone} onChange={e => setForm(f => ({ ...f, nextOfKinPhone: e.target.value }))} className={inputCls} placeholder="Phone number" />
                    <input value={form.nextOfKinRelation} onChange={e => setForm(f => ({ ...f, nextOfKinRelation: e.target.value }))} className={inputCls} placeholder="Relationship" />
                  </div>
                </div>
              </div>

              {/* Allergies */}
              <div className="pt-1">
                <p className="text-[10px] font-black text-gray-400 dark:text-white/30 uppercase tracking-widest mb-2">Allergies</p>
                <textarea value={form.allergies} onChange={e => setForm(f => ({ ...f, allergies: e.target.value }))} rows={2}
                  className={inputCls} placeholder="List any known allergies..." />
              </div>

              {/* Medical History */}
              <div className="pt-1">
                <p className="text-[10px] font-black text-gray-400 dark:text-white/30 uppercase tracking-widest mb-2">Medical History</p>
                <div className="flex flex-wrap gap-2 mb-2">
                  {MEDICAL_CONDITIONS.map(condition => {
                    const active = form.medicalHistory.includes(condition)
                    return (
                      <button key={condition} type="button"
                        onClick={() => setForm(f => ({
                          ...f,
                          medicalHistory: active
                            ? f.medicalHistory.filter(c => c !== condition)
                            : [...f.medicalHistory, condition],
                        }))}
                        className={cn(
                          'px-3 py-1.5 rounded-xl text-xs font-bold border transition-all',
                          active
                            ? 'bg-cyan-500 text-white border-cyan-500'
                            : 'bg-gray-50 dark:bg-white/5 text-gray-600 dark:text-white/60 border-gray-200 dark:border-white/10 hover:border-cyan-400',
                        )}>
                        {condition}
                      </button>
                    )
                  })}
                </div>
                <input
                  value={form.medicalHistory.filter(c => !MEDICAL_CONDITIONS.includes(c)).join(', ')}
                  onChange={e => {
                    const pills  = form.medicalHistory.filter(c => MEDICAL_CONDITIONS.includes(c))
                    const extras = e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                    setForm(f => ({ ...f, medicalHistory: [...pills, ...extras] }))
                  }}
                  className={inputCls} placeholder="Other conditions..." />
              </div>

              {formError && <p className="text-xs text-red-500 font-medium">{formError}</p>}

              <div className="flex items-center gap-2 p-3 bg-cyan-50 dark:bg-cyan-900/20 rounded-xl">
                <Upload size={14} className="text-cyan-500 flex-shrink-0" />
                <p className="text-xs text-cyan-700 dark:text-cyan-300">
                  Adding multiple patients? Use{' '}
                  <button onClick={() => { setShowAdd(false); csvInputRef.current?.click() }} className="font-bold underline">
                    Import CSV
                  </button>{' '}instead.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowAdd(false)}
                  className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-bold text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                  Cancel
                </button>
                <button onClick={addPatient} disabled={saving}
                  className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
                  {saving ? 'Adding...' : 'Add Patient'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  )
}
