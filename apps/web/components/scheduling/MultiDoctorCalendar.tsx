'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Constants ────────────────────────────────────────────────────────────────
const HOUR_START  = 7
const HOUR_END    = 20
const SLOT_HEIGHT = 52

// ─── Types ────────────────────────────────────────────────────────────────────
interface Appointment {
  id: string
  startAt: string
  endAt: string
  status: string
  notes?: string
  patient: { id: string; firstName: string; lastName: string; phone: string }
  doctor:  { id?: string; user: { firstName: string; lastName: string } }
  service: { id: string; name: string; colour: string; durationMins: number; priceUGX?: number }
}
interface BlockedTime { id: string; startAt: string; endAt: string; reason?: string }
interface DoctorCol {
  doctor: { id: string; userId: string; firstName: string; lastName: string; colour: string; specialisation?: string; workingHours?: string }
  appointments: Appointment[]
  blockedTimes:  BlockedTime[]
}
interface Props {
  onBookSlot:         (doctorId: string, startAt: Date) => void
  onClickAppointment: (appt: Appointment) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeToTop(dateStr: string): number {
  const d    = new Date(dateStr)
  const mins = d.getHours() * 60 + d.getMinutes() - HOUR_START * 60
  return Math.max(0, (mins / 30) * SLOT_HEIGHT)
}
function durationToHeight(mins: number): number {
  return Math.max((mins / 30) * SLOT_HEIGHT, SLOT_HEIGHT * 0.45)
}
function fmtTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('en-UG', {
    timeZone: 'Africa/Kampala', hour: '2-digit', minute: '2-digit', hour12: true,
  })
}
function toDateStr(d: Date): string { return d.toISOString().slice(0, 10) }
function sameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString() }

function getWeekDates(anchor: Date): Date[] {
  const day = anchor.getDay()
  const mon = new Date(anchor)
  mon.setDate(anchor.getDate() - (day === 0 ? 6 : day - 1))
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(mon)
    d.setDate(mon.getDate() + i)
    return d
  })
}

function getMonthGrid(year: number, month: number): (Date | null)[][] {
  const first  = new Date(year, month, 1)
  const last   = new Date(year, month + 1, 0)
  let startDow = first.getDay()
  if (startDow === 0) startDow = 7
  startDow -= 1
  const cells: (Date | null)[] = Array(startDow).fill(null)
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)
  const rows: (Date | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
  return rows
}

const timeSlots = Array.from({ length: (HOUR_END - HOUR_START) * 2 }, (_, i) => {
  const h = Math.floor(i / 2) + HOUR_START
  const m = i % 2 === 0 ? '00' : '30'
  return `${String(h).padStart(2, '0')}:${m}`
})

const STATUS_RING: Record<string, string> = {
  PENDING:        '#94A3B8', // slate
  CONFIRMED:      '#3B82F6', // blue
  CHECKED_IN:     '#EAB308', // yellow
  IN_CHAIR:       '#F97316', // orange
  WITH_PROVIDER:  '#14B8A6', // teal
  READY_CHECKOUT: '#A855F7', // purple
  COMPLETED:      '#10B981', // green
  NO_SHOW:        '#EF4444', // red
  CANCELLED:      '#9CA3AF', // gray
}

// Pulse animation statuses (patient is actively in clinic)
const STATUS_PULSE = new Set(['CHECKED_IN', 'IN_CHAIR', 'WITH_PROVIDER'])

// ─── NowLine ──────────────────────────────────────────────────────────────────
function NowLine() {
  const [top, setTop] = useState<number | null>(null)
  useEffect(() => {
    function update() {
      const now  = new Date()
      const mins = now.getHours() * 60 + now.getMinutes() - HOUR_START * 60
      if (mins < 0 || mins > (HOUR_END - HOUR_START) * 60) { setTop(null); return }
      setTop((mins / 30) * SLOT_HEIGHT)
    }
    update()
    const t = setInterval(update, 30000)
    return () => clearInterval(t)
  }, [])
  if (top === null) return null
  return (
    <div className="absolute left-0 right-0 z-20 pointer-events-none flex items-center" style={{ top: `${top}px` }}>
      <div className="w-2 h-2 rounded-full bg-red-500 -ml-1 flex-shrink-0" />
      <div className="flex-1 h-[1.5px] bg-red-500" />
    </div>
  )
}

// ─── Appointment block ────────────────────────────────────────────────────────
function ApptBlock({ appt, onClick }: { appt: Appointment; onClick: () => void }) {
  const top    = timeToTop(appt.startAt)
  const height = durationToHeight(appt.service.durationMins)
  const colour = appt.service.colour || '#29ABE2'
  const ring   = STATUS_RING[appt.status] || '#9CA3AF'
  const short  = height < SLOT_HEIGHT

  const isPulsing = STATUS_PULSE.has(appt.status)

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className="absolute left-1 right-1 rounded-lg text-left overflow-hidden transition-all hover:scale-[1.02] hover:shadow-lg z-10"
      style={{
        top: `${top}px`, height: `${height}px`,
        background: colour + '22',
        border: `1px solid ${colour}30`,
        borderLeft: `3px solid ${colour}`,
      }}
    >
      <div className="px-1.5 py-1 h-full flex flex-col">
        <div className="flex items-center gap-1 min-w-0">
          <div
            className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', isPulsing && 'animate-pulse')}
            style={{ background: ring }}
          />
          <span className="text-[11px] font-bold truncate" style={{ color: colour }}>
            {appt.patient.firstName} {appt.patient.lastName}
          </span>
        </div>
        {!short && (
          <>
            <span className="text-[10px] text-gray-500 truncate mt-0.5">{appt.service.name}</span>
            <div className="flex items-center gap-1 mt-auto">
              <span className="text-[10px] text-gray-400">{fmtTime(appt.startAt)}</span>
              {appt.status !== 'PENDING' && appt.status !== 'CONFIRMED' && (
                <span className="text-[9px] font-bold px-1 rounded" style={{ background: ring + '30', color: ring }}>
                  {appt.status.replace('_', ' ')}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </button>
  )
}

// ─── Blocked block ────────────────────────────────────────────────────────────
function BlockedBlock({ block }: { block: BlockedTime }) {
  const start = new Date(block.startAt)
  const end   = new Date(block.endAt)
  const top    = timeToTop(block.startAt)
  const height = durationToHeight((end.getTime() - start.getTime()) / 60000)
  return (
    <div className="absolute left-1 right-1 rounded-lg z-[5] flex items-center justify-center"
      style={{
        top: `${top}px`, height: `${height}px`,
        background: 'repeating-linear-gradient(45deg,#F3F4F6,#F3F4F6 4px,#E5E7EB 4px,#E5E7EB 8px)',
        border: '1px solid #D1D5DB',
      }}>
      <span className="text-[10px] text-gray-400 font-medium px-1 text-center leading-tight">
        🔒 {block.reason || 'Blocked'}
      </span>
    </div>
  )
}

// ─── Time column ──────────────────────────────────────────────────────────────
function TimeCol({ width }: { width: number }) {
  return (
    <div className="flex-shrink-0 border-r border-gray-100 dark:border-white/10 relative"
      style={{ width, minWidth: width, height: `${timeSlots.length * SLOT_HEIGHT}px` }}>
      {timeSlots.map((slot, i) => (
        <div key={slot} className="absolute flex items-start pt-1 pr-2 justify-end w-full"
          style={{ top: `${i * SLOT_HEIGHT}px`, height: `${SLOT_HEIGHT}px` }}>
          {slot.endsWith(':00') && (
            <span className="text-[10px] font-medium text-gray-400 leading-none">{slot}</span>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Doctors View ─────────────────────────────────────────────────────────────
function DoctorsView({ columns, dateStr, onBookSlot, onClickAppointment }: {
  columns:          DoctorCol[]
  dateStr:          string
  onBookSlot:       (docId: string, at: Date) => void
  onClickAppointment: (a: Appointment) => void
}) {
  const today   = toDateStr(new Date()) === dateStr
  const TIME_W  = 56

  function handleClick(docId: string, slot: string) {
    const [h, m] = slot.split(':').map(Number)
    const d = new Date(dateStr + 'T00:00:00')
    d.setHours(h, m, 0, 0)
    onBookSlot(docId, d)
  }

  return (
    <div className="flex-1 overflow-auto">
      {/* Doctor headers */}
      <div className="flex sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-white/10 shadow-sm">
        <div className="flex-shrink-0 border-r border-gray-100 dark:border-white/10" style={{ width: TIME_W }} />
        {columns.map(({ doctor, appointments }) => {
          const count = appointments.filter((a) => a.status !== 'CANCELLED').length
          const init  = doctor.firstName[0] + doctor.lastName[0]
          return (
            <div key={doctor.id} className="flex-1 min-w-[130px] px-2 py-2.5 border-r border-gray-100 dark:border-white/10 flex items-center gap-2">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{ background: `linear-gradient(135deg,${doctor.colour},${doctor.colour}aa)` }}>
                {init}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-clinic-navy dark:text-white truncate">Dr. {doctor.firstName}</div>
                <div className="text-[10px] text-gray-400 truncate">{doctor.specialisation || 'General'}</div>
              </div>
              {count > 0 && (
                <span className="text-[10px] font-bold text-white px-1.5 py-0.5 rounded-full"
                  style={{ background: doctor.colour }}>{count}</span>
              )}
            </div>
          )
        })}
      </div>

      {/* Grid body */}
      <div className="flex" style={{ height: `${timeSlots.length * SLOT_HEIGHT}px` }}>
        <TimeCol width={TIME_W} />
        {columns.map(({ doctor, appointments, blockedTimes }) => {
          // Parse workingHours — supports both legacy {start,end} and per-day {"1":{start,end},...}
          let rawWh: any = { start: '08:00', end: '18:00' }
          try { if (doctor.workingHours) rawWh = JSON.parse(doctor.workingHours) } catch {}
          const startStr = rawWh.start ?? rawWh['1']?.start ?? rawWh['2']?.start ?? rawWh['0']?.start ?? '08:00'
          const endStr   = rawWh.end   ?? rawWh['1']?.end   ?? rawWh['2']?.end   ?? rawWh['0']?.end   ?? '18:00'
          const [sH, sM] = startStr.split(':').map(Number)
          const [eH, eM] = endStr.split(':').map(Number)
          const wTop     = ((sH * 60 + sM - HOUR_START * 60) / 30) * SLOT_HEIGHT
          const wBot     = ((eH * 60 + eM - HOUR_START * 60) / 30) * SLOT_HEIGHT
          const total    = timeSlots.length * SLOT_HEIGHT

          return (
            <div key={doctor.id}
              className="flex-1 min-w-[130px] border-r border-gray-100 dark:border-white/10 relative"
              style={{ height: `${total}px` }}>
              {/* Out-of-hours shading */}
              {wTop > 0    && <div className="absolute left-0 right-0 bg-gray-50/80 dark:bg-white/3" style={{ top: 0, height: wTop }} />}
              {wBot < total && <div className="absolute left-0 right-0 bg-gray-50/80 dark:bg-white/3" style={{ top: wBot, height: total - wBot }} />}
              {/* Slot rows */}
              {timeSlots.map((slot, i) => (
                <div key={slot}
                  className="absolute left-0 right-0 hover:bg-blue-50/40 transition-colors group cursor-pointer"
                  style={{ top: `${i * SLOT_HEIGHT}px`, height: `${SLOT_HEIGHT}px`, borderBottom: '1px solid #F5F5F7' }}
                  onClick={() => handleClick(doctor.id, slot)}>
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] text-clinic-blue opacity-0 group-hover:opacity-100 font-semibold pointer-events-none">
                    + Book
                  </span>
                </div>
              ))}
              {/* Blocked */}
              {blockedTimes.map((b) => <BlockedBlock key={b.id} block={b} />)}
              {/* Appointments */}
              {appointments.filter((a) => a.status !== 'CANCELLED').map((a) => (
                <ApptBlock key={a.id} appt={a} onClick={() => onClickAppointment(a)} />
              ))}
              {/* Now line */}
              {today && <NowLine />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Week View ────────────────────────────────────────────────────────────────
function WeekView({ weekDates, appointments, onBookSlot, onClickAppointment }: {
  weekDates:          Date[]
  appointments:       Appointment[]
  onBookSlot:         (docId: string, at: Date) => void
  onClickAppointment: (a: Appointment) => void
}) {
  const today  = new Date()
  const TIME_W = 56

  function handleClick(date: Date, slot: string) {
    const [h, m] = slot.split(':').map(Number)
    const d = new Date(date)
    d.setHours(h, m, 0, 0)
    onBookSlot('', d)
  }

  return (
    <div className="flex-1 overflow-auto">
      {/* Day headers */}
      <div className="flex sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-white/10 shadow-sm">
        <div className="flex-shrink-0 border-r border-gray-100 dark:border-white/10" style={{ width: TIME_W }} />
        {weekDates.map((date) => {
          const isToday  = sameDay(date, today)
          const dayCount = appointments.filter((a) => sameDay(new Date(a.startAt), date) && a.status !== 'CANCELLED').length
          return (
            <div key={date.toISOString()} className="flex-1 min-w-[100px] px-2 py-2.5 border-r border-gray-100 dark:border-white/10 text-center">
              <div className={cn('text-[11px] font-semibold uppercase', isToday ? 'text-clinic-blue' : 'text-gray-400')}>
                {date.toLocaleDateString('en-UG', { weekday: 'short' })}
              </div>
              <div className={cn(
                'text-lg font-bold mx-auto w-9 h-9 flex items-center justify-center rounded-full mt-0.5',
                isToday ? 'bg-clinic-navy text-white' : 'text-clinic-navy dark:text-white',
              )}>
                {date.getDate()}
              </div>
              {dayCount > 0 && (
                <div className="text-[10px] font-semibold text-clinic-blue">{dayCount} apt</div>
              )}
            </div>
          )
        })}
      </div>

      {/* Grid body */}
      <div className="flex" style={{ height: `${timeSlots.length * SLOT_HEIGHT}px` }}>
        <TimeCol width={TIME_W} />
        {weekDates.map((date) => {
          const isToday  = sameDay(date, today)
          const dayAppts = appointments.filter((a) => sameDay(new Date(a.startAt), date) && a.status !== 'CANCELLED')
          return (
            <div key={date.toISOString()}
              className={cn('flex-1 min-w-[100px] border-r border-gray-100 dark:border-white/10 relative', isToday && 'bg-blue-50/15 dark:bg-blue-900/10')}
              style={{ height: `${timeSlots.length * SLOT_HEIGHT}px` }}>
              {timeSlots.map((slot, i) => (
                <div key={slot}
                  className="absolute left-0 right-0 hover:bg-blue-50/40 transition-colors group cursor-pointer"
                  style={{ top: `${i * SLOT_HEIGHT}px`, height: `${SLOT_HEIGHT}px`, borderBottom: '1px solid #F5F5F7' }}
                  onClick={() => handleClick(date, slot)}>
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] text-clinic-blue opacity-0 group-hover:opacity-100 font-semibold pointer-events-none">
                    + Book
                  </span>
                </div>
              ))}
              {dayAppts.map((a) => <ApptBlock key={a.id} appt={a} onClick={() => onClickAppointment(a)} />)}
              {isToday && <NowLine />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Month View ───────────────────────────────────────────────────────────────
function MonthView({ year, month, appointments, onDateClick }: {
  year:        number
  month:       number
  appointments: Appointment[]
  onDateClick:  (date: Date) => void
}) {
  const today = new Date()
  const grid  = getMonthGrid(year, month)

  return (
    <div className="flex-1 overflow-auto p-3">
      <div className="grid grid-cols-6 gap-1 mb-1">
        {['Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => (
          <div key={d} className="text-center text-xs font-bold text-gray-400 py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-6 gap-1">
        {grid.flat().map((date, i) => {
          if (!date) return <div key={`e${i}`} className="rounded-xl bg-gray-50/50 dark:bg-white/3 min-h-[90px]" />
          const isToday   = sameDay(date, today)
          const inMonth   = date.getMonth() === month
          const dayAppts  = appointments.filter((a) => sameDay(new Date(a.startAt), date))
          return (
            <div key={date.toISOString()}
              onClick={() => onDateClick(date)}
              className={cn(
                'rounded-xl p-2 min-h-[90px] cursor-pointer transition-all border',
                isToday   ? 'bg-blue-50 dark:bg-blue-900/20 border-clinic-blue/30 shadow-sm' :
                !inMonth  ? 'bg-gray-50/50 dark:bg-white/3 border-gray-100 dark:border-white/5 opacity-40' :
                'bg-white dark:bg-white/5 border-gray-100 dark:border-white/10 hover:border-clinic-blue/30 hover:shadow-sm',
              )}>
              <div className={cn(
                'text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full mb-1.5',
                isToday ? 'bg-clinic-navy text-white' : 'text-gray-700 dark:text-gray-300',
              )}>
                {date.getDate()}
              </div>
              {dayAppts.slice(0, 3).map((a) => (
                <div key={a.id} className="text-[10px] font-medium truncate px-1.5 py-0.5 rounded-md mb-0.5"
                  style={{ background: a.service.colour + '22', color: a.service.colour }}>
                  {a.patient.firstName} · {a.service.name.split(' ')[0]}
                </div>
              ))}
              {dayAppts.length > 3 && (
                <div className="text-[10px] text-gray-400 font-medium mt-0.5">+{dayAppts.length - 3} more</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
type ViewMode = 'doctors' | 'week' | 'month'

export default function MultiDoctorCalendar({ onBookSlot, onClickAppointment }: Props) {
  const API = '/api-proxy'

  const [view,        setView]        = useState<ViewMode>('doctors')
  const [date,        setDate]        = useState(new Date())
  const [columns,     setColumns]     = useState<DoctorCol[]>([])
  const [weekAppts,   setWeekAppts]   = useState<Appointment[]>([])
  const [monthAppts,  setMonthAppts]  = useState<Appointment[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Read token fresh inside each fetch to avoid stale SSR closure
  function authHeaders() {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    return { Authorization: `Bearer ${token}` }
  }

  const fetchDay = useCallback(async (d: Date) => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`${API}/scheduling/calendar?date=${toDateStr(d)}`, { headers: authHeaders() })
      if (res.status === 401) { window.location.href = '/login'; return }
      if (!res.ok) { setError(`API error ${res.status}`); return }
      const data = await res.json()
      if (data.calendar) setColumns(data.calendar)
      setLastFetched(new Date())
    } catch (e: any) { setError(e?.message || 'Network error') } finally { setLoading(false) }
  }, [API])

  const fetchWeek = useCallback(async (anchor: Date) => {
    setLoading(true)
    setError(null)
    const week = getWeekDates(anchor)
    const s = toDateStr(week[0]), e = toDateStr(week[5])
    try {
      const res  = await fetch(`${API}/scheduling/appointments?startDate=${s}&endDate=${e}`, { headers: authHeaders() })
      if (res.status === 401) { window.location.href = '/login'; return }
      if (!res.ok) { setError(`API error ${res.status}`); return }
      const data = await res.json()
      setWeekAppts(Array.isArray(data) ? data : [])
      setLastFetched(new Date())
    } catch (e: any) { setError(e?.message || 'Network error') } finally { setLoading(false) }
  }, [API])

  const fetchMonth = useCallback(async (anchor: Date) => {
    setLoading(true)
    setError(null)
    const s = toDateStr(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
    const e = toDateStr(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0))
    try {
      const res  = await fetch(`${API}/scheduling/appointments?startDate=${s}&endDate=${e}`, { headers: authHeaders() })
      if (res.status === 401) { window.location.href = '/login'; return }
      if (!res.ok) { setError(`API error ${res.status}`); return }
      const data = await res.json()
      setMonthAppts(Array.isArray(data) ? data : [])
      setLastFetched(new Date())
    } catch (e: any) { setError(e?.message || 'Network error') } finally { setLoading(false) }
  }, [API])

  // Fetch on view/date change
  useEffect(() => {
    if (view === 'doctors') fetchDay(date)
    else if (view === 'week') fetchWeek(date)
    else fetchMonth(date)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, date.toDateString(), date.getMonth()])

  // 30s polling
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(() => {
      if (view === 'doctors') fetchDay(date)
      else if (view === 'week') fetchWeek(date)
      else fetchMonth(date)
    }, 30000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, date.toDateString()])

  // Navigation
  function navPrev() {
    const d = new Date(date)
    if (view === 'doctors') d.setDate(d.getDate() - 1)
    else if (view === 'week') d.setDate(d.getDate() - 7)
    else d.setMonth(d.getMonth() - 1)
    setDate(d)
  }
  function navNext() {
    const d = new Date(date)
    if (view === 'doctors') d.setDate(d.getDate() + 1)
    else if (view === 'week') d.setDate(d.getDate() + 7)
    else d.setMonth(d.getMonth() + 1)
    setDate(d)
  }

  // Title
  let title = ''
  if (view === 'doctors') {
    title = date.toLocaleDateString('en-UG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  } else if (view === 'week') {
    const wk = getWeekDates(date)
    title = `${wk[0].toLocaleDateString('en-UG', { day: 'numeric', month: 'short' })} – ${wk[5].toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' })}`
  } else {
    title = date.toLocaleDateString('en-UG', { month: 'long', year: 'numeric' })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-white/10">
        {/* Nav */}
        <div className="flex items-center gap-1">
          <button onClick={navPrev}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
            <ChevronLeft size={15} />
          </button>
          <button onClick={() => setDate(new Date())}
            className="px-3 h-8 rounded-xl text-xs font-semibold text-clinic-navy dark:text-white bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/15 transition-colors">
            Today
          </button>
          <button onClick={navNext}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
            <ChevronRight size={15} />
          </button>
        </div>

        {/* Title */}
        <span className="text-sm font-bold text-clinic-navy dark:text-white flex-1 truncate">{title}</span>

        {/* Refresh */}
        {lastFetched && (
          <div className="flex items-center gap-1 text-[10px] text-gray-400 mr-1">
            <RefreshCw size={10} className={cn(loading && 'animate-spin')} />
            <span className="hidden sm:inline">
              {lastFetched.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}

        {/* View toggle */}
        <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-white/10 rounded-xl p-0.5">
          {(['doctors','week','month'] as ViewMode[]).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                view === v
                  ? 'bg-white dark:bg-white/15 text-clinic-navy dark:text-white shadow-sm'
                  : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
              )}>
              {v === 'doctors' ? 'Doctors' : v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>

        {loading && <div className="w-2 h-2 rounded-full bg-clinic-blue animate-pulse ml-1" />}
      </div>

      {/* Calendar views */}
      {view === 'doctors' && (
        <DoctorsView
          columns={columns}
          dateStr={toDateStr(date)}
          onBookSlot={onBookSlot}
          onClickAppointment={onClickAppointment}
        />
      )}
      {view === 'week' && (
        <WeekView
          weekDates={getWeekDates(date)}
          appointments={weekAppts}
          onBookSlot={onBookSlot}
          onClickAppointment={onClickAppointment}
        />
      )}
      {view === 'month' && (
        <MonthView
          year={date.getFullYear()}
          month={date.getMonth()}
          appointments={monthAppts}
          onDateClick={(d) => { setDate(d); setView('doctors') }}
        />
      )}

      {!loading && view === 'doctors' && columns.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <div className="text-center">
            <div className="text-5xl mb-3">📅</div>
            {error ? (
              <>
                <p className="font-semibold text-red-500">Failed to load calendar</p>
                <p className="text-sm mt-1 text-red-400">{error}</p>
                <button onClick={() => fetchDay(date)} className="mt-3 px-4 py-2 text-sm font-semibold bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors">
                  Retry
                </button>
              </>
            ) : (
              <>
                <p className="font-semibold text-gray-500">No doctors found</p>
                <p className="text-sm mt-1">Add doctors in the Doctors tab to see the calendar</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
