'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, ChevronLeft, ChevronRight, X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SpecialDay { id: string; date: string; type: 'DAY_OFF' | 'SPECIAL_WORKING'; openTime?: string; closeTime?: string; note?: string }

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const WEEK_DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa']

const API = '/api-proxy'
function hdr() {
  const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  return { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }
}

function isoDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function firstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

export default function SpecialDaysTab() {
  const [year,         setYear]         = useState(new Date().getFullYear())
  const [specials,     setSpecials]     = useState<SpecialDay[]>([])
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [toast,        setToast]        = useState<{ msg: string; ok: boolean } | null>(null)
  const [groupSelect,  setGroupSelect]  = useState(false)
  const [selected,     setSelected]     = useState<string[]>([])  // for group mode
  const [subTab,       setSubTab]       = useState<'schedule' | 'special'>('special')
  const [modal,        setModal]        = useState<{ date: string; existing?: SpecialDay } | null>(null)
  const [modalType,    setModalType]    = useState<'DAY_OFF' | 'SPECIAL_WORKING'>('DAY_OFF')
  const [modalOpen,    setModalOpen]    = useState('07:00')
  const [modalClose,   setModalClose]   = useState('18:00')
  const [modalNote,    setModalNote]    = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`${API}/scheduling/special-days?year=${year}`, { headers: hdr() })
      const d = await r.json()
      setSpecials(Array.isArray(d) ? d.map((s: any) => ({ ...s, date: s.date.slice(0, 10) })) : [])
    } catch { setSpecials([]) }
    finally { setLoading(false) }
  }, [year])

  useEffect(() => { load() }, [load])

  function specialFor(dateStr: string) {
    return specials.find(s => s.date === dateStr)
  }

  function openModal(dateStr: string) {
    const ex = specialFor(dateStr)
    setModal({ date: dateStr, existing: ex })
    setModalType(ex?.type ?? 'DAY_OFF')
    setModalOpen(ex?.openTime  ?? '07:00')
    setModalClose(ex?.closeTime ?? '18:00')
    setModalNote(ex?.note ?? '')
  }

  function handleDayClick(dateStr: string) {
    if (groupSelect) {
      setSelected(prev => prev.includes(dateStr) ? prev.filter(d => d !== dateStr) : [...prev, dateStr])
    } else {
      openModal(dateStr)
    }
  }

  async function saveModal() {
    if (!modal) return
    setSaving(true)
    try {
      const body = { date: modal.date, type: modalType, openTime: modalOpen || undefined, closeTime: modalClose || undefined, note: modalNote || undefined }
      const r = await fetch(`${API}/scheduling/special-days`, { method: 'POST', headers: hdr(), body: JSON.stringify(body) })
      if (r.ok) { flash('Special day saved', true); await load() }
      else flash('Failed to save', false)
    } catch { flash('Network error', false) }
    finally { setSaving(false); setModal(null) }
  }

  async function deleteModal() {
    if (!modal?.existing) return
    setSaving(true)
    try {
      const r = await fetch(`${API}/scheduling/special-days/${modal.existing.id}`, { method: 'DELETE', headers: hdr() })
      if (r.ok) { flash('Removed', true); await load() }
      else flash('Failed to remove', false)
    } catch { flash('Network error', false) }
    finally { setSaving(false); setModal(null) }
  }

  async function saveGroupSelected(type: 'DAY_OFF' | 'SPECIAL_WORKING') {
    setSaving(true)
    try {
      await Promise.all(selected.map(date =>
        fetch(`${API}/scheduling/special-days`, { method: 'POST', headers: hdr(), body: JSON.stringify({ date, type }) })
      ))
      flash(`${selected.length} days marked`, true)
      setSelected([])
      await load()
    } catch { flash('Network error', false) }
    finally { setSaving(false) }
  }

  function flash(msg: string, ok: boolean) {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3000)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toast */}
      {toast && (
        <div className={cn('fixed top-5 right-5 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-semibold text-white shadow-xl', toast.ok ? 'bg-emerald-500' : 'bg-red-500')}>
          {toast.ok ? <Check size={16} /> : <X size={16} />} {toast.msg}
        </div>
      )}

      {/* Day detail modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#0f1729] rounded-2xl shadow-2xl w-full max-w-sm border border-gray-100 dark:border-white/10 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/8">
              <h3 className="font-black text-gray-800 dark:text-white text-sm">{modal.date}</h3>
              <button onClick={() => setModal(null)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
                <X size={14} className="text-gray-400" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <p className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-2">Type</p>
                <div className="flex gap-2">
                  {(['DAY_OFF', 'SPECIAL_WORKING'] as const).map(t => (
                    <button key={t} onClick={() => setModalType(t)}
                      className={cn('flex-1 py-2 rounded-xl text-xs font-bold border transition-all', modalType === t ? (t === 'DAY_OFF' ? 'bg-red-100 border-red-300 text-red-600 dark:bg-red-900/30 dark:border-red-700 dark:text-red-400' : 'bg-amber-100 border-amber-300 text-amber-600 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-400') : 'border-gray-200 dark:border-white/10 text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5')}>
                      {t === 'DAY_OFF' ? 'Day Off' : 'Special Working'}
                    </button>
                  ))}
                </div>
              </div>
              {modalType === 'SPECIAL_WORKING' && (
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Opens</p>
                    <input type="time" value={modalOpen}  onChange={e => setModalOpen(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-white/10 text-gray-700 dark:text-gray-200 focus:outline-none" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Closes</p>
                    <input type="time" value={modalClose} onChange={e => setModalClose(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-white/10 text-gray-700 dark:text-gray-200 focus:outline-none" />
                  </div>
                </div>
              )}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Note (optional)</p>
                <input value={modalNote} onChange={e => setModalNote(e.target.value)} placeholder="e.g. Public Holiday" className="w-full px-2.5 py-1.5 text-xs border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-white/10 text-gray-700 dark:text-gray-200 focus:outline-none" />
              </div>
            </div>
            <div className="flex items-center gap-2 px-5 pb-5">
              {modal.existing && (
                <button onClick={deleteModal} disabled={saving}
                  className="px-3 py-2 rounded-xl text-xs font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors border border-red-200 dark:border-red-800/40">
                  Remove
                </button>
              )}
              <button onClick={() => setModal(null)} className="ml-auto px-4 py-2 rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">Cancel</button>
              <button onClick={saveModal} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-60 transition-all"
                style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex-shrink-0 px-4 sm:px-6 pt-5 pb-4 border-b border-gray-100 dark:border-white/8">
        <div className="flex flex-wrap items-start sm:items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-lg font-black text-gray-800 dark:text-white">Special Days</h2>
            <p className="text-sm text-gray-400 mt-0.5">Mark dates as day-off or special working days</p>
          </div>
          {/* Year nav */}
          <div className="flex items-center gap-2">
            <button onClick={() => setYear(y => y - 1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
              <ChevronLeft size={15} className="text-gray-500" />
            </button>
            <span className="text-sm font-black text-gray-700 dark:text-gray-200 w-12 text-center">{year}</span>
            <button onClick={() => setYear(y => y + 1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
              <ChevronRight size={15} className="text-gray-500" />
            </button>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1 bg-gray-100 dark:bg-white/8 rounded-xl p-1">
            {([['schedule', 'Schedule for the week'], ['special', 'Special days schedule']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setSubTab(k)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition-all', subTab === k ? 'bg-white dark:bg-white/15 text-gray-800 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200')}>
                {label}
              </button>
            ))}
          </div>

          {/* Group select toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <button onClick={() => { setGroupSelect(g => !g); setSelected([]) }}
              className={cn('relative w-9 h-[20px] rounded-full transition-all', groupSelect ? 'bg-cyan-500' : 'bg-gray-200 dark:bg-white/15')}>
              <span className={cn('absolute top-[2px] w-4 h-4 rounded-full bg-white shadow-sm transition-all', groupSelect ? 'left-[18px]' : 'left-[2px]')} />
            </button>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Enable group dates selection</span>
          </label>
        </div>

        {/* Group action bar */}
        {groupSelect && selected.length > 0 && (
          <div className="mt-3 flex items-center gap-2 p-2.5 rounded-xl bg-cyan-50 dark:bg-cyan-900/15 border border-cyan-100 dark:border-cyan-800/30">
            <span className="text-xs font-bold text-cyan-600 dark:text-cyan-400">{selected.length} date{selected.length !== 1 ? 's' : ''} selected</span>
            <button onClick={() => saveGroupSelected('DAY_OFF')} disabled={saving}
              className="ml-auto px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-60">
              Mark as Day Off
            </button>
            <button onClick={() => saveGroupSelected('SPECIAL_WORKING')} disabled={saving}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 transition-colors disabled:opacity-60">
              Mark as Special Working
            </button>
            <button onClick={() => setSelected([])} className="p-1.5 rounded-lg text-gray-400 hover:bg-white dark:hover:bg-white/10 transition-colors">
              <X size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 size={28} className="animate-spin text-cyan-500" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {MONTHS.map((monthName, mIdx) => {
                const totalDays = daysInMonth(year, mIdx)
                const startDay  = firstDayOfMonth(year, mIdx)
                const cells: (number | null)[] = [...Array(startDay).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)]
                // pad to full rows
                while (cells.length % 7 !== 0) cells.push(null)

                return (
                  <div key={mIdx} className="rounded-xl border border-gray-100 dark:border-white/8 overflow-hidden bg-white dark:bg-white/5 p-3">
                    <p className="text-xs font-black text-gray-600 dark:text-gray-300 mb-2 text-center uppercase tracking-wide">{monthName}</p>
                    <div className="grid grid-cols-7 gap-px mb-1">
                      {WEEK_DAYS.map(d => <div key={d} className="text-[9px] text-center font-bold text-gray-300 dark:text-gray-600">{d}</div>)}
                    </div>
                    <div className="grid grid-cols-7 gap-px">
                      {cells.map((day, ci) => {
                        if (day === null) return <div key={ci} />
                        const dateStr = `${year}-${String(mIdx + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
                        const special = specialFor(dateStr)
                        const isSelected = selected.includes(dateStr)
                        const isToday = dateStr === isoDate(new Date())

                        let cellCls = 'relative w-full aspect-square flex items-center justify-center rounded-md text-[10px] font-semibold cursor-pointer transition-all select-none'
                        if (isSelected)                              cellCls += ' bg-cyan-500 text-white'
                        else if (special?.type === 'DAY_OFF')        cellCls += ' bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800/40'
                        else if (special?.type === 'SPECIAL_WORKING') cellCls += ' bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                        else if (isToday)                             cellCls += ' ring-1 ring-cyan-500 text-cyan-600 dark:text-cyan-400'
                        else                                          cellCls += ' text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/8'

                        return (
                          <div key={ci} className={cellCls} onClick={() => handleDayClick(dateStr)}>
                            {day}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 mt-5 px-1">
              {[
                { colour: 'bg-cyan-500',                                       label: 'Selected day' },
                { colour: 'bg-gray-100 dark:bg-white/8 ring-1 ring-gray-200', label: 'Working day' },
                { colour: 'bg-red-100 dark:bg-red-900/30 border border-red-200', label: 'Day off' },
                { colour: 'bg-amber-100 dark:bg-amber-900/30',                 label: 'Special working day' },
              ].map(({ colour, label }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div className={cn('w-4 h-4 rounded-md flex-shrink-0', colour)} />
                  <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
