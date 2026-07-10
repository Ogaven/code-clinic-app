'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, RefreshCw, Download, Printer, MessageCircle, CheckCircle2,
  Calendar, ChevronLeft, ChevronRight, Users, UserCheck, UserPlus,
  RotateCcw, Clock, XCircle, PhoneOff, CalendarX,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Metrics {
  totalScheduled: number
  totalSeen: number
  newPatients: number
  returningPatients: number
  reviews: number
  confirmed: number
  pending: number
  cancelled: number
  noShows: number
  cancelledNotRescheduled: number
}

interface FollowUpEntry {
  appointmentId: string
  patientId: string
  patientName: string
  phone: string
  originalDate: string
  service: string
  doctor: string
  reason: 'CANCELLED' | 'NO_SHOW'
  daysSince: number
  followUpSent: boolean
  followUpSentAt: string | null
  contactedAt: string | null
}

interface ClinicalReport {
  period: { view: string; start: string; end: string; label: string }
  metrics: Metrics
  followUpList: FollowUpEntry[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

function getMondayStr(fromDateStr?: string): string {
  const n = fromDateStr ? new Date(fromDateStr + 'T00:00:00') : new Date()
  const day = n.getDay()
  const diff = day === 0 ? -6 : 1 - day
  n.setDate(n.getDate() + diff)
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi',
  })
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    hour12: true, timeZone: 'Africa/Nairobi',
  })
}

function cleanPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('0')) return '256' + digits.slice(1)
  if (digits.startsWith('256')) return digits
  return '256' + digits
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClinicalReportPage() {
  const [view, setView]           = useState<'daily' | 'weekly'>('daily')
  const [date, setDate]           = useState(todayStr)
  const [weekStart, setWeekStart] = useState(() => getMondayStr())
  const [data, setData]           = useState<ClinicalReport | null>(null)
  const [loading, setLoading]     = useState(true)
  const [contacted, setContacted] = useState<Record<string, string>>({})

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = view === 'weekly'
        ? new URLSearchParams({ view: 'weekly', weekStart })
        : new URLSearchParams({ view: 'daily', date })
      const res = await fetch(`/api-proxy/reports/clinical?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const json: ClinicalReport = await res.json()
      setData(json)
      const init: Record<string, string> = {}
      for (const r of json.followUpList ?? []) {
        if (r.contactedAt) init[r.appointmentId] = r.contactedAt
      }
      setContacted(init)
    } catch {}
    setLoading(false)
  }, [view, date, weekStart, token])

  useEffect(() => { fetchData() }, [fetchData])

  async function markContacted(appointmentId: string) {
    const ts = new Date().toISOString()
    setContacted(c => ({ ...c, [appointmentId]: ts }))
    try {
      await fetch(`/api-proxy/reports/clinical/contact/${appointmentId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {}
  }

  function exportCSV() {
    if (!data) return
    const headers = ['Patient','Phone','Date','Service','Doctor','Reason','Days Since','Auto Follow-up Sent','Staff Contacted']
    const rows = data.followUpList.map(r => [
      r.patientName, r.phone, fmtDate(r.originalDate), r.service, r.doctor,
      r.reason, String(r.daysSince), r.followUpSent ? 'Yes' : 'No',
      contacted[r.appointmentId] ? `Yes (${fmtDate(contacted[r.appointmentId])})` : 'No',
    ])
    const csv = [headers, ...rows].map(row => row.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url
    a.download = `clinical-followup-${view === 'weekly' ? weekStart : date}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  function copyWeeklySummary() {
    if (!data) return
    const m = data.metrics
    const lines = [
      `📊 *Code Clinic — ${data.period.label}*`,
      '',
      `✅ Total Scheduled: ${m.totalScheduled}`,
      `👁️ Patients Seen: ${m.totalSeen}`,
      `🆕 New Patients: ${m.newPatients}`,
      `🔄 Returning: ${m.returningPatients}`,
      `🔍 Reviews / Recalls: ${m.reviews}`,
      `✔️ Confirmed: ${m.confirmed}`,
      `⏳ Pending: ${m.pending}`,
      `❌ Cancelled: ${m.cancelled}`,
      `⚠️ No-Shows: ${m.noShows}`,
      `📞 Needs Follow-up: ${data.followUpList.length}`,
    ]
    if (data.followUpList.length > 0) {
      lines.push('', '*Needs Follow-up:*')
      data.followUpList.forEach((r, i) => {
        lines.push(`${i + 1}. ${r.patientName} — ${r.reason === 'NO_SHOW' ? 'No-Show' : 'Cancelled'} (${r.doctor}) — ${r.phone}`)
      })
    }
    navigator.clipboard.writeText(lines.join('\n'))
      .then(() => alert('Report copied — paste into WhatsApp or email'))
      .catch(() => alert('Could not access clipboard'))
  }

  const m = data?.metrics
  const STATS = !m ? [] : [
    { label: 'Total Scheduled',             value: m.totalScheduled,          color: '#29ABE2', Icon: Calendar      },
    { label: 'Patients Seen',               value: m.totalSeen,               color: '#10B981', Icon: UserCheck     },
    { label: 'New Patients',                value: m.newPatients,             color: '#8B5CF6', Icon: UserPlus      },
    { label: 'Returning',                   value: m.returningPatients,       color: '#3B82F6', Icon: Users         },
    { label: 'Reviews / Recalls',           value: m.reviews,                 color: '#F59E0B', Icon: RotateCcw     },
    { label: 'Confirmed',                   value: m.confirmed,               color: '#14B8A6', Icon: CheckCircle2  },
    { label: 'Pending',                     value: m.pending,                 color: '#94A3B8', Icon: Clock         },
    { label: 'Cancelled',                   value: m.cancelled,               color: '#EF4444', Icon: XCircle       },
    { label: 'No-Shows',                    value: m.noShows,                 color: '#F97316', Icon: PhoneOff      },
    { label: 'Cancelled & Not Rescheduled', value: m.cancelledNotRescheduled, color: '#DC2626', Icon: CalendarX     },
  ]

  const weekEnd = weekStart ? addDays(weekStart, 6) : ''

  return (
    <>
      {/* Print styles — hide sidebar/header, reveal only report content */}
      <style>{`
        @media print {
          aside, header, nav { display: none !important; }
          body, html { height: auto !important; overflow: visible !important; }
          .no-print { display: none !important; }
          main { overflow: visible !important; height: auto !important; }
        }
        @media screen { .print-only { display: none !important; } }
      `}</style>

      <div className="space-y-5 p-6 animate-fade-in">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap no-print">
          <Link href="/reports"
            className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 transition-colors text-gray-400">
            <ArrowLeft size={16} />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-clinic-navy dark:text-white">Daily / Weekly Clinical Report</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {loading ? 'Loading…' : data?.period.label}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={copyWeeklySummary}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/10 transition-colors">
              <MessageCircle size={14} /> Share
            </button>
            <button onClick={exportCSV}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/10 transition-colors">
              <Download size={14} /> Export CSV
            </button>
            <button onClick={() => window.print()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-md"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
              <Printer size={14} />
              {view === 'weekly' ? 'Generate Weekly PDF' : 'Print Daily Report'}
            </button>
            <button onClick={fetchData}
              className="p-2.5 rounded-xl border border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400 transition-colors">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* ── View toggle + date controls ────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap no-print">
          <div className="flex bg-gray-100 dark:bg-white/10 rounded-xl p-1 gap-1">
            {(['daily', 'weekly'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
                  view === v
                    ? 'bg-white dark:bg-white/20 text-clinic-navy dark:text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-600 dark:hover:text-white/80'
                }`}>
                {v === 'daily' ? 'Daily' : 'Weekly'}
              </button>
            ))}
          </div>

          {view === 'daily' ? (
            <div className="flex items-center gap-1 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-2 py-1.5">
              <button onClick={() => setDate(d => addDays(d, -1))}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                <ChevronLeft size={14} className="text-gray-400" />
              </button>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="text-sm bg-transparent text-gray-700 dark:text-gray-200 focus:outline-none mx-1" />
              <button onClick={() => setDate(d => addDays(d, 1))}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                <ChevronRight size={14} className="text-gray-400" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-2 py-1.5">
              <button onClick={() => setWeekStart(w => addDays(w, -7))}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                <ChevronLeft size={14} className="text-gray-400" />
              </button>
              <div className="flex items-center gap-1.5 mx-2">
                <Calendar size={13} className="text-gray-400 flex-shrink-0" />
                <input type="date" value={weekStart} onChange={e => setWeekStart(getMondayStr(e.target.value))}
                  className="text-sm bg-transparent text-gray-700 dark:text-gray-200 focus:outline-none" />
                {weekEnd && (
                  <span className="text-xs text-gray-400 whitespace-nowrap hidden sm:inline">
                    — {fmtDate(weekEnd + 'T12:00:00')}
                  </span>
                )}
              </div>
              <button onClick={() => setWeekStart(w => addDays(w, 7))}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                <ChevronRight size={14} className="text-gray-400" />
              </button>
            </div>
          )}
        </div>

        {/* Print-only report header */}
        <div className="print-only mb-4">
          <div className="flex items-center justify-between border-b border-gray-200 pb-3 mb-4">
            <div>
              <h1 className="text-xl font-black text-gray-900">Code Clinic — Clinical Report</h1>
              <p className="text-gray-600 mt-0.5">{data?.period.label}</p>
            </div>
            <p className="text-xs text-gray-400">
              Generated {new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
            </p>
          </div>
        </div>

        {/* ── Metric cards ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {loading
            ? Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-4 shadow-sm">
                  <div className="h-2.5 bg-gray-100 dark:bg-white/10 rounded animate-pulse mb-3 w-16" />
                  <div className="h-7 bg-gray-100 dark:bg-white/10 rounded animate-pulse w-10" />
                </div>
              ))
            : STATS.map(({ label, value, color, Icon }, i) => (
                <div key={i} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-4 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-2 gap-1">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 leading-tight">{label}</p>
                    <Icon size={13} style={{ color }} className="opacity-50 flex-shrink-0 mt-0.5" />
                  </div>
                  <p className="text-3xl font-black leading-none" style={{ color }}>{value}</p>
                </div>
              ))
          }
        </div>

        {/* ── Follow-up list ─────────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-bold text-gray-800 dark:text-white">Needs Follow-up</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Cancelled / no-show patients with no future appointment booked
              </p>
            </div>
            {!loading && data && data.followUpList.length > 0 && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                {data.followUpList.length} {data.followUpList.length === 1 ? 'patient' : 'patients'}
              </span>
            )}
          </div>

          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 dark:bg-white/5 border-b border-gray-100 dark:border-white/10">
                    {['Patient','Phone','Appt Date','Service','Doctor','Reason','Days Since','Auto Sent','Action'].map(h => (
                      <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wide text-gray-400 px-4 py-3 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 9 }).map((_, j) => (
                          <td key={j} className="px-4 py-3">
                            <div className="h-3 bg-gray-100 dark:bg-white/10 rounded animate-pulse w-20" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : !data || data.followUpList.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-14 text-center">
                        <CheckCircle2 size={36} className="mx-auto mb-3 text-green-400 opacity-50" />
                        <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">All patients accounted for</p>
                        <p className="text-xs text-gray-400 mt-1">No cancelled or no-show patients without a rebooked appointment</p>
                      </td>
                    </tr>
                  ) : (
                    data.followUpList.map(r => {
                      const isContacted   = !!contacted[r.appointmentId]
                      const contactedTime = contacted[r.appointmentId]
                      const waPhone       = cleanPhone(r.phone)
                      return (
                        <tr key={r.appointmentId}
                          className="hover:bg-amber-50/30 dark:hover:bg-white/5 transition-colors">
                          <td className="px-4 py-3">
                            <Link href={`/patients/${r.patientId}`}
                              className="text-sm font-semibold text-gray-800 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                              {r.patientName}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap font-mono">
                            {r.phone}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                            {fmtDateTime(r.originalDate)}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 max-w-[140px] truncate">
                            {r.service}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                            {r.doctor}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
                              r.reason === 'NO_SHOW'
                                ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            }`}>
                              {r.reason === 'NO_SHOW' ? 'No Show' : 'Cancelled'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-bold tabular-nums ${
                              r.daysSince === 0 ? 'text-orange-500' : r.daysSince > 7 ? 'text-red-500' : 'text-gray-600 dark:text-gray-300'
                            }`}>
                              {r.daysSince === 0 ? 'Today' : r.daysSince === 1 ? '1 day' : `${r.daysSince} days`}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {r.followUpSent
                              ? <span title={r.followUpSentAt ? `Sent ${fmtDate(r.followUpSentAt)}` : undefined}
                                  className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 whitespace-nowrap cursor-help">
                                  Sent ✓{r.followUpSentAt ? ` ${fmtDate(r.followUpSentAt)}` : ''}
                                </span>
                              : <span className="text-[10px] text-gray-400">—</span>
                            }
                          </td>
                          <td className="px-4 py-3 no-print">
                            <div className="flex items-center gap-2">
                              <a href={`https://wa.me/${waPhone}`} target="_blank" rel="noreferrer"
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-green-500 hover:bg-green-600 text-white text-[10px] font-bold transition-colors whitespace-nowrap">
                                <MessageCircle size={10} /> WhatsApp
                              </a>
                              {isContacted ? (
                                <span className="flex items-center gap-1 text-[10px] font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">
                                  <CheckCircle2 size={11} />
                                  {contactedTime
                                    ? `Contacted ${fmtDate(contactedTime)}`
                                    : 'Contacted'}
                                </span>
                              ) : (
                                <button onClick={() => markContacted(r.appointmentId)}
                                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-200 dark:border-white/10 text-[10px] font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/10 transition-colors whitespace-nowrap">
                                  Mark Contacted
                                </button>
                              )}
                            </div>
                          </td>
                          {/* Print-only action column */}
                          <td className="print-only px-4 py-3 text-xs text-gray-500">
                            {isContacted ? '✓ Contacted' : r.followUpSent ? 'Auto-sent' : 'Pending'}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {!loading && data && data.followUpList.length > 0 && (
              <div className="border-t border-gray-100 dark:border-white/10 px-4 py-3 no-print">
                <p className="text-[10px] text-gray-400">
                  <span className="font-bold">Tip:</span> Click WhatsApp to open a direct conversation.
                  &nbsp;Auto Sent means Sarah already sent a 24-hour follow-up message.
                  &nbsp;Mark Contacted after your team has reached out so no one double-contacts.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
