// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — acquisition-to-revenue attribution (Phase 5).
//
// Lead.CONVERTED does NOT mean revenue. This module keeps every stage
// separate and defensible:
//   Lead -> Contacted -> Qualified -> Booked -> Attended -> Treatment
//   Accepted -> Treatment Value -> Invoiced -> Collected
//
// Attribution rule (the one that matters most here): Lead.convertedToPatientId
// links a Lead to the Patient it produced, but that link is a plain string,
// not an enforced 1:1 relation — routes/crm.ts's convert handler reuses an
// existing Patient row when one already matches the phone number, so in
// principle more than one Lead can end up pointing at the same Patient
// (e.g. two separate inquiries from the same person, both later converted).
// Naively summing "this patient's lifetime payments" and crediting them to
// EVERY lead that points at that patient would double-count real money.
//
// So: a patient's revenue is only ever attributed when EXACTLY ONE lead
// (across the whole leads table, not just the current filter) points at
// that patient. Any patient linked from more than one lead is reported
// separately as ambiguous and excluded from every per-dimension total —
// never split, never guessed, never assigned to "whichever lead is newer."
// Patients with zero lead link at all (walk-ins, referrals, historical
// import) are simply outside every attribution bucket — their revenue is
// real but has no acquisition story to attach it to.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import { ATTENDED_STATUSES } from '../services/patient-analytics.service'

export interface AttributionFilters {
  source?: string
  campaignId?: string
  ownerId?: string   // Lead.assignedTo
  dateFrom?: Date    // Lead.createdAt >= dateFrom
  dateTo?: Date      // Lead.createdAt <= dateTo
}

interface LeadPatientLink {
  leadId: string
  patientId: string
  source: string
  campaignId: string | null
  assignedTo: string | null
  createdAt: Date
}

const OPEN_LEAD_REACHED = (toStage: string) => ({ stageHistory: { some: { toStage } } })

function matchesFilters(link: LeadPatientLink, filters: AttributionFilters): boolean {
  if (filters.source && link.source !== filters.source) return false
  if (filters.campaignId && link.campaignId !== filters.campaignId) return false
  if (filters.ownerId && link.assignedTo !== filters.ownerId) return false
  if (filters.dateFrom && link.createdAt < filters.dateFrom) return false
  if (filters.dateTo && link.createdAt > filters.dateTo) return false
  return true
}

// Every Lead -> Patient link that exists at all, used to detect ambiguity
// (a patient pointed at by more than one lead) regardless of which lead is
// in scope for the current filter — ambiguity is a property of the patient,
// not of one lead's filter match.
async function loadLeadPatientLinks(): Promise<LeadPatientLink[]> {
  const leads = await prisma.lead.findMany({
    where:  { convertedToPatientId: { not: null } },
    select: { id: true, convertedToPatientId: true, source: true, campaignId: true, assignedTo: true, createdAt: true },
  })
  return leads.map(l => ({ leadId: l.id, patientId: l.convertedToPatientId!, source: l.source, campaignId: l.campaignId, assignedTo: l.assignedTo, createdAt: l.createdAt }))
}

// Patient ids with exactly one linking lead that also matches `filters`, plus
// the count of patients excluded because more than one lead points at them.
async function cleanlyAttributedPatientIds(filters: AttributionFilters, allLinks: LeadPatientLink[]): Promise<{ patientIds: string[]; ambiguousPatientCount: number }> {
  const byPatient = new Map<string, LeadPatientLink[]>()
  for (const link of allLinks) {
    byPatient.set(link.patientId, [...(byPatient.get(link.patientId) ?? []), link])
  }

  const patientIds: string[] = []
  let ambiguousPatientCount = 0
  for (const [patientId, links] of byPatient) {
    const matchingInFilter = links.filter(l => matchesFilters(l, filters))
    if (matchingInFilter.length === 0) continue // this patient has no lead in scope for this filter at all
    if (links.length > 1) { ambiguousPatientCount++; continue } // multiple leads EVER point here — exclude, don't guess
    patientIds.push(patientId)
  }
  return { patientIds, ambiguousPatientCount }
}

async function sumTreatmentValueUGX(patientIds: string[]): Promise<number> {
  if (patientIds.length === 0) return 0
  const plans = await prisma.treatmentPlan.findMany({
    where:  { patientId: { in: patientIds } },
    select: { costPerUnit: true, quantity: true, discount: true },
  })
  return plans.reduce((sum, p) => sum + Math.max(0, p.costPerUnit * p.quantity - p.discount), 0)
}

async function sumInvoicedUGX(patientIds: string[]): Promise<number> {
  if (patientIds.length === 0) return 0
  const agg = await prisma.invoice.aggregate({ where: { patientId: { in: patientIds } }, _sum: { totalUGX: true } })
  return agg._sum.totalUGX ?? 0
}

async function sumCollectedUGX(patientIds: string[]): Promise<number> {
  if (patientIds.length === 0) return 0
  const agg = await prisma.payment.aggregate({ where: { patientId: { in: patientIds } }, _sum: { amountUGX: true } })
  return agg._sum.amountUGX ?? 0
}

export interface AcquisitionRevenueReport {
  filters: AttributionFilters
  funnel: {
    leadCount: number
    contactedCount: number
    qualifiedCount: number
    bookedCount: number
    attendedCount: number
    treatmentAcceptedCount: number
  }
  revenue: {
    treatmentValueUGX: number
    invoicedUGX: number
    collectedUGX: number
  }
  ambiguousPatientCount: number
  note: string
}

export async function buildAcquisitionRevenueReport(filters: AttributionFilters = {}): Promise<AcquisitionRevenueReport> {
  const leadWhere: Record<string, unknown> = {}
  if (filters.source) leadWhere.source = filters.source
  if (filters.campaignId) leadWhere.campaignId = filters.campaignId
  if (filters.ownerId) leadWhere.assignedTo = filters.ownerId
  if (filters.dateFrom || filters.dateTo) {
    leadWhere.createdAt = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    }
  }

  const [leadCount, contactedCount, qualifiedCount, allLinks] = await Promise.all([
    prisma.lead.count({ where: leadWhere }),
    prisma.lead.count({ where: { AND: [leadWhere, OPEN_LEAD_REACHED('CONTACTED')] } }),
    prisma.lead.count({ where: { AND: [leadWhere, OPEN_LEAD_REACHED('QUALIFIED')] } }),
    loadLeadPatientLinks(),
  ])

  const { patientIds, ambiguousPatientCount } = await cleanlyAttributedPatientIds(filters, allLinks)

  const [appointments, treatmentAcceptedCount, treatmentValueUGX, invoicedUGX, collectedUGX] = await Promise.all([
    patientIds.length
      ? prisma.appointment.findMany({ where: { patientId: { in: patientIds } }, select: { patientId: true, status: true } })
      : Promise.resolve([]),
    patientIds.length
      ? prisma.patient.count({ where: { id: { in: patientIds }, treatmentPlanStatus: 'ACCEPTED' } })
      : Promise.resolve(0),
    sumTreatmentValueUGX(patientIds),
    sumInvoicedUGX(patientIds),
    sumCollectedUGX(patientIds),
  ])

  const bookedPatientIds = new Set(appointments.map(a => a.patientId))
  const attendedPatientIds = new Set(appointments.filter(a => (ATTENDED_STATUSES as string[]).includes(a.status)).map(a => a.patientId))

  return {
    filters,
    funnel: {
      leadCount,
      contactedCount,
      qualifiedCount,
      bookedCount: bookedPatientIds.size,
      attendedCount: attendedPatientIds.size,
      treatmentAcceptedCount,
    },
    revenue: { treatmentValueUGX, invoicedUGX, collectedUGX },
    ambiguousPatientCount,
    note:
      'Booked/Attended/Treatment Accepted/revenue figures cover only patients with EXACTLY ONE linking lead — patients ' +
      `linked from more than one lead (${ambiguousPatientCount} in this cohort) are excluded rather than having their ` +
      'revenue guessed or split. Revenue figures are lifetime totals for the attributed patients, not activity within ' +
      'dateFrom/dateTo (that window only scopes which leads count toward Lead/Contacted/Qualified). ' +
      'Converted != revenue: booked/attended/treatment-accepted/invoiced/collected are tracked separately on purpose.',
  }
}

export interface AcquisitionRevenueBucket {
  key: string
  leadCount: number
  bookedCount: number
  attendedCount: number
  treatmentAcceptedCount: number
  treatmentValueUGX: number
  invoicedUGX: number
  collectedUGX: number
}

// Clinic-wide breakdown by a single dimension (source, campaign, or owner) —
// one pass, reusing the same clean-attribution rule as the single-cohort
// report above, for building a dashboard without N sequential report calls.
export async function acquisitionRevenueByDimension(dimension: 'source' | 'campaignId' | 'ownerId'): Promise<{ buckets: AcquisitionRevenueBucket[]; ambiguousPatientCount: number }> {
  const allLinks = await loadLeadPatientLinks()
  const keyOf = (l: LeadPatientLink): string | null =>
    dimension === 'source' ? l.source : dimension === 'campaignId' ? l.campaignId : l.assignedTo

  const byPatient = new Map<string, LeadPatientLink[]>()
  for (const link of allLinks) byPatient.set(link.patientId, [...(byPatient.get(link.patientId) ?? []), link])

  const patientIdsByKey = new Map<string, string[]>()
  let ambiguousPatientCount = 0
  for (const [patientId, links] of byPatient) {
    if (links.length > 1) { ambiguousPatientCount++; continue }
    const key = keyOf(links[0])
    if (key === null) continue
    patientIdsByKey.set(key, [...(patientIdsByKey.get(key) ?? []), patientId])
  }

  const leadWhereDimension = (key: string) => (dimension === 'source' ? { source: key } : dimension === 'campaignId' ? { campaignId: key } : { assignedTo: key })

  const buckets: AcquisitionRevenueBucket[] = []
  for (const [key, patientIds] of patientIdsByKey) {
    const [leadCount, appointments, treatmentAcceptedCount, treatmentValueUGX, invoicedUGX, collectedUGX] = await Promise.all([
      prisma.lead.count({ where: leadWhereDimension(key) }),
      prisma.appointment.findMany({ where: { patientId: { in: patientIds } }, select: { patientId: true, status: true } }),
      prisma.patient.count({ where: { id: { in: patientIds }, treatmentPlanStatus: 'ACCEPTED' } }),
      sumTreatmentValueUGX(patientIds),
      sumInvoicedUGX(patientIds),
      sumCollectedUGX(patientIds),
    ])
    const bookedCount = new Set(appointments.map(a => a.patientId)).size
    const attendedCount = new Set(appointments.filter(a => (ATTENDED_STATUSES as string[]).includes(a.status)).map(a => a.patientId)).size
    buckets.push({ key, leadCount, bookedCount, attendedCount, treatmentAcceptedCount, treatmentValueUGX, invoicedUGX, collectedUGX })
  }

  return { buckets: buckets.sort((a, b) => b.collectedUGX - a.collectedUGX), ambiguousPatientCount }
}

export interface UnattributedRevenueSummary {
  totalCollectedUGX: number
  attributedToLeadUGX: number
  ambiguousMultiLeadUGX: number
  unattributedUGX: number
  note: string
}

// Clinic-wide: of every UGX actually collected, how much can be traced back
// to a single, unambiguous lead? The remainder is real revenue this report
// simply cannot explain the origin of — reported honestly, not hidden.
export async function unattributedRevenueSummary(): Promise<UnattributedRevenueSummary> {
  const [totalAgg, allLinks] = await Promise.all([
    prisma.payment.aggregate({ _sum: { amountUGX: true } }),
    loadLeadPatientLinks(),
  ])
  const totalCollectedUGX = totalAgg._sum.amountUGX ?? 0

  const byPatient = new Map<string, LeadPatientLink[]>()
  for (const link of allLinks) byPatient.set(link.patientId, [...(byPatient.get(link.patientId) ?? []), link])

  const cleanPatientIds = [...byPatient.entries()].filter(([, links]) => links.length === 1).map(([id]) => id)
  const ambiguousPatientIds = [...byPatient.entries()].filter(([, links]) => links.length > 1).map(([id]) => id)

  const [attributedToLeadUGX, ambiguousMultiLeadUGX] = await Promise.all([
    sumCollectedUGX(cleanPatientIds),
    sumCollectedUGX(ambiguousPatientIds),
  ])

  return {
    totalCollectedUGX,
    attributedToLeadUGX,
    ambiguousMultiLeadUGX,
    unattributedUGX: Math.max(0, totalCollectedUGX - attributedToLeadUGX - ambiguousMultiLeadUGX),
    note:
      'unattributedUGX covers payments for patients with no lead link at all (walk-ins, referrals, historical/imported ' +
      'patients) — real collected revenue this report has no acquisition story for. ambiguousMultiLeadUGX is money for ' +
      'patients linked from more than one lead, deliberately not attributed to any single one of them.',
  }
}
