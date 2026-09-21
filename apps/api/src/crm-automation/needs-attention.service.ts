// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — unified "Needs Attention" operational queue for LEADS.
//
// Every category here is a direct read of existing, already-computed state
// (Lead.status/slaState/assignedTo, Appointment.status, Patient.
// treatmentPlanStatus) — nothing is scored, inferred, or fabricated. Where a
// category duplicates logic that already exists elsewhere (staleLeadsByOwner
// in reporting.service.ts), it is reused rather than reimplemented so the
// two views can never silently disagree.
//
// Scope (Product Experience Closure): this queue is specifically the Leads
// work queue — "who do I need to chase today to convert an enquiry." The
// existing-patient lifecycle categories that used to live here (recall
// overdue, treatment-incomplete follow-up, collections, repeated no-show)
// moved to patient-engagement.service.ts, each with its own dedicated home
// under CRM > Patient Engagement. That split is also what fixes the
// confusing "377 Needs Attention" vs "346 Total Leads" dashboard readout —
// the old headline summed lead counts AND patient counts together, so it
// could exceed (and had nothing to do with) a pure lead total. See
// distinctLeadCount below.
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
  // Unique LEADS needing attention — the headline KPI. Never the sum of
  // category counts: a lead awaiting first response AND past its response
  // target is still exactly ONE lead needing attention. See the dedup note
  // below the categories array for how this is computed.
  distinctLeadCount: number
  // Back-compat alias, identical value to distinctLeadCount. Older callers
  // (the dashboard KPI tile, the panel's header badge) read this name —
  // kept so nothing has to touch every call site to get the fixed
  // semantics. New code should prefer distinctLeadCount, which says what it
  // means.
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
    // Response-time sweep (lead-sla.service.ts) already escalated these —
    // surfacing its own state here, not recomputing a second staleness
    // definition. Labelled in plain language, not the internal "SLA" term.
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
    { key: 'OVERDUE_FOLLOWUP',     label: 'Overdue follow-ups',                     scope: 'LEAD_OWNER',   count: overdueFollowUps.length,        items: overdueFollowUps },
    { key: 'STALE_UNTOUCHED',      label: 'Leads waiting too long for a response',  scope: 'LEAD_OWNER',   count: staleItems.length,              items: staleItems },
    { key: 'QUALIFIED_UNBOOKED',   label: 'Qualified but not yet booked',           scope: 'LEAD_OWNER',   count: qualifiedUnbooked.length,       items: qualifiedUnbooked },
    { key: 'UNASSIGNED',           label: 'Unassigned leads',                       scope: 'LEAD_OWNER',   count: unassigned.length,              items: unassigned },
    { key: 'NO_SHOW',              label: 'Recent no-shows',                        scope: 'CLINIC_WIDE',  count: recentNoShows.length,           items: recentNoShows },
    { key: 'CANCELLED_UNREBOOKED', label: 'Cancelled and not yet rebooked',         scope: 'CLINIC_WIDE',  count: unrebookedCancellations.length, items: unrebookedCancellations },
    { key: 'TREATMENT_OPPORTUNITY', label: 'Proposed treatment awaiting decision',  scope: 'CLINIC_WIDE',  count: treatmentOpportunities.length,  items: treatmentOpportunities },
  ]

  // The five LEAD_OWNER categories are not mutually exclusive — a single new,
  // unassigned lead that's also past its response target can legitimately
  // appear in UNANSWERED_NEW, OVERDUE_FOLLOWUP, STALE_UNTOUCHED, and
  // UNASSIGNED all at once. A flat sum of category.count therefore
  // over-counts how many distinct LEADS actually need action, which is
  // exactly what the headline is supposed to answer — deduplicated by lead
  // id here, and here ONLY: the headline never includes the CLINIC_WIDE
  // (appointment/patient) categories below, because those aren't leads at
  // all and mixing them into a number labelled "leads needing attention"
  // is what produced the confusing dashboard readout this milestone fixes.
  // Per-category counts above are UNCHANGED — only this headline is scoped.
  const distinctLeadCount = new Set(
    categories.filter(c => c.scope === 'LEAD_OWNER').flatMap(c => c.items.map(item => item.id as string))
  ).size

  return {
    generatedAt: new Date().toISOString(),
    ownerId,
    distinctLeadCount,
    totalItems: distinctLeadCount,
    categories,
  }
}
