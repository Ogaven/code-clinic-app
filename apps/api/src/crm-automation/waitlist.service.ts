// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — same-day waitlist (Part G), now backed by an explicit
// per-patient WaitlistEntry request instead of the earlier same-service-
// history proxy. Patient.waitlistAvailable is left in the schema for
// backwards compatibility — nothing that already reads it was removed —
// but is no longer consulted here; WaitlistEntry captures WHAT a patient is
// actually waiting for (service, optionally a preferred provider and date
// window), which the boolean alone never could.
//
// Matching order when a slot opens: exact serviceId match -> prefer an
// entry whose preferredDoctorId matches the opened slot's doctor (falls back
// to entries with NO stated doctor preference when no same-doctor entry
// exists — an explicit preference for a DIFFERENT named provider is always a
// hard exclusion, never silently overridden) -> date/time compatibility (a
// hard filter when the patient specified a window — never contact someone
// about a slot they said wouldn't work) -> oldest requestedAt first. Never
// broad-blasts; an empty match returns zero notifications.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import { sendOrSimulate } from './dry-run'
import { sendWhatsAppMessage } from '../ai-suite/whatsapp/whatsapp.service'
import { sendSMS } from '../ai-suite/sms/sms.service'
import { getChannelConsentStatus } from './consent-log.service'
import type { CommsChannel, WaitlistEntry, Patient } from '@prisma/client'

async function sendViaChannel(channel: CommsChannel, to: string, body: string): Promise<void> {
  if (channel === 'WHATSAPP') return sendWhatsAppMessage(to, body).then(() => undefined)
  if (channel === 'SMS') return sendSMS(to, body)
  throw new Error(`Waitlist notification channel "${channel}" is not wired to a real send path yet`)
}

export interface NotifyWaitlistResult {
  eligibleCount: number
  notified: Array<{ patientId: string; waitlistEntryId: string; channel: CommsChannel; dryRun: boolean }>
  skipped: Array<{ patientId: string; waitlistEntryId: string; reason: string }>
  targetingMode: 'MATCHED' | 'DISABLED_NO_SERVICE_CONTEXT' | 'DISABLED_NO_MATCH'
}

function dateCompatible(entry: WaitlistEntry, slotStart: Date): boolean {
  if (entry.preferredDateFrom && slotStart < entry.preferredDateFrom) return false
  if (entry.preferredDateTo && slotStart > entry.preferredDateTo) return false
  return true
}

export async function notifyWaitlistForOpenSlot(cancelledAppointmentId: string, limit = 20): Promise<NotifyWaitlistResult> {
  const cancelled = await prisma.appointment.findUnique({
    where:  { id: cancelledAppointmentId },
    select: { serviceId: true, doctorId: true, startAt: true },
  })

  if (!cancelled?.serviceId) {
    return { eligibleCount: 0, notified: [], skipped: [], targetingMode: 'DISABLED_NO_SERVICE_CONTEXT' }
  }

  const candidates = await prisma.waitlistEntry.findMany({
    where: { serviceId: cancelled.serviceId, isActive: true, fulfilledAt: null, cancelledAt: null },
    include: { patient: true },
    orderBy: { requestedAt: 'asc' },
  })

  if (candidates.length === 0) {
    return { eligibleCount: 0, notified: [], skipped: [], targetingMode: 'DISABLED_NO_MATCH' }
  }

  // Prefer an exact same-provider match when at least one exists. Falling
  // back must never contact someone who explicitly asked for a DIFFERENT
  // named provider — the fallback pool is only entries with no provider
  // preference at all (preferredDoctorId is null), so an explicit preference
  // is always respected as a hard filter, never silently overridden.
  const doctorMatches = cancelled.doctorId ? candidates.filter(c => c.preferredDoctorId === cancelled.doctorId) : []
  const noPreference = candidates.filter(c => !c.preferredDoctorId)
  const pool = doctorMatches.length > 0 ? doctorMatches : noPreference

  // Date/time compatibility is a hard filter — never contact someone about a
  // slot outside the window they explicitly asked for.
  const compatible = pool.filter(entry => dateCompatible(entry, cancelled.startAt))
  if (compatible.length === 0) {
    return { eligibleCount: 0, notified: [], skipped: [], targetingMode: 'DISABLED_NO_MATCH' }
  }

  const top = compatible
    .sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime())
    .slice(0, limit) as (WaitlistEntry & { patient: Patient })[]

  const notified: NotifyWaitlistResult['notified'] = []
  const skipped: NotifyWaitlistResult['skipped'] = []

  for (const entry of top) {
    const patient = entry.patient
    const channel: CommsChannel = patient.commsChannelPref ?? 'WHATSAPP'
    if (channel === 'EMAIL') {
      skipped.push({ patientId: patient.id, waitlistEntryId: entry.id, reason: 'email_channel_not_wired' })
      continue
    }

    const consented = await getChannelConsentStatus(patient.id, channel)
    if (!consented) {
      skipped.push({ patientId: patient.id, waitlistEntryId: entry.id, reason: 'consent_declined' })
      continue
    }

    const body = `Hi ${patient.firstName}, a same-day slot just opened up at Code Clinic for the service you're waitlisted for — reply here if you'd like to grab it!`
    const result = await sendOrSimulate(channel, patient.phone, body, () => sendViaChannel(channel, patient.phone, body))

    await prisma.waitlistNotification.create({
      data: {
        patientId:         patient.id,
        waitlistEntryId:   entry.id,
        appointmentSlotId: cancelledAppointmentId,
        channel,
        status:            result.dryRun ? 'DRY_RUN_SENT' : 'SENT',
        notifiedAt:        new Date(),
      },
    })

    notified.push({ patientId: patient.id, waitlistEntryId: entry.id, channel, dryRun: result.dryRun })
  }

  return { eligibleCount: top.length, notified, skipped, targetingMode: 'MATCHED' }
}

// ── Waitlist CRUD (Part 8 UI backing) ───────────────────────────────────────
export interface CreateWaitlistEntryParams {
  patientId: string
  serviceId: string
  preferredDoctorId?: string | null
  preferredDateFrom?: Date | null
  preferredDateTo?: Date | null
  timePreference?: string | null
  priority?: number | null
  notes?: string | null
  createdByUserId?: string | null
}

export async function createWaitlistEntry(params: CreateWaitlistEntryParams) {
  return prisma.waitlistEntry.create({
    data: {
      patientId:         params.patientId,
      serviceId:         params.serviceId,
      preferredDoctorId: params.preferredDoctorId ?? null,
      preferredDateFrom: params.preferredDateFrom ?? null,
      preferredDateTo:   params.preferredDateTo ?? null,
      timePreference:    params.timePreference ?? null,
      priority:          params.priority ?? null,
      notes:             params.notes ?? null,
      createdByUserId:   params.createdByUserId ?? null,
    },
  })
}

export async function listWaitlistEntries(filter: { isActive?: boolean } = {}) {
  return prisma.waitlistEntry.findMany({
    where:   { isActive: filter.isActive ?? true },
    include: { patient: { select: { id: true, firstName: true, lastName: true, phone: true } }, service: { select: { id: true, name: true } }, preferredDoctor: { select: { id: true, user: { select: { firstName: true, lastName: true } } } } },
    orderBy: { requestedAt: 'asc' },
  })
}

export async function pauseOrRemoveWaitlistEntry(id: string, action: 'pause' | 'cancel'): Promise<void> {
  await prisma.waitlistEntry.update({
    where: { id },
    data:  action === 'pause' ? { isActive: false } : { isActive: false, cancelledAt: new Date() },
  })
}

export async function markWaitlistEntryFulfilled(id: string): Promise<void> {
  await prisma.waitlistEntry.update({ where: { id }, data: { isActive: false, fulfilledAt: new Date() } })
}
