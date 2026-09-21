'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Megaphone, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SourceRow { source: string; leadCount: number; qualifiedCount: number; convertedCount: number; lostCount: number }
interface Readiness { key: string; label: string; status: 'CONNECTED' | 'SETUP_REQUIRED' | 'NOT_CONNECTED'; detail: string }

const SOURCE_LABEL: Record<string, string> = {
  WHATSAPP: 'WhatsApp', FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', WEBSITE: 'Website',
  WALKIN: 'Walk-in', QUIZ: 'Internal Quiz', SCOREAPP: 'ScoreApp', OTHER: 'Other',
}

const STATUS_META: Record<Readiness['status'], { label: string; icon: any; tone: string }> = {
  CONNECTED:      { label: 'Connected',      icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300' },
  SETUP_REQUIRED: { label: 'Setup Required', icon: AlertTriangle, tone: 'bg-amber-50 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300' },
  NOT_CONNECTED:  { label: 'Not Connected',  icon: XCircle,       tone: 'bg-gray-100 text-gray-500 dark:bg-white/8 dark:text-white/50' },
}

export default function SourcesWorkspace({ campaignsHref, leadsHref }: { campaignsHref: string; leadsHref: string }) {
  const [rows, setRows] = useState<SourceRow[] | null>(null)
  const [readiness, setReadiness] = useState<Readiness[]>([])
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    const authH = { Authorization: `Bearer ${token}` }
    Promise.all([
      fetch('/api-proxy/crm-automation/reports/source-performance', { headers: authH }),
      fetch('/api-proxy/crm-automation/source-readiness', { headers: authH }),
    ]).then(async ([perfRes, readyRes]) => {
      if (perfRes.ok) { const d = await perfRes.json(); setRows(d.sources); setNote(d.note) }
      if (readyRes.ok) setReadiness(await readyRes.json())
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const readinessByKey = new Map(readiness.map(r => [r.key, r]))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-gray-800 dark:text-white">Sources</h1>
          <p className="text-sm text-gray-500 dark:text-white/50">How each acquisition source is performing, by real lead-stage evidence.</p>
        </div>
        <Link href={campaignsHref} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold text-white transition-all"
          style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
          <Megaphone size={15} /> Manage Campaigns
        </Link>
      </div>

      {readiness.length > 0 && (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-white/50 mb-2.5">Connection Status</p>
          <div className="flex flex-wrap gap-2">
            {readiness.map(r => {
              const meta = STATUS_META[r.status]
              const Icon = meta.icon
              return (
                <span key={r.key} title={r.detail} className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold', meta.tone)}>
                  <Icon size={12} /> {r.label}: {meta.label}
                </span>
              )
            })}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-gray-400 dark:text-white/40">Loading…</p>
        ) : !rows || rows.length === 0 ? (
          <p className="p-6 text-sm text-gray-400 dark:text-white/40">No leads recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-white/5">
                <tr className="text-gray-500 dark:text-white/50 text-xs">
                  <th className="px-4 py-3 font-bold">Source</th>
                  <th className="px-4 py-3 font-bold text-right">Leads</th>
                  <th className="px-4 py-3 font-bold text-right">Qualified</th>
                  <th className="px-4 py-3 font-bold text-right">Converted</th>
                  <th className="px-4 py-3 font-bold text-right">Lost</th>
                  <th className="px-4 py-3 font-bold text-right">Conversion Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                {rows.map(r => {
                  const rate = r.leadCount > 0 ? (r.convertedCount / r.leadCount) * 100 : null
                  return (
                    <tr key={r.source} className="hover:bg-gray-50 dark:hover:bg-white/5">
                      <td className="px-4 py-3 font-semibold text-gray-800 dark:text-white">
                        <Link href={`${leadsHref}?source=${r.source}`} className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline">
                          {SOURCE_LABEL[r.source] ?? r.source}
                        </Link>
                        {readinessByKey.get(r.source) && readinessByKey.get(r.source)!.status !== 'CONNECTED' && (
                          <span className="ml-2 text-[9px] font-bold uppercase text-amber-500">{STATUS_META[readinessByKey.get(r.source)!.status].label}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600 dark:text-white/60">{r.leadCount}</td>
                      <td className="px-4 py-3 text-right text-cyan-600 dark:text-cyan-400">{r.qualifiedCount}</td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">{r.convertedCount}</td>
                      <td className="px-4 py-3 text-right text-red-500 dark:text-red-400">{r.lostCount}</td>
                      <td className="px-4 py-3 text-right text-gray-500 dark:text-white/50">{rate === null ? '—' : `${rate.toFixed(1)}%`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {note && <p className="text-[11px] text-gray-400 dark:text-white/30">{note}</p>}
    </div>
  )
}
