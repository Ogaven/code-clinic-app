'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'

type Period = 'today' | 'week' | 'month' | 'year' | 'all'
type Funnel = {
  leadCount: number
  contactedCount: number
  qualifiedCount: number
  convertedCount: number
  bookedCount: number
  payingClientCount: number
}
type Report = {
  funnel: Funnel
  revenue: { collectedUGX: number }
  ambiguousPatientCount: number
}

const PERIODS: Array<{ key: Period; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
  { key: 'all', label: 'All Time' },
]

function dateQuery(period: Period) {
  if (period === 'all') return ''
  const now = new Date()
  const local = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Kampala' }))
  let start = new Date(local)
  start.setHours(0, 0, 0, 0)
  if (period === 'week') {
    const day = start.getDay()
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1))
  } else if (period === 'month') {
    start.setDate(1)
  } else if (period === 'year') {
    start.setMonth(0, 1)
  }
  const offsetMs = 3 * 60 * 60 * 1000
  const startUtc = new Date(start.getTime() - offsetMs)
  return new URLSearchParams({ dateFrom: startUtc.toISOString(), dateTo: now.toISOString() }).toString()
}

function formatUGX(value: number) {
  return new Intl.NumberFormat('en-UG', { style: 'currency', currency: 'UGX', maximumFractionDigits: 0 }).format(value)
}

export default function GrowthCrmCard() {
  const [period, setPeriod] = useState<Period>('month')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('cc_token')
    if (!token) return
    const query = dateQuery(period)
    setLoading(true)
    fetch(`/api-proxy/crm-automation/reports/acquisition-revenue${query ? `?${query}` : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => setReport(d?.funnel ? d : null))
      .catch(() => setReport(null))
      .finally(() => setLoading(false))
  }, [period])

  const f = report?.funnel
  const rate = (value?: number) => f && f.leadCount > 0 && value !== undefined
    ? `${((value / f.leadCount) * 100).toFixed(1)}%`
    : '—'

  return (
    <div className="flex flex-col justify-between rounded-2xl p-4 text-white shadow-sm" style={{ background: 'linear-gradient(135deg,#0c1e50,#1A237E 45%,#29ABE2)' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-blue-100">Growth &amp; CRM</p>
          <p className="mt-0.5 text-[9px] text-blue-200/70">Lead to contact to appointment to payment</p>
        </div>
        <Link href="/receptionist/leads" className="flex shrink-0 items-center gap-1 text-[10px] font-bold text-white/90 hover:underline">
          Open CRM <ArrowUpRight size={12} />
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap gap-1" aria-label="CRM reporting period">
        {PERIODS.map(p => (
          <button key={p.key} type="button" onClick={() => setPeriod(p.key)}
            className={`rounded-full px-2 py-1 text-[9px] font-bold transition ${period === p.key ? 'bg-white text-[#1A237E]' : 'bg-white/10 text-blue-100 hover:bg-white/20'}`}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="my-2.5 grid grid-cols-2 gap-1.5">
        {[
          { label: 'Leads', value: f?.leadCount },
          { label: 'Contacted', value: f?.contactedCount },
          { label: 'Qualified', value: f?.qualifiedCount },
          { label: 'Appointments', value: f?.bookedCount },
          { label: 'Converted', value: f?.convertedCount },
          { label: 'Paying Clients', value: f?.payingClientCount },
        ].map(item => (
          <div key={item.label} className="rounded-xl bg-white/10 px-2.5 py-2">
            <p className="text-[9px] font-medium text-blue-100">{item.label}</p>
            <p className="mt-0.5 text-base font-extrabold text-white">{loading ? '—' : (item.value ?? 0)}</p>
          </div>
        ))}
      </div>

      <div className="space-y-1 border-t border-white/15 pt-2 text-[9px] text-blue-100">
        <div className="flex justify-between gap-3"><span>Contact rate</span><strong className="text-white">{loading ? '—' : rate(f?.contactedCount)}</strong></div>
        <div className="flex justify-between gap-3"><span>Lead to appointment</span><strong className="text-white">{loading ? '—' : rate(f?.bookedCount)}</strong></div>
        <div className="flex justify-between gap-3"><span>Lead to paying client</span><strong className="text-white">{loading ? '—' : rate(f?.payingClientCount)}</strong></div>
        <div className="flex justify-between gap-3"><span>Collected from these leads</span><strong className="text-white">{loading || !report ? '—' : formatUGX(report.revenue.collectedUGX)}</strong></div>
      </div>
      <p className="mt-1.5 text-[8px] leading-tight text-blue-200/70">Period filters when leads entered CRM. Collected is lifetime payment from those attributed patients.</p>
      {!!report?.ambiguousPatientCount && <p className="mt-1 text-[8px] text-amber-200">{report.ambiguousPatientCount} ambiguous patient link(s) excluded.</p>}
    </div>
  )
}
