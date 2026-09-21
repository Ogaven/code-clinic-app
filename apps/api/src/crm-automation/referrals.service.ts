// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — Patient Referrals list (Product Experience Closure,
// Part 17; extended in the Data/Role-Parity milestone to reconcile with the
// clinic's real historical referral data).
//
// TWO DISTINCT CONCEPTS, both surfaced here, never conflated:
//   A. ACQUISITION SOURCE — "how did this patient hear about us?" Lives on
//      the LEGACY Patient.referralSource free-text field, populated by
//      registration/CSV-import/walk-in intake since before this CRM
//      workstream existed (866 real patients in production have this set).
//   B. PATIENT-TO-PATIENT REFERRAL — "which existing patient referred this
//      one?" Lives on crmReferralSource='PATIENT_REFERRAL' +
//      crmReferredByPatientId, set only via the CRM Tags "Referred By"
//      picker added in the prior Patient CRM Automation milestone. This is
//      a genuinely NEW, structured link with zero historical backfill (0
//      patients have it set in production as of this milestone) — nothing
//      here invents a referrer identity for a patient whose free-text
//      referralSource merely says "Patient Referral"/"Friends and Family"/
//      etc. without recording WHO. Those patients are surfaced separately,
//      honestly labeled "referrer not recorded".
//
// Revenue-per-referral is intentionally NOT computed here: doing so
// correctly would require the same single-clean-attribution discipline as
// revenue-attribution.service.ts, applied to a link (referredByPatientId)
// that isn't a Lead — building that rigorously is out of this milestone's
// scope, and an approximate number would violate "do not fabricate
// referral relationships." Only real, unambiguous fields are reported.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import { startOfKampalaMonth } from '../utils/kampala-time'

// Case-insensitive match on free-text referralSource values that clearly
// indicate a patient/word-of-mouth referral (not a digital channel, not an
// institutional/employer partnership like "NWSC"/"BNI", not a professional
// "Doctor referral" — that's a distinct concept, left in the general
// breakdown rather than folded into "patient referred you" ambiguity).
const PATIENT_REFERRAL_PATTERN = /\bfriends?\b|\bfamily\b|word[\s-]of[\s-]mouth|patient\s*referral/i

export function isPatientReferralSourceText(value: string): boolean {
  return PATIENT_REFERRAL_PATTERN.test(value)
}

export interface ReferralRow {
  referredPatientId: string
  referredPatientName: string
  referredPatientPhone: string
  referredAt: Date | null
  referringPatientId: string
  referringPatientName: string
  treatmentPlanStatus: string
}

// Derived entirely from the same `referrals` rows above — no extra query,
// no new field. "Converted" reuses the same treatmentPlanStatus:'ACCEPTED'
// value the rest of the CRM already treats as the real conversion signal
// (see patient-tags.service.ts's deriveTreatmentPlanStatusFromStages) —
// never a second, referral-local definition of "converted".
export interface ReferralSummary {
  totalReferred: number
  uniqueReferrers: number
  newThisMonth: number
  convertedTreatment: number
}

export interface ReferralSourceBreakdownRow { source: string; count: number }

export interface UnknownReferrerPatient { id: string; firstName: string; lastName: string; referralSource: string; registeredAt: Date }

export interface LegacyReferralOverview {
  totalWithSourceRecorded: number
  sourceBreakdown: ReferralSourceBreakdownRow[]
  patientReferralUnknownCount: number
  patientReferralUnknownRecent: UnknownReferrerPatient[]
}

// Concept A — acquisition source, read from the legacy free-text field that
// actually has real historical data. Never inferred, never guessed: this is
// a plain groupBy of exactly what staff/patients entered, verbatim.
export async function legacyReferralSourceOverview(): Promise<LegacyReferralOverview> {
  const grouped = await prisma.patient.groupBy({
    by:     ['referralSource'],
    _count: true,
    where:  { referralSource: { not: null }, isActive: true },
    orderBy: { _count: { referralSource: 'desc' } },
  })
  const sourceBreakdown: ReferralSourceBreakdownRow[] = grouped
    .filter(g => g.referralSource && g.referralSource.trim())
    .map(g => ({ source: g.referralSource as string, count: g._count as unknown as number }))

  const totalWithSourceRecorded = sourceBreakdown.reduce((sum, r) => sum + r.count, 0)

  // Patients whose free-text source clearly says "a patient referred me" but
  // whose record has no structured crmReferredByPatientId link — real,
  // legitimate referral-source evidence with an honestly-unknown referrer
  // identity. Never backfilled into crmReferredByPatientId (that would be
  // fabricating a specific referrer this data doesn't actually name).
  const patientReferralLike = sourceBreakdown.filter(r => isPatientReferralSourceText(r.source))
  const patientReferralUnknownCount = patientReferralLike.reduce((sum, r) => sum + r.count, 0)

  const recentCandidates = patientReferralUnknownCount > 0
    ? await prisma.patient.findMany({
        where: {
          isActive: true,
          crmReferredByPatientId: null,
          OR: patientReferralLike.map(r => ({ referralSource: r.source })),
        },
        select: { id: true, firstName: true, lastName: true, referralSource: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })
    : []

  return {
    totalWithSourceRecorded,
    sourceBreakdown,
    patientReferralUnknownCount,
    patientReferralUnknownRecent: recentCandidates.map(p => ({
      id: p.id, firstName: p.firstName, lastName: p.lastName,
      referralSource: p.referralSource as string, registeredAt: p.createdAt,
    })),
  }
}

export async function listPatientReferrals(): Promise<{
  referrals: ReferralRow[]
  topReferrers: Array<{ patientId: string; name: string; count: number }>
  summary: ReferralSummary
  legacySource: LegacyReferralOverview
}> {
  const referred = await prisma.patient.findMany({
    where:  { crmReferralSource: 'PATIENT_REFERRAL', crmReferredByPatientId: { not: null } },
    select: {
      id: true, firstName: true, lastName: true, phone: true, tagsUpdatedAt: true, treatmentPlanStatus: true,
      crmReferredByPatient: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { tagsUpdatedAt: 'desc' },
  })

  const referrals: ReferralRow[] = referred
    .filter(p => p.crmReferredByPatient)
    .map(p => ({
      referredPatientId: p.id,
      referredPatientName: `${p.firstName} ${p.lastName}`,
      referredPatientPhone: p.phone,
      referredAt: p.tagsUpdatedAt,
      referringPatientId: p.crmReferredByPatient!.id,
      referringPatientName: `${p.crmReferredByPatient!.firstName} ${p.crmReferredByPatient!.lastName}`,
      treatmentPlanStatus: p.treatmentPlanStatus,
    }))

  const countByReferrer = new Map<string, { name: string; count: number }>()
  for (const r of referrals) {
    const existing = countByReferrer.get(r.referringPatientId)
    countByReferrer.set(r.referringPatientId, { name: r.referringPatientName, count: (existing?.count ?? 0) + 1 })
  }
  const topReferrers = [...countByReferrer.entries()]
    .map(([patientId, v]) => ({ patientId, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count)

  const monthStart = startOfKampalaMonth()
  const summary: ReferralSummary = {
    totalReferred:      referrals.length,
    uniqueReferrers:    countByReferrer.size,
    newThisMonth:       referrals.filter(r => r.referredAt && r.referredAt >= monthStart).length,
    convertedTreatment: referrals.filter(r => r.treatmentPlanStatus === 'ACCEPTED').length,
  }

  const legacySource = await legacyReferralSourceOverview()

  return { referrals, topReferrers, summary, legacySource }
}
