'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Megaphone } from 'lucide-react'

interface SourceRow { source: string; leadCount: number; qualifiedCount: number; convertedCount: number; lostCount: number }

const SOURCE_LABEL: Record<string, string> = {
  WHATSAPP: 'WhatsApp', FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', WEBSITE: 'Website',
  WALKIN: 'Walk-in', QUIZ: 'Internal Quiz', SCOREAPP: 'ScoreApp', OTHER: 'Other',
}

export default function SourcesWorkspace({ campaignsHref }: { campaignsHref: string }) {
  const [rows, setRows] = useState<SourceRow[] | null>(null)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    fetch('/api-proxy/crm-automation/reports/source-performance', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setRows(d.sources); setNote(d.note) } })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-gray-800 dark:text-white">Sources &amp; Campaigns</h1>
          <p className="text-sm text-gray-500 dark:text-white/50">How each acquisition source is performing, by real lead-stage evidence.</p>
        </div>
        <Link href={campaignsHref} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold text-white transition-all"
          style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
          <Megaphone size={15} /> Manage Campaigns
        </Link>
      </div>

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
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                {rows.map(r => (
                  <tr key={r.source}>
                    <td className="px-4 py-3 font-semibold text-gray-800 dark:text-white">{SOURCE_LABEL[r.source] ?? r.source}</td>
                    <td className="px-4 py-3 text-right text-gray-600 dark:text-white/60">{r.leadCount}</td>
                    <td className="px-4 py-3 text-right text-cyan-600 dark:text-cyan-400">{r.qualifiedCount}</td>
                    <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">{r.convertedCount}</td>
                    <td className="px-4 py-3 text-right text-red-500 dark:text-red-400">{r.lostCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {note && <p className="text-[11px] text-gray-400 dark:text-white/30">{note}</p>}
    </div>
  )
}
