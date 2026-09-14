// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — scheduled touch dispatcher (Part C execution).
//
// Enrollment (who gets in) is event-driven (automation-events.service.ts).
// This file is the unavoidably time-based half: once a patient/lead is
// enrolled, "day 3", "day 7-10", "day 30" touches are calendar facts, not
// events — nothing in the codebase can turn "wait N days" into a discrete
// trigger without eventually checking a clock. This mirrors the exact
// [status, scheduledFor] polling idiom already used by OutboundQueue and
// AiScheduledMessage elsewhere in this app; it is intentionally NOT used to
// decide who to enroll (see the file above for that).
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import { sendOrSimulate } from './dry-run'
import { getChannelConsentStatus, hasExplicitOptIn } from './consent-log.service'
import { decideLeadSend, isAllowed } from './lead-consent.service'
import { reprocessUnprocessedEvents } from './automation-events.service'
import { sendWhatsAppMessage } from '../ai-suite/whatsapp/whatsapp.service'
import { sendSMS } from '../ai-suite/sms/sms.service'
import type { ScheduledTouch, SequenceEnrollment, SequenceTouchTemplate, SequenceDefinition, Patient } from '@prisma/client'

type DueTouch = ScheduledTouch & {
  enrollment: SequenceEnrollment
  touchTemplate: SequenceTouchTemplate & { sequence: SequenceDefinition }
  patient: Patient | null
}

function renderTemplate(template: string, firstName: string, lastName: string): string {
  return template.replace(/\{firstName\}/g, firstName).replace(/\{lastName\}/g, lastName)
}

async function sendViaChannel(channel: string, to: string, body: string): Promise<void> {
  if (channel === 'WHATSAPP') { await sendWhatsAppMessage(to, body); return }
  if (channel === 'SMS')      { await sendSMS(to, body); return }
  throw new Error(`[CrmAutomation] Channel "${channel}" has no real send path wired for sequence touches yet`)
}

async function resolveRecipient(touch: DueTouch): Promise<{ to: string; firstName: string; lastName: string } | null> {
  if (touch.patient) {
    return { to: touch.patient.phone, firstName: touch.patient.firstName, lastName: touch.patient.lastName }
  }
  if (touch.enrollment.leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: touch.enrollment.leadId } })
    if (lead?.phone) {
      const [firstName, ...rest] = (lead.name || 'there').trim().split(/\s+/)
      return { to: lead.phone, firstName, lastName: rest.join(' ') }
    }
  }
  return null
}

export async function processDueScheduledTouches(limit = 200): Promise<{ processed: number; sent: number; dryRun: number; skipped: number }> {
  const due = (await prisma.scheduledTouch.findMany({
    where:   { status: 'PENDING', scheduledFor: { lte: new Date() } },
    take:    limit,
    include: { enrollment: true, touchTemplate: { include: { sequence: true } }, patient: true },
  })) as DueTouch[]

  let sent = 0, dryRunCount = 0, skipped = 0

  for (const touch of due) {
    if (touch.enrollment.status !== 'ACTIVE') {
      await prisma.scheduledTouch.update({
        where: { id: touch.id },
        data:  { status: 'CANCELLED', resultDetail: 'enrollment_not_active' },
      })
      skipped++
      continue
    }

    const recipient = await resolveRecipient(touch)
    if (!recipient) {
      await prisma.scheduledTouch.update({
        where: { id: touch.id },
        data:  { status: 'SKIPPED', resultDetail: 'no_recipient_address' },
      })
      skipped++
      continue
    }

    const channel = touch.touchTemplate.channel

    if ((channel === 'SMS' || channel === 'WHATSAPP')) {
      const isMarketing = touch.touchTemplate.sequence.isMarketing

      if (touch.patientId) {
        // Marketing-classified sequences (the default for new ones — see
        // SequenceDefinition.isMarketing) require a REAL logged opt-in, never
        // the legacy default-opt-in fallback used for operational comms
        // elsewhere in this codebase. See the compliance note in
        // consent-log.service.ts for the full rationale.
        const consented = isMarketing
          ? await hasExplicitOptIn(touch.patientId, channel as 'SMS' | 'WHATSAPP')
          : await getChannelConsentStatus(touch.patientId, channel as 'SMS' | 'WHATSAPP')
        if (!consented) {
          await prisma.scheduledTouch.update({
            where: { id: touch.id },
            data:  { status: 'SKIPPED', resultDetail: isMarketing ? 'no_explicit_opt_in' : 'consent_declined' },
          })
          skipped++
          continue
        }
      } else if (touch.enrollment.leadId) {
        // Lead-targeted sequence touch — never bypass the centralized lead
        // consent decision, same as every other lead-directed send path
        // (acknowledgement, SLA-30, backlog campaign).
        const decision = await decideLeadSend(touch.enrollment.leadId, channel as 'SMS' | 'WHATSAPP', isMarketing ? 'MARKETING' : 'OPERATIONAL')
        if (!isAllowed(decision)) {
          await prisma.scheduledTouch.update({
            where: { id: touch.id },
            data:  { status: 'SKIPPED', resultDetail: decision.reason },
          })
          skipped++
          continue
        }
      }
    }

    const body = renderTemplate(touch.touchTemplate.messageTemplate, recipient.firstName, recipient.lastName)

    let result
    try {
      result = await sendOrSimulate(channel as 'SMS' | 'WHATSAPP' | 'EMAIL', recipient.to, body, () =>
        sendViaChannel(channel, recipient.to, body)
      )
    } catch (err: any) {
      await prisma.scheduledTouch.update({
        where: { id: touch.id },
        data:  { status: 'FAILED', resultDetail: err?.message || 'send_failed' },
      })
      continue
    }

    if (result.dryRun) dryRunCount++; else sent++

    await prisma.scheduledTouch.update({
      where: { id: touch.id },
      data: {
        status:       result.dryRun ? 'DRY_RUN' : 'SENT',
        sentAt:       new Date(),
        dryRun:       result.dryRun,
        resultDetail: result.dryRun ? 'dry_run_no_real_send' : 'sent',
      },
    })

    if (touch.patientId) {
      await prisma.nurtureLog.create({
        data: {
          patientId: touch.patientId,
          channel,
          message: body,
          status:  result.dryRun ? 'DRY_RUN' : 'SENT',
          sentAt:  new Date(),
        },
      })
    }

    const remaining = await prisma.scheduledTouch.count({
      where: { enrollmentId: touch.enrollmentId, status: 'PENDING' },
    })
    if (remaining === 0) {
      await prisma.sequenceEnrollment.update({
        where: { id: touch.enrollmentId },
        data:  { status: 'COMPLETED', exitedAt: new Date() },
      })
    }
  }

  // Crash-recovery safety net for event emission — see automation-events.service.ts.
  await reprocessUnprocessedEvents()

  return { processed: due.length, sent, dryRun: dryRunCount, skipped }
}