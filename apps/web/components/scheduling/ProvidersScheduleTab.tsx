'use client'

import { useState, useEffect } from 'react'
import { Loader2, Save, Plus, Trash2, X, Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Break       { start: string; end: string }
interface DayConfig   { dayOfWeek: number; isOpen: boolean; openTime: string; closeTime: string; breaks: Break[]; slots?: string[] }
interface CompanyDay  { dayOfWeek: number; isOpen: boolean; openTime: string; closeTime: string }
interface Doctor      { id: string; firstName: string; lastName: string; colour: string; specialisation?: string; avatarUrl?: string | null }

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// 48 half-hour slots: "00:00" … "23:30"
const ALL_SLOTS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2)
  const m = i % 2 === 0 ? '00' : '30'
  return `${String(h).padStart(2, '0')}:${m}`
})

const API = '/api-proxy'
function hdr() {
  const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  return { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }
}
const timeCls = 'px-2 py-1.5 text-xs font-semibold border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-white/10 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all min-w-0 w-full sm:w-auto'

function buildDefaultDays(company: CompanyDay[]): DayConfig[] {
  return Array.from({ length: 7 }, (_, i) => {
    const c = company.find(d => d.dayOfWeek === i)
    return { dayOfWeek: i, isOpen: c?.isOpen ?? (i >= 1 && i <= 5), openTime: c?.openTime ?? '07:00', closeTime: c?.closeTime ?? '18:00', breaks: [], slots: [] }
  })
}

export default function ProvidersScheduleTab() {
  const [doctors,     setDoctors]     = useState<Doctor[]>([])
  const [company,     setCompany]     = useState<CompanyDay[]>([])
  const [selectedDoc, setSelectedDoc] = useState<Doctor | null>(null)
  const [subTab,      setSubTab]      = useState<'default' | 'advanced'>('default')
  const [days,        setDays]        = useState<DayConfig[]>([])
  const [hasCustom,   setHasCustom]   = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [toast,       setToast]       = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`${API}/doctors`, { headers: hdr() }).then(r => r.json()),
      fetch(`${API}/scheduling/working-hours`, { headers: hdr() }).then(r => r.json()),
    ]).then(([docs, wh]) => {
      setDoctors(Array.isArray(docs) ? docs : [])
      setCompany(Array.isArray(wh)   ? wh   : [])
    }).catch(() => {})
  }, [])

  async function selectDoctor(doc: Doctor) {
    setSelectedDoc(doc); setLoading(true)
    try {
      const r    = await fetch(`${API}/scheduling/doctor-schedule/${doc.id}`, { headers: hdr() })
      const data: DayConfig[] = await r.json()
      if (Array.isArray(data) && data.length > 0) {
        const filled = Array.from({ length: 7 }, (_, i) => {
          const found = data.find(d => d.dayOfWeek === i)
          const c     = company.find(d => d.dayOfWeek === i)
          return found ?? { dayOfWeek: i, isOpen: c?.isOpen ?? false, openTime: c?.openTime ?? '07:00', closeTime: c?.closeTime ?? '18:00', breaks: [], slots: [] }
        })
        setDays(filled); setHasCustom(true)
      } else {
        setDays(buildDefaultDays(company)); setHasCustom(false)
      }
    } catch {
      setDays(buildDefaultDays(company)); setHasCustom(false)
    }
    setLoading(false)
  }

  function patch(idx: number, p: Partial<DayConfig>) {
    setDays(prev => prev.map((d, i) => i === idx ? { ...d, ...p } : d)); setHasCustom(true)
  }
  function addBreak(idx: number) {
    setDays(prev => prev.map((d, i) => i === idx
      ? { ...d, breaks: [...(d.breaks || []), { start: '12:00', end: '13:00' }] } : d))
    setHasCustom(true)
  }
  function patchBreak(dIdx: number, bIdx: number, p: Partial<Break>) {
    setDays(prev => prev.map((d, i) => i === dIdx
      ? { ...d, breaks: (d.breaks || []).map((b, j) => j === bIdx ? { ...b, ...p } : b) } : d))
  }
  function removeBreak(dIdx: number, bIdx: number) {
    setDays(prev => prev.map((d, i) => i === dIdx
      ? { ...d, breaks: (d.breaks || []).filter((_, j) => j !== bIdx) } : d))
  }
  function toggleSlot(dayIdx: number, slot: string) {
    setDays(prev => prev.map((d, i) => {
      if (i !== dayIdx) return d
      const slots = d.slots ?? []
      const next  = slots.includes(slot) ? slots.filter(s => s !== slot) : [...slots, slot]
      return { ...d, slots: next, isOpen: next.length > 0 }
    }))
    setHasCustom(true)
  }
  function toggleDayAdvanced(dayIdx: number, on: boolean) {
    setDays(prev => prev.map((d, i) => {
      if (i !== dayIdx) return d
      if (!on) return { ...d, isOpen: false, slots: [] }
      return { ...d, isOpen: true, slots: ALL_SLOTS.filter(s => s >= '08:00' && s < '18:00') }
    }))
    setHasCustom(true)
  }

  async function save() {
    if (!selectedDoc) return
    setSaving(true)
    try {
      const r = await fetch(`${API}/scheduling/doctor-schedule/${selectedDoc.id}`, {
        method: 'PUT', headers: hdr(), body: JSON.stringify(days),
      })
      if (r.ok) { flash('Schedule saved', true); setHasCustom(true) }
      else flash('Failed to save', false)
    } catch { flash('Network error', false) }
    finally { setSaving(false) }
  }

  async function clearCustom() {
    if (!selectedDoc) return
    setSaving(true)
    try {
      await fetch(`${API}/scheduling/doctor-schedule/${selectedDoc.id}`, { method: 'DELETE', headers: hdr() })
      setDays(buildDefaultDays(company)); setHasCustom(false); flash('Custom schedule cleared', true)
    } catch { flash('Network error', false) }
    finally { setSaving(false) }
  }

  function flash(msg: string, ok: boolean) {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3000)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {toast && (
        <div className={cn('fixed top-5 right-5 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-semibold text-white shadow-xl', toast.ok ? 'bg-emerald-500' : 'bg-red-500')}>
          {toast.ok ? <Check size={16} /> : <X size={16} />} {toast.msg}
        </div>
      )}

      {/* Doctor selector */}
      <div className="flex-shrink-0 px-4 sm:px-6 pt-5 pb-4 border-b border-gray-100 dark:border-white/8">
        <h2 className="text-lg font-black text-gray-800 dark:text-white mb-1">Providers Schedule</h2>
        <p className="text-sm text-gray-400 mb-4">Set custom working hours per doctor. Overrides company schedule.</p>
        {/* Full-width on mobile, max-xs on desktop */}
        <div className="relative w-full sm:max-w-xs">
          <select
            value={selectedDoc?.id ?? ''}
            onChange={e => { const d = doctors.find(x => x.id === e.target.value); if (d) selectDoctor(d) }}
            className="w-full appearance-none pl-3 pr-8 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-white dark:bg-white/5 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all">
            <option value="">Select service provider…</option>
            {doctors.map(d => <option key={d.id} value={d.id}>Dr. {d.firstName} {d.lastName}</option>)}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {!selectedDoc ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-5xl mb-3">👨‍⚕️</div>
            <p className="font-bold text-gray-400">Select a provider above</p>
            <p className="text-sm text-gray-300 dark:text-gray-600 mt-1">to manage their custom schedule</p>
          </div>
        </div>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={28} className="animate-spin text-cyan-500" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 sm:px-6 pt-4 pb-2 flex flex-wrap items-center justify-between gap-2">
            {/* Sub-tabs */}
            <div className="flex gap-1 bg-gray-100 dark:bg-white/8 rounded-xl p-1">
              {(['default', 'advanced'] as const).map(t => (
                <button key={t} onClick={() => setSubTab(t)}
                  className={cn('px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition-all', subTab === t ? 'bg-white dark:bg-white/15 text-gray-800 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400')}>
                  {t === 'default' ? 'Default view' : 'Advanced settings'}
                </button>
              ))}
            </div>
            {hasCustom && (
              <button onClick={clearCustom}
                className="text-xs text-red-400 hover:text-red-500 font-semibold underline underline-offset-2 transition-colors">
                Clear custom schedule
              </button>
            )}
          </div>

          {!hasCustom && (
            <div className="mx-4 sm:mx-6 my-3 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-900/15 border border-blue-100 dark:border-blue-800/30 text-xs text-blue-600 dark:text-blue-400 font-medium">
              Using company schedule. Editing will create a custom override.
            </div>
          )}

          {subTab === 'default' ? (
            // ── Default view ────────────────────────────────────────────────────
            <div className="px-4 sm:px-6 pb-6">
              <div className="rounded-2xl border border-gray-100 dark:border-white/8 overflow-hidden bg-white dark:bg-white/5 mt-2">
                {days.map((day, idx) => (
                  <div key={day.dayOfWeek} className={cn(idx > 0 && 'border-t border-gray-50 dark:border-white/5')}>
                    <div className={cn('flex flex-wrap items-center gap-2 px-3 sm:px-4 py-3', day.isOpen ? 'bg-white dark:bg-white/5' : 'bg-gray-50/60 dark:bg-black/10')}>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => patch(idx, { isOpen: !day.isOpen })}
                          className={cn('relative w-10 h-[22px] rounded-full flex-shrink-0 transition-all', day.isOpen ? 'bg-cyan-500 shadow-sm' : 'bg-gray-200 dark:bg-white/15')}>
                          <span className={cn('absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-all', day.isOpen ? 'left-[22px]' : 'left-[3px]')} />
                        </button>
                        <span className={cn('text-xs font-bold w-8', day.isOpen ? 'text-gray-700 dark:text-gray-100' : 'text-gray-300 dark:text-gray-600')}>
                          {DAY_SHORT[day.dayOfWeek]}
                        </span>
                      </div>
                      {day.isOpen ? (
                        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-1 min-w-[180px]">
                            <input type="time" value={day.openTime}  onChange={e => patch(idx, { openTime:  e.target.value })} className={timeCls} />
                            <span className="text-gray-300 font-bold text-sm flex-shrink-0">—</span>
                            <input type="time" value={day.closeTime} onChange={e => patch(idx, { closeTime: e.target.value })} className={timeCls} />
                          </div>
                          <button onClick={() => addBreak(idx)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-cyan-600 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800/40 hover:bg-cyan-50 dark:hover:bg-cyan-900/20 transition-colors whitespace-nowrap">
                            <Plus size={10} /> Break
                          </button>
                        </div>
                      ) : (
                        <div className="flex-1 flex items-center gap-2">
                          <div className="flex-1 h-[2px] bg-gray-100 dark:bg-white/5 rounded-full" />
                          <span className="text-xs text-gray-300 dark:text-gray-600 font-medium whitespace-nowrap">Day off</span>
                        </div>
                      )}
                    </div>
                    {day.isOpen && (day.breaks || []).map((brk, bIdx) => (
                      <div key={bIdx} className="flex flex-wrap items-center gap-2 pl-12 sm:pl-14 pr-3 sm:pr-4 py-2 bg-amber-50/60 dark:bg-amber-900/5 border-t border-gray-50 dark:border-white/5">
                        <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wide flex-shrink-0">Break</span>
                        <div className="flex items-center gap-2 flex-1 min-w-[180px]">
                          <input type="time" value={brk.start} onChange={e => patchBreak(idx, bIdx, { start: e.target.value })} className={timeCls} />
                          <span className="text-gray-300 font-bold text-sm flex-shrink-0">—</span>
                          <input type="time" value={brk.end}   onChange={e => patchBreak(idx, bIdx, { end:   e.target.value })} className={timeCls} />
                        </div>
                        <button onClick={() => removeBreak(idx, bIdx)} className="w-7 h-7 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <button onClick={save} disabled={saving} className="mt-5 flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-white text-sm disabled:opacity-60 transition-all hover:-translate-y-0.5"
                style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 4px 14px rgba(41,171,226,0.25)' }}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save Schedule
              </button>
            </div>
          ) : (
            // ── Advanced: 7-day × 48-slot grid — horizontal scroll on mobile ────
            <div className="px-4 sm:px-6 pb-6 mt-3">
              <p className="text-xs text-gray-400 mb-4">Click a slot to toggle working / closed. Blue = working.</p>
              {/* overflow-x-auto ensures horizontal scroll on small screens */}
              <div className="overflow-x-auto rounded-2xl border border-gray-100 dark:border-white/8">
                <table className="border-collapse" style={{ minWidth: '520px' }}>
                  <thead>
                    <tr>
                      <th className="w-14 px-2 py-2 text-[10px] font-black uppercase tracking-wide text-gray-400 border-b border-r border-gray-100 dark:border-white/8 bg-gray-50 dark:bg-black/20 sticky left-0 z-10">Time</th>
                      {DAY_SHORT.map((d, i) => (
                        <th key={i} className="px-2 py-2 border-b border-r border-gray-100 dark:border-white/8 bg-gray-50 dark:bg-black/20" style={{ minWidth: '72px' }}>
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-[10px] font-black uppercase tracking-wide text-gray-500 dark:text-gray-400">{d}</span>
                            <button
                              onClick={() => toggleDayAdvanced(i, !days[i]?.isOpen)}
                              className={cn('relative w-8 h-[18px] rounded-full transition-all', days[i]?.isOpen ? 'bg-cyan-500' : 'bg-gray-200 dark:bg-white/15')}>
                              <span className={cn('absolute top-[2px] w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-all', days[i]?.isOpen ? 'left-[18px]' : 'left-[2px]')} />
                            </button>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ALL_SLOTS.map((slot, sIdx) => (
                      <tr key={slot} className={cn(sIdx % 2 === 0 ? 'bg-white dark:bg-white/[0.01]' : 'bg-gray-50/40 dark:bg-white/[0.02]')}>
                        <td className="px-2 py-0.5 text-[10px] text-gray-400 font-mono border-r border-gray-100 dark:border-white/8 text-center sticky left-0 bg-inherit z-10">{slot}</td>
                        {days.map((day, dIdx) => {
                          const active = (day.slots ?? []).includes(slot)
                          return (
                            <td key={dIdx} className="px-1 py-0.5 border-r border-gray-50 dark:border-white/5 text-center cursor-pointer"
                              onClick={() => toggleSlot(dIdx, slot)}>
                              <div className={cn('h-4 rounded-sm mx-0.5 transition-all', active ? 'bg-cyan-500 opacity-80 hover:opacity-100' : 'bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10')} />
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button onClick={save} disabled={saving} className="mt-5 flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-white text-sm disabled:opacity-60 transition-all hover:-translate-y-0.5"
                style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 4px 14px rgba(41,171,226,0.25)' }}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save Advanced Schedule
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
