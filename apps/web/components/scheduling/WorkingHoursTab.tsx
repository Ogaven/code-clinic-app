'use client'

import { useState, useEffect } from 'react'
import { Loader2, Save, Plus, Trash2, Copy, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Break     { start: string; end: string }
interface DayConfig { dayOfWeek: number; isOpen: boolean; openTime: string; closeTime: string; breaks: Break[] }

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const API = '/api-proxy'
function hdr() {
  const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  return { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }
}

const timeCls = 'px-2 py-1.5 text-xs font-semibold border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-white/10 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all min-w-0 w-full sm:w-auto'

const DEFAULTS: DayConfig[] = [
  { dayOfWeek: 0, isOpen: false, openTime: '07:00', closeTime: '18:00', breaks: [] },
  { dayOfWeek: 1, isOpen: true,  openTime: '07:00', closeTime: '18:00', breaks: [] },
  { dayOfWeek: 2, isOpen: true,  openTime: '07:00', closeTime: '18:00', breaks: [] },
  { dayOfWeek: 3, isOpen: true,  openTime: '07:00', closeTime: '18:00', breaks: [] },
  { dayOfWeek: 4, isOpen: true,  openTime: '07:00', closeTime: '18:00', breaks: [] },
  { dayOfWeek: 5, isOpen: true,  openTime: '07:00', closeTime: '18:00', breaks: [] },
  { dayOfWeek: 6, isOpen: true,  openTime: '07:00', closeTime: '14:00', breaks: [] },
]

export default function WorkingHoursTab() {
  const [days,          setDays]          = useState<DayConfig[]>(DEFAULTS)
  const [loading,       setLoading]       = useState(true)
  const [saving,        setSaving]        = useState(false)
  const [toast,         setToast]         = useState<{ msg: string; ok: boolean } | null>(null)
  const [copyFrom,      setCopyFrom]      = useState<number | null>(null)
  const [copyTargets,   setCopyTargets]   = useState<number[]>([])
  const [showCopyModal, setShowCopyModal] = useState(false)

  useEffect(() => {
    fetch(`${API}/scheduling/working-hours`, { headers: hdr() })
      .then(r => r.json())
      .then((data: any[]) => {
        if (Array.isArray(data) && data.length === 7)
          setDays(data.map(d => ({ ...d, breaks: Array.isArray(d.breaks) ? d.breaks : [] })))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function patch(idx: number, p: Partial<DayConfig>) {
    setDays(prev => prev.map((d, i) => i === idx ? { ...d, ...p } : d))
  }
  function addBreak(idx: number) {
    setDays(prev => prev.map((d, i) => i === idx
      ? { ...d, breaks: [...d.breaks, { start: '12:00', end: '13:00' }] } : d))
  }
  function patchBreak(dIdx: number, bIdx: number, p: Partial<Break>) {
    setDays(prev => prev.map((d, i) => i === dIdx
      ? { ...d, breaks: d.breaks.map((b, j) => j === bIdx ? { ...b, ...p } : b) } : d))
  }
  function removeBreak(dIdx: number, bIdx: number) {
    setDays(prev => prev.map((d, i) => i === dIdx
      ? { ...d, breaks: d.breaks.filter((_, j) => j !== bIdx) } : d))
  }

  function openCopyModal(idx: number) {
    setCopyFrom(idx); setCopyTargets([]); setShowCopyModal(true)
  }
  function applyCopy() {
    if (copyFrom === null) return
    const src = days[copyFrom]
    setDays(prev => prev.map((d, i) =>
      copyTargets.includes(i)
        ? { ...d, isOpen: src.isOpen, openTime: src.openTime, closeTime: src.closeTime, breaks: src.breaks.map(b => ({ ...b })) }
        : d
    ))
    setShowCopyModal(false)
    flash('Copied to selected days', true)
  }

  async function save() {
    setSaving(true)
    try {
      const r = await fetch(`${API}/scheduling/working-hours`, { method: 'PUT', headers: hdr(), body: JSON.stringify(days) })
      if (r.ok) window.dispatchEvent(new CustomEvent('workingHoursUpdated'))
      flash(r.ok ? 'Working hours saved' : 'Failed to save', r.ok)
    } catch { flash('Network error', false) }
    finally { setSaving(false) }
  }

  function flash(msg: string, ok: boolean) {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3000)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 size={28} className="animate-spin text-cyan-500" />
    </div>
  )

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto pb-10 overflow-y-auto h-full">

      {/* Toast */}
      {toast && (
        <div className={cn('fixed top-5 right-5 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-semibold text-white shadow-xl', toast.ok ? 'bg-emerald-500' : 'bg-red-500')}>
          {toast.ok ? <Check size={16} /> : <X size={16} />} {toast.msg}
        </div>
      )}

      {/* Copy modal — full-screen on mobile, centered card on sm+ */}
      {showCopyModal && copyFrom !== null && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#0f1729] rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm border border-gray-100 dark:border-white/10 p-5 pb-8 sm:pb-5">
            <h3 className="font-black text-gray-800 dark:text-white mb-1">Copy {DAY_SHORT[copyFrom]} hours to:</h3>
            <p className="text-xs text-gray-400 mb-4">Select the days to apply {DAY_NAMES[copyFrom]}'s schedule to</p>
            <div className="grid grid-cols-2 gap-2 mb-5">
              {DAY_NAMES.map((name, i) => i === copyFrom ? null : (
                <label key={i} className="flex items-center gap-3 cursor-pointer select-none p-2 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                  <input type="checkbox" className="w-4 h-4 rounded accent-cyan-500"
                    checked={copyTargets.includes(i)}
                    onChange={e => setCopyTargets(prev => e.target.checked ? [...prev, i] : prev.filter(x => x !== i))} />
                  <span className="text-sm text-gray-700 dark:text-gray-200">{name}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowCopyModal(false)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
                Cancel
              </button>
              <button onClick={applyCopy} disabled={copyTargets.length === 0}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-all"
                style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-5">
        <h2 className="text-lg font-black text-gray-800 dark:text-white">Working Hours</h2>
        <p className="text-sm text-gray-400 mt-0.5">Company-wide opening hours for each day of the week</p>
      </div>

      <div className="rounded-2xl border border-gray-100 dark:border-white/8 overflow-hidden bg-white dark:bg-white/5">
        {days.map((day, idx) => (
          <div key={day.dayOfWeek} className={cn(idx > 0 && 'border-t border-gray-50 dark:border-white/5')}>

            {/* Day row */}
            <div className={cn(
              'flex flex-wrap items-center gap-2 px-3 sm:px-4 py-3',
              day.isOpen ? 'bg-white dark:bg-white/5' : 'bg-gray-50/60 dark:bg-black/10',
            )}>
              {/* Toggle + label */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => patch(idx, { isOpen: !day.isOpen })}
                  className={cn('relative w-10 h-[22px] rounded-full flex-shrink-0 transition-all', day.isOpen ? 'bg-cyan-500 shadow-sm shadow-cyan-500/30' : 'bg-gray-200 dark:bg-white/15')}>
                  <span className={cn('absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-all', day.isOpen ? 'left-[22px]' : 'left-[3px]')} />
                </button>
                <span className={cn('text-xs font-bold w-8', day.isOpen ? 'text-gray-700 dark:text-gray-100' : 'text-gray-300 dark:text-gray-600')}>
                  {DAY_SHORT[day.dayOfWeek]}
                </span>
              </div>

              {day.isOpen ? (
                <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                  {/* Time range — flex-row, wraps gracefully on mobile */}
                  <div className="flex items-center gap-2 flex-1 min-w-[180px]">
                    <input type="time" value={day.openTime}  onChange={e => patch(idx, { openTime:  e.target.value })} className={timeCls} />
                    <span className="text-gray-300 dark:text-gray-600 font-bold text-sm flex-shrink-0">—</span>
                    <input type="time" value={day.closeTime} onChange={e => patch(idx, { closeTime: e.target.value })} className={timeCls} />
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => addBreak(idx)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-cyan-600 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800/40 hover:bg-cyan-50 dark:hover:bg-cyan-900/20 transition-colors whitespace-nowrap">
                      <Plus size={10} /> Add break
                    </button>
                    <button onClick={() => openCopyModal(idx)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-gray-400 border border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/8 transition-colors whitespace-nowrap">
                      <Copy size={10} /> Copy
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center gap-2 min-w-0">
                  <div className="flex-1 h-[2px] bg-gray-100 dark:bg-white/5 rounded-full" />
                  <span className="text-xs text-gray-300 dark:text-gray-600 font-medium whitespace-nowrap">Day off</span>
                </div>
              )}
            </div>

            {/* Break rows */}
            {day.isOpen && day.breaks.map((brk, bIdx) => (
              <div key={bIdx} className="flex flex-wrap items-center gap-2 pl-12 sm:pl-16 pr-3 sm:pr-4 py-2 bg-amber-50/60 dark:bg-amber-900/5 border-t border-gray-50 dark:border-white/5">
                <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wide flex-shrink-0">Break</span>
                <div className="flex items-center gap-2 flex-1 min-w-[180px]">
                  <input type="time" value={brk.start} onChange={e => patchBreak(idx, bIdx, { start: e.target.value })} className={timeCls} />
                  <span className="text-gray-300 dark:text-gray-600 font-bold text-sm flex-shrink-0">—</span>
                  <input type="time" value={brk.end}   onChange={e => patchBreak(idx, bIdx, { end:   e.target.value })} className={timeCls} />
                </div>
                <button onClick={() => removeBreak(idx, bIdx)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="mt-6">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white text-sm transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 4px 14px rgba(41,171,226,0.3)' }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Working Hours
        </button>
      </div>
    </div>
  )
}
