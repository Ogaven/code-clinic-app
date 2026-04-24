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

const store = new Map<string, BookingStateEntry>()

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
}

export function clearBookingState(phone: string): void {
  store.set(phone, { state: 'IDLE', lastUpdated: new Date() })
}
