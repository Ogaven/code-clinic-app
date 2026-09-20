// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — unified "Needs Attention" operational queue.
//
// Every category here is a direct read of existing, already-computed state
// (Lead.status/slaState/assignedTo, Appointment.status, Patient.
// treatmentPlanStatus) — nothing is scored, inferred, or fabricated. Where a
// category duplicates logic that already exists elsewhere (staleLeadsByOwner
// in reporting.service.ts), it is reused rather than reimplemented so the
// two views can never silently disagree.
//
// ownerId scopes the lead-based categories to one CRM lead owner
// (Lead.assignedTo). It does NOT scope the appointment/patient-based
// categories (no-shows, cancellations, treatment opportunities) — those
// belong to the clinic/doctor, not a CRM lead owner, and conflating the two
// would misrepresent who is actually responsible for the follow-up.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import { staleLeadsByOwner } from './reporting.service'

const OPEN_LEAD_STATUSES = { notIn: ['CONVERTED', 'LOST'] }
const RECENT_APPOINTMENT_WINDOW_DAYS = 14

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000)
}

export interface NeedsAttentionOptions {
  ownerId?: string
}

export interface NeedsAttentionCategory {
  key: string
  label: string
  scope: 'LEAD_OWNER' | 'CLINIC_WIDE'
  count: number
  items: Array<Record<string, unknown>>
}

export interface NeedsAttentionResult {
  generatedAt: string
  ownerId: string | null
  totalItems: number
  categories: NeedsAttentionCategory[]
}

export async function buildNeedsAttentionQueue(options: NeedsAttentionOptions = {}): Promise<NeedsAttentionResult> {
  const ownerId = options.ownerId ?? null
  const ownerFilter = ownerId ? { assignedTo: ownerId } : {}

  const [
    unansweredNew,
    overdueFollowUps,
    qualifiedUnbooked,
    unassigned,
    staleAll,
    recentNoShows,
    recentCancellations,
    treatmentOpportunities,
  ] = await Promise.all([
    // New lead, zero human reply yet — the very first thing anyone should act on.
    prisma.lead.findMany({
      where:  { status: 'NEW', firstHumanReplyAt: null, ...ownerFilter },
      select: { id: true, name: true, phone: true, source: true, assignedTo: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    // SLA sweep (lead-sla.service.ts) already escalated these — surfacing
    // its own state here, not recomputing a second staleness definition.
    prisma.lead.findMany({
      where:  { slaState: { in: ['ESCALATED_15', 'ESCALATED_30', 'STALE_24H'] }, status: OPEN_LEAD_STATUSES, ...ownerFilter },
      select: { id: true, name: true, phone: true, slaState: true, assignedTo: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    // Qualified but never reached CONVERTED (no patient link yet) — a hot
    // lead sitting idle is the highest-value gap in the funnel to close.
    prisma.lead.findMany({
      where:  { status: 'QUALIFIED', convertedToPatientId: null, ...ownerFilter },
      select: { id: true, name: true, phone: true, assignedTo: true, qualifyingIntent: true, updatedAt: true },
      orderBy: { updatedAt: 'asc' },
    }),
    // Nobody owns this lead at all — routing/assignment gap, not a
    // follow-up gap. Inherently owner-agnostic, so skipped entirely when
    // scoped to a single owner rather than returning a meaningless empty set.
    ownerId ? Promise.resolve([]) : prisma.lead.findMany({
      where:  { assignedTo: null, status: OPEN_LEAD_STATUSES },
      select: { id: true, name: true, phone: true, source: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    staleLeadsByOwner(),
    prisma.appointment.findMany({
      where:  { status: 'NO_SHOW', startAt: { gte: daysAgo(RECENT_APPOINTMENT_WINDOW_DAYS) } },
      select: { id: true, patientId: true, startAt: true, patient: { select: { firstName: true, lastName: true, phone: true } } },
      orderBy: { startAt: 'desc' },
    }),
    prisma.appointment.findMany({
      where:  { status: { in: ['CANCELLED', 'CANCELLED_RESCHEDULED'] }, startAt: { gte: daysAgo(RECENT_APPOINTMENT_WINDOW_DAYS) } },
      select: { id: true, patientId: true, startAt: true, patient: { select: { firstName: true, lastName: true, phone: true } } },
      orderBy: { startAt: 'desc' },
    }),
    prisma.patient.findMany({
      where:  { treatmentPlanStatus: 'PROPOSED' },
      select: { id: true, firstName: true, lastName: true, phone: true, updatedAt: true },
      orderBy: { updatedAt: 'asc' },
    }),
  ])

  // A cancellation only "needs attention" if the patient hasn't already been
  // rebooked — checked against real appointment rows, not assumed either way.
  const cancelledPatientIds = [...new Set(recentCancellations.map(a => a.patientId))]
  const laterActiveAppointments = cancelledPatientIds.length
    ? await prisma.appointment.findMany({
        where:  { patientId: { in: cancelledPatientIds }, status: { notIn: ['CANCELLED', 'CANCELLED_RESCHEDULED', 'NO_SHOW'] } },
        select: { patientId: true },
      })
    : []
  const rebookedPatientIds = new Set(laterActiveAppointments.map(a => a.patientId))
  const unrebookedCancellations = recentCancellations.filter(a => !rebookedPatientIds.has(a.patientId))

  const staleForOwner = ownerId ? staleAll.filter(group => group.ownerId === ownerId) : staleAll
  const staleItems = staleForOwner.flatMap(group => group.leads)

  const categories: NeedsAttentionCategory[] = [
    { key: 'UNANSWERED_NEW',       label: 'New leads with no reply yet',            scope: 'LEAD_OWNER',   count: unansweredNew.length,           items: unansweredNew },
    { key: 'OVERDUE_FOLLOWUP',     label: 'Overdue follow-ups (SLA breached)',      scope: 'LEAD_OWNER',   count: overdueFollowUps.length,        items: overdueFollowUps },
    { key: 'STALE_UNTOUCHED',      label: 'Untouched 24h+, no human reply',         scope: 'LEAD_OWNER',   count: staleItems.length,              items: staleItems },
    { key: 'QUALIFIED_UNBOOKED',   label: 'Qualified but not yet booked',           scope: 'LEAD_OWNER',   count: qualifiedUnbooked.length,       items: qualifiedUnbooked },
    { key: 'UNASSIGNED',           label: 'Unassigned leads',                       scope: 'LEAD_OWNER',   count: unassigned.length,              items: unassigned },
    { key: 'NO_SHOW',              label: 'Recent no-shows',                        scope: 'CLINIC_WIDE',  count: recentNoShows.length,           items: recentNoShows },
    { key: 'CANCELLED_UNREBOOKED', label: 'Cancelled and not yet rebooked',         scope: 'CLINIC_WIDE',  count: unrebookedCancellations.length, items: unrebookedCancellations },
    { key: 'TREATMENT_OPPORTUNITY', label: 'Proposed treatment awaiting decision',  scope: 'CLINIC_WIDE',  count: treatmentOpportunities.length,  items: treatmentOpportunities },
  ]

  // The five LEAD_OWNER categories are not mutually exclusive — a single new,
  // unassigned lead that's also past its SLA can legitimately appear in
  // UNANSWERED_NEW, OVERDUE_FOLLOWUP, STALE_UNTOUCHED, and UNASSIGNED all at
  // once. A flat sum of category.count therefore over-counts how many
  // distinct leads actually need action, which is what the headline number
  // is supposed to answer. The CLINIC_WIDE categories (no-shows, cancelled
  // appointments, treatment opportunities) key on Appointment/Patient rows,
  // not Lead rows, and their statuses are mutually exclusive by construction
  // (an appointment can't be both NO_SHOW and CANCELLED), so they never
  // double-count against each other or against a lead and are simply added
  // on top. Per-category counts below are UNCHANGED — only this headline
  // total is deduplicated.
  const distinctLeadIds = new Set(
    categories.filter(c => c.scope === 'LEAD_OWNER').flatMap(c => c.items.map(item => item.id as string))
  )
  const clinicWideCount = categories.filter(c => c.scope === 'CLINIC_WIDE').reduce((sum, c) => sum + c.count, 0)

  return {
    generatedAt: new Date().toISOString(),
    ownerId,
    totalItems: distinctLeadIds.size + clinicWideCount,
    categories,
  }
}
