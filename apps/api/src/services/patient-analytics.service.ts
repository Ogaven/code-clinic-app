// Canonical patient-activity analytics. Dashboard, Daily/Weekly Reports, and
// any future patient-analytics surface must call these functions rather than
// re-deriving "seen" / "new" / "returning" locally — that duplication is what
// let the dashboard and reports drift to different definitions in the past.
//
// Definitions:
//  - "Seen" (attended) = an appointment whose status is in ATTENDED_STATUSES.
//    CONFIRMED/PENDING are scheduling states, not attendance, and are never
//    counted as seen.
//  - "New" = a patient whose FIRST EVER attended appointment falls inside the
//    requested range. Patients with a non-empty Patient.importSource are
//    never counted as new (their true first visit predates the import and is
//    unknown) — same rule the dashboard already used before this change.
//  - "Returning" = a patient seen in the range who has at least one attended
//    appointment before the range start.
import { prisma } from '../lib/prisma'
import type { AppointmentStatus } from '@prisma/client'
import { safePercentChange } from '../utils/kampala-time'

/** Every status that means the patient physically attended the visit. */
export const ATTENDED_STATUSES: AppointmentStatus[] = [
  'ARRIVED',
  'WAITING',
  'IN_OPERATORY',
  'WITH_PROVIDER',
  'SESSION_COMPLETE',
  'CHECKOUT',
  'DEPARTED',
  'COMPLETED',
  'IN_PROGRESS',
  'CHECKED_IN',
  'IN_CHAIR',
  'READY_CHECKOUT',
  'IMPORTED',
]

/** Statuses that supersede an earlier occurrence and must not be double-counted in Scheduled. */
export const SUPERSEDED_STATUSES: AppointmentStatus[] = ['RESCHEDULED', 'CANCELLED_RESCHEDULED']

export interface Range {
  start: Date
  end: Date
}

export async function getTotalPatients(): Promise<number> {
  return prisma.patient.count()
}

/** Distinct patient IDs with an attended appointment starting in [range.start, range.end). */
export async function getPatientsSeen(range: Range): Promise<{ count: number; patientIds: string[] }> {
  const rows = await prisma.appointment.findMany({
    where: { startAt: { gte: range.start, lt: range.end }, status: { in: ATTENDED_STATUSES } },
    select: { patientId: true },
    distinct: ['patientId'],
  })
  const patientIds = rows.map(r => r.patientId).filter((id): id is string => !!id)
  return { count: patientIds.length, patientIds }
}

/**
 * Splits a set of "seen in range" patient IDs into new vs returning, based on
 * whether each patient has an attended appointment strictly before range.start.
 */
export async function splitNewAndReturning(
  patientIds: string[],
  rangeStart: Date,
): Promise<{ newIds: string[]; returningIds: string[] }> {
  if (patientIds.length === 0) return { newIds: [], returningIds: [] }

  const [priorVisits, importedPatients] = await Promise.all([
    prisma.appointment.findMany({
      where: { patientId: { in: patientIds }, startAt: { lt: rangeStart }, status: { in: ATTENDED_STATUSES } },
      select: { patientId: true },
      distinct: ['patientId'],
    }),
    prisma.patient.findMany({
      where: { id: { in: patientIds }, importSource: { not: null } },
      select: { id: true },
    }),
  ])

  const returningIds = new Set(priorVisits.map(v => v.patientId))
  const importedIds = new Set(importedPatients.map(p => p.id))

  const newIds: string[] = []
  const finalReturning: string[] = []
  for (const id of patientIds) {
    if (returningIds.has(id)) {
      finalReturning.push(id)
    } else if (!importedIds.has(id)) {
      newIds.push(id)
    }
    // imported patients with no known prior visit are excluded from both
    // buckets — their true history is unknown, so we don't guess.
  }
  return { newIds, returningIds: finalReturning }
}

export interface PatientActivitySummary {
  totalPatients: number
  patientsSeen: number
  newPatients: number
  returningPatients: number
}

export async function getPatientActivitySummary(range: Range): Promise<PatientActivitySummary> {
  const [totalPatients, seen] = await Promise.all([getTotalPatients(), getPatientsSeen(range)])
  const { newIds, returningIds } = await splitNewAndReturning(seen.patientIds, range.start)
  return {
    totalPatients,
    patientsSeen: seen.count,
    newPatients: newIds.length,
    returningPatients: returningIds.length,
  }
}

export interface AppointmentStatusBreakdown {
  scheduledTotal: number
  buckets: {
    seen: number
    confirmed: number
    pending: number
    cancelled: number
    noShow: number
    rescheduled: number
  }
}

/**
 * Reconciling status breakdown for a range: every AppointmentStatus value is
 * assigned to exactly one bucket, so buckets always sum to scheduledTotal.
 * Superseded RESCHEDULED/CANCELLED_RESCHEDULED originals get their own
 * bucket rather than being dropped, so nothing is silently discounted.
 */
export async function getAppointmentStatusBreakdown(range: Range): Promise<AppointmentStatusBreakdown> {
  const grouped = await prisma.appointment.groupBy({
    by: ['status'],
    where: { startAt: { gte: range.start, lt: range.end } },
    _count: { _all: true },
  })

  const buckets = { seen: 0, confirmed: 0, pending: 0, cancelled: 0, noShow: 0, rescheduled: 0 }
  let scheduledTotal = 0

  for (const g of grouped) {
    const n = g._count._all
    scheduledTotal += n
    if (ATTENDED_STATUSES.includes(g.status)) buckets.seen += n
    else if (g.status === 'CONFIRMED') buckets.confirmed += n
    else if (g.status === 'PENDING') buckets.pending += n
    else if (g.status === 'CANCELLED') buckets.cancelled += n
    else if (g.status === 'NO_SHOW') buckets.noShow += n
    else if (SUPERSEDED_STATUSES.includes(g.status)) buckets.rescheduled += n
  }

  return { scheduledTotal, buckets }
}

export interface TrendResult {
  current: number
  previous: number
  percentChange: number | null
}

/**
 * Generic current-vs-previous-period trend for any of the metrics above.
 * `metricFn` should be one of getTotalPatients/getPatientsSeen-derived
 * counts; callers pass two equal-length ranges.
 */
export async function getTrend(
  currentRange: Range,
  previousRange: Range,
  metricFn: (range: Range) => Promise<number>,
): Promise<TrendResult> {
  const [current, previous] = await Promise.all([metricFn(currentRange), metricFn(previousRange)])
  return { current, previous, percentChange: safePercentChange(current, previous) }
}

export async function patientsSeenCount(range: Range): Promise<number> {
  return (await getPatientsSeen(range)).count
}

export async function newPatientsSeenCount(range: Range): Promise<number> {
  const seen = await getPatientsSeen(range)
  const { newIds } = await splitNewAndReturning(seen.patientIds, range.start)
  return newIds.length
}

export async function returningPatientsSeenCount(range: Range): Promise<number> {
  const seen = await getPatientsSeen(range)
  const { returningIds } = await splitNewAndReturning(seen.patientIds, range.start)
  return returningIds.length
}
