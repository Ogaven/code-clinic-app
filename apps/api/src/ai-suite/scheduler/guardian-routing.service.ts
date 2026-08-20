import { prisma } from '../../lib/prisma'
import { getGreetingName, isMinor } from '../../utils/nameHelper'
import { sendWhatsAppMessage } from '../whatsapp/whatsapp.service'

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
): Promise<void> {
  const staffNum = process.env.STAFF_WHATSAPP_NUMBER || '+256763430276'
  const msg = `⚠️ ${patientFullName} is a minor with no guardian contact on file — a ${messageType} could not be sent. Please add guardian info and follow up manually.`
  await sendWhatsAppMessage(staffNum, msg).catch((err: Error) => {
    console.error(`[GuardianRouting] Staff alert failed for ${patientFullName}:`, err.message)
  })
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
  const record = await prisma.patientConsent.findFirst({
    where:   { patientId, consentType: 'BOT_COMMUNICATION' },
    orderBy: { grantedAt: 'desc' },
  })
  if (!record) return true          // No record → default opted-in
  return record.granted === true    // Last explicit choice wins
}
