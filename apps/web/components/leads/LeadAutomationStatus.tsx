'use client'

// CRM Automation (Part T) — shared Lead automation-status UI, reused by both
// the Admin and Receptionist Leads pages so the two pipelines show identical
// owner/SLA/stale/stage-history information rather than two independent
// re-implementations drifting apart.

import { useState } from 'react'
import { History, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Kampala' })
}

const SLA_BADGE: Record<string, { text: string; className: string }> = {
  ESCALATED_15: { text: '15m overdue', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  ESCALATED_30: { text: '30m overdue', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  STALE_24H:    { text: 'Stale (24h)', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
}

// Derived entirely from fields GET /crm/leads already returns (Prisma
// returns every column by default) — no extra endpoint needed.
export function slaBadge(lead: { firstHumanReplyAt?: string | null; status: string; slaState?: string | null }) {
  if (lead.firstHumanReplyAt || lead.status === 'CONVERTED' || lead.status === 'LOST') return null
  return SLA_BADGE[lead.slaState as string] ?? null
}

interface LeadStageHistoryEntry {
  id: string
  fromStage: string | null
  toStage: string
  changedAt: string
  trigger: string
  reason: string | null
}

export function LeadAutomationPanel({ lead, token }: { lead: any; token: string | null }) {
  const [history, setHistory] = useState<LeadStageHistoryEntry[] | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)

  const loadHistory = () => {
    if (history || loadingHistory) { setShowHistory(s => !s); return }
    setLoadingHistory(true)
    fetch(`/api-proxy/crm-automation/leads/${lead.id}/stage-history`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then(d => { setHistory(d); setShowHistory(true) })
      .catch(() => setHistory([]))
      .finally(() => setLoadingHistory(false))
  }

  const badge = slaBadge(lead)

  return (
    <div className="bg-gray-50 dark:bg-white/5 rounded-2xl p-4 space-y-2">
      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 block">Automation</span>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500 dark:text-white/50">
          First reply: {lead.firstHumanReplyAt ? fmtDateTime(lead.firstHumanReplyAt) : 'Awaiting reply'}
        </span>
        {badge && (
          <span className={cn('px-1.5 py-0.5 rounded-full text-[9px] font-bold', badge.className)}>{badge.text}</span>
        )}
        {lead.status === 'LOST' && lead.lossReason && (
          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
            Lost: {lead.lossReason}
          </span>
        )}
      </div>
      <button
        onClick={loadHistory}
        className="flex items-center gap-1.5 text-xs font-semibold text-cyan-600 dark:text-cyan-400 hover:underline"
      >
        {loadingHistory ? <Loader2 size={11} className="animate-spin" /> : <History size={11} />}
        {showHistory ? 'Hide stage history' : 'View stage history'}
      </button>
      {showHistory && history && (
        <div className="space-y-1.5 pt-1">
          {history.length === 0 ? (
            <p className="text-[11px] text-gray-400 dark:text-white/30">No stage changes recorded yet.</p>
          ) : history.map(h => (
            <div key={h.id} className="text-[11px] text-gray-500 dark:text-white/50 flex items-center gap-1.5">
              <span className="font-semibold text-gray-700 dark:text-white/70">{h.fromStage ?? '—'} → {h.toStage}</span>
              <span className="text-gray-300 dark:text-white/25">·</span>
              <span>{fmtDateTime(h.changedAt)}</span>
              <span className="text-gray-300 dark:text-white/25">·</span>
              <span className={h.trigger === 'AUTOMATION' ? 'text-cyan-600 dark:text-cyan-400' : 'text-amber-600 dark:text-amber-400'}>{h.trigger === 'AUTOMATION' ? 'Auto' : 'Manual'}</span>
              {h.reason && <span className="text-gray-400 dark:text-white/40">({h.reason})</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
