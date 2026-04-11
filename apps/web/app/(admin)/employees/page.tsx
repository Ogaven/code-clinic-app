'use client'

import { useEffect, useState } from 'react'
import { Plus, Shield, CheckCircle, XCircle, Mail } from 'lucide-react'
import { cn } from '@/lib/utils'
import AvatarUpload from '@/components/ui/AvatarUpload'

interface Employee {
  id: string; firstName: string; lastName: string; email: string
  role: string; isActive: boolean; lastLogin?: string; avatarUrl?: string | null
  doctor?: { specialisation?: string; colour: string; photoUrl?: string | null }
}

const ROLE_COLOURS: Record<string, string> = {
  ADMIN: '#1A237E', DOCTOR: '#29ABE2', RECEPTIONIST: '#2ECC71', ACCOUNTS: '#F39C12', DEVELOPER: '#9B59B6',
}
const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrator', DOCTOR: 'Doctor', RECEPTIONIST: 'Receptionist', ACCOUNTS: 'Accounts', DEVELOPER: 'Developer',
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  useEffect(() => {
    fetch(`/api-proxy/employees`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(d => setEmployees(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-clinic-navy dark:text-white">Staff List</h2>
          <p className="text-sm text-gray-400 mt-0.5">{employees.length} team members</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-clinic-blue text-white text-sm font-semibold rounded-lg hover:opacity-90">
          <Plus size={16} /> Add Member
        </button>
      </div>

      {/* Grid of staff cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/10 p-5 animate-pulse space-y-3">
              <div className="w-16 h-16 rounded-full bg-gray-200 dark:bg-white/10 mx-auto" />
              <div className="h-4 bg-gray-200 dark:bg-white/10 rounded w-3/4 mx-auto" />
              <div className="h-3 bg-gray-100 dark:bg-white/5 rounded w-1/2 mx-auto" />
            </div>
          ))
        ) : employees.map(emp => (
          <div key={emp.id} className="bg-white dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/10 shadow-sm p-5 flex flex-col items-center text-center hover:shadow-md dark:hover:bg-white/8 transition-shadow group">
            {/* Avatar with upload on hover */}
            <AvatarUpload
              userId={emp.id}
              firstName={emp.firstName}
              lastName={emp.lastName}
              currentAvatarUrl={emp.avatarUrl}
              colour={ROLE_COLOURS[emp.role]}
              size="lg"
              token={token || undefined}
              onUploaded={(url) => setEmployees(es => es.map(e => e.id === emp.id ? { ...e, avatarUrl: url } : e))}
            />

            <h3 className="mt-3 font-bold text-clinic-navy dark:text-white text-sm">
              {emp.role === 'DOCTOR' ? 'Dr. ' : ''}{emp.firstName} {emp.lastName}
            </h3>

            <span className="mt-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full text-white"
              style={{ backgroundColor: ROLE_COLOURS[emp.role] }}>
              {ROLE_LABELS[emp.role]}
            </span>

            {emp.doctor?.specialisation && (
              <p className="text-xs text-gray-400 mt-1 leading-tight">{emp.doctor.specialisation}</p>
            )}

            <div className="flex items-center gap-1 mt-2 text-xs text-gray-400 dark:text-gray-500">
              <Mail size={11} />
              <span className="truncate max-w-[140px]">{emp.email}</span>
            </div>

            {/* Permission dots */}
            <div className="flex items-center gap-1.5 mt-3">
              {['Schedule', 'Patients', 'Finance', 'AI', 'Settings'].map((mod, i) => {
                const hasAccess = emp.role === 'ADMIN' ||
                  (emp.role === 'DOCTOR' && i < 2) ||
                  (emp.role === 'RECEPTIONIST' && i < 2) ||
                  (emp.role === 'ACCOUNTS' && i === 2)
                return (
                  <div key={mod} className={cn('w-2 h-2 rounded-full')} style={{ backgroundColor: hasAccess ? ROLE_COLOURS[emp.role] : '#E5E7EB' }}
                    title={`${mod}: ${hasAccess ? 'Access' : 'No access'}`} />
                )
              })}
            </div>

            {/* Status */}
            <div className={cn('flex items-center gap-1 mt-3 text-xs font-medium',
              emp.isActive ? 'text-green-600' : 'text-gray-400')}>
              {emp.isActive ? <CheckCircle size={12} /> : <XCircle size={12} />}
              {emp.isActive ? 'Active' : 'Inactive'}
            </div>
          </div>
        ))}
      </div>

      {showAdd && (
        <AddEmployeeModal
          onClose={() => setShowAdd(false)}
          onAdded={(e: Employee) => { setEmployees(es => [...es, e]); setShowAdd(false) }}
          token={token}
        />
      )}
    </div>
  )
}

function AddEmployeeModal({ onClose, onAdded, token }: any) {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', role: 'RECEPTIONIST', specialisation: '', colour: '#29ABE2' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api-proxy/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setSuccess(true)
      setTimeout(() => onAdded(data), 1500)
    } catch { setError('Network error') } finally { setLoading(false) }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl animate-fade-in">
          <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-white/10">
            <h2 className="text-lg font-bold text-clinic-navy dark:text-white">Add Team Member</h2>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400">✕</button>
          </div>

          {success ? (
            <div className="px-6 py-10 text-center">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle size={28} className="text-green-600" />
              </div>
              <h3 className="font-bold text-clinic-navy mb-2">Account Created!</h3>
              <p className="text-sm text-gray-500">Login credentials have been sent to <strong>{form.email}</strong></p>
            </div>
          ) : (
            <form onSubmit={submit} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[{ k: 'firstName', l: 'First Name *' }, { k: 'lastName', l: 'Last Name *' }].map(({ k, l }) => (
                  <div key={k}>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">{l}</label>
                    <input value={(form as any)[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} required
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
                  </div>
                ))}
              </div>
              {[{ k: 'email', l: 'Email Address *', t: 'email' }, { k: 'phone', l: 'Phone (+256...)', t: 'tel' }].map(({ k, l, t }) => (
                <div key={k}>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">{l}</label>
                  <input type={t} value={(form as any)[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} required={k === 'email'}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Role *</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue bg-white">
                  {['DOCTOR','RECEPTIONIST','ACCOUNTS','DEVELOPER'].map(r => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
              {form.role === 'DOCTOR' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Specialisation</label>
                    <input value={form.specialisation} onChange={e => setForm(f => ({ ...f, specialisation: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Calendar Colour</label>
                    <input type="color" value={form.colour} onChange={e => setForm(f => ({ ...f, colour: e.target.value }))}
                      className="w-full h-10 rounded-lg border border-gray-200 cursor-pointer" />
                  </div>
                </div>
              )}
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-700">
                A secure password will be auto-generated and emailed to {form.email || 'the new member'}.
              </div>
              {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={loading} className="flex-1 py-2.5 bg-clinic-navy text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-60">
                  {loading ? 'Creating...' : 'Create & Send Credentials'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  )
}
