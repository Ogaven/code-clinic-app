'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import LivePatientFlow from '@/components/scheduling/LivePatientFlow'

export default function DoctorFlowPage() {
  const [doctorId, setDoctorId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const token = localStorage.getItem('cc_token')
    const u     = JSON.parse(localStorage.getItem('cc_user') || '{}')
    if (!token || !u.id) return
    try {
      const r  = await fetch('/api-proxy/doctors', { headers: { Authorization: `Bearer ${token}` } })
      const ds = await r.json()
      const me = Array.isArray(ds) ? ds.find((d: any) => d.userId === u.id) : null
      if (me) setDoctorId(me.id)
    } catch {}
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4 p-4 md:p-6 pb-24 md:pb-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link href="/doctor/dashboard" className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 transition-colors">
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-white">Patient Flow</h1>
          <p className="text-sm text-gray-400 mt-0.5">Your patients currently in the clinic</p>
        </div>
      </div>

      {doctorId
        ? <LivePatientFlow doctorId={doctorId} refreshInterval={15000} />
        : <div className="py-12 text-center text-sm text-gray-400 animate-pulse">Loading…</div>
      }
    </div>
  )
}
