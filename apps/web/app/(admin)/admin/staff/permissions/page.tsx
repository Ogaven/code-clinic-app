'use client'

import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, Save, Shield, Check } from 'lucide-react'

const FEATURES = [
  { key: 'scheduling',         label: 'Scheduling' },
  { key: 'appointments',       label: 'Appointments' },
  { key: 'patients',           label: 'Patients' },
  { key: 'leads',              label: 'Leads' },
  { key: 'liveFlow',           label: 'Live Flow' },
  { key: 'aiSuiteInbox',       label: 'AI Suite — Inbox' },
  { key: 'aiSuiteFollowup',    label: 'AI Suite — Follow-up' },
  { key: 'aiSuiteConfirmation',label: 'AI Suite — Confirmations' },
  { key: 'callLogs',           label: 'AI Suite — Call Logs' },
  { key: 'voiceStudio',        label: 'AI Suite — Voice Studio' },
  { key: 'knowledgeBase',      label: 'AI Suite — Knowledge Base' },
  { key: 'reports',            label: 'Reports' },
  { key: 'communications',     label: 'Communications' },
  { key: 'accounts',           label: 'Accounts' },
  { key: 'auditLog',           label: 'Audit Log' },
]

const ROLE_COLORS: Record<string, string> = {
  ADMIN:        'bg-purple-100 text-purple-700',
  DOCTOR:       'bg-blue-100 text-blue-700',
  RECEPTIONIST: 'bg-emerald-100 text-emerald-700',
  ACCOUNTS:     'bg-amber-100 text-amber-700',
  DEVELOPER:    'bg-slate-100 text-slate-600',
}

type StaffUser = {
  id: string
  firstName: string
  lastName: string
  email: string
  role: string
  permissions: string | null
}

function parsePerms(raw: string | null): Record<string, boolean> {
  try { return JSON.parse(raw || '{}') } catch { return {} }
}

export default function StaffPermissionsPage() {
  const [users,    setUsers]    = useState<StaffUser[]>([])
  const [loading,  setLoading]  = useState(true)
  const [perms,    setPerms]    = useState<Record<string, Record<string, boolean>>>({})
  const [saving,   setSaving]   = useState<string | null>(null)
  const [saved,    setSaved]    = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const token = localStorage.getItem('cc_token')
    try {
      const res = await fetch('/api-proxy/staff/permissions', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data: StaffUser[] = await res.json()
      setUsers(data)
      const initial: Record<string, Record<string, boolean>> = {}
      for (const u of data) {
        const p = parsePerms(u.permissions)
        initial[u.id] = {}
        for (const f of FEATURES) {
          initial[u.id][f.key] = p[f.key] !== false
        }
      }
      setPerms(initial)
    } catch {/* ignore */} finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = (userId: string, featureKey: string) => {
    setPerms(prev => ({
      ...prev,
      [userId]: { ...prev[userId], [featureKey]: !prev[userId]?.[featureKey] },
    }))
  }

  const save = async (userId: string) => {
    setSaving(userId)
    const token = localStorage.getItem('cc_token')
    try {
      await fetch(`/api-proxy/staff/${userId}/permissions`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify(perms[userId] || {}),
      })
      setSaved(userId)
      setTimeout(() => setSaved(s => s === userId ? null : s), 2000)
    } catch {/* ignore */} finally { setSaving(null) }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-2">
            <Shield size={22} className="text-cyan-500" /> Staff Permissions
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Control which features each staff member can access</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-white hover:bg-gray-200 dark:hover:bg-white/20 disabled:opacity-50 transition-all">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : users.length === 0 ? (
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-12 text-center">
          <Shield size={36} className="text-gray-200 dark:text-white/10 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No staff members found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {users.map(user => (
            <div key={user.id} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
              {/* Staff member header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50 dark:border-white/8">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                    {user.firstName[0]}{user.lastName[0]}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{user.firstName} {user.lastName}</p>
                    <p className="text-xs text-gray-400">{user.email}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ROLE_COLORS[user.role] || 'bg-gray-100 text-gray-500'}`}>
                    {user.role}
                  </span>
                </div>
                <button onClick={() => save(user.id)} disabled={saving === user.id}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-all"
                  style={{ background: saved === user.id ? '#10b981' : 'linear-gradient(135deg,#29ABE2,#1A237E)' }}>
                  {saving === user.id
                    ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : saved === user.id
                      ? <><Check size={14} /> Saved</>
                      : <><Save size={14} /> Save</>}
                </button>
              </div>

              {/* Feature toggles */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-px bg-gray-50 dark:bg-white/5">
                {FEATURES.map(f => {
                  const enabled = perms[user.id]?.[f.key] !== false
                  return (
                    <button key={f.key} onClick={() => toggle(user.id, f.key)}
                      className="flex items-center justify-between p-3 bg-white dark:bg-[#0e1f4d] hover:bg-gray-50 dark:hover:bg-white/5 transition-colors text-left gap-2">
                      <span className="text-xs font-medium text-gray-700 dark:text-white/80 leading-tight">{f.label}</span>
                      <div className={`flex-shrink-0 w-9 h-5 rounded-full relative transition-colors ${enabled ? 'bg-cyan-500' : 'bg-gray-200 dark:bg-white/10'}`}>
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${enabled ? 'left-4' : 'left-0.5'}`} />
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
