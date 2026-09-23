import { normalizePhone } from '../utils/phone'

// ─────────────────────────────────────────────────────────────────────────
// Single authoritative source for the clinic's STAFF escalation WhatsApp
// destination — the number that receives cc_staff_concern / cc_staff_booking_update
// and every other staff-facing operational alert. This is NEVER a patient
// number; callers must never derive it from patient/guardian data.
//
// Added 2026-09 to close out a real production defect: the same
// `process.env.STAFF_WHATSAPP_NUMBER || '+256394836298'` fallback was
// duplicated independently in escalation.ts, guardian-routing.service.ts,
// whatsapp.service.ts, and staff-relay.service.ts — four copies of the same
// magic string that could silently drift if only one were ever updated.
// Every staff-escalation WhatsApp send now goes through this accessor
// instead, so there is exactly one place that can go stale.
//
// CLINIC_ESCALATION_WHATSAPP_NUMBER is the canonical env var name.
// STAFF_WHATSAPP_NUMBER is read as a legacy fallback so this doesn't require
// an immediate production env rename. If neither is set, falls back to the
// owner-approved clinic operations number documented below — the app must
// never end up with an empty or malformed escalation destination.
// ─────────────────────────────────────────────────────────────────────────

const OWNER_APPROVED_CLINIC_ESCALATION_WHATSAPP_NUMBER = '+256394836298'

/**
 * Resolves the clinic's staff escalation WhatsApp number, normalized to
 * E.164. Throws if the configured value doesn't normalize to a valid Uganda
 * number — callers must catch this and fail that one channel closed (fall
 * back to SMS / in-app+push) rather than let a misconfiguration silently
 * route an escalation somewhere unintended.
 */
export function getClinicEscalationWhatsAppNumber(): string {
  const raw =
    process.env.CLINIC_ESCALATION_WHATSAPP_NUMBER?.trim() ||
    process.env.STAFF_WHATSAPP_NUMBER?.trim() ||
    OWNER_APPROVED_CLINIC_ESCALATION_WHATSAPP_NUMBER

  const normalized = normalizePhone(raw)
  if (!/^\+256\d{9}$/.test(normalized)) {
    throw new Error(
      `Invalid clinic escalation WhatsApp number configured ("${raw}") — does not normalize to a valid Uganda E.164 number`
    )
  }
  return normalized
}
