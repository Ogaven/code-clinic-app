// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — Patient Referrals list (Product Experience Closure,
// Part 17).
//
// Reuses the crmReferralSource/crmReferredByPatientId fields and the
// "Referred By" picker completed in the prior Patient CRM Automation
// milestone — no new schema, no new relationship model. Deliberately
// distinct from the legacy /referrals analytics page (Patient.referredBy,
// a free-text source-category field predating this workstream); that page
// is untouched.
//
// Revenue-per-referral is intentionally NOT computed here: doing so
// correctly would require the same single-clean-attribution discipline as
// revenue-attribution.service.ts, applied to a link (referredByPatientId)
// that isn't a Lead — building that rigorously is out of this milestone's
// scope, and an approximate number would violate "do not fabricate
// referral relationships." Only real, unambiguous fields are reported.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'

export interface ReferralRow {
  referredPatientId: string
  referredPatientName: string
  referredPatientPhone: string
  referredAt: Date | null
  referringPatientId: string
  referringPatientName: string
  treatmentPlanStatus: string
}

export async function listPatientReferrals(): Promise<{ referrals: ReferralRow[]; topReferrers: Array<{ patientId: string; name: string; count: number }> }> {
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

  return { referrals, topReferrers }
}
