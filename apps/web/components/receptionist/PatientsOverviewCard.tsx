'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Users, ArrowUpRight, TrendingUp, TrendingDown } from 'lucide-react'
import Avatar from '@/components/ui/Avatar'
import InfoTooltip from '@/components/ui/InfoTooltip'
import { cn, kampalaMonthToDateLabel } from '@/lib/utils'
import { CompactCard } from './DashboardPrimitives'

interface DashMetrics { newPatientsThisMonth: number; returningPatientsThisMonth: number }
interface MiniPatient { id: string; firstName: string; lastName: string; avatarUrl?: string | null }
interface DashAvatars { new: MiniPatient[]; returning: MiniPatient[] }
// GET /clinical/analytics/dashboard/trend — same canonical trend endpoint
// Admin uses (apps/web/app/(admin)/dashboard/page.tsx), so a receptionist and
// an admin looking at the same metric on the same day see the same number.
interface MetricTrend { current: number; previous: number; percentChange: number | null }
interface DashTrend {
  totalPatients: MetricTrend; patientsSeen: MetricTrend
  newPatients: MetricTrend; returningPatients: MetricTrend
}

const TOTAL_FILTER = { total: '' } as const

// Matches the Admin dashboard's "Patients Overview" card exactly (see
// apps/web/app/(admin)/dashboard/page.tsx) — same Active/New distribution
// bar, same real avatar groups, same four stats, same real trend badges and
// tooltips. Self-fetches now (rather than taking newToday/returningToday as
// month-agnostic "today" props from the parent) so the numbers are the exact
// same THIS-MONTH cohort Admin shows, from the same GET
// /clinical/analytics/dashboard endpoint (requireAuth only — no role
// restriction) — one canonical backend calculation, not a second
// locally-duplicated one.
export default function PatientsOverviewCard() {
  const [m, setM] = useState<DashMetrics | null>(null)
  const [totalPatients, setTotalPatients] = useState<number | null>(null)
  const [avatars, setAvatars] = useState<Record<string, MiniPatient[]>>({})
  const [trend, setTrend] = useState<DashTrend | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('cc_token')
    const auth = { Authorization: `Bearer ${token}` }

    fetch('/api-proxy/clinical/analytics/dashboard', { headers: auth })
      .then(r => r.ok ? r.json() : null).then(d => {
        if (d?.metrics) setM(d.metrics)
        // Active/New avatar previews come from the dashboard endpoint's own
        // canonical newIds/returningIds (clinical.ts), not a separate
        // /patients?filter=... call — so the faces shown always match the
        // headline MTD number right next to them, same as Admin.
        if (d?.avatars) {
          const a = d.avatars as DashAvatars
          setAvatars(prev => ({ ...prev, returning: a.returning, fresh: a.new }))
        }
      }).catch(() => {})

    fetch('/api-proxy/clinical/analytics/dashboard/trend', { headers: auth })
      .then(r => r.ok ? r.json() : null).then(d => { if (d?.trends) setTrend(d.trends) }).catch(() => {})

    fetch('/api-proxy/patients?limit=1', { headers: auth })
      .then(r => r.ok ? r.json() : null).then(d => { if (d && typeof d.total === 'number') setTotalPatients(d.total) }).catch(() => {})

    Object.entries(TOTAL_FILTER).forEach(([key, filter]) => {
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
        const rangeLabel = kampalaMonthToDateLabel()
        // Same real data as before (no new/fabricated metrics) — reflowed
        // into a 2x2 grid of larger tiles instead of a cramped single row,
        // so the card's real content fills the height the 3x3 grid row
        // stretches it to, rather than leaving a blank lower half.
        const segs = [
          { key: 'total',     label: 'Total Patients',  value: totalPatients, trendKey: 'totalPatients' as const, tooltip: 'All patient records currently registered at Code Clinic.' },
          { key: 'seen',      label: 'Patients Seen',   value: seenCount,     trendKey: 'patientsSeen' as const, tooltip: `Unique patients who attended an appointment from ${rangeLabel}. Equals New Patients + Active Patients.` },
          { key: 'returning', label: 'Active Patients', value: m.returningPatientsThisMonth, trendKey: 'returningPatients' as const, tooltip: `Existing Code Clinic patients who attended from ${rangeLabel}.` },
          { key: 'fresh',     label: 'New Patients',    value: m.newPatientsThisMonth, trendKey: 'newPatients' as const, tooltip: `Patients attending Code Clinic for the first time, from ${rangeLabel}.` },
        ]
        return (
          <div className="flex flex-1 flex-col justify-between gap-4">
            <div>
              <div className="flex items-center justify-between px-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-400 dark:text-white/30">
                <span>Active</span>
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
                const t = trend?.[s.trendKey]
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
                      <p className="flex items-center gap-1 text-[10px] font-medium leading-tight text-gray-500 dark:text-slate-400">
                        {s.label}
                        <InfoTooltip text={s.tooltip} />
                      </p>
                      {/* Real current-MTD-vs-same-day-last-month trend from
                          GET /clinical/analytics/dashboard/trend — same
                          endpoint and definition Admin uses. */}
                      {t && (
                        t.percentChange === null ? (
                          <span className="mt-1 inline-flex items-center gap-0.5 rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-500 dark:bg-blue-400/10 dark:text-blue-400">New</span>
                        ) : (
                          <span className={cn('mt-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold', t.percentChange >= 0 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400' : 'bg-red-50 text-red-500 dark:bg-red-400/10 dark:text-red-400')}>
                            {t.percentChange >= 0 ? <TrendingUp size={9} /> : <TrendingDown size={9} />}{t.percentChange >= 0 ? '+' : ''}{t.percentChange}%
                          </span>
                        )
                      )}
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
