'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Users, ChevronRight } from 'lucide-react'

interface PatientsOverviewCardProps {
  newToday: number
  returningToday: number
  loading: boolean
}

// Total patient count comes straight from GET /patients' pagination envelope
// ({ data, total, limit, offset }) — a single-row fetch (limit=1) just to
// read `total`, no separate count endpoint needed. New/Returning today are
// passed down from the dashboard's existing GET /receptionist/dashboard-stats
// call rather than re-fetched here, so the numbers can never disagree.
export default function PatientsOverviewCard({ newToday, returningToday, loading }: PatientsOverviewCardProps) {
  const [total, setTotal] = useState<number | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('cc_token')
    fetch('/api-proxy/patients?limit=1', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (typeof data?.total === 'number') setTotal(data.total) })
      .catch(() => {})
  }, [])

  return (
    <div className="bg-white dark:bg-white/[0.04] rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-white/8">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#2563eb,#3b82f6)' }}>
            <Users size={13} className="text-white" />
          </div>
          <h3 className="text-sm font-bold text-gray-800 dark:text-white">Patients Overview</h3>
        </div>
        <Link href="/receptionist/patients" className="text-[11px] font-semibold text-cyan-600 dark:text-cyan-400 hover:underline flex items-center gap-0.5">
          All <ChevronRight size={11} />
        </Link>
      </div>
      <div className="grid grid-cols-3 divide-x divide-gray-100 dark:divide-white/8">
        <Stat label="Total Patients" sub="All time" value={total} loading={total === null} />
        <Stat label="New" sub="Today" value={newToday} loading={loading} />
        <Stat label="Returning" sub="Today" value={returningToday} loading={loading} />
      </div>
    </div>
  )
}

function Stat({ label, sub, value, loading }: { label: string; sub: string; value: number | null; loading: boolean }) {
  return (
    <div className="px-4 py-3.5 text-center">
      {loading ? (
        <div className="h-7 w-10 mx-auto bg-gray-100 dark:bg-white/10 rounded-lg animate-pulse" />
      ) : (
        <p className="text-2xl font-black text-gray-800 dark:text-white tabular-nums">{value ?? 0}</p>
      )}
      <p className="text-[11px] font-semibold text-gray-500 dark:text-white/40 mt-1">{label}</p>
      <p className="text-[9px] text-gray-400 dark:text-white/25 uppercase tracking-wide">{sub}</p>
    </div>
  )
}
