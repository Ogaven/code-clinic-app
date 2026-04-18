'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, AlertCircle } from 'lucide-react'
import LivePatientFlow from '@/components/scheduling/LivePatientFlow'

export default function DoctorFlowPage() {
  const [doctorId, setDoctorId]   = useState<string | null | undefined>(undefined) // undefined = loading
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const token = localStorage.getItem('cc_token')
    const raw   = localStorage.getItem('cc_user')
    if (!token || !raw) { setLoading(false); return }
    const u = JSON.parse(raw)
    try {
      const r = await fetch('/api-proxy/doctors', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) { setError('Could not load doctor records.'); setLoading(false); return }
      const ds = await r.json()
      if (!Array.isArray(ds)) { setError('Unexpected response from doctors API.'); setLoading(false); return }

      // Try userId match first, then email fallback
      let me = ds.find((d: any) => d.userId === u.id)
      if (!me) me = ds.find((d: any) => d.email === u.email || d.user?.email === u.email)

      // null = no match found (show all patients), string = filtered by doctor
      setDoctorId(me?.id ?? null)
    } catch (e) {
      console.error(e)
      setError('Network error — tap retry.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4 p-4 md:p-6 pb-24 md:pb-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link href="/doctor/dashboard"
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
          <ArrowLeft size={16} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800 dark:text-white">Patient Flow</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {loading ? 'Loading…' : doctorId === null ? 'All patients (no doctor record matched)' : 'Your patients currently in the clinic'}
          </p>
        </div>
        <button onClick={load}
          className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 transition-colors">
          <RefreshCw size={15} />
        </button>
      </div>

      {loading && (
        <div className="py-12 text-center">
          <div className="w-8 h-8 rounded-full border-2 border-blue-400 border-t-transparent animate-spin mx-auto" />
          <p className="text-sm text-gray-400 mt-3">Fetching doctor record…</p>
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertCircle size={32} className="text-red-400 opacity-60" />
          <p className="text-sm text-gray-500 dark:text-gray-400">{error}</p>
          <button onClick={load}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition-colors min-h-[44px]">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}

      {/* doctorId === undefined means still loading; null or string means ready */}
      {!loading && !error && doctorId !== undefined && (
        <LivePatientFlow
          doctorId={doctorId ?? undefined}
          refreshInterval={15000}
        />
      )}
    </div>
  )
}
