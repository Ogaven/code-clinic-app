'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRef } from 'react'
import {
  ArrowLeft, User, Calendar, FileText, Activity, DollarSign, Folder,
  Phone, Mail, Edit2, Save, X, Plus, Trash2, CheckCircle2, AlertCircle,
  Clock, ChevronRight, Receipt, Download, Upload, Star, Brain, Camera, Loader2,
  CheckCircle, XCircle, Eye, Sparkles, Mic, MicOff, Printer,
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

// ── Dental chart types ────────────────────────────────────────
type Surface = 'buccal' | 'lingual' | 'occlusal' | 'mesial' | 'distal'
type SurfaceStatus = 'Healthy' | 'Caries' | 'Planned Treatment' | 'Amalgam' | 'Composite' | 'Gold' | 'Sealant'
type ToothCondition = 'Missing' | 'Implant' | 'Root Canal' | 'Crown' | 'Fracture' | 'To be Extracted' | 'Impacted' | 'Mobile' | 'Supraerupted' | 'Bridge Abutment' | 'Pontic' | 'Denture' | 'Caries'
type PerioSite = 'db' | 'b' | 'mb' | 'dl' | 'l' | 'ml'
interface TrackedCondition { id: string; condition: ToothCondition }
interface ToothState {
  conditions: TrackedCondition[]
  surfaces: Partial<Record<Surface, SurfaceStatus>>
  notes?: string
  mobility?: number
  periodontal?: Partial<Record<PerioSite, { pocketDepth?: number; gingivalMargin?: number; bleeding?: boolean; suppuration?: boolean; plaque?: boolean }>>
  history?: { date: string; changeType: string; item: string; oldStatus?: string; newStatus: string }[]
}

const statusColorMap: Record<SurfaceStatus, string> = {
  Healthy: 'fill-white', Caries: 'fill-red-400', 'Planned Treatment': 'fill-amber-400',
  Amalgam: 'fill-slate-500', Composite: 'fill-sky-300', Gold: 'fill-yellow-400', Sealant: 'fill-pink-300',
}
const quadrant1 = ['18','17','16','15','14','13','12','11']
const quadrant2 = ['21','22','23','24','25','26','27','28']
const quadrant3 = ['31','32','33','34','35','36','37','38']
const quadrant4 = ['48','47','46','45','44','43','42','41']
const childQ1 = ['55','54','53','52','51']
const childQ2 = ['61','62','63','64','65']
const childQ3 = ['71','72','73','74','75']
const childQ4 = ['85','84','83','82','81']
const conditionTools: ToothCondition[] = [
  'Missing','Implant','Root Canal','Crown','Fracture','To be Extracted',
  'Impacted','Mobile','Supraerupted','Bridge Abutment','Pontic','Denture',
]
const surfaceTools: SurfaceStatus[] = ['Healthy','Caries','Planned Treatment','Amalgam','Composite','Gold','Sealant']

function ToothSVG({ toothNumber, state, isSelected, onSelect, isPatientLeft, isUpperQuadrant }: {
  toothNumber: string; state: ToothState; isSelected: boolean;
  onSelect: (n: string | null) => void; isPatientLeft: boolean; isUpperQuadrant: boolean
}) {
  const { conditions = [], surfaces = {} } = state
  const hasCondition = (c: string) => conditions.some(tc => tc.condition === c)
  const isMissing    = hasCondition('Missing')
  const hasImplant   = hasCondition('Implant')
  const hasRootCanal = hasCondition('Root Canal')
  const hasCrown     = hasCondition('Crown')
  const hasFracture  = hasCondition('Fracture')
  const toBeExtracted= hasCondition('To be Extracted')

  const getSurfaceColor = (surfaceName: 'top' | 'bottom' | 'occlusal' | 'left' | 'right') => {
    let s: Surface
    if (surfaceName === 'top')    s = isUpperQuadrant ? 'buccal' : 'lingual'
    else if (surfaceName === 'bottom') s = isUpperQuadrant ? 'lingual' : 'buccal'
    else if (surfaceName === 'left')   s = isPatientLeft ? 'mesial' : 'distal'
    else if (surfaceName === 'right')  s = isPatientLeft ? 'distal' : 'mesial'
    else s = 'occlusal'
    return statusColorMap[surfaces[s] || 'Healthy']
  }

  return (
    <div
      className={cn('w-14 h-14 flex flex-col items-center justify-center relative cursor-pointer p-0.5 rounded-lg transition-colors',
        isSelected ? 'bg-blue-200' : 'hover:bg-slate-100 dark:hover:bg-white/10')}
      onClick={() => onSelect(isSelected ? null : toothNumber)}
      title={`Tooth ${toothNumber}`}
    >
      <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">{toothNumber}</span>
      <div className="w-10 h-10 relative">
        {isMissing ? (
          <div className="w-full h-full flex items-center justify-center">
            <X size={20} className="text-slate-400" />
          </div>
        ) : (
          <svg viewBox="0 0 20 20" className="w-full h-full">
            <path d="M7,6 L13,6 L14,2 L6,2 Z"    className={`transition-colors stroke-slate-400 stroke-[0.5] ${getSurfaceColor('top')}`} />
            <path d="M7,14 L13,14 L14,18 L6,18 Z" className={`transition-colors stroke-slate-400 stroke-[0.5] ${getSurfaceColor('bottom')}`} />
            <path d="M6,7 L6,13 L2,14 L2,6 Z"    className={`transition-colors stroke-slate-400 stroke-[0.5] ${getSurfaceColor('left')}`} />
            <path d="M14,7 L14,13 L18,14 L18,6 Z" className={`transition-colors stroke-slate-400 stroke-[0.5] ${getSurfaceColor('right')}`} />
            <path d="M6,6 H14 V14 H6 Z"            className={`transition-colors stroke-slate-400 stroke-[0.5] ${getSurfaceColor('occlusal')}`} />
          </svg>
        )}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {hasImplant    && <CheckCircle size={14} className="text-cyan-600 opacity-80" />}
          {hasRootCanal  && <span className="text-xs font-bold text-blue-500 opacity-80">R</span>}
          {hasCrown      && <div className="w-8 h-8 border-2 border-yellow-400 rounded opacity-80" />}
          {hasFracture   && <XCircle size={12} className="text-red-600 opacity-80" />}
          {toBeExtracted && <X size={16} className="text-red-600 opacity-80 stroke-2" />}
        </div>
      </div>
    </div>
  )
}

function renderMarkdown(text: string) {
  return text.split('\n').map((line, i) => {
    if (line.startsWith('### ')) return <h4 key={i} className="font-bold text-slate-800 dark:text-white mt-2 mb-0.5 text-sm">{line.slice(4)}</h4>
    if (line.startsWith('## '))  return <h3 key={i} className="font-bold text-slate-800 dark:text-white mt-3 mb-1">{line.slice(3)}</h3>
    if (line.startsWith('# '))   return <h2 key={i} className="font-semibold text-slate-900 dark:text-white mt-3 mb-1 text-base">{line.slice(2)}</h2>
    if (line === '---')           return <hr key={i} className="border-slate-200 dark:border-white/10 my-2" />
    const html = line
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
    return <p key={i} className="text-sm text-slate-700 dark:text-slate-300" dangerouslySetInnerHTML={{ __html: html || '&nbsp;' }} />
  })
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
  const [editing, setEditing]         = useState(false)
  const [form, setForm]               = useState<any>({})
  const [saving, setSaving]           = useState(false)
  const [toggling, setToggling]       = useState(false)
  const API = '/api-proxy'

  async function toggleActive() {
    setToggling(true)
    const token = localStorage.getItem('cc_token')
    try {
      await fetch(`${API}/patients/${patient.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !patient.isActive }),
      })
      onRefresh()
    } finally { setToggling(false) }
  }

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
      referralSource:   patient.referralSource   || '',
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

  function formatDobAge(dob: string) {
    const birth = new Date(dob)
    const now   = new Date()
    const totalMonths = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth()) - (now.getDate() < birth.getDate() ? 1 : 0)
    const years  = Math.floor(totalMonths / 12)
    const months = totalMonths % 12
    const agePart = totalMonths < 12 ? `${totalMonths} mo` : (years < 3 && months > 0 ? `${years} yr ${months} mo` : `${years} yrs`)
    return `${birth.toLocaleDateString('en-GB')} (${agePart})`
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-black text-gray-800 dark:text-white uppercase tracking-wide">Personal Information</h3>
            {!patient.isActive && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 uppercase tracking-wide">Inactive</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleActive}
              disabled={toggling}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all disabled:opacity-50',
                patient.isActive
                  ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
                  : 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20')}>
              {toggling ? '...' : patient.isActive ? 'Deactivate' : 'Reactivate'}
            </button>
            <button onClick={() => setEditing(e => !e)}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all',
                editing ? 'bg-gray-100 dark:bg-white/8 text-gray-600 dark:text-white/60' : 'text-cyan-600 hover:bg-cyan-50 dark:hover:bg-cyan-900/20')}>
              {editing ? <><X size={12} /> Cancel</> : <><Edit2 size={12} /> Edit</>}
            </button>
          </div>
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
            <div>
              <label className="text-xs font-bold text-gray-500 dark:text-white/40 mb-1 block">Residence</label>
              <input value={form.address} onChange={e => setForm((f: any) => ({...f, address: e.target.value}))} className={inputCls} placeholder="e.g. Kampala, Ntinda" />
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
              <label className="text-xs font-bold text-gray-500 dark:text-white/40 mb-1 block">How did they find us?</label>
              <select value={form.referralSource} onChange={e => setForm((f: any) => ({...f, referralSource: e.target.value}))} className={inputCls}>
                <option value="" className="dark:bg-gray-800">— Not specified —</option>
                {['Walk-in','Google Search','Google Ad','Facebook','Instagram','Friends and Family','Doctor referral','NWSC','ERA','City Medicals','GA','BNI','YouTube','Worship Harvest','Other'].map((o: string) => (
                  <option key={o} value={o} className="dark:bg-gray-800">{o}</option>
                ))}
              </select>
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
                { label: 'Date of Birth', value: patient.dob ? formatDobAge(patient.dob) : 'N/A' },
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
            {patient.address && (
              <div className="bg-gray-50 dark:bg-white/5 rounded-xl px-3 py-2.5">
                <p className="text-[10px] font-black text-gray-400 dark:text-white/40 uppercase tracking-wider mb-0.5">Residence</p>
                <p className="text-sm text-gray-700 dark:text-white/70">{patient.address}</p>
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
            {patient.referralSource && (
              <div className="bg-gray-50 dark:bg-white/5 rounded-xl px-3 py-2.5">
                <p className="text-[10px] font-black text-gray-400 dark:text-white/40 uppercase tracking-wider mb-0.5">How They Found Us</p>
                <p className="text-sm font-semibold text-gray-800 dark:text-white">{patient.referralSource}</p>
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
                    {d.getDate()}<br className="hidden" /><span className="hidden">{d.toLocaleDateString('en-GB',{month:'short'})}</span>
                    <span>{d.getDate()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 dark:text-white">{a.service?.name || 'Appointment'}</p>
                    <p className="text-xs text-gray-400">Dr. {a.doctor?.user?.firstName} {a.doctor?.user?.lastName} · {d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})} {d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:true})}</p>
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
                    {d.getDate()}<br />{d.toLocaleDateString('en-GB',{month:'short'})}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">{a.service?.name || 'Appointment'}</p>
                    <p className="text-xs text-gray-400">Dr. {a.doctor?.user?.firstName} · {d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</p>
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

// ── Dental Chart Tab (full editable — matches doctor view) ───
function DentalChartTab({ patientId }: { patientId: string }) {
  const [chart, setChart]               = useState<Record<string, ToothState>>({})
  const [selectedTooth, setSelectedTooth] = useState<string | null>(null)
  const [aiSummary, setAiSummary]       = useState('')
  const [isSummarizing, setIsSummarizing] = useState(false)
  const [isSaving, setIsSaving]         = useState(false)
  const [smartEntry, setSmartEntry]     = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [savedAiSummary, setSavedAiSummary] = useState('')
  const [services, setServices]         = useState<any[]>([])
  const [chartMode, setChartMode]       = useState<'adult' | 'child'>('adult')

  useEffect(() => {
    const token = localStorage.getItem('cc_token')
    fetch(`/api-proxy/clinical/patients/${patientId}/dental-chart`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => {
        setChart(d.teeth || {})
        if (d.aiSummary) setSavedAiSummary(d.aiSummary)
      }).catch(() => {})
    fetch('/api-proxy/services', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setServices(Array.isArray(d) ? d : [])).catch(() => {})
  }, [patientId])

  const getToothState = (n: string): ToothState => chart[n] || { conditions: [], surfaces: {}, history: [] }

  const updateTooth = (n: string, updates: Partial<ToothState>) => {
    setChart(prev => {
      const current = prev[n] || { conditions: [], surfaces: {}, history: [] }
      const newHistory = [...(current.history || [])]
      if (updates.conditions) {
        const oldSet = new Set(current.conditions.map(c => c.condition))
        updates.conditions.forEach(c => { if (!oldSet.has(c.condition)) newHistory.push({ date: new Date().toISOString(), changeType: 'condition', item: c.condition, newStatus: 'added' }) })
      }
      if (updates.surfaces) {
        Object.entries(updates.surfaces).forEach(([s, v]) => {
          const old = current.surfaces[s as Surface] || 'Healthy'
          if (old !== v) newHistory.push({ date: new Date().toISOString(), changeType: 'surface', item: s, oldStatus: old, newStatus: v as string })
        })
      }
      return { ...prev, [n]: { ...current, ...updates, surfaces: updates.surfaces ? { ...current.surfaces, ...updates.surfaces } : current.surfaces, conditions: updates.conditions ?? current.conditions, history: newHistory } }
    })
  }

  const handleConditionToggle = (condition: ToothCondition) => {
    if (!selectedTooth) return
    const state = getToothState(selectedTooth)
    const exists = state.conditions.some(c => c.condition === condition)
    const newConditions = exists
      ? state.conditions.filter(c => c.condition !== condition)
      : [...state.conditions, { id: `${condition}-${Date.now()}`, condition }]
    updateTooth(selectedTooth, { conditions: newConditions })
  }

  const handleSurfaceChange = (surface: Surface, status: SurfaceStatus) => {
    if (!selectedTooth) return
    const state = getToothState(selectedTooth)
    const newSurfaces = { ...state.surfaces, [surface]: status }
    const updates: Partial<ToothState> = { surfaces: newSurfaces }
    if (status === 'Caries' && !state.conditions.some(c => c.condition === 'Caries')) {
      updates.conditions = [...state.conditions, { id: `Caries-${surface}-${Date.now()}`, condition: 'Caries' }]
    }
    updateTooth(selectedTooth, updates)
  }

  const handleSave = async () => {
    setIsSaving(true)
    const token = localStorage.getItem('cc_token')
    try {
      await fetch(`/api-proxy/clinical/patients/${patientId}/dental-chart`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ teeth: chart }),
      })
    } catch {} finally { setIsSaving(false) }
  }

  const handleGenerateSummary = async () => {
    setIsSummarizing(true)
    const token = localStorage.getItem('cc_token')
    try {
      const res = await fetch(`/api-proxy/clinical/patients/${patientId}/dental-chart/ai-summary`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ chartData: chart, type: 'dental' }),
      })
      const data = await res.json()
      setSavedAiSummary(data.summary || '')
      setAiSummary(data.summary || '')
    } catch {} finally { setIsSummarizing(false) }
  }

  const handleSmartEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!smartEntry.trim()) return
    setIsProcessing(true)
    const token = localStorage.getItem('cc_token')
    try {
      const res = await fetch('/api-proxy/clinical/dental-chart/smart-entry', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ command: smartEntry, patientId }),
      })
      const data = await res.json()
      if (data.commands) {
        data.commands.forEach((cmd: any) => {
          const state = chart[cmd.toothNumber] || { conditions: [], surfaces: {}, history: [] }
          if (cmd.type === 'surface') updateTooth(cmd.toothNumber, { surfaces: { ...state.surfaces, [cmd.surface]: cmd.status } })
          else if (cmd.type === 'condition') {
            if (!state.conditions.some(c => c.condition === cmd.condition))
              updateTooth(cmd.toothNumber, { conditions: [...state.conditions, { id: `${cmd.condition}-${Date.now()}`, condition: cmd.condition }] })
          }
        })
        setSmartEntry('')
      }
    } catch {} finally { setIsProcessing(false) }
  }

  const selectedState    = selectedTooth ? getToothState(selectedTooth) : null
  const activeTreatable  = selectedState?.conditions.filter(c => ['Caries','Fracture','To be Extracted'].includes(c.condition)) || []

  const renderQuadrant = (teeth: string[], isPatientLeft: boolean, isUpper: boolean) => (
    <div className="flex">
      {teeth.map(n => (
        <ToothSVG key={n} toothNumber={n} state={getToothState(n)} isSelected={selectedTooth === n}
          onSelect={setSelectedTooth} isPatientLeft={isPatientLeft} isUpperQuadrant={isUpper} />
      ))}
    </div>
  )

  const q1 = chartMode === 'adult' ? quadrant1 : childQ1
  const q2 = chartMode === 'adult' ? quadrant2 : childQ2
  const q3 = chartMode === 'adult' ? quadrant3 : childQ3
  const q4 = chartMode === 'adult' ? quadrant4 : childQ4

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* Chart */}
        <div className="flex-1 flex flex-col items-center justify-center p-4 bg-slate-50 dark:bg-white/3 overflow-auto min-h-[200px]">
          <div className="flex items-center gap-1 mb-3 self-start bg-slate-200 dark:bg-white/10 rounded-lg p-0.5">
            {(['adult','child'] as const).map(mode => (
              <button key={mode} onClick={() => { setChartMode(mode); setSelectedTooth(null) }}
                className={cn('px-3 py-1 text-xs font-semibold rounded-md transition-colors',
                  chartMode === mode ? 'bg-white dark:bg-gray-700 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700')}>
                {mode === 'adult' ? 'Adult (32)' : 'Child — Primary (20)'}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto w-full">
            <div className="flex items-center justify-center min-w-max mx-auto">
              {renderQuadrant(q1, false, true)}
              <div className="w-px h-14 bg-slate-300 mx-1" />
              {renderQuadrant(q2, true, true)}
            </div>
            <div className="border-t my-2 border-slate-300 min-w-max" />
            <div className="flex items-center justify-center min-w-max mx-auto">
              {renderQuadrant(q4, false, false)}
              <div className="w-px h-14 bg-slate-300 mx-1" />
              {renderQuadrant(q3, true, false)}
            </div>
          </div>
        </div>

        {/* Inspector */}
        <div className="w-full md:w-72 border-t md:border-t-0 md:border-l border-slate-200 dark:border-white/10 flex flex-col overflow-y-auto bg-white dark:bg-gray-900 max-h-[40vh] md:max-h-none">
          {!selectedTooth ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-4 text-slate-400">
              <Eye size={40} className="mb-2 opacity-30" />
              <p className="font-medium">Select a tooth</p>
              <p className="text-sm">Click any tooth on the chart to view and edit</p>
            </div>
          ) : (
            <>
              <div className="p-4 border-b dark:border-white/10">
                <h3 className="font-bold text-slate-800 dark:text-white">Tooth #{selectedTooth}</h3>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {activeTreatable.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                      <Sparkles size={12} className="text-indigo-500" /> Recommended Actions
                    </h4>
                    {activeTreatable.map(tc => {
                      const recs = services.filter(s =>
                        tc.condition === 'Caries' ? s.name.toLowerCase().includes('fill') :
                        tc.condition === 'Fracture' ? s.name.toLowerCase().includes('crown') :
                        tc.condition === 'To be Extracted' ? s.name.toLowerCase().includes('extract') : false
                      ).slice(0, 2)
                      return (
                        <div key={tc.id} className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-md mb-2">
                          <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">For: <strong>{tc.condition}</strong></p>
                          {recs.length > 0 ? recs.map(r => (
                            <div key={r.id} className="text-xs text-slate-700 dark:text-slate-300 flex items-center gap-1 py-0.5">
                              <Plus size={10} /> {r.name} — {formatUGX(r.priceUGX)}
                            </div>
                          )) : <p className="text-xs text-slate-500">No services matched</p>}
                        </div>
                      )
                    })}
                  </div>
                )}
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Conditions</h4>
                  <div className="grid grid-cols-2 gap-1.5">
                    {conditionTools.map(c => (
                      <button key={c} onClick={() => handleConditionToggle(c)}
                        className={cn('px-2 py-1.5 text-xs rounded text-left transition-colors',
                          selectedState?.conditions.some(tc => tc.condition === c) ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-white/10 hover:bg-slate-200 text-slate-700 dark:text-slate-300')}>
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Surfaces</h4>
                  <div className="space-y-1.5">
                    {(['occlusal','buccal','lingual','mesial','distal'] as Surface[]).map(s => (
                      <div key={s} className="flex items-center justify-between">
                        <span className="capitalize text-xs text-slate-700 dark:text-slate-300">{s}</span>
                        <select value={selectedState?.surfaces[s] || 'Healthy'} onChange={e => handleSurfaceChange(s, e.target.value as SurfaceStatus)}
                          className="text-xs border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded px-1 py-0.5">
                          {surfaceTools.map(st => <option key={st} value={st}>{st}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Notes</h4>
                  <textarea value={selectedState?.notes || ''} onChange={e => updateTooth(selectedTooth, { notes: e.target.value })}
                    placeholder="Tooth-specific notes..."
                    className="w-full text-xs border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded p-2 min-h-[60px] resize-none" />
                </div>
                {selectedState?.history && selectedState.history.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">History</h4>
                    <div className="space-y-1.5 max-h-28 overflow-y-auto">
                      {[...selectedState.history].reverse().slice(0, 5).map((h, i) => (
                        <div key={i} className="border-l-2 border-slate-300 pl-2 text-xs">
                          <p className="text-slate-700 dark:text-slate-300">
                            {h.changeType === 'condition' ? `${h.item} ${h.newStatus}` : `${h.item}: ${h.oldStatus || 'Healthy'} → ${h.newStatus}`}
                          </p>
                          <p className="text-slate-400">{new Date(h.date).toLocaleDateString('en-GB')}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="p-4 border-t dark:border-white/10 bg-white dark:bg-gray-900 space-y-3">
        <div className="bg-slate-50 dark:bg-white/5 p-3 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-slate-800 dark:text-white flex items-center gap-2">
              <Brain size={16} className="text-indigo-600" /> AI Chart Summary
            </h4>
            <button onClick={handleGenerateSummary} disabled={isSummarizing}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:bg-slate-400">
              <Sparkles size={12} /> {isSummarizing ? 'Generating...' : 'Generate'}
            </button>
          </div>
          {isSummarizing && <p className="text-sm text-slate-500 animate-pulse">Analyzing chart...</p>}
          {!isSummarizing && savedAiSummary && <div>{renderMarkdown(savedAiSummary)}</div>}
          {!isSummarizing && !savedAiSummary && <p className="text-sm text-slate-500">Click Generate for an AI summary of this chart.</p>}
        </div>
        <form onSubmit={handleSmartEntry} className="relative">
          <input value={smartEntry} onChange={e => setSmartEntry(e.target.value)} disabled={isProcessing}
            placeholder="e.g. 'Caries on 16 occlusal', 'Missing 38 and 48', 'Crown on 25'"
            className="w-full pl-9 pr-14 py-2.5 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          <Mic size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <button type="submit" disabled={isProcessing || !smartEntry.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs bg-blue-600 text-white rounded disabled:bg-slate-300">
            {isProcessing ? '...' : 'Apply'}
          </button>
        </form>
        <button onClick={handleSave} disabled={isSaving}
          className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-400">
          <Save size={14} /> {isSaving ? 'Saving...' : 'Save Chart'}
        </button>
      </div>
    </div>
  )
}

// ── Perio Chart Tab (full editable — matches doctor view) ─────
function PerioChartTab({ patientId }: { patientId: string }) {
  const [teeth, setTeeth]           = useState<Record<string, ToothState>>({})
  const [aiSummary, setAiSummary]   = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isSaving, setIsSaving]     = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const recognitionRef              = useRef<any>(null)

  useEffect(() => {
    const token = localStorage.getItem('cc_token')
    fetch(`/api-proxy/clinical/patients/${patientId}/dental-chart`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => {
        setTeeth(d.teeth || {})
        if (d.aiPerioSummary) setAiSummary(d.aiPerioSummary)
      }).catch(() => {})
  }, [patientId])

  const updateMeasurement = (tooth: string, site: PerioSite, field: string, value: number | boolean) => {
    setTeeth(prev => {
      const t = prev[tooth] || { conditions: [], surfaces: {}, periodontal: {} }
      return { ...prev, [tooth]: { ...t, periodontal: { ...t.periodontal, [site]: { ...(t.periodontal?.[site] || {}), [field]: value } } } }
    })
  }

  const handleSave = async () => {
    setIsSaving(true)
    const token = localStorage.getItem('cc_token')
    try {
      await fetch(`/api-proxy/clinical/patients/${patientId}/dental-chart`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ periodontal: teeth }),
      })
    } catch {} finally { setIsSaving(false) }
  }

  const handleAISummary = async () => {
    setIsAnalyzing(true)
    const token = localStorage.getItem('cc_token')
    try {
      const res = await fetch(`/api-proxy/clinical/patients/${patientId}/dental-chart/ai-summary`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ chartData: teeth, type: 'perio' }),
      })
      const data = await res.json()
      setAiSummary(data.summary || '')
    } catch {} finally { setIsAnalyzing(false) }
  }

  const startVoiceScribe = () => {
    if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      alert('Voice recognition not supported on this browser'); return
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const recognition = new SR()
    recognition.continuous = false; recognition.interimResults = false; recognition.maxAlternatives = 1; recognition.lang = 'en-US'
    let resultReceived = false
    recognition.onresult = (event: any) => {
      if (resultReceived) return
      resultReceived = true
      setTranscript((prev: string) => {
        const sep = prev && !prev.endsWith(' ') ? ' ' : ''
        return prev + sep + event.results[0][0].transcript
      })
    }
    recognition.onerror = () => setIsRecording(false)
    recognition.onend = () => setIsRecording(false)
    recognitionRef.current = recognition
    setIsRecording(true)
    recognition.start()
    setTimeout(() => { try { recognition.stop() } catch {} }, 10000)
  }

  const stopVoiceScribe = () => {
    try { recognitionRef.current?.stop() } catch {}
    setIsRecording(false)
  }

  const pdColor = (v?: number) => !v ? '' : v >= 6 ? 'text-red-600 font-bold' : v >= 4 ? 'text-yellow-600 font-bold' : 'text-slate-700'

  const renderToothCol = (tooth: string, isUpper: boolean) => {
    const t = teeth[tooth]
    const isMissing = t?.conditions?.some(c => ['Missing','Implant'].includes(c.condition))
    return (
      <div key={tooth} className="w-16 text-center flex-shrink-0 border-r border-slate-200 dark:border-white/10 last:border-r-0">
        {isUpper && <div className="h-5 text-[10px] font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-white/10 flex items-center justify-center border-b border-slate-200">{tooth}</div>}
        {(['db','b','mb'] as PerioSite[]).map(site => (
          <div key={site} className="h-5 border-b border-slate-200 dark:border-white/10 flex items-center justify-center">
            {!isMissing && (
              <input type="text" value={t?.periodontal?.[site]?.pocketDepth ?? ''}
                onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v)) updateMeasurement(tooth, site, 'pocketDepth', v) }}
                className={cn('w-full h-full text-center bg-transparent border-none text-xs p-0 focus:ring-1 focus:ring-blue-500', pdColor(t?.periodontal?.[site]?.pocketDepth))} />
            )}
          </div>
        ))}
        <div className="h-4 flex items-center justify-center gap-0.5">
          {(['db','b','mb'] as PerioSite[]).map(site => (
            <button key={site} onClick={() => updateMeasurement(tooth, site, 'bleeding', !t?.periodontal?.[site]?.bleeding)}
              className={cn('w-2 h-2 rounded-full', t?.periodontal?.[site]?.bleeding ? 'bg-red-500' : 'bg-slate-200')} />
          ))}
        </div>
        {(['dl','l','ml'] as PerioSite[]).map(site => (
          <div key={site} className="h-5 border-b border-slate-200 dark:border-white/10 flex items-center justify-center">
            {!isMissing && (
              <input type="text" value={t?.periodontal?.[site]?.pocketDepth ?? ''}
                onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v)) updateMeasurement(tooth, site, 'pocketDepth', v) }}
                className={cn('w-full h-full text-center bg-transparent border-none text-xs p-0 focus:ring-1 focus:ring-blue-500', pdColor(t?.periodontal?.[site]?.pocketDepth))} />
            )}
          </div>
        ))}
        {!isUpper && <div className="h-5 text-[10px] font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-white/10 flex items-center justify-center border-t border-slate-200">{tooth}</div>}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={isRecording ? stopVoiceScribe : startVoiceScribe}
          className={cn('flex items-center gap-2 px-3 py-2 text-sm font-medium text-white rounded-lg', isRecording ? 'bg-red-500 animate-pulse' : 'bg-blue-600')}>
          {isRecording ? <><MicOff size={14} /> Stop Recording</> : <><Mic size={14} /> Dictate Note</>}
        </button>
        {transcript && <span className="text-sm text-slate-600 dark:text-slate-300 flex-1 truncate">{transcript}</span>}
        <button onClick={handleAISummary} disabled={isAnalyzing}
          className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:bg-slate-400">
          <Brain size={14} /> {isAnalyzing ? 'Analyzing...' : 'AI Analysis'}
        </button>
        <button onClick={handleSave} disabled={isSaving}
          className="flex items-center gap-1 px-3 py-2 text-sm font-medium bg-green-600 text-white rounded-lg disabled:bg-slate-400">
          <Save size={14} /> {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
      {aiSummary && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 p-3 rounded-lg">{renderMarkdown(aiSummary)}</div>
      )}
      <div className="flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Bleeding</span>
        <span className="text-red-600 font-bold">Red = PPD ≥ 6</span>
        <span className="text-yellow-600 font-bold">Yellow = PPD ≥ 4</span>
      </div>
      <div className="overflow-x-auto">
        <p className="text-center text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">Maxillary Arch (Upper)</p>
        <div className="flex border border-slate-200 dark:border-white/10 rounded-lg overflow-hidden w-fit mx-auto">
          <div className="w-14 text-[10px] text-slate-400 text-right pr-1 flex flex-col">
            {['Tooth','DB','B','MB','BOP','DL','L','ML'].map(l => <div key={l} className={l === 'BOP' ? 'h-4 flex items-center justify-end' : 'h-5 flex items-center justify-end'}>{l}</div>)}
          </div>
          {[...quadrant1, ...quadrant2].map(t => renderToothCol(t, true))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <p className="text-center text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">Mandibular Arch (Lower)</p>
        <div className="flex border border-slate-200 dark:border-white/10 rounded-lg overflow-hidden w-fit mx-auto">
          <div className="w-14 text-[10px] text-slate-400 text-right pr-1 flex flex-col">
            {['DL','L','ML','BOP','DB','B','MB','Tooth'].map(l => <div key={l} className={l === 'BOP' ? 'h-4 flex items-center justify-end' : 'h-5 flex items-center justify-end'}>{l}</div>)}
          </div>
          {[...quadrant4.slice().reverse(), ...quadrant3.slice().reverse()].map(t => renderToothCol(t, false))}
        </div>
      </div>
    </div>
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
              <p className="text-xs text-gray-400 dark:text-white/40">{new Date(plan.createdAt).toLocaleDateString('en-GB')}</p>
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

function NotesTab({ patientId, patient }: { patientId: string; patient?: any }) {
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
      const res = await fetch(`${API}/patients/${patientId}/treatment-notes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to save note. Please try again.')
        return
      }
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
                  <span className="text-xs text-gray-400">{new Date(n.createdAt).toLocaleString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
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
                  <p className="text-xs text-gray-400">{new Date(inv.createdAt).toLocaleDateString('en-GB')}</p>
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
                <p className="text-xs text-gray-400 mt-0.5">{new Date(a.createdAt).toLocaleString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}</p>
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
  const [mergeOpen, setMergeOpen]         = useState(false)
  const [mergeSearch, setMergeSearch]     = useState('')
  const [mergeResults, setMergeResults]   = useState<any[]>([])
  const [mergeSource, setMergeSource]     = useState<any>(null)
  const [mergingPatient, setMergingPatient] = useState(false)
  const [mergeError, setMergeError]       = useState('')
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

  const handlePrint = async () => {
    if (!patient) return
    const name   = `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || 'Patient'
    const dob    = patient.dob ? new Date(patient.dob).toLocaleDateString('en-GB') : 'N/A'
    const phone  = patient.phone || 'N/A'
    const origin = window.location.origin
    const token  = localStorage.getItem('cc_token')
    const res    = await fetch(`${API}/clinical/patients/${id}/treatment-notes`, { headers: { Authorization: `Bearer ${token}` } })
    const raw    = res.ok ? await res.json() : []
    const notes: any[] = Array.isArray(raw) ? raw : (raw.data || [])
    const notesHtml = notes.map((note: any) => {
      const date   = new Date(note.createdAt).toLocaleString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
      const author = note.author ? `${note.author.firstName} ${note.author.lastName}` : ''
      const body   = (note.content || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      return `<div class="note"><div class="note-date">${date}${author ? ` &bull; <span class="note-author">${author}</span>` : ''}</div><div class="note-content">${body}</div></div>`
    }).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Patient Notes — ${name}</title>
<style>
body{font-family:Arial,sans-serif;color:#000;background:#fff;margin:0;padding:24px}
.header{text-align:center;border-bottom:2px solid #1A237E;padding-bottom:16px;margin-bottom:24px}
.patient-info{margin-bottom:24px;background:#f8f9fa;padding:12px 16px;border-radius:8px}
.patient-info h2{font-size:18px;font-weight:700;margin:0 0 6px;color:#1A237E}
.patient-info p{font-size:12px;color:#555;margin:2px 0}
.section-title{font-size:12px;font-weight:700;color:#1A237E;text-transform:uppercase;letter-spacing:.5px;margin:20px 0 10px;border-bottom:1px solid #e0e0e0;padding-bottom:4px}
.note{border:1px solid #e0e0e0;border-radius:8px;padding:12px 16px;margin-bottom:12px;page-break-inside:avoid}
.note-date{font-size:11px;color:#888;margin-bottom:6px}.note-author{color:#1A237E;font-weight:600}
.note-content{font-size:13px;line-height:1.6;white-space:pre-wrap}
.empty{color:#aaa;font-size:13px;font-style:italic}
.footer{text-align:center;font-size:10px;color:#555;margin-top:32px;border-top:1px solid #e0e0e0;padding-top:12px}
</style></head><body>
<div class="header"><img src="${origin}/logo.png" alt="Code Clinic" style="height:44px;width:auto;display:block;margin:0 auto 10px"><div style="font-size:12px;color:#555">Patient Treatment Notes</div></div>
<div class="patient-info"><h2>${name}</h2><p>Date of Birth: ${dob}</p><p>Phone: ${phone}</p></div>
<div class="section-title">Treatment Notes (${notes.length})</div>
${notesHtml || '<p class="empty">No notes recorded for this patient.</p>'}
<div class="footer">Code Clinic, Kiira Road, Kamwokya &bull; +256 394 836 298</div>
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();}}</script>
</body></html>`
    const w = window.open('', '_blank', 'width=800,height=900')
    if (w) { w.document.write(html); w.document.close() }
  }

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

  async function searchMergePatients(q: string) {
    if (q.length < 2) { setMergeResults([]); return }
    const token = localStorage.getItem('cc_token')
    const res = await fetch(`${API}/patients?q=${encodeURIComponent(q)}&limit=8`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data = await res.json()
      setMergeResults((data.data || []).filter((p: any) => p.id !== id))
    }
  }

  async function handleMergePatient() {
    if (!mergeSource) return
    setMergingPatient(true)
    setMergeError('')
    try {
      const token = localStorage.getItem('cc_token')
      const res = await fetch(`${API}/patients/${id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sourceId: mergeSource.id }),
      })
      const data = await res.json()
      if (res.ok) {
        setMergeOpen(false)
        router.push('/receptionist/patients')
      } else {
        setMergeError(data.error || 'Failed to merge patients')
      }
    } catch {
      setMergeError('Network error')
    } finally { setMergingPatient(false) }
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

          {/* Print Notes */}
          <button onClick={handlePrint}
            className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-gray-600 dark:text-white/70 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5 transition-all flex-shrink-0">
            <Printer size={14} /> Print
          </button>
          <button
            onClick={() => { setMergeOpen(true); setMergeSearch(''); setMergeResults([]); setMergeSource(null); setMergeError('') }}
            className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-all flex-shrink-0">
            Merge…
          </button>
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
        {tab === 'dental'       && <DentalChartTab patientId={id} />}
        {tab === 'perio'        && <PerioChartTab patientId={id} />}
        {tab === 'treatment'    && <TreatmentTab patientId={id} />}
        {tab === 'notes'        && <NotesTab patientId={id} patient={patient} />}
        {tab === 'billing'      && <BillingTab patientId={id} />}
        {tab === 'documents'    && <DocumentsTab patientId={id} />}
        {tab === 'activity'     && <ActivityTab patientId={id} />}
        {tab === 'timeline'     && <TimelineTab patientId={id} />}
      </div>

      {/* Merge Patient Dialog */}
      {mergeOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => !mergingPatient && setMergeOpen(false)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none">
            <div className="pointer-events-auto w-full max-w-md bg-white dark:bg-[#0f1729] rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 p-6 space-y-4">
              <h3 className="text-base font-black text-amber-700 dark:text-amber-400">Merge Duplicate Patient</h3>
              <p className="text-sm text-gray-500 dark:text-white/60">
                Search for the <span className="font-semibold">duplicate</span> patient to merge into{' '}
                <span className="font-semibold text-gray-700 dark:text-white/80">{patient?.firstName} {patient?.lastName}</span>.
                The duplicate will be deleted and all their records moved here.
              </p>

              {!mergeSource ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={mergeSearch}
                    onChange={e => { setMergeSearch(e.target.value); searchMergePatients(e.target.value) }}
                    placeholder="Search by name or phone…"
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-white dark:bg-white/5 text-gray-700 dark:text-white placeholder-gray-400 dark:placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  />
                  {mergeResults.length > 0 && (
                    <div className="border border-gray-100 dark:border-white/10 rounded-xl overflow-hidden">
                      {mergeResults.map((p: any) => (
                        <button
                          key={p.id}
                          onClick={() => setMergeSource(p)}
                          className="w-full text-left px-4 py-2.5 text-sm hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors border-b border-gray-50 dark:border-white/5 last:border-0">
                          <span className="font-semibold text-gray-700 dark:text-white/80">{p.firstName} {p.lastName}</span>
                          <span className="ml-2 text-xs text-gray-400 dark:text-white/30">{p.phone}</span>
                          {p.patientId && <span className="ml-2 text-xs font-mono text-cyan-600 dark:text-cyan-400">{p.patientId}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {mergeSearch.length >= 2 && mergeResults.length === 0 && (
                    <p className="text-xs text-gray-400 dark:text-white/30 text-center py-2">No patients found</p>
                  )}
                </div>
              ) : (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl px-4 py-3 space-y-1">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">Will be deleted:</p>
                  <p className="text-sm font-bold text-gray-800 dark:text-white">{mergeSource.firstName} {mergeSource.lastName}</p>
                  <p className="text-xs text-gray-500 dark:text-white/50">{mergeSource.phone}{mergeSource.patientId ? ` · ${mergeSource.patientId}` : ''}</p>
                  <button onClick={() => setMergeSource(null)} className="text-xs text-amber-600 dark:text-amber-400 underline mt-1">Change</button>
                </div>
              )}

              {mergeError && (
                <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 rounded-xl px-3 py-2">
                  {mergeError}
                </p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  onClick={handleMergePatient}
                  disabled={!mergeSource || mergingPatient}
                  className="flex-1 py-2.5 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {mergingPatient ? <Loader2 size={14} className="animate-spin" /> : null}
                  {mergingPatient ? 'Merging…' : 'Merge & Delete Duplicate'}
                </button>
                <button
                  onClick={() => setMergeOpen(false)}
                  disabled={mergingPatient}
                  className="px-4 py-2.5 text-sm font-semibold text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/8 rounded-xl transition-colors disabled:opacity-60">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
