'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, RefreshCw, X, Lock, GripVertical, RotateCcw } from 'lucide-react'
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
  onBookSlot?:         (doctorId: string, startAt: Date) => void
  onClickAppointment?: (appt: Appointment) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeToTop(dateStr: string): number {
  const d    = new Date(dateStr)
  const mins = d.getHours() * 60 + d.getMinutes() - HOUR_START * 60
  return Math.max(0, (mins / 30) * SLOT_HEIGHT)
}
function durationToHeight(mins: number): number {
  return Math.max((mins / 30) * SLOT_HEIGHT, 60)
}
function fmtTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('en-UG', {
    timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hour12: true,
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

async function fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options)
      if ((res.status === 502 || res.status === 503) && i < retries - 1) {
        await new Promise(r => setTimeout(r, 2000)); continue
      }
      return res
    } catch (e) {
      if (i === retries - 1) throw e
      await new Promise(r => setTimeout(r, 2000))
    }
  }
  throw new Error('All retries failed')
}

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

const STATUS_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  PENDING:     { label: 'Pending',     bg: '#FFF7ED', color: '#F97316' },
  CONFIRMED:   { label: 'Confirmed',   bg: '#ECFDF5', color: '#10B981' },
  CANCELLED:   { label: 'Cancelled',   bg: '#FEF2F2', color: '#EF4444' },
  COMPLETED:   { label: 'Completed',   bg: '#EFF6FF', color: '#3B82F6' },
  NO_SHOW:     { label: 'No Show',     bg: '#F9FAFB', color: '#9CA3AF' },
  RESCHEDULED: { label: 'Rescheduled', bg: '#FEFCE8', color: '#EAB308' },
}

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

// ─── Overlap layout ───────────────────────────────────────────────────────────
function groupOverlapping(appts: Appointment[]) {
  if (!appts.length) return [] as Array<Appointment & { colIndex: number; totalCols: number }>
  const sorted = [...appts].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
  const colEndTimes: number[] = []
  const result: Array<Appointment & { colIndex: number; totalCols: number }> = sorted.map(appt => {
    const start = new Date(appt.startAt).getTime()
    const end   = new Date(appt.endAt).getTime()
    let col = colEndTimes.findIndex(e => e <= start)
    if (col === -1) col = colEndTimes.length
    colEndTimes[col] = end
    return { ...appt, colIndex: col, totalCols: 0 }
  })
  for (let i = 0; i < result.length; i++) {
    const aStart = new Date(result[i].startAt).getTime()
    const aEnd   = new Date(result[i].endAt).getTime()
    let maxCol = result[i].colIndex
    for (let j = 0; j < result.length; j++) {
      if (i === j) continue
      const bStart = new Date(result[j].startAt).getTime()
      const bEnd   = new Date(result[j].endAt).getTime()
      if (aStart < bEnd && aEnd > bStart) maxCol = Math.max(maxCol, result[j].colIndex)
    }
    result[i] = { ...result[i], totalCols: maxCol + 1 }
  }
  return result
}

// ─── Appointment block ────────────────────────────────────────────────────────
function ApptBlock({ appt, colIndex, totalCols, onClick, resizingEndAt, onResizeStart, onResizeTouchStart, isDraggable }: {
  appt: Appointment
  colIndex: number
  totalCols: number
  onClick: () => void
  resizingEndAt?: string
  onResizeStart?: (e: React.MouseEvent) => void
  onResizeTouchStart?: (e: React.TouchEvent) => void
  isDraggable?: boolean
}) {
  const top           = timeToTop(appt.startAt)
  const effectiveMins = resizingEndAt
    ? (new Date(resizingEndAt).getTime() - new Date(appt.startAt).getTime()) / 60000
    : (new Date(appt.endAt).getTime()    - new Date(appt.startAt).getTime()) / 60000
  const height     = durationToHeight(effectiveMins)
  const colour      = appt.service.colour || '#29ABE2'
  const short       = height < SLOT_HEIGHT
  const isResizing  = !!resizingEndAt
  const isCancelled = appt.status === 'CANCELLED'
  const badge       = STATUS_BADGE[appt.status]

  const pct   = 100 / Math.max(1, totalCols)
  const left  = `calc(${colIndex * pct}% + 2px)`
  const width = `calc(${pct}% - 4px)`

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      draggable={isDraggable && !isCancelled}
      onDragStart={isDraggable && !isCancelled ? (e) => { e.stopPropagation(); e.dataTransfer.setData('text/plain', appt.id); e.dataTransfer.effectAllowed = 'move' } : undefined}
      className={cn(
        'absolute rounded-lg text-left overflow-hidden transition-all z-10',
        isResizing ? 'opacity-80' : isCancelled ? 'opacity-50 cursor-default' : 'hover:scale-[1.02] hover:shadow-lg',
      )}
      style={{
        top:        `${top}px`,
        height:     `${height}px`,
        left,
        width,
        background: colour + '22',
        border:     isResizing ? '2px dashed rgba(255,255,255,0.8)' : `1px solid ${colour}30`,
        borderLeft: isResizing ? '2px dashed rgba(255,255,255,0.8)' : `3px solid ${colour}`,
      }}
    >
      <div className="px-1.5 py-1 h-full flex flex-col">
        <span className={cn('text-[11px] font-bold truncate', isCancelled && 'line-through')} style={{ color: colour }}>
          {appt.patient.firstName} {appt.patient.lastName}
        </span>
        <span className="text-[10px] text-gray-500 truncate mt-0.5">{appt.service.name}</span>
        <span className="text-[10px] text-gray-400 mt-0.5">{fmtTime(appt.startAt)}</span>
      </div>
      {badge && !isResizing && (
        <div className="absolute bottom-1 right-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full pointer-events-none"
          style={{ background: badge.bg, color: badge.color }}>
          {badge.label}
        </div>
      )}

      {/* Resize handle — visible on hover */}
      {(onResizeStart || onResizeTouchStart) && (
        <div
          className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
          style={{ backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '0 0 6px 6px' }}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onResizeStart?.(e) }}
          onTouchStart={(e) => { e.stopPropagation(); onResizeTouchStart?.(e) }}
        >
          <div className="w-8 h-0.5 bg-white/60 rounded" />
        </div>
      )}

      {/* End-time tooltip while dragging */}
      {isResizing && (
        <div className="absolute bottom-4 right-1 text-[10px] bg-black/70 text-white px-1.5 py-0.5 rounded font-mono pointer-events-none">
          {new Date(resizingEndAt!).toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
          })}
        </div>
      )}
    </button>
  )
}

// ─── Blocked block ────────────────────────────────────────────────────────────
function BlockedBlock({ block, onRemove }: { block: BlockedTime; onRemove?: () => void }) {
  const start  = new Date(block.startAt)
  const end    = new Date(block.endAt)
  const top    = timeToTop(block.startAt)
  const height = durationToHeight((end.getTime() - start.getTime()) / 60000)
  return (
    <div
      className={cn('absolute left-1 right-1 rounded-lg z-[5] group flex items-center justify-center', onRemove && 'cursor-pointer hover:brightness-95')}
      style={{
        top: `${top}px`, height: `${height}px`,
        background: 'repeating-linear-gradient(45deg,#F3F4F6,#F3F4F6 4px,#E5E7EB 4px,#E5E7EB 8px)',
        border: '1px solid #D1D5DB',
      }}
      onClick={e => { e.stopPropagation(); onRemove?.() }}>
      <span className="text-[10px] text-gray-400 font-medium px-1 text-center leading-tight">
        🔒 {block.reason || 'Blocked'}
      </span>
      {onRemove && (
        <div className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white rounded-full p-0.5 shadow-sm">
          <X size={9} className="text-red-400" />
        </div>
      )}
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

// ─── Appointment Detail Modal ─────────────────────────────────────────────────
function ApptDetailModal({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const colour   = appt.service.colour || '#29ABE2'
  const initials = `${appt.patient.firstName[0] || ''}${appt.patient.lastName[0] || ''}`
  const ring     = STATUS_RING[appt.status] || '#9CA3AF'
  const dateLabel = new Date(appt.startAt).toLocaleDateString('en-UG', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi',
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-[#0e1f3d] rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in"
        onClick={e => e.stopPropagation()}>

        {/* Coloured header */}
        <div className="px-5 py-4 flex items-center gap-3"
          style={{ background: colour + '18', borderBottom: `2px solid ${colour}30` }}>
          <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-base font-bold flex-shrink-0"
            style={{ background: `linear-gradient(135deg,${colour},${colour}bb)` }}>
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 dark:text-white truncate text-sm">
              {appt.patient.firstName} {appt.patient.lastName}
            </p>
            {appt.patient.phone ? (
              <a href={`tel:${appt.patient.phone}`}
                className="text-xs text-gray-400 hover:text-clinic-blue dark:hover:text-blue-400 transition-colors">
                📞 {appt.patient.phone}
              </a>
            ) : (
              <span className="text-xs text-gray-400">No phone on record</span>
            )}
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors flex-shrink-0">
            <X size={15} />
          </button>
        </div>

        {/* Details */}
        <div className="px-5 py-4 space-y-3">
          {/* Service + Status */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold px-2.5 py-1 rounded-full text-white"
              style={{ background: colour }}>
              {appt.service.name}
            </span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{ background: ring + '20', color: ring }}>
              {appt.status.replace(/_/g, ' ')}
            </span>
          </div>

          {appt.status === 'CANCELLED' && (
            <div className="text-xs text-red-500 font-semibold bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2 flex items-center gap-2">
              <span>🚫</span> This appointment was cancelled — editing is not available
            </div>
          )}

          {/* Date & Time */}
          <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <span className="text-gray-400 text-base">📅</span>
            <span className="font-medium">{dateLabel}</span>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span className="text-gray-500 dark:text-gray-400">{fmtTime(appt.startAt)} – {fmtTime(appt.endAt)}</span>
          </div>

          {/* Notes */}
          {appt.notes && (
            <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-white/5 rounded-xl px-3 py-2.5 leading-relaxed">
              💬 {appt.notes}
            </div>
          )}
        </div>

        {/* View Full Profile */}
        <div className="px-5 pb-5">
          <Link href={`/doctor/patients/${appt.patient.id}`}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
            style={{ background: `linear-gradient(135deg,${colour},${colour}cc)` }}
            onClick={onClose}>
            View Full Profile →
          </Link>
        </div>
      </div>
    </div>
  )
}

// ─── Doctors View ─────────────────────────────────────────────────────────────
function DoctorsView({ columns, dateStr, onBookSlot, onClickAppointment, onBlockClick, onSlotDragStart, onSlotDragMove, dragOverlay, workingHours, resizing, onApptResizeStart, onApptResizeTouchStart, onApptDrop, onReorderColumns }: {
  columns:                  DoctorCol[]
  dateStr:                  string
  onBookSlot?:              (docId: string, at: Date) => void
  onClickAppointment?:      (a: Appointment) => void
  onBlockClick?:            (doctorId: string, blockId: string) => void
  onSlotDragStart?:         (doctorId: string, slotIdx: number) => void
  onSlotDragMove?:          (doctorId: string, slotIdx: number) => void
  dragOverlay?:             { doctorId: string; startIdx: number; endIdx: number } | null
  workingHours?:            any[]
  resizing?:                { apptId: string; originalEndAt: string; currentEndAt: string } | null
  onApptResizeStart?:       (e: React.MouseEvent, appt: Appointment) => void
  onApptResizeTouchStart?:  (e: React.TouchEvent, appt: Appointment) => void
  onApptDrop?:              (apptId: string, targetDoctorId: string, slotIdx: number) => void
  onReorderColumns?:        (newOrder: string[]) => void
}) {
  const today      = toDateStr(new Date()) === dateStr
  const TIME_W     = 56
  const closedDays = new Set(workingHours?.filter(w => !w.isOpen).map(w => w.dayOfWeek) ?? [])
  const dayOfWeek  = new Date(dateStr + 'T12:00:00').getDay()
  const isClosed   = closedDays.has(dayOfWeek)
  const [closedToast, setClosedToast] = useState(false)
  const [dragOverDocId, setDragOverDocId] = useState<string | null>(null)
  const dragDocIdRef = React.useRef<string | null>(null)

  function handleClick(docId: string, slot: string) {
    if (!onBookSlot) return
    if (isClosed) {
      setClosedToast(true)
      setTimeout(() => setClosedToast(false), 2500)
      return
    }
    const [h, m] = slot.split(':').map(Number)
    const d = new Date(dateStr + 'T00:00:00')
    d.setHours(h, m, 0, 0)
    onBookSlot(docId, d)
  }

  return (
    <div className="flex-1 overflow-auto min-h-0">
      {closedToast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-bold text-white shadow-xl bg-red-500 pointer-events-none">
          🚫 This day is closed
        </div>
      )}
      {isClosed && (
        <div className="flex-shrink-0 flex items-center justify-center gap-2 py-2.5 bg-red-50 dark:bg-red-900/10 border-b border-red-100 dark:border-red-800/20">
          <span>🚫</span>
          <span className="text-sm font-bold text-red-500">This day is closed — no new bookings can be made</span>
        </div>
      )}
      {/* Doctor headers */}
      <div className="flex sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-white/10 shadow-sm">
        <div className="flex-shrink-0 border-r border-gray-100 dark:border-white/10" style={{ width: TIME_W }} />
        {columns.map(({ doctor, appointments }) => {
          const count = appointments.filter((a) => a.status !== 'CANCELLED').length
          const init  = doctor.firstName[0] + doctor.lastName[0]
          let hoursLabel: string | null = null
          try {
            if (doctor.workingHours) {
              const raw = JSON.parse(doctor.workingHours)
              const s = raw.start ?? raw['1']?.start
              const e = raw.end   ?? raw['1']?.end
              if (s && e) hoursLabel = `${s} – ${e}`
            }
          } catch {}
          const isDragOver = dragOverDocId === doctor.id
          return (
            <div key={doctor.id}
              className={cn(
                'flex-1 min-w-[130px] px-2 py-2.5 border-r border-gray-100 dark:border-white/10 flex items-center gap-2 transition-colors',
                isDragOver && 'bg-blue-50/60 dark:bg-blue-900/20 border-clinic-blue/40',
                onReorderColumns && 'cursor-grab active:cursor-grabbing',
              )}
              draggable={!!onReorderColumns}
              onDragStart={(e) => {
                dragDocIdRef.current = doctor.id
                e.dataTransfer.setData('cc_doctor_id', doctor.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOverDocId(doctor.id) }}
              onDragLeave={() => setDragOverDocId(null)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOverDocId(null)
                const fromId = e.dataTransfer.getData('cc_doctor_id')
                if (!fromId || fromId === doctor.id || !onReorderColumns) return
                const currentOrder = columns.map(c => c.doctor.id)
                const fromIdx = currentOrder.indexOf(fromId)
                const toIdx   = currentOrder.indexOf(doctor.id)
                if (fromIdx === -1 || toIdx === -1) return
                const newOrder = [...currentOrder]
                newOrder.splice(fromIdx, 1)
                newOrder.splice(toIdx, 0, fromId)
                onReorderColumns(newOrder)
              }}>
              {onReorderColumns && (
                <GripVertical size={12} className="text-gray-300 dark:text-gray-600 flex-shrink-0 -ml-0.5" />
              )}
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{ background: `linear-gradient(135deg,${doctor.colour},${doctor.colour}aa)` }}>
                {init}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-clinic-navy dark:text-white truncate">Dr. {doctor.firstName}</div>
                <div className="text-[10px] text-gray-400 truncate">{doctor.specialisation || 'General'}</div>
                {hoursLabel && <div className="text-[10px] text-gray-300 dark:text-gray-600 truncate">{hoursLabel}</div>}
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

          const ov = dragOverlay?.doctorId === doctor.id ? dragOverlay : null

          return (
            <div key={doctor.id}
              className="flex-1 min-w-[130px] border-r border-gray-100 dark:border-white/10 relative select-none"
              style={{ height: `${total}px` }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const apptId = e.dataTransfer.getData('text/plain')
                if (!apptId || !onApptDrop) return
                const rect = e.currentTarget.getBoundingClientRect()
                const slotIdx = Math.max(0, Math.min(Math.floor((e.clientY - rect.top) / SLOT_HEIGHT), timeSlots.length - 1))
                onApptDrop(apptId, doctor.id, slotIdx)
              }}>
              {/* Out-of-hours shading */}
              {wTop > 0    && <div className="absolute left-0 right-0 bg-gray-50/80 dark:bg-white/3" style={{ top: 0, height: wTop }} />}
              {wBot < total && <div className="absolute left-0 right-0 bg-gray-50/80 dark:bg-white/3" style={{ top: wBot, height: total - wBot }} />}
              {/* Slot rows */}
              {timeSlots.map((slot, i) => (
                <div key={slot}
                  className={`absolute left-0 right-0 transition-colors group${onBookSlot && !isClosed ? ' hover:bg-blue-50/40 cursor-pointer' : ''}`}
                  style={{ top: `${i * SLOT_HEIGHT}px`, height: `${SLOT_HEIGHT}px`, borderBottom: '1px solid #F5F5F7' }}
                  onMouseDown={e => { if (!isClosed) { e.preventDefault(); onSlotDragStart?.(doctor.id, i) } }}
                  onMouseEnter={e => { if (e.buttons === 1 && !isClosed) onSlotDragMove?.(doctor.id, i) }}
                  onClick={() => handleClick(doctor.id, slot)}>
                  {onBookSlot && !isClosed && (
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] text-clinic-blue opacity-0 group-hover:opacity-100 font-semibold pointer-events-none">
                      + Book
                    </span>
                  )}
                </div>
              ))}
              {/* Drag overlay */}
              {ov && (() => {
                const s = Math.min(ov.startIdx, ov.endIdx)
                const e = Math.max(ov.startIdx, ov.endIdx)
                return (
                  <div className="absolute left-0 right-0 z-[15] pointer-events-none rounded bg-blue-400/20 border border-blue-400/40"
                    style={{ top: s * SLOT_HEIGHT, height: (e - s + 1) * SLOT_HEIGHT }} />
                )
              })()}
              {/* Blocked */}
              {blockedTimes.map((b) => (
                <BlockedBlock key={b.id} block={b}
                  onRemove={onBlockClick ? () => onBlockClick(doctor.id, b.id) : undefined} />
              ))}
              {/* Appointments — max 2 visible columns, +N pill for overflow */}
              {(() => {
                const grouped = groupOverlapping(appointments)
                const visible = grouped.filter(a => a.colIndex < 2)
                const hidden  = grouped.filter(a => a.colIndex >= 2)

                // One "+N" chip per unique start-minute for hidden appointments
                const seen = new Set<string>()
                const pills: React.ReactElement[] = []
                hidden.forEach(a => {
                  const key = a.startAt.slice(0, 16)
                  if (!seen.has(key)) {
                    seen.add(key)
                    const count = hidden.filter(h => h.startAt.slice(0, 16) === key).length
                    pills.push(
                      <div key={`more-${key}`}
                        className="absolute z-20 right-1 text-[10px] font-bold text-white rounded-full px-1.5 py-0.5 shadow-sm pointer-events-none"
                        style={{ top: timeToTop(a.startAt) + 2, background: '#64748B' }}>
                        +{count}
                      </div>
                    )
                  }
                })

                return (
                  <>
                    {visible.map((a) => (
                      <ApptBlock
                        key={a.id}
                        appt={a}
                        colIndex={a.colIndex}
                        totalCols={Math.min(a.totalCols, 2)}
                        onClick={() => onClickAppointment?.(a)}
                        resizingEndAt={resizing?.apptId === a.id ? resizing.currentEndAt : undefined}
                        onResizeStart={onApptResizeStart ? (e) => onApptResizeStart(e, a) : undefined}
                        onResizeTouchStart={onApptResizeTouchStart ? (e) => onApptResizeTouchStart(e, a) : undefined}
                        isDraggable={!!onApptDrop}
                      />
                    ))}
                    {pills}
                  </>
                )
              })()}
              {/* Now line */}
              {today && <NowLine />}
              {/* Closed day overlay */}
              {isClosed && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none"
                  style={{ background: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(239,68,68,0.04) 10px, rgba(239,68,68,0.04) 20px)' }}>
                  <div className="flex flex-col items-center gap-1 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-xl px-4 py-2 shadow-sm">
                    <span className="text-lg">🚫</span>
                    <span className="text-xs font-bold text-red-500">Closed</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Week View ────────────────────────────────────────────────────────────────
function WeekView({ weekDates, appointments, onBookSlot, onClickAppointment, workingHours }: {
  weekDates:           Date[]
  appointments:        Appointment[]
  onBookSlot?:         (docId: string, at: Date) => void
  onClickAppointment?: (a: Appointment) => void
  workingHours?:       any[]
}) {
  const today      = new Date()
  const TIME_W     = 56
  const closedDays = new Set(workingHours?.filter(w => !w.isOpen).map(w => w.dayOfWeek) ?? [])
  const [closedToast, setClosedToast] = useState(false)

  function handleClick(date: Date, slot: string) {
    if (!onBookSlot) return
    if (closedDays.has(date.getDay())) {
      setClosedToast(true)
      setTimeout(() => setClosedToast(false), 2500)
      return
    }
    const [h, m] = slot.split(':').map(Number)
    const d = new Date(date)
    d.setHours(h, m, 0, 0)
    onBookSlot('', d)
  }

  return (
    <div className="flex-1 overflow-auto min-h-0">
      {closedToast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-bold text-white shadow-xl bg-red-500 pointer-events-none">
          🚫 This day is closed
        </div>
      )}
      {/* Day headers */}
      <div className="flex sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-white/10 shadow-sm">
        <div className="flex-shrink-0 border-r border-gray-100 dark:border-white/10" style={{ width: TIME_W }} />
        {weekDates.map((date) => {
          const isToday  = sameDay(date, today)
          const dayCount = appointments.filter((a) => sameDay(new Date(a.startAt), date) && a.status !== 'CANCELLED').length
          const isClosed = closedDays.has(date.getDay())
          return (
            <div key={date.toISOString()} className={cn('flex-1 min-w-[100px] px-2 py-2.5 border-r border-gray-100 dark:border-white/10 text-center', isClosed && 'bg-red-50/60 dark:bg-red-900/10')}>
              <div className={cn('text-[11px] font-semibold uppercase flex items-center justify-center gap-1', isToday ? 'text-clinic-blue' : isClosed ? 'text-red-400' : 'text-gray-400')}>
                {date.toLocaleDateString('en-UG', { weekday: 'short' })}
                {isClosed && <span className="text-[9px] font-bold text-red-500 bg-red-100 dark:bg-red-900/30 px-1 py-0.5 rounded-full">CLOSED</span>}
              </div>
              <div className={cn(
                'text-lg font-bold mx-auto w-9 h-9 flex items-center justify-center rounded-full mt-0.5',
                isToday ? 'bg-clinic-navy text-white' : isClosed ? 'text-red-400 opacity-60' : 'text-clinic-navy dark:text-white',
              )}>
                {date.getDate()}
              </div>
              {dayCount > 0 && !isClosed && (
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
          const dayAppts = appointments.filter((a) => sameDay(new Date(a.startAt), date))
          const isClosed = closedDays.has(date.getDay())
          return (
            <div key={date.toISOString()}
              className={cn('flex-1 min-w-[100px] border-r border-gray-100 dark:border-white/10 relative', isToday && 'bg-blue-50/15 dark:bg-blue-900/10')}
              style={{ height: `${timeSlots.length * SLOT_HEIGHT}px` }}>
              {timeSlots.map((slot, i) => (
                <div key={slot}
                  className={`absolute left-0 right-0 transition-colors group${onBookSlot && !isClosed ? ' hover:bg-blue-50/40 cursor-pointer' : ''}`}
                  style={{ top: `${i * SLOT_HEIGHT}px`, height: `${SLOT_HEIGHT}px`, borderBottom: '1px solid #F5F5F7' }}
                  onClick={() => handleClick(date, slot)}>
                  {onBookSlot && !isClosed && (
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] text-clinic-blue opacity-0 group-hover:opacity-100 font-semibold pointer-events-none">
                      + Book
                    </span>
                  )}
                </div>
              ))}
              {groupOverlapping(dayAppts).map((a) => (
                <ApptBlock key={a.id} appt={a} colIndex={a.colIndex} totalCols={a.totalCols} onClick={() => onClickAppointment?.(a)} />
              ))}
              {isToday && <NowLine />}
              {isClosed && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none"
                  style={{ background: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(239,68,68,0.04) 10px, rgba(239,68,68,0.04) 20px)' }}>
                  <div className="flex flex-col items-center gap-1 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-xl px-4 py-2 shadow-sm">
                    <span className="text-lg">🚫</span>
                    <span className="text-xs font-bold text-red-500">Closed</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Month View ───────────────────────────────────────────────────────────────
function MonthView({ year, month, appointments, onDateClick, workingHours }: {
  year:          number
  month:         number
  appointments:  Appointment[]
  onDateClick:   (date: Date) => void
  workingHours?: any[]
}) {
  const today      = new Date()
  const grid       = getMonthGrid(year, month)
  const closedDays = new Set(workingHours?.filter(w => !w.isOpen).map(w => w.dayOfWeek) ?? [])

  return (
    <div className="flex-1 overflow-auto min-h-0 p-3">
      <div className="grid grid-cols-7 gap-1 mb-1">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d) => (
          <div key={d} className={cn('text-center text-xs font-bold py-1', d === 'Sun' ? 'text-red-300' : 'text-gray-400')}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {grid.flat().map((date, i) => {
          if (!date) return <div key={`e${i}`} className="rounded-xl bg-gray-50/50 dark:bg-white/3 min-h-[90px]" />
          const isToday   = sameDay(date, today)
          const inMonth   = date.getMonth() === month
          const dayAppts  = appointments.filter((a) => sameDay(new Date(a.startAt), date))
          const isClosed  = inMonth && closedDays.has(date.getDay())
          return (
            <div key={date.toISOString()}
              onClick={() => onDateClick(date)}
              className={cn(
                'rounded-xl p-2 min-h-[90px] cursor-pointer transition-all border relative overflow-hidden',
                isToday   ? 'bg-blue-50 dark:bg-blue-900/20 border-clinic-blue/30 shadow-sm' :
                !inMonth  ? 'bg-gray-50/50 dark:bg-white/3 border-gray-100 dark:border-white/5 opacity-40' :
                isClosed  ? 'bg-red-50/40 dark:bg-red-900/10 border-red-100 dark:border-red-800/20' :
                'bg-white dark:bg-white/5 border-gray-100 dark:border-white/10 hover:border-clinic-blue/30 hover:shadow-sm',
              )}>
              <div className={cn(
                'text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full mb-1.5',
                isToday ? 'bg-clinic-navy text-white' : isClosed ? 'text-red-400' : 'text-gray-700 dark:text-gray-300',
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
              {isClosed && (
                <div className="absolute bottom-0 left-0 right-0 text-center text-[8px] font-bold text-red-400 bg-red-50 dark:bg-red-900/10 py-0.5">
                  CLOSED
                </div>
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

  // ─── Column ordering (drag-to-reorder, persisted in localStorage) ─────────────
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(localStorage.getItem('cc_doctor_order') || '[]') } catch { return [] }
  })

  const orderedColumns = columnOrder.length > 0
    ? [...columns].sort((a, b) => {
        const ai = columnOrder.indexOf(a.doctor.id)
        const bi = columnOrder.indexOf(b.doctor.id)
        if (ai === -1 && bi === -1) return 0
        if (ai === -1) return 1
        if (bi === -1) return -1
        return ai - bi
      })
    : columns

  function handleReorderColumns(newOrder: string[]) {
    setColumnOrder(newOrder)
    localStorage.setItem('cc_doctor_order', JSON.stringify(newOrder))
  }

  function resetColumnOrder() {
    setColumnOrder([])
    localStorage.removeItem('cc_doctor_order')
  }

  // ─── Block Time state ────────────────────────────────────────────────────────
  const [blockModal,  setBlockModal]  = useState<{
    doctorId: string; date: string; startTime: string; endTime: string; reason: string
    repeat: 'none' | 'daily' | 'weekly'
  } | null>(null)
  const [blockSaving, setBlockSaving] = useState(false)
  const [removeBlock, setRemoveBlock] = useState<{ doctorId: string; blockId: string } | null>(null)
  const dragStateRef = useRef<{ doctorId: string; startIdx: number; endIdx: number } | null>(null)
  const dateRef      = useRef(date)
  const [dragOverlay,   setDragOverlay]   = useState<{ doctorId: string; startIdx: number; endIdx: number } | null>(null)
  const [workingHours,      setWorkingHours]      = useState<any[]>([])
  const [allowOverlapping,  setAllowOverlapping]  = useState(false)
  const [resizing, setResizing] = useState<{
    apptId: string
    originalEndAt: string
    currentEndAt: string
  } | null>(null)
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null)

  // Internal appointment click — shows popup and forwards to external handler if provided
  function handleApptClick(appt: Appointment) {
    setSelectedAppt(appt)
    if (appt.status !== 'CANCELLED') onClickAppointment?.(appt)
  }

  useEffect(() => { dateRef.current = date }, [date])

  // Read token fresh inside each fetch to avoid stale SSR closure
  function authHeaders() {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    return { Authorization: `Bearer ${token}` }
  }

  function fetchWorkingHours() {
    fetch(`${API}/scheduling/working-hours`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setWorkingHours(d) })
      .catch(() => {})
  }

  function fetchBookingSettings() {
    fetch(`${API}/scheduling/booking-settings`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { if (typeof d.allowOverlapping === 'boolean') setAllowOverlapping(d.allowOverlapping) })
      .catch(() => {})
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchWorkingHours(); fetchBookingSettings() }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    window.addEventListener('workingHoursUpdated',    fetchWorkingHours)
    window.addEventListener('bookingSettingsUpdated', fetchBookingSettings)
    return () => {
      window.removeEventListener('workingHoursUpdated',    fetchWorkingHours)
      window.removeEventListener('bookingSettingsUpdated', fetchBookingSettings)
    }
  }, [])

  // Immediate refresh when any component in this session creates/updates an appointment
  useEffect(() => {
    function onApptUpdated() {
      if (view === 'doctors') fetchDay(dateRef.current)
      else if (view === 'week') fetchWeek(dateRef.current)
      else fetchMonth(dateRef.current)
    }
    window.addEventListener('appointment-updated', onApptUpdated)
    return () => window.removeEventListener('appointment-updated', onApptUpdated)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  // Refresh when a doctor is added or deleted (dispatched by DoctorsTab)
  useEffect(() => {
    function onDoctorUpdated() {
      if (view === 'doctors') fetchDay(dateRef.current)
    }
    window.addEventListener('doctor-updated', onDoctorUpdated)
    return () => window.removeEventListener('doctor-updated', onDoctorUpdated)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  // ─── Drag-to-block global mouseup ────────────────────────────────────────────
  useEffect(() => {
    function onMouseUp() {
      const d = dragStateRef.current
      if (d && d.startIdx !== d.endIdx) {
        const s = Math.min(d.startIdx, d.endIdx)
        const e = Math.max(d.startIdx, d.endIdx)
        const endSlot = e + 1 < timeSlots.length ? timeSlots[e + 1] : timeSlots[e]
        setBlockModal({ doctorId: d.doctorId, date: toDateStr(dateRef.current), startTime: timeSlots[s], endTime: endSlot, reason: '', repeat: 'none' })
      }
      dragStateRef.current = null
      setDragOverlay(null)
    }
    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [])

  function handleSlotDragStart(doctorId: string, slotIdx: number) {
    dragStateRef.current = { doctorId, startIdx: slotIdx, endIdx: slotIdx }
    setDragOverlay({ doctorId, startIdx: slotIdx, endIdx: slotIdx })
  }
  function handleSlotDragMove(doctorId: string, slotIdx: number) {
    if (!dragStateRef.current || dragStateRef.current.doctorId !== doctorId) return
    dragStateRef.current.endIdx = slotIdx
    setDragOverlay({ doctorId, startIdx: dragStateRef.current.startIdx, endIdx: slotIdx })
  }

  // ─── Resize appointment ───────────────────────────────────────────────────────
  function handleResizeStart(e: React.MouseEvent, appt: Appointment) {
    e.preventDefault()
    e.stopPropagation()

    const startY      = e.clientY
    const originalEnd = new Date(appt.endAt)
    const PIXELS_PER_MIN = SLOT_HEIGHT / 30
    let latestEndAt = appt.endAt

    function onMouseMove(moveEvent: MouseEvent) {
      const deltaY       = moveEvent.clientY - startY
      const deltaMinutes = Math.round(deltaY / PIXELS_PER_MIN / 15) * 15
      const newEnd       = new Date(originalEnd.getTime() + deltaMinutes * 60000)
      const minEnd       = new Date(new Date(appt.startAt).getTime() + 10 * 60000)
      if (newEnd < minEnd) return
      latestEndAt = newEnd.toISOString()
      setResizing({ apptId: appt.id, originalEndAt: appt.endAt, currentEndAt: latestEndAt })
    }

    async function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      if (latestEndAt === appt.endAt) { setResizing(null); return }
      const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
      await fetch(`${API}/scheduling/appointments/${appt.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ endAt: latestEndAt }),
      })
      setResizing(null)
      fetchDay(dateRef.current)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  function handleResizeTouchStart(e: React.TouchEvent, appt: Appointment) {
    e.stopPropagation()
    const touch       = e.touches[0]
    const startY      = touch.clientY
    const originalEnd = new Date(appt.endAt)
    const PIXELS_PER_MIN = SLOT_HEIGHT / 30
    let latestEndAt = appt.endAt

    function onTouchMove(moveEvent: TouchEvent) {
      const t            = moveEvent.touches[0]
      const deltaY       = t.clientY - startY
      const deltaMinutes = Math.round(deltaY / PIXELS_PER_MIN / 15) * 15
      const newEnd       = new Date(originalEnd.getTime() + deltaMinutes * 60000)
      const minEnd       = new Date(new Date(appt.startAt).getTime() + 10 * 60000)
      if (newEnd < minEnd) return
      latestEndAt = newEnd.toISOString()
      setResizing({ apptId: appt.id, originalEndAt: appt.endAt, currentEndAt: latestEndAt })
    }

    async function onTouchEnd() {
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      if (latestEndAt === appt.endAt) { setResizing(null); return }
      const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
      await fetch(`${API}/scheduling/appointments/${appt.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ endAt: latestEndAt }),
      })
      setResizing(null)
      fetchDay(dateRef.current)
    }

    document.addEventListener('touchmove', onTouchMove, { passive: true })
    document.addEventListener('touchend', onTouchEnd)
  }

  // ─── Cancel block-time drag when an appointment drag starts ──────────────────
  useEffect(() => {
    function onDragStart() { dragStateRef.current = null; setDragOverlay(null) }
    document.addEventListener('dragstart', onDragStart)
    return () => document.removeEventListener('dragstart', onDragStart)
  }, [])

  // ─── Drag appointment to a different doctor column ────────────────────────────
  async function handleApptDrop(apptId: string, targetDoctorId: string, slotIdx: number) {
    let appt: Appointment | undefined
    for (const col of columns) {
      appt = col.appointments.find(a => a.id === apptId)
      if (appt) break
    }
    if (!appt) return

    const durationMs = new Date(appt.endAt).getTime() - new Date(appt.startAt).getTime()
    const slot       = timeSlots[slotIdx]
    const newStart   = new Date(`${toDateStr(dateRef.current)}T${slot}:00+03:00`)
    const newEnd     = new Date(newStart.getTime() + durationMs)

    // No-op: same doctor, same slot
    if (appt.doctor.id === targetDoctorId &&
        newStart.getTime() === new Date(appt.startAt).getTime()) return

    // Frontend conflict guard — block drop onto an already-occupied slot
    // Skipped when allow_overlapping_appointments setting is enabled
    if (!allowOverlapping) {
      const targetCol = columns.find(c => c.doctor.id === targetDoctorId)
      if (targetCol) {
        const conflict = targetCol.appointments.find(a =>
          a.id !== apptId &&
          a.status !== 'CANCELLED' &&
          new Date(a.startAt) < newEnd &&
          new Date(a.endAt) > newStart,
        )
        if (conflict) return
      }
    }

    const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    try {
      const res = await fetch(`${API}/scheduling/appointments/${apptId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ doctorId: targetDoctorId, startAt: newStart.toISOString(), endAt: newEnd.toISOString() }),
      })
      if (res.ok) fetchDay(dateRef.current)
    } catch { /* calendar refreshes on next 30s poll */ }
  }

  // ─── Create blocked time ──────────────────────────────────────────────────────
  async function createBlock() {
    if (!blockModal) return
    setBlockSaving(true)
    const { doctorId, date: bDate, startTime, endTime, reason, repeat } = blockModal
    const datesToBlock: string[] = [bDate]
    if (repeat === 'daily') {
      for (let i = 1; i <= 6; i++) {
        const d = new Date(bDate + 'T00:00:00'); d.setDate(d.getDate() + i); datesToBlock.push(toDateStr(d))
      }
    } else if (repeat === 'weekly') {
      for (let i = 1; i <= 3; i++) {
        const d = new Date(bDate + 'T00:00:00'); d.setDate(d.getDate() + i * 7); datesToBlock.push(toDateStr(d))
      }
    }
    try {
      await Promise.all(datesToBlock.map(d =>
        fetch(`${API}/scheduling/doctors/${doctorId}/block-time`, {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ startAt: `${d}T${startTime}:00+03:00`, endAt: `${d}T${endTime}:00+03:00`, reason }),
        })
      ))
      setBlockModal(null)
      fetchDay(dateRef.current)
    } finally { setBlockSaving(false) }
  }

  // ─── Delete blocked time ──────────────────────────────────────────────────────
  async function deleteBlock() {
    if (!removeBlock) return
    await fetch(`${API}/scheduling/doctors/${removeBlock.doctorId}/block-time/${removeBlock.blockId}`, {
      method: 'DELETE', headers: authHeaders(),
    })
    setRemoveBlock(null)
    fetchDay(dateRef.current)
  }

  const fetchDay = useCallback(async (d: Date) => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetchWithRetry(`${API}/scheduling/calendar?date=${toDateStr(d)}`, { headers: authHeaders() })
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
      const res  = await fetchWithRetry(`${API}/scheduling/appointments?startDate=${s}&endDate=${e}`, { headers: authHeaders() })
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

        {/* Reset column order (only shown when custom order is active) */}
        {columnOrder.length > 0 && view === 'doctors' && (
          <button onClick={resetColumnOrder}
            title="Reset column order"
            className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
            <RotateCcw size={13} />
          </button>
        )}

        {loading && <div className="w-2 h-2 rounded-full bg-clinic-blue animate-pulse ml-1" />}
      </div>

      {/* First-load skeleton — shown when fetching and no data yet */}
      {loading && orderedColumns.length === 0 && view === 'doctors' && (
        <div className="flex gap-3 overflow-x-auto pb-4 animate-pulse">
          {[1, 2, 3].map((col) => (
            <div key={col} className="flex-shrink-0 w-48 sm:w-56">
              <div className="h-10 bg-gray-100 dark:bg-white/10 rounded-xl mb-3" />
              <div className="space-y-3">
                <div className="h-14 bg-gray-100 dark:bg-white/10 rounded-xl" />
                <div className="h-20 bg-gray-100 dark:bg-white/10 rounded-xl" />
                <div className="h-10 bg-gray-100 dark:bg-white/10 rounded-xl" />
                <div className="h-16 bg-gray-100 dark:bg-white/10 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Calendar views */}
      {view === 'doctors' && (
        <DoctorsView
          columns={orderedColumns}
          dateStr={toDateStr(date)}
          onBookSlot={onBookSlot}
          onClickAppointment={handleApptClick}
          onBlockClick={(doctorId, blockId) => setRemoveBlock({ doctorId, blockId })}
          onSlotDragStart={handleSlotDragStart}
          onSlotDragMove={handleSlotDragMove}
          dragOverlay={dragOverlay}
          workingHours={workingHours}
          resizing={resizing}
          onApptResizeStart={handleResizeStart}
          onApptResizeTouchStart={handleResizeTouchStart}
          onApptDrop={handleApptDrop}
          onReorderColumns={handleReorderColumns}
        />
      )}
      {view === 'week' && (
        <WeekView
          weekDates={getWeekDates(date)}
          appointments={weekAppts}
          onBookSlot={onBookSlot}
          onClickAppointment={handleApptClick}
          workingHours={workingHours}
        />
      )}
      {view === 'month' && (
        <MonthView
          year={date.getFullYear()}
          month={date.getMonth()}
          appointments={monthAppts}
          onDateClick={(d) => { setDate(d); setView('doctors') }}
          workingHours={workingHours}
        />
      )}

      {!loading && view === 'doctors' && orderedColumns.length === 0 && (
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

      {/* ── Appointment Detail Popup ─────────────────────────────────────────── */}
      {selectedAppt && (
        <ApptDetailModal appt={selectedAppt} onClose={() => setSelectedAppt(null)} />
      )}

      {/* ── Block Time Modal ──────────────────────────────────────────────────── */}
      {blockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setBlockModal(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2"><Lock size={14} className="text-red-400" /> Block Time</h3>
              <button onClick={() => setBlockModal(null)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              {/* Doctor */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Doctor</label>
                <select value={blockModal.doctorId} onChange={e => setBlockModal(m => m && ({ ...m, doctorId: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-800 dark:text-white outline-none">
                  {orderedColumns.map(({ doctor }) => (
                    <option key={doctor.id} value={doctor.id} className="dark:bg-gray-800">
                      Dr. {doctor.firstName} {doctor.lastName}
                    </option>
                  ))}
                </select>
              </div>
              {/* Date */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Date</label>
                <input type="date" value={blockModal.date} onChange={e => setBlockModal(m => m && ({ ...m, date: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-800 dark:text-white outline-none" />
              </div>
              {/* Start / End */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Start</label>
                  <select value={blockModal.startTime} onChange={e => setBlockModal(m => m && ({ ...m, startTime: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-800 dark:text-white outline-none">
                    {timeSlots.map(t => <option key={t} value={t} className="dark:bg-gray-800">{t}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-500 mb-1">End</label>
                  <select value={blockModal.endTime} onChange={e => setBlockModal(m => m && ({ ...m, endTime: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-800 dark:text-white outline-none">
                    {timeSlots.map(t => <option key={t} value={t} className="dark:bg-gray-800">{t}</option>)}
                  </select>
                </div>
              </div>
              {/* Reason */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Reason (optional)</label>
                <input type="text" value={blockModal.reason} onChange={e => setBlockModal(m => m && ({ ...m, reason: e.target.value }))}
                  placeholder="e.g. Lunch, Training, Meeting"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-800 dark:text-white outline-none placeholder-gray-400" />
              </div>
              {/* Repeat */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Repeat</label>
                <div className="flex gap-2">
                  {(['none','daily','weekly'] as const).map(r => (
                    <button key={r} onClick={() => setBlockModal(m => m && ({ ...m, repeat: r }))}
                      className={cn('flex-1 py-1.5 rounded-xl text-xs font-semibold border transition-colors',
                        blockModal.repeat === r
                          ? 'bg-red-400 text-white border-red-400'
                          : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-red-300')}>
                      {r === 'none' ? 'Once' : r === 'daily' ? '7 Days' : '4 Weeks'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={createBlock} disabled={blockSaving}
              className="mt-5 w-full py-2.5 rounded-xl text-sm font-bold text-white bg-red-400 hover:bg-red-500 disabled:opacity-50 transition-colors">
              {blockSaving ? 'Saving…' : 'Block Time'}
            </button>
          </div>
        </div>
      )}

      {/* ── Remove Blocked Time Confirm ───────────────────────────────────────── */}
      {removeBlock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRemoveBlock(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 w-full max-w-xs" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-gray-800 dark:text-white mb-1">Remove block?</p>
            <p className="text-sm text-gray-500 mb-5">This blocked time will be removed from the calendar.</p>
            <div className="flex gap-3">
              <button onClick={() => setRemoveBlock(null)} className="flex-1 py-2 rounded-xl text-sm font-semibold border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                Cancel
              </button>
              <button onClick={deleteBlock} className="flex-1 py-2 rounded-xl text-sm font-bold text-white bg-red-400 hover:bg-red-500 transition-colors">
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
