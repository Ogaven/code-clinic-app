'use client'

import { useState, useEffect } from 'react'
import { Users, UserCheck, Link2, X, Search, ChevronRight } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface Props {
  patient: any
  token: string | null
  onUpdate: () => void
  basePath: string  // '/admin/patients' or '/receptionist/patients'
}

export default function GuardianSection({ patient, token, onUpdate, basePath }: Props) {
  const router = useRouter()
  const [linkOpen, setLinkOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [relationship, setRelationship] = useState<string>('child')
  const [isMinor, setIsMinor] = useState(false)

  useEffect(() => {
    if (!search.trim()) { setResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api-proxy/patients?q=${encodeURIComponent(search)}&limit=10`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          const data = await res.json()
          setResults((data.data || []).filter((p: any) => p.id !== patient.id))
        }
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [search, token, patient.id])

  const linkGuardian = async (guardianId: string) => {
    setSaving(true)
    try {
      await fetch(`/api-proxy/patients/${patient.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ guardianId, relationship, isMinor }),
      })
      setLinkOpen(false)
      setSearch('')
      setResults([])
      onUpdate()
    } finally {
      setSaving(false)
    }
  }

  const unlinkGuardian = async () => {
    if (!confirm('Remove guardian link for this patient?')) return
    setSaving(true)
    try {
      await fetch(`/api-proxy/patients/${patient.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ guardianId: null, isMinor: false, relationship: null }),
      })
      onUpdate()
    } finally {
      setSaving(false)
    }
  }

  const hasGuardian = !!patient.guardian
  const hasDependents = patient.dependents && patient.dependents.length > 0

  return (
    <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-700/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-600 flex items-center gap-1.5">
          <Users size={13} /> Family / Guardian
        </p>
        {!hasGuardian && (
          <button onClick={() => setLinkOpen(!linkOpen)}
            className="text-xs text-emerald-600 hover:text-emerald-800 dark:hover:text-emerald-300 font-semibold flex items-center gap-1 transition-colors">
            <Link2 size={11} /> Link guardian
          </button>
        )}
      </div>

      {/* This patient has a guardian */}
      {hasGuardian && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-emerald-500 mb-0.5">Primary Contact / Guardian</p>
            <button onClick={() => router.push(`${basePath}/${patient.guardian.id}`)}
              className="text-sm font-semibold text-emerald-800 dark:text-emerald-200 hover:underline flex items-center gap-1">
              <UserCheck size={13} />
              {patient.guardian.firstName} {patient.guardian.lastName}
              <ChevronRight size={12} />
            </button>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
              {patient.guardian.phone}
              {patient.relationship && ` · ${patient.relationship}`}
              {patient.isMinor && ' · minor'}
            </p>
          </div>
          <button onClick={unlinkGuardian} disabled={saving}
            className="text-xs text-red-400 hover:text-red-600 p-1 disabled:opacity-50">
            <X size={14} />
          </button>
        </div>
      )}

      {/* This patient IS a guardian — show dependents */}
      {hasDependents && (
        <div>
          <p className="text-[10px] text-emerald-500 mb-1.5">
            Dependents ({patient.dependents.length})
          </p>
          <div className="space-y-1.5">
            {patient.dependents.map((dep: any) => (
              <button key={dep.id} onClick={() => router.push(`${basePath}/${dep.id}`)}
                className="w-full flex items-center justify-between px-3 py-2 bg-white dark:bg-white/5 rounded-lg border border-emerald-100 dark:border-emerald-700/20 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-800 text-emerald-700 dark:text-emerald-100 text-[10px] font-bold flex items-center justify-center shrink-0">
                    {dep.firstName[0]}{dep.lastName[0]}
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-semibold text-slate-800 dark:text-white">
                      {dep.firstName} {dep.lastName}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {dep.relationship || 'dependent'}{dep.isMinor ? ' · minor' : ''}
                      {dep.accountBalance > 0 && (
                        <span className="ml-1 text-red-500">· UGX {dep.accountBalance.toLocaleString()} owing</span>
                      )}
                    </p>
                  </div>
                </div>
                <ChevronRight size={12} className="text-slate-400 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* No family link */}
      {!hasGuardian && !hasDependents && !linkOpen && (
        <p className="text-xs text-emerald-600/60 dark:text-emerald-400/60 italic">No family account linked.</p>
      )}

      {/* Link guardian search UI */}
      {linkOpen && (
        <div className="space-y-2 pt-1 border-t border-emerald-100 dark:border-emerald-700/30 mt-1">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-emerald-600 mb-1">Relationship</label>
              <select value={relationship} onChange={e => setRelationship(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-emerald-200 dark:border-emerald-700 dark:bg-gray-800 dark:text-white rounded-lg focus:ring-1 focus:ring-emerald-400 focus:outline-none">
                <option value="child">Child</option>
                <option value="spouse">Spouse</option>
                <option value="dependent">Dependent</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="flex items-end pb-1.5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={isMinor} onChange={e => setIsMinor(e.target.checked)}
                  className="w-3.5 h-3.5 accent-emerald-500" />
                <span className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">Is Minor</span>
              </label>
            </div>
          </div>
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-2.5 text-emerald-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search guardian by name or phone..."
              className="w-full pl-7 pr-3 py-2 text-xs border border-emerald-200 dark:border-emerald-700 dark:bg-gray-800 dark:text-white rounded-lg focus:ring-1 focus:ring-emerald-400 focus:outline-none" />
          </div>
          {searching && <p className="text-[10px] text-emerald-500 animate-pulse">Searching...</p>}
          {results.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {results.map((r: any) => (
                <button key={r.id} onClick={() => linkGuardian(r.id)} disabled={saving}
                  className="w-full flex items-center justify-between px-3 py-2 bg-white dark:bg-white/5 rounded-lg border border-emerald-100 dark:border-emerald-700/20 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-left transition-colors disabled:opacity-50">
                  <div>
                    <p className="text-xs font-semibold text-slate-800 dark:text-white">{r.firstName} {r.lastName}</p>
                    <p className="text-[10px] text-slate-400">{r.phone}</p>
                  </div>
                  <span className="text-[10px] text-emerald-600 font-bold shrink-0">Set as guardian →</span>
                </button>
              ))}
            </div>
          )}
          <button onClick={() => { setLinkOpen(false); setSearch(''); setResults([]) }}
            className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
