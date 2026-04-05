'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Phone, Mail, MapPin, Calendar, User, Edit, Camera, Stethoscope, Receipt, Star } from 'lucide-react'
import { cn, formatPhone, formatUGX, formatKampalaDate } from '@/lib/utils'
import AvatarUpload from '@/components/ui/AvatarUpload'

const STATUS_BADGE: Record<string, string> = {
  CONFIRMED: 'badge-confirmed', PENDING: 'badge-pending',
  COMPLETED: 'badge-completed', CANCELLED: 'badge-cancelled', NO_SHOW: 'badge-no-show',
}

export default function PatientProfilePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [patient, setPatient] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'appointments' | 'invoices' | 'feedback'>('appointments')
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const user = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('cc_user') || '{}') : {}

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/patients/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(setPatient)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-40 bg-gray-200 rounded" />
      <div className="h-48 bg-gray-100 rounded-2xl" />
    </div>
  )

  if (!patient) return (
    <div className="text-center py-20 text-gray-400">
      <User size={40} className="mx-auto mb-3 opacity-30" />
      <p>Patient not found</p>
    </div>
  )

  const initials = `${patient.firstName[0]}${patient.lastName[0]}`

  return (
    <div className="space-y-5 animate-fade-in max-w-5xl">

      {/* Back */}
      <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-gray-500 hover:text-clinic-navy transition-colors">
        <ArrowLeft size={16} /> Back to Patients
      </button>

      {/* ── Hero card ─────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Colour banner */}
        <div className="h-24 bg-gradient-to-r from-clinic-navy to-clinic-blue" />
        <div className="px-6 pb-6 -mt-12">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div className="flex items-end gap-4">
              <AvatarUpload
                userId={patient.id}
                firstName={patient.firstName}
                lastName={patient.lastName}
                currentAvatarUrl={patient.avatarUrl}
                size="xl"
                token={token || undefined}
                onUploaded={(url) => setPatient((p: any) => ({ ...p, avatarUrl: url }))}
              />
              <div className="mb-2">
                <h1 className="text-2xl font-bold text-clinic-navy">{patient.firstName} {patient.lastName}</h1>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full',
                    patient.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  )}>
                    {patient.isActive ? 'Active Patient' : 'Inactive'}
                  </span>
                  {patient.accountBalance > 0 && (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700">
                      Owes {formatUGX(patient.accountBalance)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-sm font-medium text-gray-600 rounded-lg hover:bg-gray-50 transition-colors mb-2">
              <Edit size={14} /> Edit
            </button>
          </div>
        </div>
      </div>

      {/* ── Info + Tabs ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Patient info card */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h3 className="font-semibold text-clinic-navy text-sm">Personal Details</h3>
          {[
            { icon: Phone, label: 'Phone', value: formatPhone(patient.phone) },
            { icon: Mail, label: 'Email', value: patient.email || '—' },
            { icon: MapPin, label: 'Address', value: patient.address || '—' },
            { icon: Calendar, label: 'Date of Birth', value: patient.dob ? new Date(patient.dob).toLocaleDateString('en-UG') : '—' },
            { icon: User, label: 'Gender', value: patient.gender || '—' },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <Icon size={13} className="text-clinic-blue" />
              </div>
              <div>
                <p className="text-xs text-gray-400">{label}</p>
                <p className="text-sm font-medium text-gray-800">{value}</p>
              </div>
            </div>
          ))}

          <div className="pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-400 mb-1">Patient since</p>
            <p className="text-sm font-medium text-gray-800">
              {new Date(patient.createdAt).toLocaleDateString('en-UG', { year: 'numeric', month: 'long' })}
            </p>
          </div>
        </div>

        {/* Tabs: appointments / invoices / feedback */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-gray-100">
            {([
              { key: 'appointments', label: 'Appointments', icon: Stethoscope },
              { key: 'invoices',     label: 'Invoices',     icon: Receipt },
              { key: 'feedback',     label: 'Feedback',     icon: Star },
            ] as const).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={cn(
                  'flex items-center gap-2 px-5 py-3.5 text-sm font-medium transition-colors border-b-2',
                  activeTab === key
                    ? 'border-clinic-blue text-clinic-navy'
                    : 'border-transparent text-gray-400 hover:text-gray-600',
                )}
              >
                <Icon size={14} />
                {label}
                {key === 'appointments' && patient.appointments?.length > 0 && (
                  <span className="bg-clinic-blue text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {patient.appointments.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-4">
            {activeTab === 'appointments' && (
              <div className="space-y-2">
                {(!patient.appointments || patient.appointments.length === 0) ? (
                  <p className="text-sm text-gray-400 text-center py-8">No appointments yet</p>
                ) : patient.appointments.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:bg-blue-50/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: a.service?.colour + '20' }}>
                        <Stethoscope size={14} style={{ color: a.service?.colour }} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{a.service?.name}</p>
                        <p className="text-xs text-gray-400">
                          Dr. {a.doctor?.user?.firstName} {a.doctor?.user?.lastName} · {new Date(a.startAt).toLocaleDateString('en-UG')}
                        </p>
                      </div>
                    </div>
                    <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full', STATUS_BADGE[a.status] || 'badge-pending')}>
                      {a.status.replace('_', ' ')}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'invoices' && (
              <div className="space-y-2">
                {(!patient.invoices || patient.invoices.length === 0) ? (
                  <p className="text-sm text-gray-400 text-center py-8">No invoices yet</p>
                ) : patient.invoices.map((inv: any) => (
                  <div key={inv.id} className="flex items-center justify-between p-3 rounded-xl border border-gray-100">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{inv.invoiceNumber}</p>
                      <p className="text-xs text-gray-400">{new Date(inv.createdAt).toLocaleDateString('en-UG')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-clinic-navy">{formatUGX(inv.totalUGX)}</p>
                      <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full',
                        inv.status === 'PAID' ? 'bg-green-100 text-green-700' :
                        inv.status === 'OVERDUE' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                      )}>
                        {inv.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'feedback' && (
              <div className="space-y-2">
                {(!patient.feedback || patient.feedback.length === 0) ? (
                  <p className="text-sm text-gray-400 text-center py-8">No feedback yet</p>
                ) : patient.feedback.map((f: any) => (
                  <div key={f.id} className="p-3 rounded-xl border border-gray-100">
                    <div className="flex items-center gap-1 mb-1">
                      {Array.from({ length: 5 }, (_, i) => (
                        <Star key={i} size={14} className={i < f.rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'} />
                      ))}
                      <span className="text-xs text-gray-400 ml-1">{new Date(f.submittedAt).toLocaleDateString('en-UG')}</span>
                    </div>
                    {f.comment && <p className="text-sm text-gray-600">{f.comment}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
