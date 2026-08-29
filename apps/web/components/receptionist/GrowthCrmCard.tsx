'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Users, UserCheck, Share2, Megaphone, ArrowUpRight } from 'lucide-react'

interface Lead { id: string; status: string; createdAt: string }
interface Campaign { id: string; status: string }
interface ReferralStats { stats: { source: string; count: number; thisMonth: number }[] }

// Matches the Admin dashboard's "Growth & CRM" card exactly (see
// apps/web/app/(admin)/dashboard/page.tsx) — same gradient, same four
// metrics, same real endpoints (GET /crm/leads, /campaigns,
// /patients/referral-stats — all requireAuth-only, no role restriction, so
// Receptionist gets the same real data Admin does). Only the destination
// link differs (a real Receptionist route instead of an Admin one).
export default function GrowthCrmCard() {
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [referrals, setReferrals] = useState<ReferralStats | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('cc_token')
    const auth = { Authorization: `Bearer ${token}` }
    fetch('/api-proxy/crm/leads', { headers: auth })
      .then(r => r.ok ? r.json() : null).then(d => { if (Array.isArray(d)) setLeads(d) }).catch(() => {})
    fetch('/api-proxy/campaigns', { headers: auth })
      .then(r => r.ok ? r.json() : null).then(d => { if (Array.isArray(d)) setCampaigns(d) }).catch(() => {})
    fetch('/api-proxy/patients/referral-stats', { headers: auth })
      .then(r => r.ok ? r.json() : null).then(d => { if (d?.stats) setReferrals(d) }).catch(() => {})
  }, [])

  const newLeads = leads ? leads.filter(l => Date.now() - new Date(l.createdAt).getTime() < 7 * 86400000).length : null
  const convertedLeads = leads ? leads.filter(l => l.status === 'CONVERTED').length : null
  const activeCampaigns = campaigns ? campaigns.filter(c => c.status !== 'DRAFT').length : null
  const referralPatients = referrals ? referrals.stats.filter(s => s.source !== 'Not Recorded').reduce((sum, s) => sum + s.count, 0) : null
  const conversionRate = leads && leads.length > 0 && convertedLeads !== null ? Math.round((convertedLeads / leads.length) * 100) : null

  return (
    <Link href="/receptionist/leads" className="flex flex-col justify-between rounded-2xl p-4 text-white shadow-sm transition hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg,#0c1e50,#1A237E 45%,#29ABE2)' }}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wide text-blue-100">Growth &amp; CRM</p>
        <span className="grid h-7 w-7 place-items-center rounded-full bg-white/15"><Share2 size={13} /></span>
      </div>
      <div className="my-2.5 space-y-1.5">
        <div className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-blue-100"><Users size={12} /> New Leads (7d)</span>
          <span className="text-sm font-bold text-white">{newLeads ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-blue-100"><UserCheck size={12} /> Converted <span className="text-blue-200/60">(all time)</span></span>
          <span className="text-sm font-bold text-white">{convertedLeads ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-blue-100"><Share2 size={12} /> Referral Patients <span className="text-blue-200/60">(all time)</span></span>
          <span className="text-sm font-bold text-white">{referralPatients ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-blue-100"><Megaphone size={12} /> Active Campaigns</span>
          <span className="text-sm font-bold text-white" title="Based on the 100 most recently created campaigns — may undercount if older campaigns are still active">{activeCampaigns ?? '—'}{activeCampaigns !== null && <span className="ml-0.5 align-top text-[9px] font-bold text-blue-200">*</span>}</span>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-white/15 pt-2">
        <span className="text-[10px] font-medium text-blue-100">{conversionRate !== null ? `${conversionRate}% lead conversion (all time)` : 'Conversion — unavailable'}</span>
        <span className="flex items-center gap-1 text-[11px] font-bold text-white/90">Open CRM <ArrowUpRight size={12} /></span>
      </div>
      {activeCampaigns !== null && <p className="mt-1 text-center text-[8px] text-blue-200/60">*last 100 campaigns</p>}
    </Link>
  )
}
