// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — post-visit review request (Part H).
//
// Reuses the REAL, already-working Google Business Profile OAuth connection
// in routes/business-profile.ts — an admin picks the clinic's location once
// via GET /business-profile/locations (which returns metadata.placeId) and
// that place id is stored on ReviewRequestConfig.gbpPlaceId. The actual
// review link a patient clicks is Google's standard direct-review URL
// (https://search.google.com/local/writereview?placeid=...), which needs no
// further API calls or scopes beyond the place id itself.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import { sendOrSimulate } from './dry-run'
import { sendWhatsAppMessage } from '../ai-suite/whatsapp/whatsapp.service'
import { getChannelConsentStatus } from './consent-log.service'

export function buildGoogleReviewLink(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
}

async function getReviewLink(): Promise<string | null> {
  const config = await prisma.reviewRequestConfig.findFirst()
  if (!config) return null
  if (config.reviewLinkOverride) return config.reviewLinkOverride
  if (config.gbpPlaceId) return buildGoogleReviewLink(config.gbpPlaceId)
  return null
}

// Called once an appointment is marked COMPLETED — schedules (does not
// send) a review request for `delayHours` later. suppressIfNegative honors
// Patient.negativeExperience at send time, not just at schedule time, since
// the flag could be set any time before the delay elapses.
export async function scheduleReviewRequest(appointmentId: string, patientId: string): Promise<void> {
  const config = await prisma.reviewRequestConfig.findFirst()
  if (!config || !config.isActive) return

  const existing = await prisma.reviewRequestLog.findUnique({ where: { appointmentId } })
  if (existing) return // never double-schedule the same appointment

  await prisma.reviewRequestLog.create({
    data: {
      patientId,
      appointmentId,
      scheduledFor: new Date(Date.now() + config.delayHours * 60 * 60 * 1000),
      status: 'PENDING',
    },
  })
}

export async function processDueReviewRequests(limit = 100): Promise<{ processed: number; sent: number; suppressed: number }> {
  const due = await prisma.reviewRequestLog.findMany({
    where:   { status: 'PENDING', scheduledFor: { lte: new Date() } },
    take:    limit,
    include: { patient: true },
  })

  let sent = 0, suppressed = 0

  for (const log of due) {
    if (log.patient.negativeExperience) {
      await prisma.reviewRequestLog.update({
        where: { id: log.id },
        data:  { status: 'SUPPRESSED_NEGATIVE_EXPERIENCE' },
      })
      suppressed++
      continue
    }

    const consented = await getChannelConsentStatus(log.patientId, 'WHATSAPP')
    if (!consented) {
      await prisma.reviewRequestLog.update({ where: { id: log.id }, data: { status: 'FAILED' } })
      continue
    }

    const link = await getReviewLink()
    if (!link) {
      await prisma.reviewRequestLog.update({ where: { id: log.id }, data: { status: 'FAILED' } })
      continue
    }

    const body = `Hi ${log.patient.firstName}, thanks for visiting Code Clinic! If you have a moment, we'd love a quick Google review: ${link}`
    const result = await sendOrSimulate('WHATSAPP', log.patient.phone, body, () => sendWhatsAppMessage(log.patient.phone, body))

    await prisma.reviewRequestLog.update({
      where: { id: log.id },
      data:  { status: result.dryRun ? 'DRY_RUN_SENT' : 'SENT', sentAt: new Date() },
    })
    sent++
  }

  return { processed: due.length, sent, suppressed }
}