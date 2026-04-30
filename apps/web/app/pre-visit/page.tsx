'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2, AlertCircle, Loader2, Stethoscope } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Suspense } from 'react'

const CONDITIONS = ['Diabetes', 'Hypertension', 'Ulcers', 'Asthma', 'Heart Disease', 'HIV/AIDS']

function PreVisitForm() {
  const params   = useSearchParams()
  const apptId   = params.get('appt')
  const phone    = params.get('phone')

  const [appt, setAppt]       = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [submitted, setSubmit]= useState(false)
  const [error, setError]     = useState('')
  const [saving, setSaving]   = useState(false)

  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: phone || '',
    dob: '', gender: 'FEMALE',
    address: '', district: '',
    nextOfKinName: '', nextOfKinPhone: '', nextOfKinRelation: '',
    allergies: '',
    medicalHistory: [] as string[],
    chiefComplaint: '',
    currentMedications: '',
  })

  useEffect(() => {
    if (!apptId) { setLoading(false); return }
    fetch(`/api-proxy/pre-visit/${apptId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setAppt(data)
          setForm(f => ({
            ...f,
            firstName: data.patient?.firstName || '',
            lastName:  data.patient?.lastName  || '',
            phone:     data.patient?.phone     || phone || '',
            dob:       data.patient?.dob ? data.patient.dob.slice(0, 10) : '',
            gender:    data.patient?.gender    || 'FEMALE',
            address:   data.patient?.address   || '',
            district:  data.patient?.district  || '',
            nextOfKinName:     data.patient?.nextOfKinName     || '',
            nextOfKinPhone:    data.patient?.nextOfKinPhone    || '',
            nextOfKinRelation: data.patient?.nextOfKinRelation || '',
            allergies:         data.patient?.allergies         || '',
            medicalHistory: data.patient?.medicalHistory
              ? data.patient.medicalHistory.split(',').map((s: string) => s.trim()).filter(Boolean)
              : [],
          }))
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [apptId])

  function toggleCondition(cond: string) {
    setForm(f => ({
      ...f,
      medicalHistory: f.medicalHistory.includes(cond)
        ? f.medicalHistory.filter(c => c !== cond)
        : [...f.medicalHistory, cond],
    }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.firstName || !form.lastName || !form.phone) {
      setError('Name and phone number are required.'); return
    }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api-proxy/pre-visit/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, apptId, medicalHistory: form.medicalHistory.join(', ') }),
      })
      if (res.ok) setSubmit(true)
      else { const d = await res.json(); setError(d.error || 'Submission failed, please try again.') }
    } catch { setError('Network error. Please check your connection and try again.') }
    finally { setSaving(false) }
  }

  const inputCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all'
  const labelCls = 'text-xs font-bold text-gray-500 mb-1 block'

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 size={28} className="animate-spin text-cyan-500" />
    </div>
  )

  if (submitted) return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center">
      <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mb-6">
        <CheckCircle2 size={40} className="text-emerald-500" />
      </div>
      <h1 className="text-2xl font-black text-gray-800 mb-2">Thank you!</h1>
      <p className="text-gray-500 max-w-sm">
        Your pre-visit form has been submitted. Our team has your information and will be ready for you.
      </p>
      {appt && (
        <div className="mt-6 bg-cyan-50 border border-cyan-200 rounded-2xl px-6 py-4 text-sm text-cyan-800 max-w-sm">
          <p className="font-bold">{appt.service?.name}</p>
          <p>Dr. {appt.doctor?.user?.firstName} {appt.doctor?.user?.lastName}</p>
          <p>{new Date(appt.startAt).toLocaleString('en-UG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' })}</p>
        </div>
      )}
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-cyan-50/30">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
          <Stethoscope size={16} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-black text-gray-800">Code Clinic</p>
          <p className="text-[10px] text-gray-400">Pre-Visit Health Form</p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5 pb-12">

        {/* Appointment banner */}
        {appt && (
          <div className="bg-white rounded-2xl border border-cyan-200 p-4 shadow-sm">
            <p className="text-[10px] font-black text-cyan-600 uppercase tracking-wider mb-1">Your Appointment</p>
            <p className="font-bold text-gray-800">{appt.service?.name}</p>
            <p className="text-sm text-gray-500">Dr. {appt.doctor?.user?.firstName} {appt.doctor?.user?.lastName} · {new Date(appt.startAt).toLocaleString('en-UG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' })}</p>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          {/* Personal info */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
            <h2 className="text-sm font-black text-gray-700 uppercase tracking-wide">Personal Information</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>First Name *</label>
                <input required value={form.firstName} onChange={e => setForm(f => ({...f, firstName: e.target.value}))} className={inputCls} placeholder="First name" />
              </div>
              <div>
                <label className={labelCls}>Last Name *</label>
                <input required value={form.lastName} onChange={e => setForm(f => ({...f, lastName: e.target.value}))} className={inputCls} placeholder="Last name" />
              </div>
            </div>
            <div>
              <label className={labelCls}>Phone Number *</label>
              <input required value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} className={inputCls} placeholder="e.g. +256700000000" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Gender</label>
                <select value={form.gender} onChange={e => setForm(f => ({...f, gender: e.target.value}))} className={inputCls}>
                  <option value="FEMALE">Female</option>
                  <option value="MALE">Male</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Date of Birth</label>
                <input type="date" value={form.dob} onChange={e => setForm(f => ({...f, dob: e.target.value}))} className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Area / Street</label>
                <input value={form.address} onChange={e => setForm(f => ({...f, address: e.target.value}))} className={inputCls} placeholder="e.g. Kamwokya" />
              </div>
              <div>
                <label className={labelCls}>District</label>
                <input value={form.district} onChange={e => setForm(f => ({...f, district: e.target.value}))} className={inputCls} placeholder="e.g. Kampala" />
              </div>
            </div>
          </div>

          {/* Next of kin */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
            <h2 className="text-sm font-black text-gray-700 uppercase tracking-wide">Next of Kin</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Full Name</label>
                <input value={form.nextOfKinName} onChange={e => setForm(f => ({...f, nextOfKinName: e.target.value}))} className={inputCls} placeholder="Name" />
              </div>
              <div>
                <label className={labelCls}>Phone</label>
                <input value={form.nextOfKinPhone} onChange={e => setForm(f => ({...f, nextOfKinPhone: e.target.value}))} className={inputCls} placeholder="Contact" />
              </div>
            </div>
            <div>
              <label className={labelCls}>Relationship</label>
              <select value={form.nextOfKinRelation} onChange={e => setForm(f => ({...f, nextOfKinRelation: e.target.value}))} className={inputCls}>
                <option value="">Select...</option>
                <option>Spouse</option><option>Parent</option><option>Child</option>
                <option>Sibling</option><option>Friend</option><option>Guardian</option><option>Other</option>
              </select>
            </div>
          </div>

          {/* Medical history */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
            <h2 className="text-sm font-black text-gray-700 uppercase tracking-wide">Medical Information</h2>
            <div>
              <label className={labelCls}>Known Allergies</label>
              <input value={form.allergies} onChange={e => setForm(f => ({...f, allergies: e.target.value}))} className={inputCls} placeholder="e.g. Penicillin, Latex (leave blank if none)" />
            </div>
            <div>
              <label className={labelCls}>Medical Conditions (select all that apply)</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {CONDITIONS.map(cond => (
                  <button key={cond} type="button" onClick={() => toggleCondition(cond)}
                    className={cn('px-3 py-1.5 rounded-xl text-xs font-bold transition-all border',
                      form.medicalHistory.includes(cond)
                        ? 'bg-cyan-500 text-white border-cyan-500'
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-cyan-300')}>
                    {cond}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={labelCls}>Current Medications</label>
              <textarea rows={2} value={form.currentMedications} onChange={e => setForm(f => ({...f, currentMedications: e.target.value}))} className={cn(inputCls, 'resize-none')} placeholder="List any medications you are currently taking..." />
            </div>
            <div>
              <label className={labelCls}>Reason for Visit / Chief Complaint</label>
              <textarea rows={2} value={form.chiefComplaint} onChange={e => setForm(f => ({...f, chiefComplaint: e.target.value}))} className={cn(inputCls, 'resize-none')} placeholder="What brings you in today?" />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              <AlertCircle size={15} /> {error}
            </div>
          )}

          <button type="submit" disabled={saving}
            className="w-full py-3.5 rounded-2xl text-sm font-black text-white disabled:opacity-60 transition-all hover:-translate-y-0.5 hover:shadow-lg"
            style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
            {saving ? <><Loader2 size={14} className="inline animate-spin mr-2" />Submitting...</> : 'Submit Pre-Visit Form'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function PreVisitPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 size={28} className="animate-spin text-cyan-500" />
      </div>
    }>
      <PreVisitForm />
    </Suspense>
  )
}
