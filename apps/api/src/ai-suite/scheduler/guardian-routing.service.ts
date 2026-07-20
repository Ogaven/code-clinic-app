import { prisma } from '../../lib/prisma'
import { isMinor } from '../../utils/nameHelper'

export type PatientForRouting = {
  id: string
  dob: Date | null
  phone: string
  firstName: string
  familyAccountId: string | null
  // legacy fallback fields (kept for backwards compat while data migrates)
  guardianId: string | null
  guardian: { phone: string } | null
}

export type OutboundRecipient = {
  phone: string
  /** Display name to use in greeting (e.g. "Dear Kato,") */
  name: string
  /** Whether messages go to a guardian rather than the patient directly */
  isGuardian: boolean
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
      select: { firstName: true, lastName: true, phone: true },
    })

    if (guardian) {
      return {
        ok: true,
        recipient: {
          phone: guardian.phone,
          name: `${guardian.firstName} ${guardian.lastName}`.trim(),
          isGuardian: true,
        },
      }
    }
    // Family account exists but no active communication-contact guardian → STOP
    return { ok: false, reason: 'MINOR_NO_GUARDIAN' }
  }

  // Legacy: guardianId self-reference on Patient (pre-family-account data)
  if (patient.guardian?.phone) {
    return {
      ok: true,
      recipient: {
        phone: patient.guardian.phone,
        name: patientDisplayName,
        isGuardian: true,
      },
    }
  }

  // Minor with no guardian record at all → STOP
  return { ok: false, reason: 'MINOR_NO_GUARDIAN' }
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
