'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, TrendingUp, Loader2, X, Printer, Share2,
  CheckCircle, XCircle, Clock, ChevronRight, Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ───────────────────────────────────────────────────────────────────────
interface PatientEntry { name: string; service: string; date: string; value: number }
interface CASummary    { presented: number; accepted: number; followUp: number; declined: number; onHold: number; acceptanceRate: number; target: number }
interface CADoctor     {
  id: string; name: string
  presented: number; accepted: number; followUp: number; declined: number; onHold: number; acceptanceRate: number
  patients: { accepted: PatientEntry[]; declined: PatientEntry[]; pending: PatientEntry[] }
}
interface CAData { summary: CASummary; byStatus: Record<string, number>; byDoctor: CADoctor[] }

// ── Helpers ─────────────────────────────────────────────────────────────────────
function eatMonthRange() {
  const e = new Date(Date.now() + 3 * 60 * 60 * 1000)
  const y = e.getUTCFullYear(), m = e.getUTCMonth()
  return { from: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), to: new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10) }
}
function lastMonthRange() {
  const e = new Date(Date.now() + 3 * 60 * 60 * 1000)
  const y = e.getUTCFullYear(), m = e.getUTCMonth()
  return { from: new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10), to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }
}
function fmtMonthLabel(from: string) {
  return new Date(from + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}
function fmtUGX(v: number) { return v > 0 ? `UGX ${v.toLocaleString('en-UG')}` : '—' }
function fmtDate(d: string) { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }

function rateColor(rate: number, target = 90) {
  return rate >= target ? 'text-emerald-500' : rate >= 70 ? 'text-amber-500' : 'text-red-500'
}
function rateBg(rate: number, target = 90): string {
  return rate >= target ? '#16a34a' : rate >= 70 ? '#d97706' : '#dc2626'
}
function initials(name: string) {
  const parts = name.replace('Dr. ', '').trim().split(' ').filter(Boolean)
  return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : (parts[0]?.slice(0, 2) ?? '??').toUpperCase()
}

// ── Sub-components ──────────────────────────────────────────────────────────────
function RateBar({ rate, target = 90 }: { rate: number; target?: number }) {
  return (
    <div className="relative w-full h-2.5 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${rate}%`, background: rateBg(rate, target) }} />
      {/* Target marker */}
      <div className="absolute top-0 bottom-0 w-0.5 bg-white/70 dark:bg-white/40" style={{ left: `${target}%` }} title={`Target: ${target}%`} />
    </div>
  )
}

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center p-3 bg-white dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/10">
      <span className="text-2xl font-black" style={{ color }}>{value}</span>
      <span className="text-[11px] text-gray-500 dark:text-white/50 font-medium mt-0.5">{label}</span>
    </div>
  )
}

function PatientTable({ rows, type }: { rows: PatientEntry[]; type: 'accepted' | 'declined' | 'pending' }) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-400 py-4 text-center">No patients in this category</p>
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-white/10">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-white/5">
          <tr>
            <th className="text-left px-3 py-2.5 text-xs font-bold text-gray-400 uppercase">Patient</th>
            <th className="text-left px-3 py-2.5 text-xs font-bold text-gray-400 uppercase">Service / Stage</th>
            <th className="text-left px-3 py-2.5 text-xs font-bold text-gray-400 uppercase">Date</th>
            {type === 'accepted' && <th className="text-right px-3 py-2.5 text-xs font-bold text-gray-400 uppercase">Value</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 dark:divide-white/5">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/5">
              <td className="px-3 py-2.5 font-medium text-gray-800 dark:text-white">{r.name}</td>
              <td className="px-3 py-2.5 text-gray-500 dark:text-white/60">{r.service}</td>
              <td className="px-3 py-2.5 text-gray-400 dark:text-white/40 text-xs">{fmtDate(r.date)}</td>
              {type === 'accepted' && <td className="px-3 py-2.5 text-right text-emerald-600 dark:text-emerald-400 font-semibold">{fmtUGX(r.value)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Print template (injected into DOM for printing) ──────────────────────────────
function printDoctorReport(doc: CADoctor, monthLabel: string) {
  const totalValue = doc.patients.accepted.reduce((s, p) => s + p.value, 0)
  const rows = (label: string, list: PatientEntry[], showValue: boolean) =>
    list.length === 0 ? `<tr><td colspan="4" style="padding:8px;color:#999;text-align:center">None</td></tr>` :
    list.map(p => `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">${p.name}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">${p.service}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">${fmtDate(p.date)}</td>
      ${showValue ? `<td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${fmtUGX(p.value)}</td>` : ''}
    </tr>`).join('')

  const html = `<!DOCTYPE html><html><head><title>${doc.name} — Case Acceptance Report</title>
  <style>
    body{font-family:system-ui,sans-serif;font-size:13px;color:#111;margin:32px}
    h1{font-size:20px;font-weight:900;margin:0 0 4px}
    h2{font-size:13px;font-weight:700;margin:20px 0 8px;color:#333;border-bottom:2px solid #e5e7eb;padding-bottom:4px}
    .meta{color:#666;font-size:12px;margin-bottom:20px}
    .stats{display:flex;gap:16px;margin-bottom:20px}
    .stat{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;flex:1;text-align:center}
    .stat .n{font-size:24px;font-weight:900;margin-bottom:2px}
    .stat .l{font-size:11px;color:#666;text-transform:uppercase}
    table{width:100%;border-collapse:collapse}
    th{text-align:left;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#666;border-bottom:2px solid #e5e7eb}
    .rate{font-size:28px;font-weight:900;color:${rateBg(doc.acceptanceRate)}}
    @media print{body{margin:16px}}
  </style></head><body>
  <h1>${doc.name}</h1>
  <div class="meta">Case Acceptance Report — ${monthLabel} &nbsp;|&nbsp; Generated ${new Date().toLocaleDateString('en-GB')}</div>
  <div class="stats">
    <div class="stat"><div class="n" style="color:#0891b2">${doc.presented}</div><div class="l">Presented</div></div>
    <div class="stat"><div class="n" style="color:#16a34a">${doc.accepted}</div><div class="l">Accepted</div></div>
    <div class="stat"><div class="n" style="color:#dc2626">${doc.declined}</div><div class="l">Declined</div></div>
    <div class="stat"><div class="n" style="color:#d97706">${doc.followUp}</div><div class="l">Pending</div></div>
    <div class="stat"><div class="rate">${doc.acceptanceRate}%</div><div class="l">Rate</div></div>
  </div>
  ${totalValue > 0 ? `<p style="margin-bottom:20px;font-weight:600;color:#16a34a">Total accepted value: ${fmtUGX(totalValue)}</p>` : ''}
  <h2>✅ Accepted (${doc.patients.accepted.length})</h2>
  <table><thead><tr><th>Patient</th><th>Service</th><th>Date</th><th style="text-align:right">Value</th></tr></thead>
  <tbody>${rows('accepted', doc.patients.accepted, true)}</tbody></table>
  <h2>⏳ Pending (${doc.patients.pending.length})</h2>
  <table><thead><tr><th>Patient</th><th>Service</th><th>Date</th></tr></thead>
  <tbody>${rows('pending', doc.patients.pending, false)}</tbody></table>
  <h2>❌ Declined (${doc.patients.declined.length})</h2>
  <table><thead><tr><th>Patient</th><th>Service</th><th>Date</th></tr></thead>
  <tbody>${rows('declined', doc.patients.declined, false)}</tbody></table>
  </body></html>`

  const win = window.open('', '_blank', 'width=800,height=900')
  if (!win) return
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => { win.print() }, 400)
}

// ── Drill-Down Modal ─────────────────────────────────────────────────────────────
function DrilldownModal({ doc, monthLabel, onClose }: { doc: CADoctor; monthLabel: string; onClose: () => void }) {
  const [tab, setTab] = useState<'accepted' | 'declined' | 'pending'>('accepted')
  const totalValue = doc.patients.accepted.reduce((s, p) => s + p.value, 0)

  async function handleShare() {
    const text = `${doc.name} Case Acceptance — ${monthLabel}\nRate: ${doc.acceptanceRate}%\nPresented: ${doc.presented} | Accepted: ${doc.accepted} | Declined: ${doc.declined}\nCode Clinic`
    if (navigator.share) {
      try { await navigator.share({ title: `${doc.name} — Case Acceptance`, text }) } catch {}
    } else {
      await navigator.clipboard.writeText(text)
      alert('Report summary copied to clipboard')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative z-10 w-full sm:max-w-2xl max-h-[92dvh] flex flex-col bg-white dark:bg-[#0f1f2e] rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-white/10 flex-shrink-0">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-black text-sm flex-shrink-0"
            style={{ background: rateBg(doc.acceptanceRate) }}>
            {initials(doc.name)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-black text-gray-800 dark:text-white truncate">{doc.name}</h2>
            <p className="text-xs text-gray-400">{monthLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => printDoctorReport(doc, monthLabel)}
              className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
              title="Print / Save PDF">
              <Printer size={16} />
            </button>
            <button onClick={handleShare}
              className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
              title="Share">
              <Share2 size={16} />
            </button>
            <button onClick={onClose} className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="px-5 py-4 flex-shrink-0 border-b border-gray-50 dark:border-white/5">
          <div className="grid grid-cols-5 gap-2 mb-3">
            <StatChip label="Presented" value={doc.presented} color="#0891b2" />
            <StatChip label="Accepted"  value={doc.accepted}  color="#16a34a" />
            <StatChip label="Declined"  value={doc.declined}  color="#dc2626" />
            <StatChip label="Pending"   value={doc.followUp}  color="#d97706" />
            <div className="flex flex-col items-center p-3 bg-white dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/10">
              <span className={cn('text-2xl font-black', rateColor(doc.acceptanceRate))}>{doc.acceptanceRate}%</span>
              <span className="text-[11px] text-gray-500 dark:text-white/50 font-medium mt-0.5">Rate</span>
            </div>
          </div>
          <RateBar rate={doc.acceptanceRate} />
          {totalValue > 0 && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold mt-2">
              Total accepted value: {fmtUGX(totalValue)}
            </p>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3 flex-shrink-0">
          {([
            { key: 'accepted', label: `Accepted (${doc.patients.accepted.length})`, icon: CheckCircle, color: 'text-emerald-600' },
            { key: 'declined', label: `Declined (${doc.patients.declined.length})`,  icon: XCircle,     color: 'text-red-500'     },
            { key: 'pending',  label: `Pending (${doc.patients.pending.length})`,    icon: Clock,       color: 'text-amber-500'   },
          ] as const).map(({ key, label, icon: Icon, color }) => (
            <button key={key} onClick={() => setTab(key)}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors',
                tab === key ? 'bg-gray-100 dark:bg-white/10 text-gray-800 dark:text-white' : 'text-gray-400 hover:text-gray-600 dark:hover:text-white/60')}>
              <Icon size={12} className={tab === key ? color : ''} />
              {label}
            </button>
          ))}
        </div>

        {/* Patient list */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <PatientTable rows={doc.patients[tab]} type={tab} />
        </div>
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────────
export default function CaseAcceptancePage() {
  const token  = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const def    = eatMonthRange()
  const [preset,   setPreset]   = useState<'this' | 'last' | 'custom'>('this')
  const [from,     setFrom]     = useState(def.from)
  const [to,       setTo]       = useState(def.to)
  const [data,     setData]     = useState<CAData | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [selected, setSelected] = useState<CADoctor | null>(null)

  function applyPreset(p: 'this' | 'last') {
    setPreset(p)
    const r = p === 'this' ? eatMonthRange() : lastMonthRange()
    setFrom(r.from); setTo(r.to)
  }

  async function generate(f = from, t = to) {
    setLoading(true)
    try {
      const res = await fetch(`/api-proxy/reports/case-acceptance?from=${f}&to=${t}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setData(await res.json())
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => { generate() }, [])

  const s      = data?.summary
  const target = s?.target ?? 90
  const monthLabel = preset !== 'custom' ? fmtMonthLabel(from) : `${from} → ${to}`

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-5 pb-4 bg-white dark:bg-[#0a1520] border-b border-gray-100 dark:border-white/8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <Link href="/reports" className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors">
              <ArrowLeft size={15} /> Reports
            </Link>
            <span className="text-gray-200 dark:text-white/20">/</span>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center">
                <TrendingUp size={14} className="text-cyan-600 dark:text-cyan-400" />
              </div>
              <div>
                <h1 className="text-lg font-black text-gray-800 dark:text-white leading-none">Case Acceptance Rate</h1>
                <p className="text-xs text-gray-400 mt-0.5">Treatment plans presented vs. accepted</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {(['this', 'last'] as const).map(p => (
              <button key={p} onClick={() => applyPreset(p)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                  preset === p ? 'bg-cyan-500 text-white border-cyan-500' : 'bg-white dark:bg-white/5 text-gray-600 dark:text-white/60 border-gray-200 dark:border-white/10 hover:border-cyan-300')}>
                {p === 'this' ? 'This Month' : 'Last Month'}
              </button>
            ))}
            <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPreset('custom') }}
              className="text-sm border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-gray-600 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/20" />
            <span className="text-xs text-gray-400">–</span>
            <input type="date" value={to} onChange={e => { setTo(e.target.value); setPreset('custom') }}
              className="text-sm border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-gray-600 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/20" />
            <button onClick={() => generate()}
              className="px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
              style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
              Generate
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-4xl">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={24} className="animate-spin text-cyan-500" />
          </div>
        ) : !data ? null : (
          <>
            {/* Clinic-wide overview */}
            <div className="bg-gradient-to-br from-slate-800 to-blue-900 rounded-2xl p-6 text-white">
              <p className="text-xs font-bold text-blue-200/70 uppercase tracking-widest mb-1">{monthLabel}</p>
              <div className="flex items-end gap-4 mb-2">
                <p className={cn('text-7xl font-black',
                  (s?.acceptanceRate ?? 0) >= target ? 'text-emerald-400' :
                  (s?.acceptanceRate ?? 0) >= 70     ? 'text-amber-400'   : 'text-red-400')}>
                  {s?.acceptanceRate ?? 0}%
                </p>
                <div className="pb-3">
                  <p className="text-blue-200/70 text-sm">Clinic-wide Case Acceptance</p>
                  <p className="text-xs text-blue-200/40">Target: {target}%</p>
                </div>
              </div>

              {/* Target progress bar */}
              <div className="relative w-full h-3 bg-white/10 rounded-full overflow-hidden mb-1">
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${Math.min(s?.acceptanceRate ?? 0, 100)}%`, background: rateBg(s?.acceptanceRate ?? 0, target) }} />
                <div className="absolute top-0 bottom-0 w-0.5 bg-white/50" style={{ left: `${target}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-blue-200/40 mb-3">
                <span>0%</span>
                <span className="text-white/50">Target {target}%</span>
                <span>100%</span>
              </div>

              <p className="text-xs text-blue-200/50">
                {(s?.acceptanceRate ?? 0) >= target ? `✓ At or above ${target}% target` :
                 (s?.acceptanceRate ?? 0) >= 70     ? `⚠ Below ${target}% target — follow up on pending plans` :
                                                      `✕ Needs attention — many plans not accepted`}
              </p>
            </div>

            {/* Four stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Presented', value: s?.presented ?? 0, color: '#0891b2', sub: 'total plans this period'     },
                { label: 'Accepted',  value: s?.accepted  ?? 0, color: '#16a34a', sub: 'In Progress + Completed'     },
                { label: 'Follow-up', value: s?.followUp  ?? 0, color: '#d97706', sub: 'Planned — awaiting decision' },
                { label: 'Declined',  value: s?.declined  ?? 0, color: '#dc2626', sub: 'patient declined'            },
              ].map(({ label, value, color, sub }) => (
                <div key={label} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-3" style={{ background: color + '20' }}>
                    <TrendingUp size={15} style={{ color }} />
                  </div>
                  <p className="text-3xl font-black text-gray-800 dark:text-white">{value}</p>
                  <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mt-0.5">{label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
                </div>
              ))}
            </div>

            {/* Per-doctor table — click to drill down */}
            {data.byDoctor.length > 0 && (
              <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-gray-50 dark:border-white/8">
                  <h3 className="text-sm font-bold text-gray-700 dark:text-white">Per-Doctor Breakdown</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Click any row to see patient-level detail</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-white/5">
                      <tr>
                        {['Doctor', 'Presented', 'Accepted', 'Follow-up', 'Declined', 'Rate', '', ''].map((h, i) => (
                          <th key={i} className="text-left px-4 py-2.5 text-xs font-black text-gray-400 dark:text-white/30 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                      {data.byDoctor.map(d => (
                        <tr key={d.id} onClick={() => setSelected(d)}
                          className="hover:bg-cyan-50 dark:hover:bg-cyan-900/10 transition-colors cursor-pointer group">
                          <td className="px-4 py-3 font-semibold text-gray-800 dark:text-white flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-black flex-shrink-0"
                              style={{ background: rateBg(d.acceptanceRate) }}>
                              {initials(d.name)}
                            </div>
                            {d.name}
                          </td>
                          <td className="px-4 py-3 text-gray-600 dark:text-white/60">{d.presented}</td>
                          <td className="px-4 py-3 font-bold text-emerald-600 dark:text-emerald-400">{d.accepted}</td>
                          <td className="px-4 py-3 text-amber-600 dark:text-amber-400">{d.followUp}</td>
                          <td className="px-4 py-3 text-red-500 dark:text-red-400">{d.declined}</td>
                          <td className="px-4 py-3">
                            <span className={cn('font-black text-base', rateColor(d.acceptanceRate, target))}>{d.acceptanceRate}%</span>
                          </td>
                          <td className="px-4 py-3 w-28"><RateBar rate={d.acceptanceRate} target={target} /></td>
                          <td className="px-4 py-3 w-8">
                            <ChevronRight size={14} className="text-gray-300 dark:text-white/20 group-hover:text-cyan-400 transition-colors" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Legend */}
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800/30 p-5">
              <h3 className="text-sm font-bold text-blue-800 dark:text-blue-300 mb-2">How to read this report</h3>
              <ul className="text-sm text-blue-700 dark:text-blue-300/70 space-y-1.5 list-disc list-inside">
                <li><strong>Presented</strong> — every treatment plan item created in the period</li>
                <li><strong>Accepted</strong> — plans marked <em>In Progress</em> or <em>Completed</em></li>
                <li><strong>Follow-up</strong> — plans still <em>Planned</em> (patient hasn't decided — follow up)</li>
                <li><strong>Declined</strong> — plans marked <em>Declined</em> by staff after patient said no</li>
                <li><strong>Target</strong> — {target}% industry benchmark. White marker on bar shows target position.</li>
                <li>Click any doctor row to see individual patient details and generate a printable PDF report.</li>
              </ul>
            </div>
          </>
        )}
      </div>

      {/* Drill-down modal */}
      {selected && (
        <DrilldownModal doc={selected} monthLabel={monthLabel} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
