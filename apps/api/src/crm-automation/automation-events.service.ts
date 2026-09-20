// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — event-driven trigger engine (Part B/D of the spec).
//
// emitAutomationEvent() is the ONLY way a sequence gets enrolled. It is
// called synchronously, inline, at the exact point a tag/value actually
// changes (an API write, or the daily derived-tag job diffing old vs new).
// Rule evaluation happens in the SAME call, right after the event row is
// inserted — nothing polls this table to decide who to enroll. A low-
// frequency recovery sweep (see sequence-dispatcher.ts) only re-processes
// rows whose processedAt stayed null because evaluation threw, mirroring the
// retry idiom this codebase already uses for OutboundQueue/AiScheduledMessage.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import { isCrmFeatureLive } from './dry-run'
import type { AutomationEvent, SequenceDefinition } from '@prisma/client'

export type EntityType = 'PATIENT' | 'LEAD'

export interface EmitEventParams {
  entityType: EntityType
  entityId: string
  eventType: string
  fromValue?: string | null
  toValue?: string | null
  metadata?: Record<string, unknown>
}

// ── Minimal rule matcher for audienceRule / exclusionRule JSON ──────────────
// Supports plain equality, {"in":[...]} membership (works against array
// columns like treatmentTypes/riskFlags too), and {"not": value} negation.
// Intentionally simple — this is a rules engine for a handful of well-known
// CRM tag fields, not a general query language.
type FieldMatcher = string | number | boolean | null | { in?: unknown[]; not?: unknown }

function fieldMatches(actual: unknown, matcher: FieldMatcher): boolean {
  if (matcher !== null && typeof matcher === 'object' && !Array.isArray(matcher)) {
    if ('in' in matcher && Array.isArray(matcher.in)) {
      if (Array.isArray(actual)) return matcher.in.some(v => actual.includes(v))
      return matcher.in.includes(actual)
    }
    if ('not' in matcher) return actual !== matcher.not
    return false
  }
  if (Array.isArray(actual)) return actual.includes(matcher)
  return actual === matcher
}

export function ruleMatchesEntity(rule: Record<string, FieldMatcher> | null, entity: Record<string, unknown>): boolean {
  if (!rule) return false
  return Object.entries(rule).every(([field, matcher]) => fieldMatches(entity[field], matcher))
}

function safeParse<T = any>(json: string | null): T | null {
  if (!json) return null
  try { return JSON.parse(json) as T } catch { return null }
}

async function fetchEntity(entityType: EntityType, entityId: string): Promise<Record<string, unknown> | null> {
  if (entityType === 'PATIENT') return prisma.patient.findUnique({ where: { id: entityId } })
  return prisma.lead.findUnique({ where: { id: entityId } })
}

export interface EnrollResult {
  enrolled: boolean
  reason?: 'entity_not_found' | 'excluded' | 'audience_mismatch' | 'duplicate' | 'conflict_group' | 'no_touches_defined'
  enrollmentId?: string
}

// Duplicate + conflicting-sequence protection lives here (Part D): a patient/
// lead can never hold two ACTIVE enrollments in the same sequence, nor two
// ACTIVE enrollments across sequences sharing a conflictGroup.
export async function enrollEntityInSequence(
  sequence: SequenceDefinition,
  entityType: EntityType,
  entityId: string
): Promise<EnrollResult> {
  const entity = await fetchEntity(entityType, entityId)
  if (!entity) return { enrolled: false, reason: 'entity_not_found' }

  const exclusionRule = safeParse<Record<string, FieldMatcher>>(sequence.exclusionRule)
  if (exclusionRule && ruleMatchesEntity(exclusionRule, entity)) {
    return { enrolled: false, reason: 'excluded' }
  }

  const audienceRule = safeParse<Record<string, FieldMatcher>>(sequence.audienceRule)
  if (audienceRule && !ruleMatchesEntity(audienceRule, entity)) {
    return { enrolled: false, reason: 'audience_mismatch' }
  }

  const entityFilter = entityType === 'PATIENT' ? { patientId: entityId } : { leadId: entityId }

  const existingSame = await prisma.sequenceEnrollment.findFirst({
    where: { sequenceId: sequence.id, status: 'ACTIVE', ...entityFilter },
  })
  if (existingSame) return { enrolled: false, reason: 'duplicate' }

  if (sequence.conflictGroup) {
    const conflicting = await prisma.sequenceEnrollment.findFirst({
      where: { status: 'ACTIVE', ...entityFilter, sequence: { conflictGroup: sequence.conflictGroup } },
    })
    if (conflicting) return { enrolled: false, reason: 'conflict_group' }
  }

  const touches = await prisma.sequenceTouchTemplate.findMany({
    where: { sequenceId: sequence.id },
    orderBy: { order: 'asc' },
  })
  if (touches.length === 0) return { enrolled: false, reason: 'no_touches_defined' }

  const enrollment = await prisma.sequenceEnrollment.create({
    data: { sequenceId: sequence.id, entityType, ...entityFilter },
  })

  const now = new Date()
  // Informational marker only — the real send decision happens at dispatch
  // time in sequence-dispatcher.ts, which re-checks the feature gate fresh.
  const dryRun = !isCrmFeatureLive(sequence.isMarketing ? 'MARKETING' : 'OPERATIONAL')
  await prisma.scheduledTouch.createMany({
    data: touches.map(t => ({
      enrollmentId: enrollment.id,
      touchTemplateId: t.id,
      patientId: entityType === 'PATIENT' ? entityId : null,
      scheduledFor: new Date(now.getTime() + t.delayDays * 86_400_000),
      dryRun,
    })),
  })

  return { enrolled: true, enrollmentId: enrollment.id }
}

async function evaluateRulesForEvent(event: AutomationEvent): Promise<void> {
  const sequences = await prisma.sequenceDefinition.findMany({
    where: { status: 'ACTIVE', entityType: event.entityType, triggerEventType: event.eventType },
  })

  for (const seq of sequences) {
    const condition = safeParse<{ toValue?: string | null; fromValue?: string | null }>(seq.triggerCondition)
    if (condition) {
      if (condition.toValue !== undefined && condition.toValue !== event.toValue) continue
      if (condition.fromValue !== undefined && condition.fromValue !== event.fromValue) continue
    }
    await enrollEntityInSequence(seq, event.entityType as EntityType, event.entityId)
  }
}

export async function emitAutomationEvent(params: EmitEventParams): Promise<AutomationEvent> {
  const event = await prisma.automationEvent.create({
    data: {
      entityType: params.entityType,
      entityId:   params.entityId,
      eventType:  params.eventType,
      fromValue:  params.fromValue ?? null,
      toValue:    params.toValue ?? null,
      metadata:   params.metadata ? JSON.stringify(params.metadata) : null,
    },
  })

  try {
    await evaluateRulesForEvent(event)
    await prisma.automationEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } })
  } catch (err) {
    // Left with processedAt = null on purpose — the crash-recovery sweep in
    // sequence-dispatcher.ts retries unprocessed events. The event itself is
    // never lost even if a rule evaluation throws.
    console.error('[CrmAutomation] Rule evaluation failed for event', event.id, err)
  }

  return event
}

// Crash-recovery safety net only — NOT the primary trigger path. Processes
// any event whose inline evaluation above never completed.
export async function reprocessUnprocessedEvents(limit = 100): Promise<number> {
  const pending = await prisma.automationEvent.findMany({
    where: { processedAt: null },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
  for (const event of pending) {
    try {
      await evaluateRulesForEvent(event)
      await prisma.automationEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } })
    } catch (err) {
      console.error('[CrmAutomation] Recovery sweep failed for event', event.id, err)
    }
  }
  return pending.length
}

// ── Exit / stop conditions (Part D) ─────────────────────────────────────────
// Any of: inbound reply, booking, tracked click, an excluding tag change, or
// a manual stop should end active enrollments. Cancels not-yet-sent touches
// so a patient/lead never gets a message after the exit condition fires.
export type ExitStatus = 'EXITED_REPLY' | 'EXITED_BOOKED' | 'EXITED_TAG_CHANGE' | 'STOPPED'

// Optional narrowing so an exit condition can stop only the sequence(s) it
// actually applies to (see sequence-groups.ts) instead of every active
// enrollment the entity happens to hold. Omitted entirely by every existing
// LEAD call site, which keeps their original "exit everything" behavior.
export interface ExitScope {
  conflictGroup?: string
  channel?: string // e.g. exit only sequences that actually send on the channel a patient just opted out of
}

export async function exitActiveEnrollments(
  entityType: EntityType,
  entityId: string,
  status: ExitStatus,
  detail?: string,
  scope?: ExitScope
): Promise<number> {
  const entityFilter = entityType === 'PATIENT' ? { patientId: entityId } : { leadId: entityId }
  const active = await prisma.sequenceEnrollment.findMany({
    where: {
      ...entityFilter,
      status: 'ACTIVE',
      ...(scope?.conflictGroup || scope?.channel
        ? { sequence: { ...(scope.conflictGroup ? { conflictGroup: scope.conflictGroup } : {}), ...(scope.channel ? { channel: scope.channel } : {}) } }
        : {}),
    },
  })

  for (const enr of active) {
    await prisma.sequenceEnrollment.update({
      where: { id: enr.id },
      data:  { status, exitReason: detail ?? status, exitedAt: new Date() },
    })
    await prisma.scheduledTouch.updateMany({
      where: { enrollmentId: enr.id, status: 'PENDING' },
      data:  { status: 'CANCELLED' },
    })
  }

  return active.length
}