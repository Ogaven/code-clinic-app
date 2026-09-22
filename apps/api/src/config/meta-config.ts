// ─────────────────────────────────────────────────────────────────────────
// Single authoritative source for Code Clinic's production WhatsApp Business
// Account identity. Added 2026-09 to close out a real production defect:
// meta-billing.service.ts and meta-usage.routes.ts each hardcoded their own
// WABA ID constant (`1754698499275270`) that predates a since-completed
// migration off Africa's Talking onto direct Meta Cloud API (confirmed by
// whatsapp.service.ts's "Zero AT involvement" send path, and by live Graph
// API calls during the 2026-09-20 investigation: `1754698499275270` belongs
// to an unrelated WABA under the same Business Manager and does not own
// Code Clinic's real phone number, templates, or delivery-failure records —
// the real production WABA is `1035568108843333`, matching WHATSAPP_WABA_ID).
//
// Every WABA-scoped read (billing/health status, usage/cost analytics,
// phone-number listing) must go through this accessor instead of a local
// constant, so there is exactly one place that can go stale.
// ─────────────────────────────────────────────────────────────────────────

export function getWhatsAppWabaId(): string | null {
  const id = process.env.WHATSAPP_WABA_ID?.trim()
  return id ? id : null
}

export function getWhatsAppToken(): string | null {
  const token = process.env.WHATSAPP_TOKEN?.trim()
  return token ? token : null
}

export function getWhatsAppPhoneNumberId(): string | null {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  return id ? id : null
}
