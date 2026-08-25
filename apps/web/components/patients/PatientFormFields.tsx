'use client'

import { cn } from '@/lib/utils'

// Single source of truth for "what does a New Patient form collect" — used
// by BOTH the main Add Patient modal (apps/web/app/(admin)/patients/page.tsx)
// and the booking-flow New Patient section (BookingDrawer.tsx), so the two
// entry points can never drift out of sync again. Same field names, same
// POST /patients contract, same validation, same consent copy/default —
// nothing here changes backend behaviour.

export interface PatientFormValues {
  firstName: string; lastName: string; phone: string; email: string; gender: string; dob: string
  address: string; district: string
  nextOfKinName: string; nextOfKinPhone: string; nextOfKinRelation: string
  allergies: string
  medicalHistory: string[]
  referralSource: string
  patientType: 'NEW' | 'EXISTING'
  consentBotComms: boolean
}

export const EMPTY_PATIENT_FORM: PatientFormValues = {
  firstName: '', lastName: '', phone: '', email: '', gender: 'FEMALE', dob: '',
  address: '', district: '',
  nextOfKinName: '', nextOfKinPhone: '', nextOfKinRelation: '',
  allergies: '',
  medicalHistory: [],
  referralSource: '',
  patientType: 'NEW',
  consentBotComms: true,
}

export const MEDICAL_CONDITIONS = [
  'Diabetes', 'Hypertension', 'Ulcers', 'Heart Disease', 'Asthma',
  'HIV/AIDS', 'Hepatitis B', 'Kidney Disease', 'Blood Disorder',
  'Epilepsy', 'Arthritis', 'Cancer',
]

export const REFERRAL_SOURCES = [
  'Google Search', 'Google Maps', 'Facebook', 'Instagram', 'TikTok',
  'Referred by Friend / Family', 'Referred by Doctor', 'Walk-in', 'Returning Patient', 'Other',
]

const toProperCase = (str: string) => str.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase())

const inputCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all'

// Exact same optional-field-stripping the main form already did inline in
// addPatient() — centralised here so BookingDrawer doesn't have to
// reimplement it. Required fields (firstName/lastName/phone) are validated
// by the caller before calling this, same as before.
export function buildPatientRequestBody(form: PatientFormValues): Record<string, unknown> {
  const body: Record<string, unknown> = { ...form }
  if (!body.email)             delete body.email
  if (!body.dob)               delete body.dob
  if (!body.nextOfKinPhone)    delete body.nextOfKinPhone
  if (!body.nextOfKinName)     delete body.nextOfKinName
  if (!body.nextOfKinRelation) delete body.nextOfKinRelation
  if (!body.allergies)         delete body.allergies
  return body
}

export default function PatientFormFields({ form, setForm }: {
  form: PatientFormValues
  setForm: React.Dispatch<React.SetStateAction<PatientFormValues>>
}) {
  return (
    <div className="space-y-4">
      {/* Basic info */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1">First Name *</label>
          <input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} onBlur={e => setForm(f => ({ ...f, firstName: toProperCase(e.target.value) }))} className={inputCls} placeholder="John" />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1">Last Name *</label>
          <input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} onBlur={e => setForm(f => ({ ...f, lastName: toProperCase(e.target.value) }))} className={inputCls} placeholder="Doe" />
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

      {/* Referral Source */}
      <div className="pt-1">
        <p className="text-[10px] font-black text-gray-400 dark:text-white/30 uppercase tracking-widest mb-2">How did they find us?</p>
        <select value={form.referralSource} onChange={e => setForm(f => ({ ...f, referralSource: e.target.value }))} className={inputCls}>
          <option value="">— Select source —</option>
          {REFERRAL_SOURCES.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Patient Type */}
      <div className="pt-1">
        <p className="text-[10px] font-black text-gray-400 dark:text-white/30 uppercase tracking-widest mb-2">Patient Type</p>
        <div className="flex gap-2">
          {(['NEW', 'EXISTING'] as const).map(type => (
            <button
              key={type}
              type="button"
              onClick={() => setForm(f => ({ ...f, patientType: type }))}
              className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                form.patientType === type
                  ? type === 'NEW'
                    ? 'bg-emerald-500 text-white border-emerald-500'
                    : 'bg-blue-500 text-white border-blue-500'
                  : 'bg-white dark:bg-white/5 text-gray-500 dark:text-white/40 border-gray-200 dark:border-white/10 hover:border-gray-300'
              }`}
            >
              {type === 'NEW' ? 'New Patient' : 'Existing / Old Patient'}
            </button>
          ))}
        </div>
      </div>

      {/* Consent — exact field name, default value, and copy as the main
          New Patient form. Do not edit this block without also editing it
          there; they must stay identical, and this does not itself trigger
          any message — it only sets a flag consumed elsewhere. */}
      <div className="pt-1">
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.consentBotComms}
            onChange={e => setForm(f => ({ ...f, consentBotComms: e.target.checked }))}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
          />
          <span className="text-xs text-gray-600 dark:text-white/60 leading-relaxed">
            Patient consents to receive automated appointment reminders and follow-up messages via WhatsApp. They can opt out at any time by replying STOP.
          </span>
        </label>
      </div>
    </div>
  )
}
