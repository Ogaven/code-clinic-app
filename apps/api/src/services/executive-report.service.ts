import { prisma } from '../lib/prisma'
import { isAccepted, isDeclined, computeMoneyAtRisk } from './treatment-classification.service'
import { getAppointmentStatusBreakdown, getPatientActivitySummary } from './patient-analytics.service'
import { buildAcquisitionRevenueReport, buildSourceOutcomeEvidence } from '../crm-automation/revenue-attribution.service'

export type ExecutivePeriod = 'weekly' | 'monthly'

function startOfPeriod(kind: ExecutivePeriod, anchor = new Date()) {
  const local = new Date(anchor.toLocaleString('en-US', { timeZone: 'Africa/Kampala' }))
  local.setHours(0, 0, 0, 0)
  if (kind === 'weekly') {
    const day = local.getDay()
    local.setDate(local.getDate() - ((day + 6) % 7))
  } else local.setDate(1)
  return new Date(local.getTime() - 10_800_000)
}
function nextPeriod(kind: ExecutivePeriod, start: Date) {
  const d = new Date(start.getTime() + 10_800_000)
  kind === 'weekly' ? d.setDate(d.getDate() + 7) : d.setMonth(d.getMonth() + 1)
  return new Date(d.getTime() - 10_800_000)
}
function previousPeriod(kind: ExecutivePeriod, start: Date) {
  const d = new Date(start.getTime() + 10_800_000)
  kind === 'weekly' ? d.setDate(d.getDate() - 7) : d.setMonth(d.getMonth() - 1)
  return new Date(d.getTime() - 10_800_000)
}
function pct(c: number, p: number) { return p === 0 ? (c === 0 ? 0 : null) : Math.round(((c - p) / p) * 1000) / 10 }
function label(kind: ExecutivePeriod, start: Date, end: Date) {
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Kampala' })
  return kind === 'weekly' ? `${fmt(start)} – ${fmt(new Date(end.getTime() - 1))}` : start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Africa/Kampala' })
}
function planValue(p: { costPerUnit: number; quantity: number; discount: number }) { return Math.max(0, Math.round(p.costPerUnit * p.quantity - p.discount)) }
function localParts(d: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kampala', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(d)
  return { weekday: parts.find(p => p.type === 'weekday')?.value || '', hour: Number(parts.find(p => p.type === 'hour')?.value || 0) }
}
function isClinicHours(d: Date) {
  const { weekday, hour } = localParts(d)
  if (weekday === 'Sun') return false
  if (weekday === 'Sat') return hour >= 9 && hour < 14
  return hour >= 8 && hour < 18
}

async function snapshot(start: Date, end: Date) {
  const range = { gte: start, lt: end }
  const [appointmentBreakdown, patientActivity, appointments, leads, conversations, messages, plans, payments, invoices, automationEvents, touches, activeEnrollments, waitlistActive, waitlistAdded, waitlistFulfilled, feedback, reviewRequests, referrals] = await Promise.all([
    getAppointmentStatusBreakdown({ start, end }),
    getPatientActivitySummary({ start, end }),
    prisma.appointment.findMany({ where: { startAt: range }, select: { patientId: true, arrivedAt: true, withProviderAt: true, departedAt: true } }),
    prisma.lead.findMany({ where: { createdAt: range }, select: { source: true, firstHumanReplyAt: true, createdAt: true } }),
    prisma.aiConversation.findMany({ where: { createdAt: range }, select: { id: true, channel: true, agentEnabled: true } }),
    prisma.aiMessage.findMany({ where: { createdAt: range }, select: { role: true, status: true, createdAt: true, conversation: { select: { channel: true } } } }),
    prisma.treatmentPlan.findMany({ where: { createdAt: range }, select: { status: true, costPerUnit: true, quantity: true, discount: true, followUpAt: true, appointments: { select: { status: true, createdAt: true } } } }),
    prisma.payment.findMany({ where: { paidAt: range }, select: { amountUGX: true, patientId: true } }),
    prisma.invoice.findMany({ where: { createdAt: range, status: { not: 'CANCELLED' } }, select: { totalUGX: true, paidUGX: true, status: true } }),
    prisma.automationEvent.findMany({ where: { createdAt: range }, select: { processedAt: true } }),
    prisma.scheduledTouch.findMany({ where: { createdAt: range }, select: { status: true, dryRun: true, sentAt: true } }),
    prisma.sequenceEnrollment.count({ where: { status: 'ACTIVE' } }),
    prisma.waitlistEntry.count({ where: { isActive: true } }),
    prisma.waitlistEntry.count({ where: { requestedAt: range } }),
    prisma.waitlistEntry.count({ where: { fulfilledAt: range } }),
    prisma.patientFeedback.findMany({ where: { submittedAt: range }, select: { rating: true } }),
    prisma.reviewRequestLog.findMany({ where: { createdAt: range }, select: { status: true } }),
    prisma.patient.findMany({ where: { crmReferralSource: 'PATIENT_REFERRAL', tagsUpdatedAt: range }, select: { treatmentPlanStatus: true } }),
  ])

  const waits = appointments.filter(a => a.arrivedAt && a.withProviderAt).map(a => (a.withProviderAt!.getTime() - a.arrivedAt!.getTime()) / 60000).filter(n => n >= 0)
  const visits = appointments.filter(a => a.arrivedAt && a.departedAt).map(a => (a.departedAt!.getTime() - a.arrivedAt!.getTime()) / 60000).filter(n => n >= 0)
  const providerTimes = appointments.filter(a => a.withProviderAt && a.departedAt).map(a => (a.departedAt!.getTime() - a.withProviderAt!.getTime()) / 60000).filter(n => n >= 0)

  const bySource: Record<string, number> = {}
  for (const l of leads) bySource[l.source] = (bySource[l.source] || 0) + 1
  const reply = leads.filter(l => l.firstHumanReplyAt).map(l => (l.firstHumanReplyAt!.getTime() - l.createdAt.getTime()) / 60000).filter(n => n >= 0)

  const byChannel: Record<string, { conversations: number; inbound: number }> = {}
  for (const c of conversations) byChannel[c.channel] = { conversations: (byChannel[c.channel]?.conversations || 0) + 1, inbound: byChannel[c.channel]?.inbound || 0 }
  const inbound = messages.filter(m => m.role === 'USER')
  for (const m of inbound) {
    const channel = m.conversation.channel
    byChannel[channel] = { conversations: byChannel[channel]?.conversations || 0, inbound: (byChannel[channel]?.inbound || 0) + 1 }
  }
  const afterHoursInbound = inbound.filter(m => !isClinicHours(m.createdAt)).length
  const hourCounts = new Map<number, number>()
  for (const m of inbound) {
    const h = localParts(m.createdAt).hour
    hourCounts.set(h, (hourCounts.get(h) || 0) + 1)
  }
  const busiest = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0]

  const acceptedPlans = plans.filter(p => isAccepted(p))
  const declinedPlans = plans.filter(p => isDeclined(p))
  const statusCount = (s: string) => plans.filter(p => p.status === s).length
  const statusValue = (s: string) => plans.filter(p => p.status === s).reduce((sum, p) => sum + planValue(p), 0)
  const presentedValue = plans.reduce((sum, p) => sum + planValue(p), 0)
  const acceptedValue = acceptedPlans.reduce((sum, p) => sum + planValue(p), 0)

  const feedbackAverage = feedback.length ? Math.round((feedback.reduce((s, f) => s + f.rating, 0) / feedback.length) * 10) / 10 : null
  const reviewByStatus: Record<string, number> = {}
  for (const r of reviewRequests) reviewByStatus[r.status] = (reviewByStatus[r.status] || 0) + 1
  const touchByStatus: Record<string, number> = {}
  for (const t of touches) touchByStatus[t.status] = (touchByStatus[t.status] || 0) + 1

  const acquisition = await buildAcquisitionRevenueReport({ dateFrom: start, dateTo: new Date(end.getTime() - 1) })
  const sourceAttribution = await Promise.all(Object.keys(bySource).map(async source => {
    const [r, outcomes] = await Promise.all([
      buildAcquisitionRevenueReport({ source, dateFrom: start, dateTo: new Date(end.getTime() - 1) }),
      buildSourceOutcomeEvidence(source, start, end),
    ])
    return {
      source,
      ...r.funnel,
      ...r.revenue,
      // Operational Booked/Attended must be period-scoped and may recover
      // historical WhatsApp outcomes through exact unique phone evidence.
      // Revenue remains on the stricter explicit Lead -> Patient rule.
      bookedCount: outcomes.bookedCount,
      attendedCount: outcomes.attendedCount,
      directLinkedPatientCount: outcomes.directLinkedPatientCount,
      evidenceMatchedPatientCount: outcomes.evidenceMatchedPatientCount,
      ambiguousIdentityCount: outcomes.ambiguousIdentityCount,
      outcomeAttributionNote: outcomes.note,
    }
  }))

  return {
    appointments: {
      scheduled: appointmentBreakdown.scheduledTotal,
      patientsSeen: patientActivity.patientsSeen,
      attended: appointmentBreakdown.buckets.seen,
      confirmed: appointmentBreakdown.buckets.confirmed,
      pending: appointmentBreakdown.buckets.pending,
      cancelled: appointmentBreakdown.buckets.cancelled,
      noShows: appointmentBreakdown.buckets.noShow,
      rescheduled: appointmentBreakdown.buckets.rescheduled,
      showRate: appointmentBreakdown.scheduledTotal ? Math.round((appointmentBreakdown.buckets.seen / appointmentBreakdown.scheduledTotal) * 1000) / 10 : 0,
    },
    liveFlow: {
      // Live Flow is intentionally separate from appointment scheduling.
      // Durations come only from persisted clinical timestamps; missing
      // timestamps stay unmeasured rather than being inferred from status.
      visitsWithArrival: appointments.filter(a => !!a.arrivedAt).length,
      visitsWithProviderStart: appointments.filter(a => !!a.withProviderAt).length,
      completedJourneys: appointments.filter(a => !!a.arrivedAt && !!a.departedAt).length,
      waitSamples: waits.length,
      providerSamples: providerTimes.length,
      visitSamples: visits.length,
      avgArrivalToProviderMinutes: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
      avgProviderToDepartureMinutes: providerTimes.length ? Math.round(providerTimes.reduce((a, b) => a + b, 0) / providerTimes.length) : null,
      avgTotalVisitMinutes: visits.length ? Math.round(visits.reduce((a, b) => a + b, 0) / visits.length) : null,
    },
    patients: patientActivity,
    crm: {
      newLeads: leads.length,
      avgFirstHumanReplyMinutes: reply.length ? Math.round(reply.reduce((a, b) => a + b, 0) / reply.length) : null,
      bySource,
      funnel: acquisition.funnel,
      attributedRevenue: acquisition.revenue,
      ambiguousPatientCount: acquisition.ambiguousPatientCount,
      sourceAttribution: sourceAttribution.sort((a, b) => b.collectedUGX - a.collectedUGX),
    },
    communications: {
      conversations: conversations.length,
      inboundMessages: inbound.length,
      agentMessages: messages.filter(m => m.role === 'AGENT').length,
      humanTakeovers: conversations.filter(c => !c.agentEnabled).length,
      failedAgentMessages: messages.filter(m => m.role === 'AGENT' && m.status === 'failed').length,
      afterHoursInbound,
      afterHoursShare: inbound.length ? Math.round((afterHoursInbound / inbound.length) * 1000) / 10 : 0,
      busiestHour: busiest ? `${String(busiest[0]).padStart(2, '0')}:00–${String((busiest[0] + 1) % 24).padStart(2, '0')}:00` : null,
      busiestHourMessages: busiest?.[1] || 0,
      byChannel,
    },
    treatment: {
      plansPresented: plans.length,
      presentedValueUGX: presentedValue,
      accepted: acceptedPlans.length,
      acceptedValueUGX: acceptedValue,
      planned: statusCount('Planned'),
      inProgress: statusCount('In Progress'),
      completed: statusCount('Completed'),
      onHold: statusCount('On Hold'),
      followUpRequested: plans.filter(p => !!p.followUpAt).length,
      declined: declinedPlans.length,
      acceptanceRate: plans.length ? Math.round((acceptedPlans.length / plans.length) * 1000) / 10 : 0,
      moneyAtRiskUGX: computeMoneyAtRisk(plans.map(p => ({ status: p.status, appointments: p.appointments, value: planValue(p) }))),
      valuesByStage: { planned: statusValue('Planned'), inProgress: statusValue('In Progress'), completed: statusValue('Completed'), onHold: statusValue('On Hold') },
    },
    finance: {
      collectedUGX: payments.reduce((s, p) => s + p.amountUGX, 0),
      payingPatients: new Set(payments.filter(p => p.amountUGX > 0).map(p => p.patientId)).size,
      invoicedUGX: invoices.reduce((s, i) => s + i.totalUGX, 0),
      outstandingUGX: invoices.filter(i => ['UNPAID', 'SENT', 'PARTIAL', 'OVERDUE'].includes(i.status)).reduce((s, i) => s + Math.max(0, i.totalUGX - i.paidUGX), 0),
    },
    crmOperations: {
      referralsAdded: referrals.length,
      referralsAcceptedTreatment: referrals.filter(r => r.treatmentPlanStatus === 'ACCEPTED').length,
      waitlistActive,
      waitlistAdded,
      waitlistFulfilled,
      feedbackReceived: feedback.length,
      averageRating: feedbackAverage,
      reviewRequests: reviewRequests.length,
      reviewRequestByStatus: reviewByStatus,
    },
    automation: {
      eventsCreated: automationEvents.length,
      eventsProcessed: automationEvents.filter(e => !!e.processedAt).length,
      activeEnrollments,
      touchesCreated: touches.length,
      touchesSent: touches.filter(t => t.status === 'SENT' && !t.dryRun).length,
      touchesDryRun: touches.filter(t => t.dryRun || t.status === 'DRY_RUN').length,
      touchesFailed: touchByStatus.FAILED || 0,
      touchesPending: touchByStatus.PENDING || 0,
    },
  }
}

export async function buildExecutiveReport(kind: ExecutivePeriod) {
  const start = startOfPeriod(kind), end = nextPeriod(kind, start), prevStart = previousPeriod(kind, start)
  const [current, previous] = await Promise.all([snapshot(start, end), snapshot(prevStart, start)])
  const attention: string[] = []
  const wins: string[] = []
  const opportunities: string[] = []

  if (current.appointments.patientsSeen) wins.push(`${current.appointments.patientsSeen} distinct patient(s) were seen during the period, with a ${current.appointments.showRate}% appointment show-up rate.`)
  if (current.crm.funnel.payingClientCount) wins.push(`${current.crm.funnel.payingClientCount} paying client(s) are cleanly attributable to leads acquired in this period.`)
  if (current.crm.attributedRevenue.collectedUGX) wins.push(`UGX ${current.crm.attributedRevenue.collectedUGX.toLocaleString('en-US')} collected is cleanly attributable to this period's acquired-lead cohort.`)
  if (current.communications.afterHoursInbound) wins.push(`${current.communications.afterHoursInbound} inbound message(s) were engaged outside clinic opening hours.`)
  if (current.automation.touchesSent) wins.push(`${current.automation.touchesSent} live automated follow-up/reminder touch(es) were sent.`)
  if (current.treatment.acceptedValueUGX) wins.push(`UGX ${current.treatment.acceptedValueUGX.toLocaleString('en-US')} of treatment presented in this period is classified as accepted.`)

  if (current.treatment.moneyAtRiskUGX) opportunities.push(`UGX ${current.treatment.moneyAtRiskUGX.toLocaleString('en-US')} is treatment opportunity currently classified as money at risk for plans created in this period.`)
  if (current.finance.outstandingUGX) opportunities.push(`UGX ${current.finance.outstandingUGX.toLocaleString('en-US')} remains outstanding on invoices created in this period.`)
  if (current.crmOperations.waitlistActive) opportunities.push(`${current.crmOperations.waitlistActive} patient(s) are currently on the active waitlist.`)

  if (current.crm.newLeads > current.crm.funnel.bookedCount) opportunities.push(`${current.crm.newLeads - current.crm.funnel.bookedCount} period lead(s) are not evidenced as booked in the strict acquisition funnel and remain a follow-up opportunity.`)

  if (current.appointments.noShows) attention.push(`${current.appointments.noShows} no-show appointment(s) recorded in this period.`)
  if (current.appointments.pending) attention.push(`${current.appointments.pending} appointment(s) remain pending.`)
  if (current.communications.failedAgentMessages) attention.push(`${current.communications.failedAgentMessages} agent message(s) recorded as failed delivery.`)
  if (current.automation.touchesFailed) attention.push(`${current.automation.touchesFailed} automation touch(es) failed in this period.`)

  return {
    period: { kind, start: start.toISOString(), end: end.toISOString(), label: label(kind, start, end), previousLabel: label(kind, prevStart, start) },
    generatedAt: new Date().toISOString(),
    current, previous,
    comparisons: {
      scheduledAppointmentsPct: pct(current.appointments.scheduled, previous.appointments.scheduled),
      patientsSeenPct: pct(current.appointments.patientsSeen, previous.appointments.patientsSeen),
      leadsPct: pct(current.crm.newLeads, previous.crm.newLeads),
      payingClientsPct: pct(current.crm.funnel.payingClientCount, previous.crm.funnel.payingClientCount),
      conversationsPct: pct(current.communications.conversations, previous.communications.conversations),
      collectedRevenuePct: pct(current.finance.collectedUGX, previous.finance.collectedUGX),
      attributedRevenuePct: pct(current.crm.attributedRevenue.collectedUGX, previous.crm.attributedRevenue.collectedUGX),
    },
    wins, opportunities, attention,
    notes: [
      'Collected this period is based only on Code Clinic Payment records with paidAt inside the selected period; demo financial dashboard values are never used.',
      'Business Source Booked/Attended outcomes are period-scoped. WhatsApp can recover historical outcomes only from exact unique normalized phone matches; ambiguous identities, social IDs and website session IDs are excluded.',
      'Attributed revenue remains stricter: downstream lifetime revenue only for patients explicitly and cleanly linked to exactly one lead acquired in the selected period. Evidence-only phone matches never create revenue attribution.',
      'Treatment opportunity/value is not revenue. Paying client requires a positive Payment record.',
      'Appointment attendance and patient growth use the shared canonical patient-analytics definitions.',
      'Automation impact reports recorded events/touches only; no speculative staff-hours-saved estimate is made.',
    ],
  }
}
