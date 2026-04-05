'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Search, Plus, Filter, Phone, Mail, ChevronLeft, ChevronRight, User } from 'lucide-react'
import { cn, formatPhone, formatUGX } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'

interface Patient {
  id: string
  firstName: string
  lastName: string
  phone: string
  email?: string
  address?: string
  dob?: string
  gender?: string
  isActive: boolean
  accountBalance: number
  avatarUrl?: string | null
  createdAt: string
}

const GENDER_LABELS: Record<string, string> = { MALE: 'Male', FEMALE: 'Female', OTHER: 'Other' }

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [showAddModal, setShowAddModal] = useState(false)
  const limit = 20
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  const fetchPatients = useCallback(async (q = search, p = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String((p - 1) * limit) })
      if (q) params.set('q', q)
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patients?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setPatients(Array.isArray(data) ? data : data.data || [])
        setTotal(data.total || (Array.isArray(data) ? data.length : 0))
      }
    } finally { setLoading(false) }
  }, [token])

  useEffect(() => { fetchPatients() }, [])

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); fetchPatients(search, 1) }, 350)
    return () => clearTimeout(t)
  }, [search])

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-4 animate-fade-in">

      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-clinic-navy">Patients</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {loading ? '...' : `${total || patients.length} patients`}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-clinic-blue text-white text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity"
        >
          <Plus size={16} />
          Add Patient
        </button>
      </div>

      {/* ── Search + Filter ──────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or phone..."
            className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue focus:bg-white transition-all"
          />
        </div>
        <button className="flex items-center gap-2 px-3 py-2 border border-gray-200 text-gray-500 text-sm rounded-lg hover:bg-gray-50 transition-colors">
          <Filter size={14} />
          Filter
        </button>
      </div>

      {/* ── Table ────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Patient', 'Phone', 'Email', 'Gender', 'Balance', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3.5 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-5 py-4">
                        <div className="h-4 bg-gray-100 rounded animate-pulse w-24" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : patients.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center text-gray-400">
                    <User size={40} className="mx-auto mb-3 opacity-30" />
                    <p>{search ? `No patients found for "${search}"` : 'No patients yet'}</p>
                  </td>
                </tr>
              ) : patients.map((p) => (
                <tr key={p.id} className="hover:bg-blue-50/30 transition-colors cursor-pointer group">
                  <td className="px-5 py-3.5">
                    <Link href={`/patients/${p.id}`} className="flex items-center gap-3">
                      <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl} size="sm" />
                      <span className="text-sm font-medium text-gray-800 group-hover:text-clinic-navy transition-colors">
                        {p.firstName} {p.lastName}
                      </span>
                    </Link>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-1.5 text-sm text-gray-500">
                      <Phone size={12} className="text-gray-300 flex-shrink-0" />
                      {formatPhone(p.phone)}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    {p.email ? (
                      <div className="flex items-center gap-1.5 text-sm text-gray-500">
                        <Mail size={12} className="text-gray-300 flex-shrink-0" />
                        <span className="truncate max-w-[160px]">{p.email}</span>
                      </div>
                    ) : (
                      <span className="text-gray-300 text-sm">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-gray-500">
                    {p.gender ? GENDER_LABELS[p.gender] : '—'}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={cn('text-sm font-semibold', p.accountBalance > 0 ? 'text-red-600' : 'text-green-600')}>
                      {p.accountBalance !== 0 ? formatUGX(Math.abs(p.accountBalance)) : '—'}
                    </span>
                    {p.accountBalance > 0 && <span className="text-xs text-red-400 ml-1">owed</span>}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full',
                      p.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500',
                    )}>
                      {p.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/patients/${p.id}`}
                      className="text-xs text-clinic-blue hover:underline font-medium"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 bg-gray-50">
            <p className="text-sm text-gray-400">
              Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setPage(p => p - 1); fetchPatients(search, page - 1) }}
                disabled={page === 1}
                className="p-1.5 rounded-lg hover:bg-white border border-gray-200 text-gray-500 disabled:opacity-40 transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  onClick={() => { setPage(n); fetchPatients(search, n) }}
                  className={cn('w-8 h-8 rounded-lg text-xs font-semibold transition-colors',
                    page === n ? 'bg-clinic-blue text-white' : 'hover:bg-white border border-gray-200 text-gray-500',
                  )}
                >
                  {n}
                </button>
              ))}
              <button
                onClick={() => { setPage(p => p + 1); fetchPatients(search, page + 1) }}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg hover:bg-white border border-gray-200 text-gray-500 disabled:opacity-40 transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add Patient Modal */}
      {showAddModal && <AddPatientModal onClose={() => setShowAddModal(false)} onAdded={() => { setShowAddModal(false); fetchPatients() }} token={token} />}
    </div>
  )
}

// ── Add Patient Modal ────────────────────────────────────────
function AddPatientModal({ onClose, onAdded, token }: { onClose: () => void; onAdded: () => void; token: string | null }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', email: '', gender: '', dob: '', address: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to create patient'); return }
      onAdded()
    } catch { setError('Network error') } finally { setLoading(false) }
  }

  const field = (key: keyof typeof form, label: string, type = 'text', options?: string[]) => (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
      {options ? (
        <select value={form[key]} onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value }))}
          className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue bg-white">
          <option value="">Select...</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type={type} value={form[key]} onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value }))}
          className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
      )}
    </div>
  )

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl animate-fade-in">
          <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
            <h2 className="text-lg font-bold text-clinic-navy">Add New Patient</h2>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">✕</button>
          </div>
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {field('firstName', 'First Name *')}
              {field('lastName', 'Last Name *')}
            </div>
            {field('phone', 'Phone (+256...) *', 'tel')}
            {field('email', 'Email', 'email')}
            <div className="grid grid-cols-2 gap-3">
              {field('gender', 'Gender', 'text', ['MALE', 'FEMALE', 'OTHER'])}
              {field('dob', 'Date of Birth', 'date')}
            </div>
            {field('address', 'Address')}
            {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={loading} className="flex-1 py-2.5 bg-clinic-blue text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-60">
                {loading ? 'Adding...' : 'Add Patient'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
