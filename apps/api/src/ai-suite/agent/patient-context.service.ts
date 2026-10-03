// Structured Patient Context Summary for Sarah (the WhatsApp/website AI
// agent) — gives her conversational continuity ("you already have an
// appointment Tuesday", "your crown follow-up is due next week") without
// dumping the raw EMR into the LLM prompt.
//
// Scope discipline: every query here is filtered by the exact resolved
// patientId the caller already matched via resolveTextingPatient() (phone-
// based, in agent.service.ts) — this function never does its own patient
// lookup/matching, so it can't itself introduce a cross-patient identity
// mix-up. Deliberately excludes billing/financial detail (accountBalance,
// invoices, costPerUnit) and raw clinical notes (medicalNotesEncrypted,
// TreatmentNote content) — none of that is "minimum necessary" for a
// booking/continuity conversation, and some of it (balances, diagnoses) is
// exactly the kind of data this feature must NOT hand to a model that then
// echoes things back in chat.
import { prisma } from '../../lib/prisma'

const ACTIVE_TREATMENT_STATUSES = ['Planned', 'In Progress', 'On Hold']

export async function buildPatientContextSummary(patientId: string): Promise<string> {
  const now = new Date()

  const [pastApptCount, upcomingAppt, lastCompletedAppt, activePlans, recentCompletedPlan] = await Promise.all([
    prisma.appointment.count({
      where: { patientId, status: { in: ['COMPLETED'] } },
    }),
    prisma.appointment.findFirst({
      where: { patientId, startAt: { gt: now }, status: { notIn: ['CANCELLED'] } },
      orderBy: { startAt: 'asc' },
      select: {
        startAt: true, status: true,
        service: { select: { name: true } },
        doctor: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    }),
    prisma.appointment.findFirst({
      where: { patientId, status: 'COMPLETED' },
      orderBy: { startAt: 'desc' },
      select: {
        startAt: true,
        service: { select: { name: true } },
        doctor: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    }),
    prisma.treatmentPlan.findMany({
      where: { patientId, status: { in: ACTIVE_TREATMENT_STATUSES } },
      select: {
        status: true, toothNumber: true, followUpAt: true, followUpReason: true, serviceId: true,
        doctor: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.treatmentPlan.findFirst({
      where: { patientId, status: 'Completed' },
      orderBy: { updatedAt: 'desc' },
      select: { serviceId: true, updatedAt: true },
    }),
  ])

  // TreatmentPlan has no direct Prisma relation to Service (only serviceId —
  // same reason pipeline.ts batch-fetches a serviceMap instead of an
  // `include`), so names are resolved in one small follow-up query.
  const serviceIds = [...new Set([...activePlans.map(p => p.serviceId), recentCompletedPlan?.serviceId].filter(Boolean))] as string[]
  const serviceMap = new Map<string, string>()
  if (serviceIds.length > 0) {
    const services = await prisma.service.findMany({ where: { id: { in: serviceIds } }, select: { id: true, name: true } })
    services.forEach(s => serviceMap.set(s.id, s.name))
  }

  const isReturning = pastApptCount > 0
  const lines: string[] = [
    `PATIENT STATUS: ${isReturning ? 'Returning patient' : 'New patient — no completed visits on file yet'}`,
  ]

  if (upcomingAppt) {
    const docName = upcomingAppt.doctor?.user ? `Dr. ${upcomingAppt.doctor.user.firstName} ${upcomingAppt.doctor.user.lastName}` : 'a doctor'
    const when = upcomingAppt.startAt.toLocaleString('en-GB', { timeZone: 'Africa/Kampala', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: true })
    lines.push(`UPCOMING APPOINTMENT: Already booked — ${when} with ${docName}${upcomingAppt.service ? ` for ${upcomingAppt.service.name}` : ''} (status: ${upcomingAppt.status}). Do NOT treat this patient as needing a new booking unless they ask to change/add one — acknowledge the existing appointment naturally.`)
  } else {
    lines.push('UPCOMING APPOINTMENT: None currently booked.')
  }

  if (lastCompletedAppt) {
    const docName = lastCompletedAppt.doctor?.user ? `Dr. ${lastCompletedAppt.doctor.user.firstName} ${lastCompletedAppt.doctor.user.lastName}` : 'a doctor'
    const when = lastCompletedAppt.startAt.toLocaleDateString('en-GB', { timeZone: 'Africa/Kampala', day: 'numeric', month: 'long', year: 'numeric' })
    lines.push(`LAST VISIT: ${when} with ${docName}${lastCompletedAppt.service ? ` for ${lastCompletedAppt.service.name}` : ''}.`)
  }

  if (activePlans.length > 0) {
    lines.push('ACTIVE TREATMENT PLANS:')
    for (const p of activePlans) {
      const docName = p.doctor?.user ? `Dr. ${p.doctor.user.firstName} ${p.doctor.user.lastName}` : 'unassigned doctor'
      const svc = (p.serviceId && serviceMap.get(p.serviceId)) || (p.toothNumber ? `Treatment on tooth ${p.toothNumber}` : 'Treatment')
      let line = `- ${svc} (${p.status}, ${docName})`
      if (p.followUpAt) {
        const due = p.followUpAt.toLocaleDateString('en-GB', { timeZone: 'Africa/Kampala', day: 'numeric', month: 'long' })
        line += ` — patient asked to be followed up around ${due}${p.followUpReason ? ` (${p.followUpReason})` : ''}. If they're asking about this treatment, you may acknowledge the planned follow-up; staff will reach out — do not promise a specific contact time yourself.`
      }
      lines.push(line)
    }
  }

  const recentCompletedServiceName = recentCompletedPlan?.serviceId ? serviceMap.get(recentCompletedPlan.serviceId) : undefined
  if (recentCompletedServiceName) {
    const when = recentCompletedPlan!.updatedAt.toLocaleDateString('en-GB', { timeZone: 'Africa/Kampala', day: 'numeric', month: 'long', year: 'numeric' })
    lines.push(`RECENT COMPLETED TREATMENT: ${recentCompletedServiceName} (completed around ${when}).`)
  }

  lines.push('Use this context only for natural conversational continuity (e.g. acknowledging an existing booking or follow-up). Never state a fact about this patient that is not listed above, and never read this context aloud verbatim.')

  return lines.join('\n')
}

// ── Staff hand-back context ─────────────────────────────────────────────────
// When staff hand a conversation back to Sarah, she needs to know what the
// human did during takeover so she doesn't re-ask questions or double-book.
// Reads the free-form summary staff optionally typed (stored on the SYSTEM
// "Agent resumed by staff" AiMessage — see takeover.service.ts) plus an
// auto-generated list of PatientActivity rows logged between takeover and
// hand-back, which is read data (never fabricated) from whatever staff
// actions were already logged by the normal appointment/treatment routes.
async function buildHandoffContext(patientId: string, takenOverAt: Date, handedBackAt: Date): Promise<string> {
  const activities = await prisma.patientActivity.findMany({
    where: { patientId, createdAt: { gte: takenOverAt, lte: handedBackAt } },
    select: { action: true, userName: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 20,
  })
  if (activities.length === 0) return ''
  return activities
    .map(a => `- ${a.action} (by ${a.userName}, ${a.createdAt.toLocaleTimeString('en-GB', { timeZone: 'Africa/Kampala', hour: '2-digit', minute: '2-digit' })})`)
    .join('\n')
}

// Only surfaces a hand-back note the FIRST time Sarah replies after staff
// resumed her — if she's already replied since the hand-back, there's
// nothing new to tell her, and repeating it every turn would just get
// stale/confusing. "Already replied since" is determined by comparing
// timestamps, not by mutating/consuming the message, so this stays safe to
// call on every incoming message without extra state.
export async function getPendingHandoffNote(conversationId: string, patientId: string): Promise<string | null> {
  const [lastAgentMsg, lastHandback] = await Promise.all([
    prisma.aiMessage.findFirst({ where: { conversationId, role: 'AGENT' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.aiMessage.findFirst({
      where: { conversationId, role: 'SYSTEM', content: { startsWith: 'Agent resumed by staff' } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, metadata: true },
    }),
  ])
  if (!lastHandback) return null
  if (lastAgentMsg && lastAgentMsg.createdAt > lastHandback.createdAt) return null

  let staffSummary: string | null = null
  try {
    const meta = lastHandback.metadata ? JSON.parse(lastHandback.metadata) : null
    staffSummary = meta?.summary || null
  } catch { /* malformed metadata — treat as no summary, never throw */ }

  const lastTakeover = await prisma.aiMessage.findFirst({
    where: { conversationId, role: 'SYSTEM', content: { startsWith: 'Conversation taken over by staff' }, createdAt: { lt: lastHandback.createdAt } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  const autoActions = lastTakeover
    ? await buildHandoffContext(patientId, lastTakeover.createdAt, lastHandback.createdAt)
    : ''

  if (!staffSummary && !autoActions) return null

  const lines = ['A staff member just handled part of this conversation directly and has handed it back to you. Continue naturally from here — do NOT repeat questions already answered, do NOT restart qualification, and do NOT book another appointment if one is already confirmed below.']
  if (staffSummary) lines.push(`STAFF NOTES: ${staffSummary}`)
  if (autoActions) lines.push(`ACTIONS TAKEN WHILE STAFF WERE HANDLING THIS:\n${autoActions}`)
  return lines.join('\n')
}
