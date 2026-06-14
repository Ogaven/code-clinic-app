'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, Shield, CheckCircle, XCircle, Mail, Pencil, UserX, UserCheck, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import AvatarUpload from '@/components/ui/AvatarUpload'

interface Employee {
  id: string; firstName: string; lastName: string; email: string
  role: string; isActive: boolean; lastLogin?: string; avatarUrl?: string | null
  phone?: string
  doctor?: { specialisation?: string; colour: string; photoUrl?: string | null; bookingMode?: string; workingDays?: string }
}

const ROLE_COLOURS: Record<string, string> = {
  ADMIN: '#1A237E', DOCTOR: '#29ABE2', RECEPTIONIST: '#2ECC71', ACCOUNTS: '#F39C12', DEVELOPER: '#9B59B6',
}
const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrator', DOCTOR: 'Doctor', RECEPTIONIST: 'Receptionist', ACCOUNTS: 'Accounts', DEVELOPER: 'Developer',
}

export default function EmployeesPage() {
  const [employees, setEmployees]       = useState<Employee[]>([])
  const [loading, setLoading]           = useState(true)
  const [showAdd, setShowAdd]           = useState(false)
  const [editing, setEditing]           = useState<Employee | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null)
  const [deleteError, setDeleteError]   = useState<string | null>(null)
  const [deleting, setDeleting]         = useState(false)

  // Bulk-delete state
  const [myId, setMyId]                   = useState<string | null>(null)
  const [selected, setSelected]           = useState<Set<string>>(new Set())
  const [showBulkConfirm, setShowBulkConfirm] = useState(false)
  const [bulkDeleting, setBulkDeleting]   = useState(false)
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null)
  const [bulkErrors, setBulkErrors]       = useState<string[]>([])
  const selectAllRef                      = useRef<HTMLInputElement>(null)

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  useEffect(() => {
    // Identify the logged-in user so we can block self-deletion
    try {
      const stored = localStorage.getItem('cc_user')
      if (stored) setMyId(JSON.parse(stored).id ?? null)
    } catch {}

    fetch(`/api-proxy/employees`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(d => setEmployees(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false))
  }, [])

  // Keep the "Select All" checkbox indeterminate when only some are selected
  const selectable  = employees.filter(e => e.id !== myId)
  const allSelected = selectable.length > 0 && selectable.every(e => selected.has(e.id))
  const someSelected = selected.size > 0
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected
    }
  }, [someSelected, allSelected])

  function toggleSelect(id: string) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(selectable.map(e => e.id)))
  }

  function handleUpdated(updated: Employee) {
    setEmployees(es => es.map(e => e.id === updated.id ? { ...e, ...updated } : e))
    setEditing(null)
  }

  async function handleToggleActive(emp: Employee) {
    const newStatus = !emp.isActive
    await fetch(`/api-proxy/employees/${emp.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ isActive: newStatus }),
    })
    setEmployees(es => es.map(e => e.id === emp.id ? { ...e, isActive: newStatus } : e))
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true); setDeleteError(null)
    try {
      const res  = await fetch(`/api-proxy/employees/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) { setDeleteError(data.error || 'Delete failed'); return }
      setEmployees(es => es.filter(e => e.id !== deleteTarget.id))
      setSelected(s => { const n = new Set(s); n.delete(deleteTarget.id); return n })
      setDeleteTarget(null)
    } catch { setDeleteError('Network error') } finally { setDeleting(false) }
  }

  async function handleBulkDelete() {
    setBulkDeleting(true); setBulkDeleteError(null); setBulkErrors([])
    try {
      const res = await fetch('/api-proxy/employees/bulk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: [...selected] }),
      })
      const data = await res.json()
      if (!res.ok) { setBulkDeleteError(data.error || 'Delete failed'); return }

      if (data.deletedIds?.length > 0) {
        setEmployees(es => es.filter(e => !data.deletedIds.includes(e.id)))
        setSelected(s => { const n = new Set(s); data.deletedIds.forEach((id: string) => n.delete(id)); return n })
      }

      if (data.errors?.length > 0) {
        setBulkErrors(data.errors)
        // Keep modal open so the user sees which ones couldn't be deleted
      } else {
        setShowBulkConfirm(false)
        setSelected(new Set())
      }
    } catch { setBulkDeleteError('Network error') } finally { setBulkDeleting(false) }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {!loading && selectable.length > 0 && (
            <label className="flex items-center gap-2 cursor-pointer select-none" title="Select all staff">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded accent-clinic-blue cursor-pointer"
              />
              <span className="text-sm text-gray-500 dark:text-gray-400">Select all</span>
            </label>
          )}
          <div>
            <h2 className="text-2xl font-bold text-clinic-navy dark:text-white">Staff List</h2>
            <p className="text-sm text-gray-400 mt-0.5">{employees.length} team members</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {someSelected && (
            <button
              onClick={() => { setShowBulkConfirm(true); setBulkDeleteError(null); setBulkErrors([]) }}
              className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors">
              <Trash2 size={15} />
              Delete Selected ({selected.size})
            </button>
          )}
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-clinic-blue text-white text-sm font-semibold rounded-lg hover:opacity-90">
            <Plus size={16} /> Add Member
          </button>
        </div>
      </div>

      {/* ── Staff Grid ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/10 p-5 animate-pulse space-y-3">
              <div className="w-16 h-16 rounded-full bg-gray-200 dark:bg-white/10 mx-auto" />
              <div className="h-4 bg-gray-200 dark:bg-white/10 rounded w-3/4 mx-auto" />
              <div className="h-3 bg-gray-100 dark:bg-white/5 rounded w-1/2 mx-auto" />
            </div>
          ))
        ) : employees.map(emp => {
          const isSelf      = emp.id === myId
          const isSelected  = selected.has(emp.id)

          return (
            <div key={emp.id} className={cn(
              'relative rounded-xl border shadow-sm p-5 flex flex-col items-center text-center hover:shadow-md transition-all group',
              emp.isActive
                ? 'bg-white dark:bg-white/5 border-gray-100 dark:border-white/10 dark:hover:bg-white/8'
                : 'bg-gray-50 dark:bg-white/3 border-gray-200 dark:border-white/5 opacity-70',
              isSelected && 'ring-2 ring-clinic-blue border-clinic-blue',
            )}>

              {/* ── Top-left: checkbox (non-self) or shield (self) ─────────── */}
              {isSelf ? (
                <div className="absolute top-3 left-3 z-10" title="You — cannot delete yourself">
                  <Shield size={14} className="text-clinic-blue opacity-60" />
                </div>
              ) : (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(emp.id)}
                  onClick={e => e.stopPropagation()}
                  className="absolute top-3 left-3 z-10 w-4 h-4 rounded accent-clinic-blue cursor-pointer"
                  title="Select for bulk delete"
                />
              )}

              {/* ── Top-right: Edit + Delete (hover) ───────────────────────── */}
              <button
                onClick={() => setEditing(emp)}
                className="absolute top-3 right-3 w-7 h-7 rounded-lg bg-gray-100 dark:bg-white/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-clinic-blue hover:text-white text-gray-500 dark:text-gray-300"
                title="Edit member">
                <Pencil size={13} />
              </button>
              {!isSelf && (
                <button
                  onClick={() => { setDeleteTarget(emp); setDeleteError(null) }}
                  className="absolute top-3 right-11 w-7 h-7 rounded-lg bg-gray-100 dark:bg-white/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 text-gray-500 dark:text-gray-300"
                  title="Delete member">
                  <Trash2 size={13} />
                </button>
              )}

              {/* ── Top-right-3rd: Toggle active (hover) ───────────────────── */}
              <button
                onClick={() => handleToggleActive(emp)}
                className={cn(
                  'absolute top-3 w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 dark:text-gray-300',
                  isSelf ? 'right-11' : 'right-20',
                  emp.isActive
                    ? 'bg-gray-100 dark:bg-white/10 hover:bg-amber-100 hover:text-amber-600 dark:hover:bg-amber-900/30'
                    : 'bg-green-100 dark:bg-green-900/20 hover:bg-green-200 hover:text-green-700',
                )}
                title={emp.isActive ? 'Deactivate' : 'Reactivate'}>
                {emp.isActive ? <UserX size={13} /> : <UserCheck size={13} />}
              </button>

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
                {isSelf && <span className="ml-1 text-[10px] font-normal text-gray-400">(you)</span>}
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
                    <div key={mod} className={cn('w-2 h-2 rounded-full')}
                      style={{ backgroundColor: hasAccess ? ROLE_COLOURS[emp.role] : '#E5E7EB' }}
                      title={`${mod}: ${hasAccess ? 'Access' : 'No access'}`} />
                  )
                })}
              </div>

              <div className={cn('flex items-center gap-1 mt-3 text-xs font-medium',
                emp.isActive ? 'text-green-600' : 'text-gray-400')}>
                {emp.isActive ? <CheckCircle size={12} /> : <XCircle size={12} />}
                {emp.isActive ? 'Active' : 'Inactive'}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Add modal ──────────────────────────────────────────────────────── */}
      {showAdd && (
        <AddEmployeeModal
          onClose={() => setShowAdd(false)}
          onAdded={(e: Employee) => { setEmployees(es => [...es, e]); setShowAdd(false) }}
          token={token}
        />
      )}

      {/* ── Edit modal ─────────────────────────────────────────────────────── */}
      {editing && (
        <EditEmployeeModal
          employee={editing}
          onClose={() => setEditing(null)}
          onSaved={handleUpdated}
          token={token}
        />
      )}

      {/* ── Single delete confirmation modal ───────────────────────────────── */}
      {deleteTarget && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => { setDeleteTarget(null); setDeleteError(null) }} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl animate-fade-in p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                  <Trash2 size={18} className="text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-white text-sm">Delete staff member?</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {deleteTarget.role === 'DOCTOR' ? 'Dr. ' : ''}{deleteTarget.firstName} {deleteTarget.lastName}
                  </p>
                </div>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 leading-relaxed">
                This will permanently delete their account and cannot be undone.
                {deleteTarget.role === 'DOCTOR' && ' If this doctor has appointments, deactivate instead.'}
              </p>
              {deleteError && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400 text-xs rounded-xl px-4 py-3 mb-4 leading-relaxed">
                  {deleteError}
                </div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => { setDeleteTarget(null); setDeleteError(null) }}
                  className="flex-1 py-2.5 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 text-sm rounded-xl hover:bg-gray-50 dark:hover:bg-white/5">
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl disabled:opacity-60 transition-colors">
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Bulk delete confirmation modal ─────────────────────────────────── */}
      {showBulkConfirm && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40"
            onClick={() => { if (!bulkDeleting) { setShowBulkConfirm(false); setBulkErrors([]) } }} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl animate-fade-in p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                  <Trash2 size={18} className="text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-white text-sm">
                    Delete {selected.size} staff member{selected.size !== 1 ? 's' : ''}?
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">This action cannot be undone</p>
                </div>
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 leading-relaxed">
                This will permanently delete{' '}
                <strong>{selected.size} staff member{selected.size !== 1 ? 's' : ''}</strong>{' '}
                and cannot be undone. Doctors with existing appointments will be skipped — deactivate them instead.
              </p>

              {bulkDeleteError && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400 text-xs rounded-xl px-4 py-3 mb-4 leading-relaxed">
                  {bulkDeleteError}
                </div>
              )}

              {bulkErrors.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 text-amber-700 dark:text-amber-400 text-xs rounded-xl px-4 py-3 mb-4 leading-relaxed space-y-1">
                  <p className="font-semibold mb-1">Could not delete:</p>
                  {bulkErrors.map((err, i) => <p key={i}>• {err}</p>)}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => { if (!bulkDeleting) { setShowBulkConfirm(false); setBulkErrors([]) } }}
                  disabled={bulkDeleting}
                  className="flex-1 py-2.5 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 text-sm rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-60">
                  {bulkErrors.length > 0 ? 'Close' : 'Cancel'}
                </button>
                {bulkErrors.length === 0 && (
                  <button
                    onClick={handleBulkDelete}
                    disabled={bulkDeleting}
                    className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl disabled:opacity-60 transition-colors">
                    {bulkDeleting ? 'Deleting…' : `Delete ${selected.size}`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ─── Add Employee Modal ──────────────────────────────────────────────────── */
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

function parseWorkingDays(wd: string | undefined): number[] {
  try { return JSON.parse(wd || '[1,2,3,4,5]') } catch { return [1, 2, 3, 4, 5] }
}

/* ─── Edit Employee Modal ─────────────────────────────────────────────────── */
function EditEmployeeModal({ employee, onClose, onSaved, token }: {
  employee: Employee; onClose: () => void; onSaved: (e: Employee) => void; token: string | null
}) {
  const [form, setForm] = useState({
    firstName:      employee.firstName,
    lastName:       employee.lastName,
    phone:          employee.phone || '',
    role:           employee.role,
    isActive:       employee.isActive,
    specialisation: employee.doctor?.specialisation || '',
    bookingMode:    employee.doctor?.bookingMode || 'OPEN',
    workingDays:    parseWorkingDays(employee.doctor?.workingDays),
  })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      // Update name / phone / status
      const r1 = await fetch(`/api-proxy/employees/${employee.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ firstName: form.firstName, lastName: form.lastName, phone: form.phone, isActive: form.isActive }),
      })
      if (!r1.ok) { setError((await r1.json()).error || 'Update failed'); return }

      // Update role if changed
      if (form.role !== employee.role) {
        const r2 = await fetch(`/api-proxy/employees/${employee.id}/role`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ role: form.role }),
        })
        if (!r2.ok) { setError((await r2.json()).error || 'Role update failed'); return }
      }

      // Update doctor specialisation / bookingMode if applicable
      const isDoctor = form.role === 'DOCTOR' || employee.role === 'DOCTOR'
      const doctorChanged = isDoctor && (
        form.specialisation !== (employee.doctor?.specialisation || '') ||
        form.bookingMode    !== (employee.doctor?.bookingMode    || 'OPEN') ||
        JSON.stringify(form.workingDays) !== (employee.doctor?.workingDays || '[1,2,3,4,5]')
      )
      if (doctorChanged) {
        await fetch(`/api-proxy/employees/${employee.id}/doctor`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ specialisation: form.specialisation, bookingMode: form.bookingMode, workingDays: JSON.stringify(form.workingDays) }),
        })
      }

      onSaved({ ...employee, ...form, doctor: employee.doctor ? { ...employee.doctor, specialisation: form.specialisation, bookingMode: form.bookingMode, workingDays: JSON.stringify(form.workingDays) } : undefined })
    } catch { setError('Network error') } finally { setLoading(false) }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl animate-fade-in">
          <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-white/10">
            <div>
              <h2 className="text-lg font-bold text-clinic-navy dark:text-white">Edit Staff Member</h2>
              <p className="text-xs text-gray-400 mt-0.5">{employee.email}</p>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400">✕</button>
          </div>

          <form onSubmit={submit} className="px-6 py-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[{ k: 'firstName', l: 'First Name' }, { k: 'lastName', l: 'Last Name' }].map(({ k, l }) => (
                <div key={k}>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">{l}</label>
                  <input value={(form as any)[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} required
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
                </div>
              ))}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Phone</label>
              <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="+256..."
                className="w-full px-3 py-2.5 border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Role</label>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className="w-full px-3 py-2.5 border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue">
                {['ADMIN','DOCTOR','RECEPTIONIST','ACCOUNTS','DEVELOPER'].map(r => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>

            {(form.role === 'DOCTOR' || employee.role === 'DOCTOR') && (
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Specialisation</label>
                <select value={form.specialisation} onChange={e => setForm(f => ({ ...f, specialisation: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue">
                  <option value="">— Select specialisation —</option>
                  {['General Dentistry','Orthodontics','Oral Surgery','Periodontics','Endodontics','Paediatric Dentistry','Prosthodontics','Restorative Dentistry','Oral-Systemic Health'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            )}

            {(form.role === 'DOCTOR' || employee.role === 'DOCTOR') && (
              <div className="flex items-center justify-between py-3 px-4 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5">
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Accepts new patients via Sarah</p>
                  <p className="text-xs text-gray-400">{form.bookingMode === 'OPEN' ? 'Sarah can book patients with this doctor' : 'Patients are seen by referral only'}</p>
                </div>
                <button type="button" onClick={() => setForm(f => ({ ...f, bookingMode: f.bookingMode === 'OPEN' ? 'BY_REFERRAL' : 'OPEN' }))}
                  className={cn('relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
                    form.bookingMode === 'OPEN' ? 'bg-green-500' : 'bg-gray-300 dark:bg-white/20')}>
                  <span className={cn('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                    form.bookingMode === 'OPEN' ? 'translate-x-5' : 'translate-x-0')} />
                </button>
              </div>
            )}

            {(form.role === 'DOCTOR' || employee.role === 'DOCTOR') && (
              <div className="py-3 px-4 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Working Days</p>
                <div className="flex gap-1.5 flex-wrap">
                  {(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const).map((label, day) => {
                    const checked = form.workingDays.includes(day)
                    return (
                      <label key={day} className={cn(
                        'flex items-center justify-center w-10 h-8 rounded-lg border text-xs cursor-pointer transition-colors select-none font-medium',
                        checked
                          ? 'border-clinic-blue bg-clinic-blue/10 text-clinic-blue dark:bg-clinic-blue/20'
                          : 'border-gray-200 dark:border-white/10 text-gray-400 hover:border-gray-300',
                      )}>
                        <input type="checkbox" checked={checked} onChange={() => setForm(f => ({
                          ...f,
                          workingDays: checked
                            ? f.workingDays.filter(n => n !== day)
                            : [...f.workingDays, day].sort((a, b) => a - b),
                        }))} className="sr-only" />
                        {label}
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between py-3 px-4 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Account Status</p>
                <p className="text-xs text-gray-400">{form.isActive ? 'This member can log in' : 'Login is disabled'}</p>
              </div>
              <button type="button" onClick={() => setForm(f => ({ ...f, isActive: !f.isActive }))}
                className={cn('relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
                  form.isActive ? 'bg-green-500' : 'bg-gray-300 dark:bg-white/20')}>
                <span className={cn('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                  form.isActive ? 'translate-x-5' : 'translate-x-0')} />
              </button>
            </div>

            {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose}
                className="flex-1 py-2.5 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 text-sm rounded-lg hover:bg-gray-50 dark:hover:bg-white/5">
                Cancel
              </button>
              <button type="submit" disabled={loading}
                className="flex-1 py-2.5 bg-clinic-navy text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-60">
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
