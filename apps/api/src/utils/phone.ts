// Canonical phone number handling for Uganda numbers (country code 256).
//
// Historical records exist in three formats depending on when/how they were entered:
// +256XXXXXXXXX, 256XXXXXXXXX, and local 0XXXXXXXXX. A recurring class of production bugs
// (duplicate contacts, missed appointment lookups, misdirected messages) traced back to
// different files comparing/storing these inconsistently — some checking only 2 of the 3
// formats, some producing a different canonical shape on write. This is the single source
// of truth going forward: normalizePhone() for anything written to the DB, phoneVariants()
// for anything matched/looked up against it.
//
// Per project policy this does NOT retroactively rewrite existing records — historical data
// stays as-is; phoneVariants() exists precisely so reads still find records in any of the
// three formats without a backfill.

/**
 * Normalizes a raw phone number string to canonical E.164 form (+256XXXXXXXXX).
 * Use this for anything being written/stored (new patient, new lead, new conversation, etc).
 */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return trimmed

  // Local Uganda format: 0XXXXXXXXX (10 digits, leading 0)
  if (digits.startsWith('0') && digits.length === 10) return '+256' + digits.slice(1)

  // Already has the country code, with or without a leading +
  if (digits.startsWith('256') && digits.length === 12) return '+' + digits

  // Bare subscriber number, no country code or leading 0 (9 digits, starts 7 or 4)
  if (digits.length === 9 && /^[74]/.test(digits)) return '+256' + digits

  // Unknown shape — best effort, preserve a leading + if the input already had one
  return trimmed.startsWith('+') ? '+' + digits : '+' + digits
}

/**
 * Returns every historical format a given number might be stored as
 * (+256XXXXXXXXX, 256XXXXXXXXX, 0XXXXXXXXX), for building lookup queries, e.g.:
 *   prisma.patient.findFirst({ where: { phone: { in: phoneVariants(from) } } })
 * Use this for anything matched/looked up against stored phone numbers.
 */
export function phoneVariants(raw: string | null | undefined): string[] {
  if (!raw) return []
  const canonical = normalizePhone(raw)
  if (!canonical.startsWith('+256') || canonical.length !== 13) {
    // Couldn't confidently normalize (unrecognized shape) — fall back to raw + best-effort form
    return [...new Set([raw.trim(), canonical])].filter(Boolean)
  }
  const bare = canonical.slice(1)          // 256XXXXXXXXX
  const local = '0' + bare.slice(3)        // 0XXXXXXXXX
  return [canonical, bare, local]
}
