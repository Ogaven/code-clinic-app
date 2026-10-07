'use client'

import { useEffect, useState } from 'react'
import { CompactCard, SatisfactionGauge } from './DashboardPrimitives'

interface SatisfactionSummary {
  total: number
  averageRating: number | null
  satisfiedCount: number
  satisfactionPct: number | null
}

export default function PatientSatisfactionCard() {
  const [summary, setSummary] = useState<SatisfactionSummary | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('cc_token')
    if (!token) return
    fetch('/api-proxy/receptionist/patient-satisfaction', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && typeof d.total === 'number') setSummary(d) })
      .catch(() => {})
  }, [])

  const hasFeedback = (summary?.total ?? 0) > 0
  const ratingLabel = hasFeedback && summary?.averageRating != null ? summary.averageRating.toFixed(1) : '—'

  return (
    <CompactCard
      title="Patient Satisfaction"
      action={<span className="rounded-full bg-gray-50 px-2 py-0.5 text-[9px] font-bold text-gray-500 dark:bg-white/5 dark:text-white/40">Code Clinic Feedback</span>}
    >
      <div className="flex items-center justify-between px-1 text-[10px] font-semibold text-gray-400 dark:text-white/25">
        <span>{hasFeedback ? `${summary!.total} rating${summary!.total === 1 ? '' : 's'}` : 'No ratings yet'}</span>
        <span>{hasFeedback && summary?.satisfactionPct != null ? `${summary.satisfactionPct}% satisfied` : ' '}</span>
      </div>
      <SatisfactionGauge pct={summary?.satisfactionPct ?? null} ratingLabel={ratingLabel} />
      <div className="-mt-2 text-center">
        <p className="mx-auto max-w-[210px] text-[10px] font-semibold leading-snug text-gray-500 dark:text-slate-400">
          {hasFeedback
            ? `${summary!.satisfiedCount} patient${summary!.satisfiedCount === 1 ? '' : 's'} rated their visit 4–5 stars`
            : 'Internal post-visit ratings will appear here as patients respond'}
        </p>
        <p className="mt-2 text-[9px] font-medium text-gray-300 dark:text-white/25">Google Reviews remain separate</p>
      </div>
    </CompactCard>
  )
}
