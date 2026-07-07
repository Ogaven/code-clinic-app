'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Save, ClipboardList, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

const API = '/api-proxy'
function hdr() {
  const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  return { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }
}

function eatToday() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function fmtDate(isoDate: string) {
  return new Date(isoDate + 'T12:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    timeZone: 'Africa/Nairobi',
  })
}

interface Report {
  id: string
  reportDate: string
  newPatients: number
  oldPatients: number
  reviewPatients: number
  notes: string | null
  updatedAt: string
}

interface DailySummary {
  scheduled: number
  attended: number
  departed: number
  newPatients: number
  returning: number
  cancelled: number
  noShows: number
}

export default function DailyReportTab() {
  const [date,           setDate]           = useState(eatToday())
  const [newPx,          setNewPx]          = useState('')
  const [oldPx,          setOldPx]          = useState('')
  const [reviewPx,       setReviewPx]       = useState('')
  const [notes,          setNotes]          = useState('')
  const [saving,         setSaving]         = useState(false)
  const [saved,          setSaved]          = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const [reports,        setReports]        = useState<Report[]>([])
  const [loadingReports, setLoadingReports] = useState(true)
  const [historyOpen,    setHistoryOpen]    = useState(false)
  const [autoStats,      setAutoStats]      = useState<DailySummary | null>(null)
  const [loadingAuto,    setLoadingAuto]    = useState(false)

  const loadAutoStats = useCallback(async (d: string) => {
    setLoadingAuto(true)
    try {
      const r = await fetch(`${API}/receptionist/daily-summary?date=${d}`, { headers: hdr() })
      if (r.ok) setAutoStats(await r.json())
    } catch { /* ignore */ }
    setLoadingAuto(false)
  }, [])

  const loadExisting = useCallback(async (d: string) => {
    setError(null)
    try {
      const r = await fetch(`${API}/receptionist/daily-report?date=${d}`, { headers: hdr() })
      if (!r.ok) return
      const data = await r.json()
      if (data) {
        setNewPx(String(data.newPatients))
        setOldPx(String(data.oldPatients))
        setReviewPx(String(data.reviewPatients))
        setNotes(data.notes ?? '')
      } else {
        setNewPx(''); setOldPx(''); setReviewPx(''); setNotes('')
      }
    } catch { /* ignore */ }
  }, [])

  const loadHistory = useCallback(async () => {
    setLoadingReports(true)
    try {
      const r = await fetch(`${API}/receptionist/daily-reports`, { headers: hdr() })
      if (r.ok) setReports(await r.json())
    } catch { /* ignore */ }
    setLoadingReports(false)
  }, [])

  useEffect(() => { loadExisting(date); loadAutoStats(date) }, [date, loadExisting, loadAutoStats])
  useEffect(() => { loadHistory() }, [loadHistory])

  async function handleSave() {
    setSaving(true); setError(null); setSaved(false)
    try {
      const r = await fetch(`${API}/receptionist/daily-report`, {
        method: 'POST',
        headers: hdr(),
        body: JSON.stringify({
          date,
          newPatients:    parseInt(newPx)    || 0,
          oldPatients:    parseInt(oldPx)    || 0,
          reviewPatients: parseInt(reviewPx) || 0,
          notes: notes.trim() || null,
        }),
      })
      if (!r.ok) throw new Error('Save failed')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      loadHistory()
    } catch { setError('Failed to save report') }
    setSaving(false)
  }

  const total = (parseInt(newPx) || 0) + (parseInt(oldPx) || 0) + (parseInt(reviewPx) || 0)

  return (
    <div className="flex flex-col gap-5 p-5 max-w-2xl mx-auto">

      {/* Auto-stats card */}
      <div className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/8 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/8">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
            <h2 className="font-black text-sm text-gray-800 dark:text-white">Appointment Activity (Auto)</h2>
          </div>
          <button onClick={() => loadAutoStats(date)} disabled={loadingAuto}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors disabled:opacity-40">
            <RefreshCw size={13} className={cn('text-gray-400', loadingAuto && 'animate-spin')} />
          </button>
        </div>
        <div className="p-5">
          {loadingAuto ? (
            <div className="flex justify-center py-4">
              <Loader2 size={18} className="animate-spin text-gray-300 dark:text-gray-600" />
            </div>
          ) : !autoStats ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">No appointment data for this date.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-7 gap-3">
              {[
                { label: 'Scheduled',    value: autoStats.scheduled,    color: 'text-cyan-600 dark:text-cyan-400'       },
                { label: 'Attended',     value: autoStats.attended,     color: 'text-teal-600 dark:text-teal-400'       },
                { label: 'Departed',     value: autoStats.departed,     color: 'text-emerald-600 dark:text-emerald-400' },
                { label: 'New Patients', value: autoStats.newPatients,  color: 'text-violet-600 dark:text-violet-400'   },
                { label: 'Returning',    value: autoStats.returning,    color: 'text-blue-600 dark:text-blue-400'       },
                { label: 'Cancelled',    value: autoStats.cancelled,    color: 'text-red-500 dark:text-red-400'         },
                { label: 'No Shows',     value: autoStats.noShows,      color: 'text-gray-500 dark:text-gray-400'       },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center">
                  <p className={cn('text-2xl font-black', color)}>{value}</p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 leading-tight">{label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Form card */}
      <div className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/8 rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-gray-100 dark:border-white/8">
          <ClipboardList size={16} className="text-cyan-500" />
          <h2 className="font-black text-sm text-gray-800 dark:text-white">Daily Patient Report</h2>
        </div>

        <div className="p-5 space-y-4">
          {/* Date picker */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Report Date</label>
            <input
              type="date"
              value={date}
              max={eatToday()}
              onChange={e => { setDate(e.target.value); setSaved(false) }}
              className="px-3 py-2 text-sm font-semibold border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all"
            />
          </div>

          {/* Patient type counts */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'New Patients',    value: newPx,    set: setNewPx,    color: 'text-emerald-600 dark:text-emerald-400' },
              { label: 'Old Patients',    value: oldPx,    set: setOldPx,    color: 'text-blue-600 dark:text-blue-400'    },
              { label: 'Review Patients', value: reviewPx, set: setReviewPx, color: 'text-violet-600 dark:text-violet-400' },
            ].map(({ label, value, set, color }) => (
              <div key={label} className="bg-gray-50 dark:bg-white/3 rounded-xl p-3 border border-gray-100 dark:border-white/8">
                <label className="block text-xs font-semibold text-gray-400 dark:text-gray-500 mb-2">{label}</label>
                <input
                  type="number"
                  min="0"
                  value={value}
                  onChange={e => { set(e.target.value); setSaved(false) }}
                  placeholder="0"
                  className={cn(
                    'w-full text-2xl font-black bg-transparent border-none outline-none text-center',
                    color,
                  )}
                />
              </div>
            ))}
          </div>

          {/* Total */}
          {total > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
              Total: <span className="font-bold text-gray-700 dark:text-gray-200">{total}</span> patients
            </p>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => { setNotes(e.target.value); setSaved(false) }}
              placeholder="Any remarks for the day…"
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 text-gray-700 dark:text-gray-200 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all resize-none"
            />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            onClick={handleSave}
            disabled={saving}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-md disabled:opacity-60 disabled:cursor-not-allowed disabled:translate-y-0',
              saved
                ? 'bg-emerald-500'
                : 'bg-gradient-to-r from-[#1A237E] to-[#29ABE2]',
            )}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Report'}
          </button>
        </div>
      </div>

      {/* History */}
      <div className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/8 rounded-2xl overflow-hidden">
        <button
          onClick={() => setHistoryOpen(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-white/3 transition-colors">
          <span className="font-black text-sm text-gray-800 dark:text-white">Report History</span>
          {historyOpen ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
        </button>

        {historyOpen && (
          <div className="border-t border-gray-100 dark:border-white/8">
            {loadingReports ? (
              <div className="flex justify-center py-8">
                <Loader2 size={18} className="animate-spin text-gray-300 dark:text-gray-600" />
              </div>
            ) : reports.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-8">No reports submitted yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-white/8">
                      {['Date', 'New', 'Old', 'Review', 'Total', 'Notes'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left font-semibold text-gray-400 dark:text-gray-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map(r => {
                      const d = r.reportDate.slice(0, 10)
                      const tot = r.newPatients + r.oldPatients + r.reviewPatients
                      return (
                        <tr key={r.id}
                          onClick={() => { setDate(d); setHistoryOpen(false) }}
                          className="border-b border-gray-50 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/3 cursor-pointer transition-colors">
                          <td className="px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap">{fmtDate(d)}</td>
                          <td className="px-4 py-2.5 font-bold text-emerald-600 dark:text-emerald-400">{r.newPatients}</td>
                          <td className="px-4 py-2.5 font-bold text-blue-600 dark:text-blue-400">{r.oldPatients}</td>
                          <td className="px-4 py-2.5 font-bold text-violet-600 dark:text-violet-400">{r.reviewPatients}</td>
                          <td className="px-4 py-2.5 font-bold text-gray-700 dark:text-gray-200">{tot}</td>
                          <td className="px-4 py-2.5 text-gray-400 dark:text-gray-500 max-w-[160px] truncate">{r.notes ?? '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
