// ─────────────────────────────────────────────────────────────────────────
// CRM Automation routes (Part V — server-side RBAC on every route below;
// the existing per-user `permissions` JSON blob is client-side/advisory only
// in this codebase and is never treated as authorization here).
// Mounted at /crm-automation in main.ts.
// ─────────────────────────────────────────────────────────────────────────
import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { adminOnly, clinicalStaff, adminAndReceptionist, accountsOrAdmin } from '../middleware/rbac'
import { prisma } from '../lib/prisma'
import { applyPatientTagUpdate, runDailyPatientTagDerivation, type PatientTagUpdateInput } from '../crm-automation/patient-tags.service'
import { recordConsent, getConsentHistory, type ConsentSource, type ConsentStatus } from '../crm-automation/consent-log.service'
import { assignCollectionsOwner, listCollectionsCases } from '../crm-automation/collections.service'
import { enrollEntityInSequence } from '../crm-automation/automation-events.service'
import { processDueScheduledTouches } from '../crm-automation/sequence-dispatcher'
import { checkLeadSlas } from '../crm-automation/lead-sla.service'
import { logHumanReply, applyQualifyingIntent, markLeadLostManually, sweepStaleContactedLeads, convertLeadOnBooking } from '../crm-automation/lead-stage.service'
import { recordMissedCall } from '../crm-automation/missed-call.service'
import { notifyWaitlistForOpenSlot } from '../crm-automation/waitlist.service'
import { processDueReviewRequests } from '../crm-automation/review-request.service'
import { tagBacklogLeads, executeBacklogCampaign, sweepBacklogNoResponse, previewBacklogEligibility } from '../crm-automation/backlog-reengagement.service'
import { recordLeadConsent, getLeadConsentHistory, type LeadConsentPurpose, type LeadConsentSource, type LeadConsentStatus } from '../crm-automation/lead-consent.service'
import { createWaitlistEntry, listWaitlistEntries, pauseOrRemoveWaitlistEntry, markWaitlistEntryFulfilled, previewWaitlistMatchesForSlot } from '../crm-automation/waitlist.service'
import {
  responseTimeLeaderboard, stageConversionRates, staleLeadsByOwner, weeklyColdLeadsDigest,
  caseAcceptanceReport, sequencePerformanceReport, agingReceivablesReport, callPerformanceReport,
} from '../crm-automation/reporting.service'
import { isCrmAutomationLive, crmFeatureStatus } from '../crm-automation/dry-run'

const router = Router()

// Fields that carry financial information — Part V: "Do not expose all
// financial tags to every role." DOCTOR sees clinical/lifecycle/risk tags
// but never balance/payment/value-tier data.
const FINANCIAL_TAG_FIELDS = new Set(['paymentType', 'balanceStatus', 'balanceAgingBucket', 'valueTier', 'accountBalance'])

function stripFinancialFieldsForRole(patient: Record<string, any>, role: string): Record<string, any> {
  if (role === 'ADMIN' || role === 'ACCOUNTS') return patient
  const copy = { ...patient }
  for (const field of FINANCIAL_TAG_FIELDS) delete copy[field]
  return copy
}

// ── Patient CRM tags (Part A/U) ─────────────────────────────────────────────
router.get('/patients/:id/tags', requireAuth, clinicalStaff, async (req: Request, res: Response) => {
  const patient = await prisma.patient.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, treatmentTypes: true, treatmentPlanStatus: true, recallInterval: true, providerId: true,
      lifecycleStage: true, recallStatus: true, noShowCount: true, lateCancelCount: true,
      declineReason: true, declineReasonNote: true, paymentType: true, balanceStatus: true,
      balanceAgingBucket: true, valueTier: true, riskFlags: true, crmReferralSource: true,
      crmReferredByPatientId: true, commsChannelPref: true, languagePref: true, waitlistAvailable: true,
      negativeExperience: true, tagsUpdatedAt: true, tagsUpdatedBy: true, accountBalance: true,
    },
  })
  if (!patient) return res.status(404).json({ error: 'Patient not found' })
  res.json(stripFinancialFieldsForRole(patient, req.user!.role))
})

router.patch('/patients/:id/tags', requireAuth, clinicalStaff, async (req: Request, res: Response) => {
  try {
    const body = req.body as PatientTagUpdateInput
    if (req.user!.role === 'DOCTOR') {
      for (const field of Object.keys(body)) {
        if (FINANCIAL_TAG_FIELDS.has(field)) {
          return res.status(403).json({ error: `Role DOCTOR cannot set financial tag "${field}"` })
        }
      }
    }
    const updated = await applyPatientTagUpdate(req.params.id, body, req.user!.id)
    res.json(stripFinancialFieldsForRole(updated, req.user!.role))
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Failed to update patient tags' })
  }
})

router.post('/tags/derive-run', requireAuth, adminOnly, async (_req: Request, res: Response) => {
  const result = await runDailyPatientTagDerivation()
  res.json(result)
})

// ── Consent log (Part I) ─────────────────────────────────────────────────
router.get('/patients/:id/consent', requireAuth, clinicalStaff, async (req: Request, res: Response) => {
  const channel = req.query.channel as any
  res.json(await getConsentHistory(req.params.id, channel))
})

router.post('/patients/:id/consent', requireAuth, clinicalStaff, async (req: Request, res: Response) => {
  const { channel, status, source, metadata } = req.body as { channel: string; status: ConsentStatus; source: ConsentSource; metadata?: Record<string, unknown> }
  if (!channel || !status || !source) return res.status(400).json({ error: 'channel, status, and source are required' })
  const record = await recordConsent({ patientId: req.params.id, channel: channel as any, status, source, changedBy: req.user!.id, metadata })
  res.status(201).json(record)
})

// ── Collections / treatment-plan follow-up (Part E) ─────────────────────
router.get('/collections', requireAuth, accountsOrAdmin, async (req: Request, res: Response) => {
  res.json(await listCollectionsCases(req.query.ownerId as string | undefined))
})

router.post('/collections/:patientId/assign', requireAuth, accountsOrAdmin, async (req: Request, res: Response) => {
  try {
    await assignCollectionsOwner(req.params.patientId, req.body.ownerId ?? null)
    res.json({ success: true })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// ── Sequence definitions (Part C admin config) ───────────────────────────
router.get('/sequences', requireAuth, adminOnly, async (_req: Request, res: Response) => {
  res.json(await prisma.sequenceDefinition.findMany({ include: { touches: { orderBy: { order: 'asc' } } }, orderBy: { createdAt: 'desc' } }))
})

router.post('/sequences', requireAuth, adminOnly, async (req: Request, res: Response) => {
  const { key, name, description, entityType, triggerEventType, triggerCondition, audienceRule, exclusionRule, conflictGroup, channel, owner, isMarketing, touches } = req.body
  if (!key || !name || !entityType || !triggerEventType || !channel) {
    return res.status(400).json({ error: 'key, name, entityType, triggerEventType, and channel are required' })
  }
  try {
    const sequence = await prisma.sequenceDefinition.create({
      data: {
        key, name, description, entityType, triggerEventType,
        triggerCondition: triggerCondition ? JSON.stringify(triggerCondition) : null,
        audienceRule:     audienceRule ? JSON.stringify(audienceRule) : null,
        exclusionRule:    exclusionRule ? JSON.stringify(exclusionRule) : null,
        conflictGroup:    conflictGroup ?? null,
        // Defaults to true (marketing, requires explicit opt-in) when omitted
        // — matches the schema default and the safer-by-default consent posture.
        isMarketing:      typeof isMarketing === 'boolean' ? isMarketing : true,
        channel, owner: owner ?? null, status: 'DRAFT',
        touches: {
          create: (touches || []).map((t: any, i: number) => ({
            order: t.order ?? i, delayDays: t.delayDays, channel: t.channel ?? channel, messageTemplate: t.messageTemplate,
          })),
        },
      },
      include: { touches: true },
    })
    res.status(201).json(sequence)
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Failed to create sequence' })
  }
})

router.patch('/sequences/:id', requireAuth, adminOnly, async (req: Request, res: Response) => {
  const { status, name, description } = req.body
  try {
    const updated = await prisma.sequenceDefinition.update({
      where: { id: req.params.id },
      data:  { ...(status && { status }), ...(name && { name }), ...(description !== undefined && { description }), version: { increment: 1 } },
    })
    res.json(updated)
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Failed to update sequence' })
  }
})

// Replace the full touch list. Blocked while ACTIVE — an in-place edit to a
// touch an enrollment has already scheduled against (delayDays, template,
// channel) would corrupt already-scheduled ScheduledTouch rows silently.
// Pause the sequence first, edit touches, then reactivate; new enrollments
// pick up the new touches, and the (now-cancelled-on-pause) old scheduled
// touches for already-active enrollments are never mutated out from under them.
router.put('/sequences/:id/touches', requireAuth, adminOnly, async (req: Request, res: Response) => {
  const { touches } = req.body as { touches: Array<{ order?: number; delayDays: number; channel: string; messageTemplate: string }> }
  if (!Array.isArray(touches) || touches.length === 0) {
    return res.status(400).json({ error: 'touches must be a non-empty array' })
  }
  const sequence = await prisma.sequenceDefinition.findUnique({ where: { id: req.params.id } })
  if (!sequence) return res.status(404).json({ error: 'Sequence not found' })
  if (sequence.status === 'ACTIVE') {
    return res.status(409).json({ error: 'Pause this sequence before editing its touches — editing an active sequence could corrupt already-scheduled sends' })
  }
  try {
    await prisma.$transaction([
      prisma.sequenceTouchTemplate.deleteMany({ where: { sequenceId: req.params.id } }),
      prisma.sequenceTouchTemplate.createMany({
        data: touches.map((t, i) => ({ sequenceId: req.params.id, order: t.order ?? i, delayDays: t.delayDays, channel: t.channel, messageTemplate: t.messageTemplate })),
      }),
      prisma.sequenceDefinition.update({ where: { id: req.params.id }, data: { version: { increment: 1 } } }),
    ])
    const result = await prisma.sequenceDefinition.findUnique({ where: { id: req.params.id }, include: { touches: { orderBy: { order: 'asc' } } } })
    res.json(result)
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Failed to update touches' })
  }
})

// Manual/test-time enrollment — lets an admin verify a sequence against a
// specific patient/lead without waiting for a real trigger event.
router.post('/sequences/:id/enroll', requireAuth, adminOnly, async (req: Request, res: Response) => {
  const { entityType, entityId } = req.body as { entityType: 'PATIENT' | 'LEAD'; entityId: string }
  const sequence = await prisma.sequenceDefinition.findUnique({ where: { id: req.params.id } })
  if (!sequence) return res.status(404).json({ error: 'Sequence not found' })
  const result = await enrollEntityInSequence(sequence, entityType, entityId)
  res.json(result)
})

// ── Owner routing config (Part L) ────────────────────────────────────────

// Prevents saving a rule that would silently route nowhere: every user id
// named in sourceMap/eligibleUserIds must exist and be active.
async function validateRoutingTargets(mode: string, sourceMap?: Record<string, string>, eligibleUserIds?: string[]): Promise<string | null> {
  const ids = mode === 'SOURCE_BASED' ? Object.values(sourceMap ?? {}) : (eligibleUserIds ?? [])
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  if (uniqueIds.length === 0) return null
  const users = await prisma.user.findMany({ where: { id: { in: uniqueIds } }, select: { id: true, isActive: true } })
  const found = new Map(users.map(u => [u.id, u.isActive]))
  for (const id of uniqueIds) {
    if (!found.has(id)) return `Unknown staff id in routing config: ${id}`
    if (!found.get(id)) return `Staff member ${id} is inactive and cannot be a routing target`
  }
  return null
}

router.get('/routing-rules', requireAuth, adminOnly, async (_req: Request, res: Response) => {
  res.json(await prisma.routingRule.findMany({ orderBy: { updatedAt: 'desc' } }))
})

router.post('/routing-rules', requireAuth, adminOnly, async (req: Request, res: Response) => {
  const { name, mode, sourceMap, eligibleUserIds } = req.body
  if (!name || !mode) return res.status(400).json({ error: 'name and mode are required' })
  if (!['SOURCE_BASED', 'ROUND_ROBIN'].includes(mode)) return res.status(400).json({ error: 'mode must be SOURCE_BASED or ROUND_ROBIN' })
  const validationError = await validateRoutingTargets(mode, sourceMap, eligibleUserIds)
  if (validationError) return res.status(400).json({ error: validationError })
  const rule = await prisma.routingRule.create({
    data: {
      name, mode, entityType: 'LEAD',
      sourceMap: sourceMap ? JSON.stringify(sourceMap) : null,
      eligibleUserIds: eligibleUserIds ? JSON.stringify(eligibleUserIds) : null,
      createdBy: req.user!.id,
    },
  })
  res.status(201).json(rule)
})

router.patch('/routing-rules/:id', requireAuth, adminOnly, async (req: Request, res: Response) => {
  const { name, mode, sourceMap, eligibleUserIds, isActive } = req.body
  if (sourceMap !== undefined || eligibleUserIds !== undefined) {
    const existing = await prisma.routingRule.findUnique({ where: { id: req.params.id } })
    if (!existing) return res.status(404).json({ error: 'Routing rule not found' })
    const validationError = await validateRoutingTargets(mode ?? existing.mode, sourceMap, eligibleUserIds)
    if (validationError) return res.status(400).json({ error: validationError })
  }
  const updated = await prisma.routingRule.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(mode !== undefined && { mode }),
      ...(sourceMap !== undefined && { sourceMap: JSON.stringify(sourceMap) }),
      ...(eligibleUserIds !== undefined && { eligibleUserIds: JSON.stringify(eligibleUserIds) }),
      ...(isActive !== undefined && { isActive }),
    },
  })
  res.json(updated)
})

// Archive/delete safely: refuse while active (deactivate first), then remove
// its round-robin cursor row before the rule itself to satisfy the FK.
router.delete('/routing-rules/:id', requireAuth, adminOnly, async (req: Request, res: Response) => {
  const existing = await prisma.routingRule.findUnique({ where: { id: req.params.id } })
  if (!existing) return res.status(404).json({ error: 'Routing rule not found' })
  if (existing.isActive) return res.status(409).json({ error: 'Deactivate this rule before deleting it' })
  await prisma.routingState.deleteMany({ where: { routingRuleId: req.params.id } })
  await prisma.routingRule.delete({ where: { id: req.params.id } })
  res.json({ success: true })
})

// ── Lead automation actions (Parts J-P) ──────────────────────────────────
router.post('/leads/:id/log-human-reply', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  try {
    const lead = await logHumanReply(req.params.id, req.user!.id)
    res.json(lead)
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

router.post('/leads/:id/qualify', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  const { intent } = req.body as { intent: string }
  if (!intent) return res.status(400).json({ error: 'intent is required (e.g. "asked_pricing", "wants_appointment")' })
  try {
    const lead = await applyQualifyingIntent(req.params.id, req.user!.id, intent)
    res.json(lead)
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

router.post('/leads/:id/lost', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  const { reason } = req.body as { reason: string }
  if (!reason) return res.status(400).json({ error: 'A loss reason is required' })
  try {
    const lead = await markLeadLostManually(req.params.id, req.user!.id, reason)
    res.json(lead)
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// Manual/fallback trigger for QUALIFIED -> CONVERTED — the real automatic
// path is checkAndConvertLeadOnBooking/OnTreatmentStart (lead-patient-link.
// service.ts), wired into scheduling.ts, agent-tools.ts, assistant.ts, and
// pipeline.ts's single + bulk treatment-status endpoints. This stays for
// cases those matchers can't reach.
router.post('/leads/:id/converted', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  try {
    const lead = await convertLeadOnBooking(req.params.id)
    res.json(lead)
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

router.get('/leads/:id/stage-history', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  res.json(await prisma.leadStageHistory.findMany({ where: { leadId: req.params.id }, orderBy: { changedAt: 'asc' } }))
})

// ── Missed-call text-back (Part F) — MOCK provider only; see file header in
// missed-call.service.ts for the real-provider gap this reports honestly.
router.post('/missed-calls/simulate', requireAuth, adminOnly, async (req: Request, res: Response) => {
  const { fromNumber, toNumber } = req.body
  if (!fromNumber || !toNumber) return res.status(400).json({ error: 'fromNumber and toNumber are required' })
  const call = await recordMissedCall({ provider: 'MOCK', fromNumber, toNumber })
  res.status(201).json(call)
})

router.get('/missed-calls', requireAuth, adminAndReceptionist, async (_req: Request, res: Response) => {
  res.json(await prisma.callEvent.findMany({ orderBy: { occurredAt: 'desc' }, take: 100 }))
})

// ── Same-day waitlist (Part G) ────────────────────────────────────────────
router.post('/waitlist/notify', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  const { cancelledAppointmentId } = req.body
  if (!cancelledAppointmentId) return res.status(400).json({ error: 'cancelledAppointmentId is required' })
  res.json(await notifyWaitlistForOpenSlot(cancelledAppointmentId))
})

router.post('/waitlist/preview', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  const { cancelledAppointmentId } = req.body
  if (!cancelledAppointmentId) return res.status(400).json({ error: 'cancelledAppointmentId is required' })
  res.json(await previewWaitlistMatchesForSlot(cancelledAppointmentId))
})

// ── Post-visit review request config (Part H) ─────────────────────────────
router.get('/review-config', requireAuth, adminOnly, async (_req: Request, res: Response) => {
  res.json(await prisma.reviewRequestConfig.findFirst())
})

router.post('/review-config', requireAuth, adminOnly, async (req: Request, res: Response) => {
  const { delayHours, isActive, gbpPlaceId, reviewLinkOverride } = req.body
  if (delayHours !== undefined && (typeof delayHours !== 'number' || delayHours <= 0)) {
    return res.status(400).json({ error: 'delayHours must be a positive number' })
  }
  if (isActive && !gbpPlaceId && !reviewLinkOverride) {
    return res.status(400).json({ error: 'Set a Google place id or a manual review link before activating review requests' })
  }
  const existing = await prisma.reviewRequestConfig.findFirst()
  const data = { delayHours, isActive, gbpPlaceId, reviewLinkOverride, updatedBy: req.user!.id }
  const config = existing
    ? await prisma.reviewRequestConfig.update({ where: { id: existing.id }, data })
    : await prisma.reviewRequestConfig.create({ data })
  res.json(config)
})

// ── Backlog re-engagement (Part Q) — admin-only, three explicit steps ─────
router.post('/backlog/tag', requireAuth, adminOnly, async (_req: Request, res: Response) => {
  try {
    res.json(await tagBacklogLeads())
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// Dry-run count of how many tagged leads would ACTUALLY receive a message —
// call this before /execute so an admin never activates blind.
router.get('/backlog/:runId/preview', requireAuth, adminOnly, async (req: Request, res: Response) => {
  res.json(await previewBacklogEligibility(req.params.runId))
})

router.post('/backlog/:runId/execute', requireAuth, adminOnly, async (req: Request, res: Response) => {
  try {
    res.json(await executeBacklogCampaign(req.params.runId, req.user!.id))
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

router.post('/backlog/sweep-no-response', requireAuth, adminOnly, async (_req: Request, res: Response) => {
  res.json({ movedToLost: await sweepBacklogNoResponse() })
})

router.get('/backlog/runs', requireAuth, adminOnly, async (_req: Request, res: Response) => {
  res.json(await prisma.backlogCampaignRun.findMany({ orderBy: { createdAt: 'desc' } }))
})

// ── Reporting (Part R) ────────────────────────────────────────────────────
router.get('/reports/response-time-leaderboard', requireAuth, adminAndReceptionist, async (_req, res) => res.json(await responseTimeLeaderboard()))
router.get('/reports/stage-conversion-rates',     requireAuth, adminAndReceptionist, async (_req, res) => res.json(await stageConversionRates()))
router.get('/reports/stale-leads',                requireAuth, adminAndReceptionist, async (_req, res) => res.json(await staleLeadsByOwner()))
router.get('/reports/weekly-cold-leads',          requireAuth, adminAndReceptionist, async (_req, res) => res.json(await weeklyColdLeadsDigest()))
router.get('/reports/case-acceptance',            requireAuth, clinicalStaff,        async (_req, res) => res.json(await caseAcceptanceReport()))
router.get('/reports/sequence-performance',       requireAuth, adminAndReceptionist, async (_req, res) => res.json(await sequencePerformanceReport()))
router.get('/reports/aging-receivables',          requireAuth, accountsOrAdmin,      async (_req, res) => res.json(await agingReceivablesReport()))
router.get('/reports/call-performance',           requireAuth, adminAndReceptionist, async (_req, res) => res.json(await callPerformanceReport()))

// ── Manual dispatcher triggers (testing/admin only — the real triggers are
// the setInterval schedulers wired in main.ts) ────────────────────────────
router.post('/dispatch/run', requireAuth, adminOnly, async (_req: Request, res: Response) => {
  const touches = await processDueScheduledTouches()
  const sla = await checkLeadSlas()
  const staleContacted = await sweepStaleContactedLeads()
  const reviews = await processDueReviewRequests()
  res.json({ live: isCrmAutomationLive(), features: crmFeatureStatus(), touches, sla, staleContacted, reviews })
})

// ── Automation mode status (Part 11 — Admin visibility) ───────────────────
// Read-only booleans only, never raw env values/secrets. Backing the Admin
// CRM Automation Settings page's "current mode" panel.
router.get('/automation-status', requireAuth, adminAndReceptionist, async (_req: Request, res: Response) => {
  res.json({ masterLive: isCrmAutomationLive(), features: crmFeatureStatus() })
})

// ── Lead consent (release-blocker fix) ────────────────────────────────────
router.get('/leads/:id/consent', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  const channel = req.query.channel as any
  res.json(await getLeadConsentHistory(req.params.id, channel))
})

router.post('/leads/:id/consent', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  const { channel, status, purpose, source, metadata } = req.body as {
    channel: string; status: LeadConsentStatus; purpose: LeadConsentPurpose; source: LeadConsentSource; metadata?: Record<string, unknown>
  }
  if (!channel || !status || !purpose || !source) {
    return res.status(400).json({ error: 'channel, status, purpose, and source are required' })
  }
  const record = await recordLeadConsent({ leadId: req.params.id, channel: channel as any, status, purpose, source, recordedByUserId: req.user!.id, metadata })
  res.status(201).json(record)
})

// ── Waitlist entries (Part 7/8 — explicit per-patient requests) ──────────
router.get('/waitlist', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  const isActive = req.query.isActive === 'false' ? false : true
  res.json(await listWaitlistEntries({ isActive }))
})

router.post('/waitlist', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  const { patientId, serviceId, preferredDoctorId, preferredDateFrom, preferredDateTo, timePreference, priority, notes } = req.body
  if (!patientId || !serviceId) return res.status(400).json({ error: 'patientId and serviceId are required' })
  try {
    const entry = await createWaitlistEntry({
      patientId, serviceId,
      preferredDoctorId: preferredDoctorId || null,
      preferredDateFrom: preferredDateFrom ? new Date(preferredDateFrom) : null,
      preferredDateTo:   preferredDateTo ? new Date(preferredDateTo) : null,
      timePreference: timePreference || null,
      priority: typeof priority === 'number' ? priority : null,
      notes: notes || null,
      createdByUserId: req.user!.id,
    })
    res.status(201).json(entry)
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Failed to create waitlist entry' })
  }
})

router.post('/waitlist/:id/pause', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  await pauseOrRemoveWaitlistEntry(req.params.id, 'pause')
  res.json({ success: true })
})

router.post('/waitlist/:id/cancel', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  await pauseOrRemoveWaitlistEntry(req.params.id, 'cancel')
  res.json({ success: true })
})

router.post('/waitlist/:id/fulfilled', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  await markWaitlistEntryFulfilled(req.params.id)
  res.json({ success: true })
})

export default router