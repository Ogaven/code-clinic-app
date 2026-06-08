'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRef } from 'react'
import {
  ArrowLeft, User, Calendar, FileText, Activity, DollarSign, Folder,
  Phone, Mail, Edit2, Save, X, Plus, Trash2, CheckCircle2, AlertCircle,
  Clock, ChevronRight, Receipt, Download, Upload, Star, Brain, Camera, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import TimelineTab from '@/components/patients/TimelineTab'

type Tab = 'overview' | 'appointments' | 'dental' | 'perio' | 'treatment' | 'notes' | 'billing' | 'documents' | 'activity' | 'timeline'

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'timeline',      label: 'Timeline',        icon: Activity   },
  { key: 'overview',      label: 'Overview',        icon: User       },
  { key: 'appointments',  label: 'Appointments',    icon: Calendar   },
  { key: 'dental',        label: 'Dental Chart',    icon: Star       },
  { key: 'perio',         label: 'Perio',           icon: Activity   },
  { key: 'treatment',     label: 'Treatment Plan',  icon: Brain      },
  { key: 'notes',         label: 'Notes',           icon: FileText   },
  { key: 'billing',       label: 'Billing',         icon: DollarSign },
  { key: 'documents',     label: 'Documents',       icon: Folder     },
]

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  PENDING:        { label: 'Scheduled',   cls: 'bg-slate-100 text-slate-600 dark:bg-slate-900/30 dark:text-slate-400' },
  CONFIRMED:      { label: 'Confirmed',   cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  CHECKED_IN:     { label: 'Checked In',  cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  IN_CHAIR:       { label: 'In Chair',    cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  WITH_PROVIDER:  { label: 'With Provider',cls:'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' },
  READY_CHECKOUT: { label: 'Ready',       cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  COMPLETED:      { label: 'Done',        cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  CANCELLED:      { label: 'Cancelled',   cls: 'bg-red-100 text-red-500 dark:bg-red-900/30 dark:text-red-400' },
  NO_SHOW:        { label: 'No Show',     cls: 'bg-gray-100 text-gray-500 dark:bg-gray-900/30 dark:text-gray-400' },
}

const COLORS = ['#29ABE2','#9B59B6','#2ECC71','#E8A838','#E74C3C','#1ABC9C']
function avatarColor(name: string) {
  let h = 0; for (const c of name) h = c.charCodeAt(0) + ((h << 5) - h)
  return COLORS[Math.abs(h) % COLORS.length]
}

function formatUGX(n: number) {
  return 'UGX ' + n.toLocaleString()
}

// ── Card wrapper ─────────────────────────────────────────────
function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm', className)}>
      {children}
    </div>
  )
}

// ── Overview Tab ─────────────────────────────────────────────
function OverviewTab({ patient, onRefresh }: { patient: any; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm]       = useState<any>({})
  const [saving, setSaving]   = useState(false)
  const API = '/api-proxy'

  useEffect(() => {
    setForm({
      firstName:        patient.firstName        || '',
      lastName:         patient.lastName         || '',
      phone:            patient.phone            || '',
      email:            patient.email            || '',
      gender:           patient.gender           || 'FEMALE',
      dob:              patient.dob ? patient.dob.slice(0, 10) : '',
      address:          patient.address          || '',
      district:         patient.district         || '',
      nextOfKinName:    patient.nextOfKinName    || '',
      nextOfKinPhone:   patient.nextOfKinPhone   || '',
      nextOfKinRelation:patient.nextOfKinRelation|| '',
      allergies:        patient.allergies        || '',
      medicalHistory:   patient.medicalHistory   || '',
      notes:            patient.notes            || '',
    })
  }, [patient])

  async function save() {
    setSaving(true)
    const token = localStorage.getItem('cc_token')
    try {
      await fetch(`${API}/patients/${patient.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      onRefresh()
      setEditing(false)
    } finally { setSaving(false) }
  }

  const inputCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all'

  const age = patient.dob ? new Date().getFullYear() - new Date(patient.dob).getFullYear() : null

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-black text-gray-800 dark:text-white uppercase tracking-wide">Personal Information</h3>
          <button onClick={() => setEditing(e => !e)}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all',
              editing ? 'bg-gray-100 dark:bg-white/8 text-gray-600 dark:text-white/60' : 'text-cyan-600 hover:bg-cyan-50 dark:hover:bg-cyan-900/20')}>
            {editing ? <><X size={12} /> Cancel</> : <><Edit2 size={12} /> Edit</>}
          </button>
        </div>

        {editing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-white/40 mb-1 block">First Name</label>
                <input value={form.firstName} onChange={e => setForm((f: any) => ({...f, firstName: e.target.value}))} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-white/40 mb-1 block">Last Name</label>
                <input value={form.lastName} onChange={e => setForm((f: any) => ({...f, lastName: e.target.value}))} className={inputCls} />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 dark:text-white/40 mb-1 block">Phone</label>
              <input value={form.phone} onChange={e => setForm((f: any) => ({...f, phone: e.target.value}))} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 dark:text-white/40 mb-1 block">Email</label>
              <input type="email" value={form.email} onChange={e => setForm((f: any) => ({...f, email: e.target.value}))} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-white/40 mb-1 block">Gender</label>
                <select value={form.gender} onChange={e => setForm((f: any) => ({...f, gender: e.target.value}))} className={inputCls}>
                  <option value="FEMALE" className="dark:bg-gray-800">Female</option>
                  <option value="MALE" className="dark:bg-gray-800">Male</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-white/40 mb-1 block">Date of Birth</label>
                <input type="date" value={form.dob} onChange={e => setForm((f: any) => ({...f, dob: e.target.value}))} className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-white/40 mb-1 block">Place of Residence</label>
                <input value={form.address} onChange={e => setForm((f: any) => ({...f, address: e.target.value}))} className={inputCls} placeholder="Street / village" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-white/40 mb-1 block">District</label>
                <input value={form.district} onChange={e => setForm((f: any) => ({...f, district: e.target.value}))} className={inputCls} placeholder="e.g. Kampala" />
              </div>
            </div>
            <div className="pt-1">
              <p className="text-xs font-black text-gray-400 dark:text-white/40 uppercase tracking-wider mb-2">Next of Kin</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-white/40 mb-1 block">Name</label>
                  <input value={form.nextOfKinName} onChange={e => setForm((f: any) => ({...f, nextOfKinName: e.target.value}))} className={inputCls} placeholder="Full name" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-white/40 mb-1 block">Contact</label>
                  <input value={form.nextOfKinPhone} onChange={e => setForm((f: any) => ({...f, nextOfKinPhone: e.target.value}))} className={inputCls} placeholder="Phone number" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-white/40 mb-1 block">Relationship</label>
                  <select value={form.nextOfKinRelation} onChange={e => setForm((f: any) => ({...f, nextOfKinRelation: e.target.value}))} className={inputCls}>
                    <option value="" className="dark:bg-gray-800">Select...</option>
                    <option value="Spouse" className="dark:bg-gray-800">Spouse</option>
                    <option value="Parent" className="dark:bg-gray-800">Parent</option>
                    <option value="Child" className="dark:bg-gray-800">Child</option>
                    <option value="Sibling" className="dark:bg-gray-800">Sibling</option>
                    <option value="Friend" className="dark:bg-gray-800">Friend</option>
                    <option value="Guardian" className="dark:bg-gray-800">Guardian</option>
                    <option value="Other" className="dark:bg-gray-800">Other</option>
                  </select>
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 dark:text-white/40 mb-1 block">Allergies</label>
              <input value={form.allergies} onChange={e => setForm((f: any) => ({...f, allergies: e.target.value}))} className={inputCls} placeholder="e.g. Penicillin, Latex (comma separated)" />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 dark:text-white/40 mb-1 block">Medical History</label>
              {(() => {
                const STANDARD = ['Diabetes','Hypertension','Ulcers','Heart Disease','Asthma','HIV/AIDS','Hepatitis B','Kidney Disease','Blood Disorder','Epilepsy','Arthritis','Cancer']
                const selected = (form.medicalHistory || '').split(',').map((s: string) => s.trim()).filter(Boolean)
                const extras   = selected.filter((s: string) => !STANDARD.includes(s))
                return (
                  <>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {STANDARD.map(cond => {
                        const isOn = selected.includes(cond)
                        return (
                          <button key={cond} type="button" onClick={() => {
                            const next = isOn ? selected.filter((s: string) => s !== cond) : [...selected, cond]
                            setForm((f: any) => ({...f, medicalHistory: next.join(', ')}))
                          }}
                            className={cn('px-3 py-1.5 rounded-xl text-xs font-bold transition-all',
                              isOn ? 'bg-cyan-500 text-white' : 'bg-gray-100 dark:bg-white/8 text-gray-600 dark:text-white/60 hover:bg-gray-200 dark:hover:bg-white/15')}>
                            {cond}
                          </button>
                        )
                      })}
                    </div>
                    <input
                      value={extras.join(', ')}
                      onChange={e => {
                        const pills  = selected.filter((s: string) => STANDARD.includes(s))
                        const newExt = e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean)
                        setForm((f: any) => ({...f, medicalHistory: [...pills, ...newExt].join(', ')}))
                      }}
                      className={inputCls} placeholder="Other conditions..." />
                  </>
                )
              })()}
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 dark:text-white/40 mb-1 block">Notes</label>
              <textarea rows={2} value={form.notes} onChange={e => setForm((f: any) => ({...f, notes: e.target.value}))} className={cn(inputCls, 'resize-none')} placeholder="General patient notes..." />
            </div>
            <button onClick={save} disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
              {saving ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Save size={13} />}
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Full Name',  value: `${patient.firstName} ${patient.lastName}` },
                { label: 'Gender',     value: patient.gender || 'N/A' },
                { label: 'Age',        value: age ? `${age} years` : 'N/A' },
                { label: 'Date of Birth', value: patient.dob ? new Date(patient.dob).toLocaleDateString('en-UG') : 'N/A' },
              ].map(f => (
                <div key={f.label} className="bg-gray-50 dark:bg-white/5 rounded-xl px-3 py-2.5">
                  <p className="text-[10px] font-black text-gray-400 dark:text-white/40 uppercase tracking-wider mb-0.5">{f.label}</p>
                  <p className="text-sm font-semibold text-gray-800 dark:text-white">{f.value}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 bg-gray-50 dark:bg-white/5 rounded-xl px-3 py-2.5">
              <Phone size={13} className="text-cyan-500 flex-shrink-0" />
              <span className="text-sm text-gray-700 dark:text-white/70">{patient.phone}</span>
            </div>
            <div className="flex items-center gap-2 bg-gray-50 dark:bg-white/5 rounded-xl px-3 py-2.5">
              <Mail size={13} className="text-cyan-500 flex-shrink-0" />
              <span className="text-sm text-gray-700 dark:text-white/70">{patient.email || 'No email'}</span>
            </div>
            {(patient.address || patient.district) && (
              <div className="bg-gray-50 dark:bg-white/5 rounded-xl px-3 py-2.5">
                <p className="text-[10px] font-black text-gray-400 dark:text-white/40 uppercase tracking-wider mb-0.5">Place of Residence</p>
                <p className="text-sm text-gray-700 dark:text-white/70">{[patient.address, patient.district].filter(Boolean).join(', ')}</p>
              </div>
            )}
            {(patient.nextOfKinName || patient.nextOfKinPhone) && (
              <div className="bg-gray-50 dark:bg-white/5 rounded-xl px-3 py-2.5">
                <p className="text-[10px] font-black text-gray-400 dark:text-white/40 uppercase tracking-wider mb-1">Next of Kin</p>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                  {patient.nextOfKinName && <span className="text-sm font-semibold text-gray-800 dark:text-white">{patient.nextOfKinName}</span>}
                  {patient.nextOfKinRelation && <span className="text-xs text-cyan-600 dark:text-cyan-400 font-semibold self-center">({patient.nextOfKinRelation})</span>}
                  {patient.nextOfKinPhone && <span className="text-sm text-gray-500 dark:text-white/60">{patient.nextOfKinPhone}</span>}
                </div>
              </div>
            )}
            {patient.allergies && (
              <div className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-700/20 rounded-xl px-3 py-2.5">
                <p className="text-[10px] font-black text-red-500 uppercase tracking-wider mb-0.5">Allergies</p>
                <p className="text-sm text-red-700 dark:text-red-300">{patient.allergies}</p>
              </div>
            )}
            {patient.medicalHistory && (
              <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-700/20 rounded-xl px-3 py-2.5">
                <p className="text-[10px] font-black text-blue-500 uppercase tracking-wider mb-1.5">Medical History</p>
                <div className="flex flex-wrap gap-1.5">
                  {patient.medicalHistory.split(',').map((c: string) => c.trim()).filter(Boolean).map((cond: string) => (
                    <span key={cond} className="px-2.5 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg text-xs font-bold">{cond}</span>
                  ))}
                </div>
              </div>
            )}
            {patient.notes && (
              <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-700/20 rounded-xl px-3 py-2.5">
                <p className="text-[10px] font-black text-amber-600 uppercase tracking-wider mb-0.5">Notes</p>
                <p className="text-sm text-amber-800 dark:text-amber-300">{patient.notes}</p>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Visits',  value: patient._count?.appointments || 0,  color: '#29ABE2' },
          { label: 'Since',          value: new Date(patient.createdAt).getFullYear(), color: '#9B59B6' },
          { label: 'Status',         value: patient.isActive ? 'Active' : 'Inactive', color: '#10B981' },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 p-3 text-center shadow-sm">
            <p className="text-2xl font-black" style={{ color: s.color }}>{s.value}</p>
            <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Appointments Tab ─────────────────────────────────────────
function AppointmentsTab({ patientId }: { patientId: string }) {
  const [appts, setAppts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const API = '/api-proxy'

  useEffect(() => {
    const token = localStorage.getItem('cc_token')
    const start = new Date(); start.setFullYear(start.getFullYear() - 3)
    const end = new Date(); end.setFullYear(end.getFullYear() + 1)
    fetch(`${API}/scheduling/appointments?patientId=${patientId}&startDate=${start.toISOString().slice(0,10)}&endDate=${end.toISOString().slice(0,10)}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(j => {
      setAppts(Array.isArray(j) ? j : j.appointments || j.data || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [patientId])

  async function advance(apptId: string, status: string) {
    const token = localStorage.getItem('cc_token')
    await fetch(`${API}/scheduling/appointments/${apptId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    const updated = appts.map(a => a.id === apptId ? { ...a, status } : a)
    setAppts(updated)
  }

  if (loading) return <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>

  const upcoming = appts.filter(a => !['COMPLETED','CANCELLED','NO_SHOW'].includes(a.status))
  const past     = appts.filter(a => ['COMPLETED','CANCELLED','NO_SHOW'].includes(a.status))

  return (
    <div className="space-y-4">
      {upcoming.length > 0 && (
        <Card>
          <div className="px-4 py-3 border-b border-gray-50 dark:border-white/5">
            <h3 className="text-sm font-bold text-gray-800 dark:text-white">Upcoming / Active</h3>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-white/5">
            {upcoming.map(a => {
              const STATUS_NEXT: Record<string, string> = { PENDING:'CONFIRMED', CONFIRMED:'CHECKED_IN', CHECKED_IN:'IN_CHAIR', IN_CHAIR:'WITH_PROVIDER', WITH_PROVIDER:'READY_CHECKOUT', READY_CHECKOUT:'COMPLETED' }
              const STATUS_LABELS: Record<string, string> = { PENDING:'Confirm', CONFIRMED:'Check In', CHECKED_IN:'In Chair', IN_CHAIR:'With Provider', WITH_PROVIDER:'Ready', READY_CHECKOUT:'Check Out' }
              const d = new Date(a.startAt)
              const cfg = STATUS_CFG[a.status]
              return (
                <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                    style={{ background: a.service?.colour || '#29ABE2' }}>
                    {d.getDate()}<br className="hidden" /><span className="hidden">{d.toLocaleDateString('en-UG',{month:'short'})}</span>
                    <span>{d.getDate()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 dark:text-white">{a.service?.name || 'Appointment'}</p>
                    <p className="text-xs text-gray-400">Dr. {a.doctor?.user?.firstName} {a.doctor?.user?.lastName} · {d.toLocaleDateString('en-UG',{weekday:'short',day:'numeric',month:'short'})} {d.toLocaleTimeString('en-UG',{hour:'2-digit',minute:'2-digit',hour12:true})}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', cfg?.cls)}>{cfg?.label || a.status}</span>
                    {STATUS_NEXT[a.status] && (
                      <button onClick={() => advance(a.id, STATUS_NEXT[a.status])}
                        className="text-[10px] font-bold bg-cyan-500 text-white px-2 py-0.5 rounded-lg hover:bg-cyan-600 transition-colors">
                        {STATUS_LABELS[a.status]}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {past.length > 0 && (
        <Card>
          <div className="px-4 py-3 border-b border-gray-50 dark:border-white/5">
            <h3 className="text-sm font-bold text-gray-800 dark:text-white">History</h3>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-white/5">
            {past.map(a => {
              const d = new Date(a.startAt)
              const cfg = STATUS_CFG[a.status]
              return (
                <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[10px] font-black flex-shrink-0"
                    style={{ background: a.service?.colour || '#CBD5E1' }}>
                    {d.getDate()}<br />{d.toLocaleDateString('en-UG',{month:'short'})}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">{a.service?.name || 'Appointment'}</p>
                    <p className="text-xs text-gray-400">Dr. {a.doctor?.user?.firstName} · {d.toLocaleDateString('en-UG',{day:'numeric',month:'short',year:'numeric'})}</p>
                  </div>
                  <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', cfg?.cls)}>{cfg?.label || a.status}</span>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {appts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Calendar size={40} className="text-gray-200 dark:text-white/10 mb-3" />
          <p className="text-gray-400">No appointments found</p>
        </div>
      )}
    </div>
  )
}

// ── Dental Chart Tab (read-only view for receptionist) ───────
function DentalTab({ patientId }: { patientId: string }) {
  const [chart, setChart] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [chartMode, setChartMode] = useState<'adult' | 'child'>('adult')
  const API = '/api-proxy'

  useEffect(() => {
    const token = localStorage.getItem('cc_token')
    fetch(`${API}/patients/${patientId}/dental-chart`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setChart).catch(() => {}).finally(() => setLoading(false))
  }, [patientId])

  const adultUpper = ['18','17','16','15','14','13','12','11','21','22','23','24','25','26','27','28']
  const adultLower = ['48','47','46','45','44','43','42','41','31','32','33','34','35','36','37','38']
  const childUpper = ['55','54','53','52','51','61','62','63','64','65']
  const childLower = ['85','84','83','82','81','71','72','73','74','75']

  const upperRow = chartMode === 'adult' ? adultUpper : childUpper
  const lowerRow = chartMode === 'adult' ? adultLower : childLower

  const SURFACE_COLORS: Record<string, string> = {
    Healthy: '#fff', Caries: '#F87171', 'Planned Treatment': '#FCD34D',
    Amalgam: '#94A3B8', Composite: '#7DD3FC', Gold: '#FBBF24', Sealant: '#F9A8D4',
  }

  if (loading) return <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>

  const teethData = chart?.teeth || {}

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-bold text-gray-800 dark:text-white">Dental Chart (Read-only)</h3>
            <p className="text-xs text-gray-400 dark:text-white/40">Chart edits are done by the dentist.</p>
          </div>
          {/* Adult / Child toggle */}
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 rounded-lg p-0.5">
            {(['adult','child'] as const).map(mode => (
              <button key={mode} onClick={() => setChartMode(mode)}
                className={cn('px-3 py-1 text-xs font-semibold rounded-md transition-colors',
                  chartMode === mode ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400')}>
                {mode === 'adult' ? 'Adult' : 'Child'}
              </button>
            ))}
          </div>
        </div>

        {/* Simple tooth grid */}
        <div className="overflow-x-auto">
          <div className="min-w-max">
            {/* Upper arch */}
            <div className="flex gap-1 mb-2">
              {upperRow.map(t => {
                const td = teethData[t] || {}
                const conditions = td.conditions || []
                const missing = conditions.some((c: any) => c.condition === 'Missing')
                return (
                  <div key={t} className="flex flex-col items-center gap-0.5">
                    <span className="text-[8px] text-gray-400">{t}</span>
                    <div className={cn('w-8 h-8 rounded-lg border-2 flex items-center justify-center text-[8px] font-bold transition-all',
                      missing ? 'border-dashed border-gray-300 bg-gray-50 dark:bg-white/5 text-gray-300' : 'border-gray-200 dark:border-white/10 bg-white dark:bg-white/5')}>
                      {missing ? '×' : conditions.length > 0 ? '!' : ''}
                    </div>
                    <div className="w-1 h-3 bg-gray-200 dark:bg-white/10 rounded-full" />
                  </div>
                )
              })}
            </div>

            {/* Lower arch */}
            <div className="flex gap-1 mt-1">
              {lowerRow.map(t => {
                const td = teethData[t] || {}
                const conditions = td.conditions || []
                const missing = conditions.some((c: any) => c.condition === 'Missing')
                return (
                  <div key={t} className="flex flex-col items-center gap-0.5">
                    <div className="w-1 h-3 bg-gray-200 dark:bg-white/10 rounded-full" />
                    <div className={cn('w-8 h-8 rounded-lg border-2 flex items-center justify-center text-[8px] font-bold',
                      missing ? 'border-dashed border-gray-300 bg-gray-50 dark:bg-white/5 text-gray-300' : 'border-gray-200 dark:border-white/10 bg-white dark:bg-white/5')}>
                      {missing ? '×' : conditions.length > 0 ? '!' : ''}
                    </div>
                    <span className="text-[8px] text-gray-400">{t}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-50 dark:border-white/5">
          {Object.entries(SURFACE_COLORS).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1">
              <span className="w-3 h-3 rounded border border-gray-200" style={{ background: v }} />
              <span className="text-[10px] text-gray-500 dark:text-white/50">{k}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Conditions summary */}
      {Object.keys(teethData).length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50 dark:border-white/5">
            <h3 className="text-sm font-bold text-gray-800 dark:text-white">Conditions Summary</h3>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-white/5">
            {Object.entries(teethData).filter(([, v]: any) => v?.conditions?.length > 0).map(([tooth, td]: any) => (
              <div key={tooth} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-white/8 flex items-center justify-center text-xs font-bold text-gray-600 dark:text-white/60">{tooth}</span>
                <div className="flex flex-wrap gap-1">
                  {td.conditions.map((c: any) => (
                    <span key={c.id} className="text-[10px] font-bold bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded-full">{c.condition}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// ── Perio Tab ────────────────────────────────────────────────
function PerioTab({ patientId }: { patientId: string }) {
  const [chart, setChart] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const API = '/api-proxy'

  useEffect(() => {
    const token = localStorage.getItem('cc_token')
    fetch(`${API}/patients/${patientId}/dental-chart`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setChart).catch(() => {}).finally(() => setLoading(false))
  }, [patientId])

  if (loading) return <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>

  const teethData = chart?.teeth || {}
  const perioTeeth = Object.entries(teethData).filter(([, v]: any) => v?.periodontal && Object.keys(v.periodontal).length > 0)

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-50 dark:border-white/5">
        <h3 className="text-sm font-bold text-gray-800 dark:text-white">Periodontal Chart (Read-only)</h3>
        <p className="text-xs text-gray-400 dark:text-white/40">Recorded by the treating dentist</p>
      </div>
      {perioTeeth.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Activity size={36} className="text-gray-200 dark:text-white/10 mb-3" />
          <p className="text-sm text-gray-400">No periodontal data recorded yet</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-50 dark:divide-white/5">
          {perioTeeth.map(([tooth, td]: any) => {
            const sites = td.periodontal
            return (
              <div key={tooth} className="px-4 py-3">
                <p className="text-sm font-bold text-gray-700 dark:text-white mb-2">Tooth {tooth}</p>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(sites).map(([site, data]: any) => (
                    <div key={site} className="bg-gray-50 dark:bg-white/5 rounded-lg p-2">
                      <p className="text-[10px] font-black text-gray-400 uppercase mb-1">{site}</p>
                      {data.pocketDepth !== undefined && <p className="text-xs text-gray-700 dark:text-white/70">PD: <span className={cn('font-bold', data.pocketDepth >= 4 ? 'text-red-500' : 'text-emerald-500')}>{data.pocketDepth}mm</span></p>}
                      {data.bleeding && <p className="text-[10px] text-red-400">● Bleeding</p>}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ── Treatment Plans Tab ──────────────────────────────────────
function TreatmentTab({ patientId }: { patientId: string }) {
  const [plans, setPlans]   = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const API = '/api-proxy'

  useEffect(() => {
    const token = localStorage.getItem('cc_token')
    fetch(`${API}/patients/${patientId}/treatment-plans`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(j => { setPlans(Array.isArray(j) ? j : j.data || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [patientId])

  if (loading) return <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="space-y-3">
      {plans.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FileText size={40} className="text-gray-200 dark:text-white/10 mb-3" />
          <p className="text-gray-400">No treatment plans found</p>
        </div>
      ) : plans.map(plan => (
        <Card key={plan.id} className="overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50 dark:border-white/5">
            <div>
              <h3 className="text-sm font-bold text-gray-800 dark:text-white">{plan.title || 'Treatment Plan'}</h3>
              <p className="text-xs text-gray-400 dark:text-white/40">{new Date(plan.createdAt).toLocaleDateString('en-UG')}</p>
            </div>
            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
              plan.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
              plan.status === 'COMPLETED' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
              'bg-gray-100 text-gray-500')}>
              {plan.status || 'Draft'}
            </span>
          </div>
          {plan.items?.length > 0 && (
            <div className="divide-y divide-gray-50 dark:divide-white/5">
              {plan.items.map((item: any) => (
                <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className={cn('w-2 h-2 rounded-full flex-shrink-0', item.completed ? 'bg-emerald-500' : 'bg-amber-400')} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 dark:text-white/80">{item.description || item.service?.name}</p>
                    {item.tooth && <p className="text-xs text-gray-400">Tooth {item.tooth}</p>}
                  </div>
                  {item.fee > 0 && <span className="text-xs font-bold text-gray-600 dark:text-white/60">{formatUGX(item.fee)}</span>}
                </div>
              ))}
            </div>
          )}
          {plan.totalFee > 0 && (
            <div className="px-4 py-2.5 border-t border-gray-50 dark:border-white/5 flex items-center justify-between">
              <span className="text-xs font-bold text-gray-500">Total</span>
              <span className="text-sm font-black text-cyan-600">{formatUGX(plan.totalFee)}</span>
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}

// ── Notes Tab ────────────────────────────────────────────────
const FOLLOWUP_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  NONE:            { label: 'No Status',       color: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400' },
  CONTACT:         { label: 'Contact',         color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  CONTACTED:       { label: 'Contacted',       color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  DO_NOT_CONTACT:  { label: 'Do Not Contact',  color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
}

function NotesTab({ patientId }: { patientId: string }) {
  const [notes, setNotes]   = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText]     = useState('')
  const [saving, setSaving] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null)
  const API = '/api-proxy/clinical'

  const fetchNotes = useCallback(() => {
    const token = localStorage.getItem('cc_token')
    fetch(`${API}/patients/${patientId}/treatment-notes`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(j => { setNotes(Array.isArray(j) ? j : j.data || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [patientId])

  useEffect(() => { fetchNotes() }, [fetchNotes])

  async function addNote() {
    if (!text.trim()) return
    setSaving(true)
    const token = localStorage.getItem('cc_token')
    try {
      await fetch(`${API}/patients/${patientId}/treatment-notes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text.trim() }),
      })
      setText('')
      fetchNotes()
    } finally { setSaving(false) }
  }

  async function updateFollowUpStatus(noteId: string, status: string) {
    setUpdatingStatus(noteId + status)
    const token = localStorage.getItem('cc_token')
    try {
      await fetch(`${API}/patients/${patientId}/treatment-notes/${noteId}/followup-status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      setNotes(prev => prev.map(n => n.id === noteId ? { ...n, followUpStatus: status } : n))
    } finally { setUpdatingStatus(null) }
  }

  if (loading) return <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="space-y-4">
      {/* Add note */}
      <Card className="p-4">
        <h3 className="text-sm font-bold text-gray-800 dark:text-white mb-3">Add Note</h3>
        <textarea
          value={text} onChange={e => setText(e.target.value)}
          placeholder="Write a clinical note..."
          rows={3}
          className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 resize-none transition-all"
        />
        <button onClick={addNote} disabled={saving || !text.trim()}
          className="mt-2 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-all"
          style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
          {saving ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Plus size={13} />}
          Save Note
        </button>
      </Card>

      {/* Notes list */}
      {notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FileText size={36} className="text-gray-200 dark:text-white/10 mb-3" />
          <p className="text-gray-400">No notes yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((n: any) => {
            const fus = n.followUpStatus || 'NONE'
            const statusInfo = FOLLOWUP_STATUS_LABELS[fus] || FOLLOWUP_STATUS_LABELS.NONE
            return (
              <Card key={n.id} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-400">{new Date(n.createdAt).toLocaleString('en-UG', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusInfo.color}`}>{statusInfo.label}</span>
                </div>
                <p className="text-sm text-gray-700 dark:text-white/80 leading-relaxed mb-3">{n.content}</p>
                {n.author && <p className="text-xs text-gray-400 mb-3">— {n.author.firstName} {n.author.lastName}</p>}
                {/* Follow-up status buttons */}
                <div className="flex flex-wrap gap-2 border-t border-gray-100 dark:border-white/8 pt-3">
                  {(['CONTACT', 'CONTACTED', 'DO_NOT_CONTACT'] as const).map(s => {
                    const isActive = fus === s
                    const SOLID: Record<string, string> = { CONTACT: '#3B82F6', CONTACTED: '#10B981', DO_NOT_CONTACT: '#EF4444' }
                    return (
                      <button
                        key={s}
                        onClick={() => updateFollowUpStatus(n.id, fus === s ? 'NONE' : s)}
                        disabled={updatingStatus !== null}
                        style={isActive
                          ? { background: SOLID[s], boxShadow: `0 2px 8px ${SOLID[s]}66` }
                          : { border: `1.5px solid ${SOLID[s]}`, color: SOLID[s] }
                        }
                        className={`px-4 py-2 rounded-full text-xs font-bold transition-all disabled:opacity-50 ${isActive ? 'text-white' : 'bg-transparent'}`}>
                        {FOLLOWUP_STATUS_LABELS[s].label}
                      </button>
                    )
                  })}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Billing Tab ──────────────────────────────────────────────
function BillingTab({ patientId }: { patientId: string }) {
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading]   = useState(true)
  const API = '/api-proxy'

  useEffect(() => {
    const token = localStorage.getItem('cc_token')
    fetch(`${API}/billing/invoices?patientId=${patientId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(j => { setInvoices(Array.isArray(j) ? j : j.data || j.invoices || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [patientId])

  if (loading) return <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>

  const totalDue  = invoices.filter(i => i.status !== 'PAID').reduce((s, i) => s + (i.amount || 0), 0)
  const totalPaid = invoices.filter(i => i.status === 'PAID').reduce((s, i) => s + (i.amount || 0), 0)

  return (
    <div className="space-y-4">
      {/* Balance summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 p-4 shadow-sm">
          <p className="text-xs text-gray-400 mb-1">Outstanding</p>
          <p className="text-2xl font-black text-red-500">{formatUGX(totalDue)}</p>
        </div>
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 p-4 shadow-sm">
          <p className="text-xs text-gray-400 mb-1">Total Paid</p>
          <p className="text-2xl font-black text-emerald-500">{formatUGX(totalPaid)}</p>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 dark:border-white/5">
          <h3 className="text-sm font-bold text-gray-800 dark:text-white">Invoices</h3>
        </div>
        {invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Receipt size={36} className="text-gray-200 dark:text-white/10 mb-3" />
            <p className="text-gray-400">No invoices found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-white/5">
            {invoices.map((inv: any) => (
              <div key={inv.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-white/8 flex items-center justify-center flex-shrink-0">
                  <Receipt size={15} className="text-gray-500 dark:text-white/50" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 dark:text-white">Invoice #{inv.invoiceNumber || inv.id?.slice(0, 8)}</p>
                  <p className="text-xs text-gray-400">{new Date(inv.createdAt).toLocaleDateString('en-UG')}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-gray-800 dark:text-white">{formatUGX(inv.amount || 0)}</p>
                  <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                    inv.status === 'PAID' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400')}>
                    {inv.status || 'Unpaid'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

// ── Documents Tab ────────────────────────────────────────────
function DocumentsTab({ patientId }: { patientId: string }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-50 dark:border-white/5">
        <h3 className="text-sm font-bold text-gray-800 dark:text-white">Documents</h3>
      </div>
      <div className="flex flex-col items-center justify-center py-14 text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-white/8 flex items-center justify-center mb-4">
          <Folder size={28} className="text-gray-400 dark:text-white/40" />
        </div>
        <p className="text-sm font-semibold text-gray-600 dark:text-white/60 mb-1">Document storage</p>
        <p className="text-xs text-gray-400 dark:text-white/30 mb-4">X-rays, consent forms and files attached by the dentist will appear here</p>
        <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border border-gray-200 dark:border-white/10 text-gray-500 dark:text-white/50 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
          <Upload size={13} /> Upload Document
        </button>
      </div>
    </Card>
  )
}

// ── Activity Tab ─────────────────────────────────────────────
function ActivityTab({ patientId }: { patientId: string }) {
  const [activity, setActivity] = useState<any[]>([])
  const [loading, setLoading]   = useState(true)
  const API = '/api-proxy'

  useEffect(() => {
    const token = localStorage.getItem('cc_token')
    fetch(`${API}/patients/${patientId}/activity`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(j => { setActivity(Array.isArray(j) ? j : j.data || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [patientId])

  if (loading) return <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-50 dark:border-white/5">
        <h3 className="text-sm font-bold text-gray-800 dark:text-white">Activity Log</h3>
      </div>
      {activity.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Clock size={36} className="text-gray-200 dark:text-white/10 mb-3" />
          <p className="text-gray-400">No activity recorded yet</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-50 dark:divide-white/5">
          {activity.map((a: any, i: number) => (
            <div key={a.id || i} className="flex items-start gap-3 px-4 py-3">
              <div className="w-7 h-7 rounded-full bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <CheckCircle2 size={13} className="text-cyan-600 dark:text-cyan-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700 dark:text-white/80">{a.description || a.action}</p>
                <p className="text-xs text-gray-400 mt-0.5">{new Date(a.createdAt).toLocaleString('en-UG', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── Main Page ────────────────────────────────────────────────
export default function PatientDetailPage() {
  const params  = useParams()
  const router  = useRouter()
  const id      = params.id as string

  const [patient, setPatient]       = useState<any>(null)
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState<Tab>('timeline')
  const [toast, setToast]           = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [localAvatar, setLocalAvatar] = useState<string | null>(null)
  const [uploading, setUploading]   = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const API = '/api-proxy'

  const fetchPatient = useCallback(async () => {
    const token = localStorage.getItem('cc_token')
    try {
      const res = await fetch(`${API}/patients/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setPatient(await res.json())
    } finally { setLoading(false) }
  }, [id])

  useEffect(() => { fetchPatient() }, [fetchPatient])

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      showToast('Only JPG, PNG or WebP allowed', 'err'); return
    }
    setUploading(true)
    try {
      const token = localStorage.getItem('cc_token')
      const form  = new FormData()
      form.append('avatar', file)
      const res = await fetch(`${API}/patients/${id}/avatar`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
      })
      if (res.ok) {
        const data = await res.json()
        setLocalAvatar(data.avatarUrl)
        showToast('Photo updated', 'ok')
        fetchPatient()
      } else {
        // Fallback: show local preview
        const reader = new FileReader()
        reader.onload = ev => setLocalAvatar(ev.target?.result as string)
        reader.readAsDataURL(file)
        showToast('Saved locally (API not available)', 'ok')
      }
    } catch {
      showToast('Upload failed', 'err')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function showToast(msg: string, type: 'ok' | 'err') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full py-32">
      <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!patient) return (
    <div className="flex flex-col items-center justify-center h-full py-32 text-center">
      <AlertCircle size={48} className="text-gray-200 dark:text-white/10 mb-4" />
      <p className="text-gray-400">Patient not found</p>
      <button onClick={() => router.push('/receptionist/patients')}
        className="mt-4 text-sm text-cyan-600 hover:underline">← Back to Patients</button>
    </div>
  )

  const initials   = `${patient.firstName?.[0] || ''}${patient.lastName?.[0] || ''}`
  const avatarBg   = avatarColor(`${patient.firstName}${patient.lastName}`)
  const age        = patient.dob ? new Date().getFullYear() - new Date(patient.dob).getFullYear() : null

  return (
    <div className="flex flex-col h-full">
      {/* Toast */}
      {toast && (
        <div className={cn('fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-xl text-sm font-bold animate-fade-in',
          toast.type === 'ok' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white')}>
          {toast.type === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex-shrink-0 bg-white dark:bg-[#0a1f4a]/60 dark:backdrop-blur-md border-b border-gray-100 dark:border-white/8 px-5 py-4">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/receptionist/patients')}
            className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/8 transition-colors flex-shrink-0">
            <ArrowLeft size={18} className="text-gray-600 dark:text-white/70" />
          </button>

          {/* Avatar — clickable to upload */}
          <div className="relative group flex-shrink-0 cursor-pointer" onClick={() => fileRef.current?.click()} title="Click to change photo">
            {(localAvatar || patient.avatarUrl) ? (
              <img src={localAvatar || patient.avatarUrl} alt=""
                className="w-12 h-12 rounded-2xl object-cover ring-2 ring-white dark:ring-white/10 shadow-sm" />
            ) : (
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-base shadow-sm"
                style={{ background: avatarBg }}>
                {initials}
              </div>
            )}
            <div className="absolute inset-0 rounded-2xl bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              {uploading ? <Loader2 size={16} className="animate-spin text-white" /> : <Camera size={16} className="text-white" />}
            </div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleAvatarUpload} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black text-gray-800 dark:text-white truncate">
                {patient.firstName} {patient.lastName}
              </h1>
              {patient.patientId && (
                <span className="text-xs font-mono text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-900/20 px-2 py-0.5 rounded-lg flex-shrink-0">{patient.patientId}</span>
              )}
            </div>
            <p className="text-xs text-gray-400 dark:text-white/40">
              {patient.gender || 'N/A'}{age ? ` · ${age} yrs` : ''} · {patient.phone}
              {patient._count?.appointments > 0 && ` · ${patient._count.appointments} visits`}
            </p>
          </div>

          {/* Quick action: book appointment */}
          <button
            onClick={() => router.push('/receptionist/appointments')}
            className="hidden sm:flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white flex-shrink-0 hover:-translate-y-0.5 transition-all"
            style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
            <Plus size={14} /> Book
          </button>
        </div>

        {/* Tab bar — scrollable on mobile */}
        <div className="flex gap-1 mt-4 overflow-x-auto scrollbar-none">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex-shrink-0',
                tab === key
                  ? 'bg-cyan-500 text-white shadow-sm'
                  : 'text-gray-500 dark:text-white/50 hover:bg-gray-100 dark:hover:bg-white/8',
              )}>
              <Icon size={13} />
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{label.split(' ')[0]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'overview'     && <OverviewTab patient={patient} onRefresh={fetchPatient} />}
        {tab === 'appointments' && <AppointmentsTab patientId={id} />}
        {tab === 'dental'       && <DentalTab patientId={id} />}
        {tab === 'perio'        && <PerioTab patientId={id} />}
        {tab === 'treatment'    && <TreatmentTab patientId={id} />}
        {tab === 'notes'        && <NotesTab patientId={id} />}
        {tab === 'billing'      && <BillingTab patientId={id} />}
        {tab === 'documents'    && <DocumentsTab patientId={id} />}
        {tab === 'activity'     && <ActivityTab patientId={id} />}
        {tab === 'timeline'     && <TimelineTab patientId={id} />}
      </div>
    </div>
  )
}
