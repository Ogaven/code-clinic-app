'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { TrendingUp, ChevronRight, UserPlus } from 'lucide-react'

interface Lead { id: string; status: string; createdAt: string; updatedAt: string }

const DAY_MS = 24 * 60 * 60 * 1000

// All figures come from GET /crm/leads (the same endpoint the Leads page
// itself uses — requireAuth only, no role restriction, so Receptionist gets
// the real list). Treatment Pipeline, Referrals and Campaigns are left out
// here on purpose: Receptionist has no page for any of them (Admin-layout
// redirects Receptionist away from /treatment-pipeline, /referrals,
// /campaigns), so a "Growth & CRM" metric for them would have nowhere
// honest to link to. See the task report for the full permission mapping.
//
// "Converted" uses Lead.updatedAt as a proxy for conversion date — there is
// no dedicated convertedAt field on the Lead model, and status flips to
// CONVERTED via POST /crm/leads/:id/convert, which touches updatedAt via
// Prisma's @updatedAt. It's the closest real signal, not a fabricated one.
export default function GrowthCrmCard() {
  const [leads, setLeads] = useState<Lead[] | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('cc_token')
    fetch('/api-proxy/crm/leads', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then(data => setLeads(Array.isArray(data) ? data : []))
      .catch(() => setLeads([]))
  }, [])

  const now = Date.now()
  const newLeads7d    = leads?.filter(l => now - new Date(l.createdAt).getTime() <= 7 * DAY_MS).length ?? null
  const converted30d  = leads?.filter(l => l.status === 'CONVERTED' && now - new Date(l.updatedAt).getTime() <= 30 * DAY_MS).length ?? null
  const activeNow     = leads?.filter(l => l.status !== 'CONVERTED' && l.status !== 'LOST').length ?? null

  const loading = leads === null

  return (
    <div className="bg-white dark:bg-white/[0.04] rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-white/8">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#7c3aed,#a78bfa)' }}>
            <TrendingUp size={13} className="text-white" />
          </div>
          <h3 className="text-sm font-bold text-gray-800 dark:text-white">Growth &amp; CRM</h3>
        </div>
        <Link href="/receptionist/leads" className="text-[11px] font-semibold text-cyan-600 dark:text-cyan-400 hover:underline flex items-center gap-0.5">
          Leads <ChevronRight size={11} />
        </Link>
      </div>
      <div className="grid grid-cols-3 divide-x divide-gray-100 dark:divide-white/8">
        <Stat label="New Leads" sub="7d" value={newLeads7d} loading={loading} />
        <Stat label="Converted" sub="30d" value={converted30d} loading={loading} />
        <Stat label="Active" sub="Now" value={activeNow} loading={loading} />
      </div>
      {!loading && leads?.length === 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-gray-50 dark:border-white/5 text-[11px] text-gray-400 dark:text-white/30">
          <UserPlus size={12} /> No leads captured yet
        </div>
      )}
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
