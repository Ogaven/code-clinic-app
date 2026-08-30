'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Users, ArrowUpRight } from 'lucide-react'
import Avatar from '@/components/ui/Avatar'
import { CompactCard } from './DashboardPrimitives'

interface DashMetrics { newPatientsThisMonth: number; returningPatientsThisMonth: number }
interface MiniPatient { id: string; firstName: string; lastName: string; avatarUrl?: string | null }

const CATEGORY_FILTERS = { total: '', returning: 'returning', fresh: 'new_patient' } as const

// Matches the Admin dashboard's "Patients Overview" card exactly (see
// apps/web/app/(admin)/dashboard/page.tsx) — same Returning/New distribution
// bar, same real avatar groups, same four stats. Self-fetches now (rather
// than taking newToday/returningToday as month-agnostic "today" props from
// the parent) so the numbers are the exact same THIS-MONTH cohort Admin
// shows, from the same GET /clinical/analytics/dashboard endpoint
// (requireAuth only — no role restriction).
export default function PatientsOverviewCard() {
  const [m, setM] = useState<DashMetrics | null>(null)
  const [totalPatients, setTotalPatients] = useState<number | null>(null)
  const [avatars, setAvatars] = useState<Record<string, MiniPatient[]>>({})

  useEffect(() => {
    const token = localStorage.getItem('cc_token')
    const auth = { Authorization: `Bearer ${token}` }

    fetch('/api-proxy/clinical/analytics/dashboard', { headers: auth })
      .then(r => r.ok ? r.json() : null).then(d => { if (d?.metrics) setM(d.metrics) }).catch(() => {})

    fetch('/api-proxy/patients?limit=1', { headers: auth })
      .then(r => r.ok ? r.json() : null).then(d => { if (d && typeof d.total === 'number') setTotalPatients(d.total) }).catch(() => {})

    Object.entries(CATEGORY_FILTERS).forEach(([key, filter]) => {
      const qs = filter ? `filter=${filter}&limit=3` : 'limit=3'
      fetch(`/api-proxy/patients?${qs}`, { headers: auth })
        .then(r => r.ok ? r.json() : null)
        .then(d => { const rows = Array.isArray(d) ? d : d?.data; if (Array.isArray(rows)) setAvatars(prev => ({ ...prev, [key]: rows })) })
        .catch(() => {})
    })
  }, [])

  return (
    <CompactCard
      title="Patients Overview"
      action={<Link href="/receptionist/patients" className="text-[11px] font-bold text-clinic-blue hover:underline dark:text-cyan-400">View all patients</Link>}
      className="flex h-full flex-col"
    >
      {!m ? (
        <div className="h-32 animate-pulse rounded-xl bg-gray-50 dark:bg-white/5" />
      ) : (() => {
        const seenCount = m.newPatientsThisMonth + m.returningPatientsThisMonth
        const barTotal = Math.max(totalPatients ?? seenCount, 1)
        // Same real data as before (no new/fabricated metrics) — reflowed
        // into a 2x2 grid of larger tiles instead of a cramped single row,
        // so the card's real content fills the height the 3x3 grid row
        // stretches it to, rather than leaving a blank lower half.
        const segs = [
          { key: 'total',     label: 'Total Patients', value: totalPatients },
          { key: 'seen',      label: 'Patients Seen',  value: seenCount },
          { key: 'returning', label: 'Returning',      value: m.returningPatientsThisMonth },
          { key: 'fresh',     label: 'New Patients',   value: m.newPatientsThisMonth },
        ]
        return (
          <div className="flex flex-1 flex-col justify-between gap-4">
            <div>
              <div className="flex items-center justify-between px-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-400 dark:text-white/30">
                <span>Returning</span>
                <span>New</span>
              </div>
              <div className="mt-1.5 flex h-3 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
                <div style={{ width: `${(m.returningPatientsThisMonth / barTotal) * 100}%`, background: '#10B981' }} />
                <div style={{ width: `${(m.newPatientsThisMonth / barTotal) * 100}%`, background: '#F59E0B' }} />
              </div>
            </div>

            <div className="grid flex-1 grid-cols-2 gap-3">
              {segs.map(s => {
                const people = avatars[s.key] ?? []
                return (
                  <div key={s.key} className="flex flex-col justify-between rounded-xl bg-gray-50 p-3.5 dark:bg-white/[0.04]">
                    <div className="flex items-center">
                      <div className="flex -space-x-2">
                        {people.length > 0 ? people.slice(0, 3).map(p => (
                          <Avatar key={p.id} firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl} size="sm" />
                        )) : <span className="grid h-8 w-8 place-items-center rounded-full bg-gray-100 text-gray-300 dark:bg-white/10"><Users size={13} /></span>}
                      </div>
                      <span className="ml-auto grid h-6 w-6 flex-shrink-0 place-items-center rounded-full bg-white text-gray-400 shadow-sm dark:bg-white/10 dark:text-white/30"><ArrowUpRight size={12} /></span>
                    </div>
                    <div className="mt-3">
                      <p className="text-2xl font-extrabold leading-tight text-clinic-navy dark:text-white">{s.value !== null ? s.value.toLocaleString() : '—'}</p>
                      <p className="text-[10px] font-medium leading-tight text-gray-500 dark:text-slate-400">{s.label}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}
    </CompactCard>
  )
}
