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
import { phoneVariants } from '../utils/phone'

export function buildGoogleReviewLink(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
}

export async function getReviewLink(): Promise<string | null> {
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

    const body = `Hi ${log.patient.firstName}, thanks for visiting Code Clinic! 😊 How was your experience with us? Please reply with a number from 1 to 5, where 5 is excellent.`
    const result = await sendOrSimulate('REVIEW_REQUEST', 'WHATSAPP', log.patient.phone, body, () => sendWhatsAppMessage(log.patient.phone, body))

    await prisma.reviewRequestLog.update({
      where: { id: log.id },
      data:  { status: result.dryRun ? 'DRY_RUN_SENT' : 'SENT', sentAt: new Date() },
    })
    sent++
  }

  return { processed: due.length, sent, suppressed }
}
// Captures a simple 1-5 reply only when the patient has a recent, actually-sent
// review request. This prevents ordinary messages containing a number from being
// mistaken for feedback. PatientFeedback already stores one rating per appointment.
export async function captureReviewRatingReply(from: string, text: string): Promise<string | null> {
  const match = text.trim().match(/^([1-5])(?:\s*(?:\/\s*5|stars?))?[.!]?$/i)
  if (!match) return null

  const variants = phoneVariants(from)
  const patient = await prisma.patient.findFirst({ where: { phone: { in: variants } }, select: { id: true } })
  if (!patient) return null

  const recent = await prisma.reviewRequestLog.findFirst({
    where: { patientId: patient.id, status: 'SENT', sentAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    orderBy: { sentAt: 'desc' },
    select: { appointmentId: true },
  })
  if (!recent) return null

  const existing = await prisma.patientFeedback.findUnique({ where: { appointmentId: recent.appointmentId } })
  if (existing) return 'Thank you again for your feedback 😊'

  const rating = Number(match[1])
  await prisma.patientFeedback.create({
    data: { patientId: patient.id, appointmentId: recent.appointmentId, rating, channel: 'WHATSAPP' },
  })

  if (rating >= 4) {
    const link = await getReviewLink()
    return link
      ? `Thank you so much! 😊 We're glad you had a good experience. If you have a moment, we'd really appreciate a Google review: ${link}`
      : `Thank you so much for the feedback! 😊 We're glad you had a good experience.`
  }

  return 'Thank you for telling us. We appreciate the feedback and will use it to improve your experience with Code Clinic.'
}
