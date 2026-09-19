import { prisma } from '../../lib/prisma'
import { getGreetingName, isMinor } from '../../utils/nameHelper'
import { sendWhatsAppMessage, sendWhatsAppTemplate } from '../whatsapp/whatsapp.service'

export type PatientForRouting = {
  id: string
  dob: Date | null
  phone: string
  firstName: string
  familyAccountId: string | null
  // legacy fallback fields (kept for backwards compat while data migrates)
  guardianId: string | null
  guardian: { phone: string } | null
  // optional: present when callers include them in their DB select
  nextOfKinName?: string | null
  nextOfKinRelation?: string | null
}

export type OutboundRecipient = {
  phone: string
  /** Greeting-appropriate first name (e.g. "Grace") or title ("Mummy") */
  name: string
  /** Whether messages go to a guardian rather than the patient directly */
  isGuardian: boolean
  /** Raw relation string from DB — pass to guardianTitle() for warm titles */
  relation?: string | null
}

export type RoutingResult =
  | { ok: true; recipient: OutboundRecipient }
  | { ok: false; reason: 'MINOR_NO_GUARDIAN' }

/**
 * Resolves who should receive outbound bot messages for a patient.
 *
 * Rules:
 *  • Adult (age ≥ 18, or no DOB) → direct to patient
 *  • Minor (age < 18):
 *      1. Look for an active Guardian in the family account with isCommunicationContact = true
 *      2. If found → route to guardian
 *      3. If NOT found → return { ok: false, reason: 'MINOR_NO_GUARDIAN' }
 *         Callers MUST treat this as a hard stop — do not send any message.
 *  • Legacy fallback: if no familyAccountId but guardianId is set, use that guardian's phone
 */
export async function resolveOutboundRecipient(
  patient: PatientForRouting,
  patientDisplayName: string,
): Promise<RoutingResult> {
  if (!isMinor(patient.dob)) {
    return { ok: true, recipient: { phone: patient.phone, name: patientDisplayName, isGuardian: false } }
  }

  // Minor — find a communication-contact guardian
  if (patient.familyAccountId) {
    const guardian = await prisma.guardian.findFirst({
      where: {
        familyAccountId: patient.familyAccountId,
        isCommunicationContact: true,
        isActive: true,
      },
      select: { firstName: true, lastName: true, phone: true, relationship: true },
    })

    if (guardian) {
      return {
        ok: true,
        recipient: {
          phone: guardian.phone,
          name: getGreetingName({ firstName: guardian.firstName, lastName: guardian.lastName }),
          isGuardian: true,
          relation: guardian.relationship ?? undefined,
        },
      }
    }
    // Family account exists but no active communication-contact guardian → STOP
    return { ok: false, reason: 'MINOR_NO_GUARDIAN' }
  }

  // Legacy: guardianId self-reference on Patient (pre-family-account data)
  if (patient.guardian?.phone) {
    const guardianName = patient.nextOfKinName
      ? getGreetingName({ firstName: patient.nextOfKinName, lastName: '' })
      : patientDisplayName
    return {
      ok: true,
      recipient: {
        phone: patient.guardian.phone,
        name: guardianName,
        isGuardian: true,
        relation: patient.nextOfKinRelation ?? undefined,
      },
    }
  }

  // Minor with no guardian record at all → STOP
  return { ok: false, reason: 'MINOR_NO_GUARDIAN' }
}

/**
 * Send a real WhatsApp alert to staff whenever a minor patient has no active
 * communication-contact guardian. Every missed communication is a real gap —
 * alert fires every time so nothing slips through silently.
 */
export async function alertStaffMinorNoGuardian(
  patientFullName: string,
  messageType: string,
  patientPhone?: string,
): Promise<void> {
  const staffNum = process.env.STAFF_WHATSAPP_NUMBER || '+256394836298'
  const reason = `${messageType} could not be sent — no guardian contact on file, please add guardian info and follow up manually`
  const msg = `⚠️ ${patientFullName} is a minor with no guardian contact on file — a ${messageType} could not be sent. Please add guardian info and follow up manually.`

  // Template-first, freeform fallback only on failure — same pattern as
  // escalation.ts's notifyJulian(). This alert fires every time a scheduled
  // job hits the same still-unfixed patient (by design, see the comment
  // above this function), so a high-volume free-form path here is exactly
  // what was driving repeated 24h-window failures to the staff number.
  //
  // The approved cc_staff_concern template's {{2}} placeholder is literally
  // "Phone:" in its Meta-approved body text -- it must be the patient's real
  // phone number, not a description string, or the delivered message reads
  // "Phone: minor — no guardian phone on file" to staff. patientPhone is
  // optional only because a small number of call sites don't have it handy;
  // when absent, "N/A" is an honest placeholder rather than a fabricated
  // or mislabelled value.
  const templateName = process.env.WA_TEMPLATE_STAFF_ALERT_NAME
  let sent = false
  if (templateName) {
    try {
      await sendWhatsAppTemplate(staffNum, templateName, [patientFullName, patientPhone || 'N/A', reason])
      sent = true
    } catch (err: any) {
      console.warn(`[GuardianRouting] Template failed for ${patientFullName}, falling back to freeform:`, err.message)
    }
  }
  if (!sent) {
    await sendWhatsAppMessage(staffNum, msg).catch((err: Error) => {
      console.error(`[GuardianRouting] Staff alert failed for ${patientFullName}:`, err.message)
    })
  }
}

/**
 * Insert-only audit log for every outbound bot message.
 * There is NO update or delete path for this table — ever.
 */
export async function logBotMessage(opts: {
  patientId: string | null
  recipientPhone: string
  channel: 'WHATSAPP' | 'SMS'
  templateType: string
  messageBody: string
  deliveryStatus?: string
}): Promise<void> {
  await prisma.botMessageLog.create({
    data: {
      patientId: opts.patientId,
      recipientPhone: opts.recipientPhone,
      channel: opts.channel,
      templateType: opts.templateType,
      messageBody: opts.messageBody,
      deliveryStatus: opts.deliveryStatus ?? null,
    },
  })
}

/**
 * Returns true if the patient has consented to automated bot communications,
 * or has no consent record (default opt-in for operational healthcare comms).
 * Returns false if the patient has explicitly opted out.
 */
export async function hasOutboundConsent(patientId: string): Promise<boolean> {
  // ConsentLog (CRM automation's append-only per-channel record) wins when
  // present, so a WhatsApp STOP logged there isn't shadowed by a stale or
  // opposite PatientConsent row (the two used to be written independently —
  // see consent-log.service.ts header). Falls back to legacy PatientConsent
  // only when ConsentLog has no WhatsApp rows yet for this patient, which
  // preserves the existing default-opted-in behavior for outbound sends.
  const latestLog = await prisma.consentLog.findFirst({
    where:   { patientId, channel: 'WHATSAPP' },
    orderBy: { createdAt: 'desc' },
  })
  if (latestLog) return latestLog.status === 'OPT_IN'

  const record = await prisma.patientConsent.findFirst({
    where:   { patientId, consentType: 'BOT_COMMUNICATION' },
    orderBy: { grantedAt: 'desc' },
  })
  if (!record) return true          // No record → default opted-in
  return record.granted === true    // Last explicit choice wins
}
