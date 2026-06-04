import fs from 'fs'
import type { AvailableSlot } from './booking.service'

export type BookingState =
  | 'IDLE'
  | 'AWAITING_SERVICE'
  | 'AWAITING_DOCTOR_PREFERENCE'
  | 'AWAITING_DOCTOR_NAME'
  | 'AWAITING_SLOT_CONFIRMATION'
  | 'AWAITING_RESCHEDULE_SLOT'
  | 'AWAITING_CANCEL_CONFIRMATION'

export interface BookingStateEntry {
  state: BookingState
  serviceId?: string
  doctorId?: string
  availableSlots?: AvailableSlot[]
  appointmentId?: string
  lastUpdated: Date
}

const STATE_TIMEOUT_MS = 30 * 60 * 1000   // 30 minutes

// Survive PM2 restarts — /tmp persists across process restarts (not server reboots)
const STATE_FILE = '/tmp/codeclinic-booking-state.json'

function loadFromFile(): Map<string, BookingStateEntry> {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8')
    const obj = JSON.parse(raw) as Record<string, any>
    const entries = Object.entries(obj).map(([k, v]): [string, BookingStateEntry] => [
      k,
      {
        ...v,
        lastUpdated:    new Date(v.lastUpdated),
        availableSlots: v.availableSlots?.map((s: any) => ({
          ...s,
          startAt: new Date(s.startAt),
          endAt:   new Date(s.endAt),
        })),
      },
    ])
    return new Map(entries)
  } catch {
    return new Map()
  }
}

function saveToFile(store: Map<string, BookingStateEntry>): void {
  try {
    const obj: Record<string, any> = {}
    store.forEach((v, k) => { obj[k] = v })
    fs.writeFileSync(STATE_FILE, JSON.stringify(obj), 'utf-8')
  } catch (e: any) {
    console.warn('[BookingState] Failed to persist state:', e.message)
  }
}

let store = loadFromFile()

function isExpired(entry: BookingStateEntry): boolean {
  return Date.now() - entry.lastUpdated.getTime() > STATE_TIMEOUT_MS
}

export function getBookingState(phone: string): BookingStateEntry {
  const entry = store.get(phone)
  if (!entry || isExpired(entry)) {
    return { state: 'IDLE', lastUpdated: new Date() }
  }
  return entry
}

export function setBookingState(
  phone: string,
  updates: Partial<Omit<BookingStateEntry, 'lastUpdated'>> & { state: BookingState }
): void {
  const current = store.get(phone)
  const base    = current && !isExpired(current) ? current : { state: 'IDLE' as BookingState }
  store.set(phone, { ...base, ...updates, lastUpdated: new Date() })
  saveToFile(store)
}

export function clearBookingState(phone: string): void {
  store.set(phone, { state: 'IDLE', lastUpdated: new Date() })
  saveToFile(store)
}
