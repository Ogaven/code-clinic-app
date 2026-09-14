// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — consent / opt-in log (Part I).
//
// Deliberately a NEW, separate, append-only model (ConsentLog) rather than a
// rework of the existing PatientConsent table. PatientConsent stores current
// state per consentType (TERMS_OF_SERVICE/MARKETING/DATA_PROCESSING/
// BOT_COMMUNICATION) and is mutated in place via revokedAt — reusing it for a
// full per-channel audit trail would mean overwriting history, which the
// spec explicitly forbids. ConsentLog instead gets one INSERT per consent
// event, split by channel (SMS/WhatsApp/Email), and is never updated or
// deleted.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import type { CommsChannel } from '@prisma/client'
import { hasOutboundConsent } from '../ai-suite/scheduler/guardian-routing.service'

export type ConsentStatus = 'OPT_IN' | 'OPT_OUT'
export type ConsentSource = 'PATIENT_REQUEST' | 'STAFF_ENTRY' | 'INBOUND_KEYWORD' | 'REGISTRATION_DEFAULT' | 'IMPORT'

export interface RecordConsentParams {
  patientId: string
  channel: CommsChannel
  status: ConsentStatus
  source: ConsentSource
  changedBy?: string | null
  metadata?: Record<string, unknown>
}

export async function recordConsent(params: RecordConsentParams) {
  return prisma.consentLog.create({
    data: {
      patientId: params.patientId,
      channel:   params.channel,
      status:    params.status,
      source:    params.source,
      changedBy: params.changedBy ?? null,
      metadata:  params.metadata ? JSON.stringify(params.metadata) : null,
    },
  })
}

// Latest logged event per channel wins. If no channel-specific event has
// ever been logged, falls back to the existing BOT_COMMUNICATION consent
// record (hasOutboundConsent) so behavior doesn't silently diverge from
// what the rest of the app already does for outbound sends.
export async function getChannelConsentStatus(patientId: string, channel: CommsChannel): Promise<boolean> {
  const latest = await prisma.consentLog.findFirst({
    where:   { patientId, channel },
    orderBy: { createdAt: 'desc' },
  })
  if (!latest) return hasOutboundConsent(patientId)
  return latest.status === 'OPT_IN'
}

export async function getConsentHistory(patientId: string, channel?: CommsChannel) {
  return prisma.consentLog.findMany({
    where:   { patientId, ...(channel ? { channel } : {}) },
    orderBy: { createdAt: 'desc' },
  })
}

// ── Compliance note (audited per the follow-up review) ──────────────────────
// getChannelConsentStatus() above intentionally preserves this codebase's
// EXISTING default-opt-in behavior (hasOutboundConsent's "no record ->
// opted-in", documented in guardian-routing.service.ts as a deliberate prior
// decision for OPERATIONAL healthcare comms — appointment reminders,
// follow-ups). This workstream does not change that existing behavior.
//
// However, this CRM automation engine also drives sequences that are more
// marketing-like than operational (backlog re-engagement, general
// re-activation sequences, review requests to a broad list) — applying the
// SAME lenient default there is a materially different, higher compliance
// risk (SMS marketing consent rules and GDPR-style opt-in requirements for
// promotional content are generally stricter than for transactional/
// operational messages). hasExplicitOptIn() below is the gate for anything
// SequenceDefinition.isMarketing=true (the default for new sequences —
// see schema.prisma): it requires a REAL logged OPT_IN, never falling back
// to the legacy default. This does not retroactively change any existing
// send path outside the new sequence engine.
//
// Leads (as opposed to Patients) have NO consent model at all in this
// schema — ConsentLog/PatientConsent are both patient-only. The SLA
// 30-minute warm message, lead acknowledgements, and the backlog
// re-engagement campaign therefore currently send to leads with NO consent
// gate whatsoever. This is a real, unresolved compliance gap — flagged
// explicitly in the final report rather than silently patched with a
// same-day schema addition of unclear legal shape.
export async function hasExplicitOptIn(patientId: string, channel: CommsChannel): Promise<boolean> {
  const latest = await prisma.consentLog.findFirst({
    where:   { patientId, channel },
    orderBy: { createdAt: 'desc' },
  })
  return latest?.status === 'OPT_IN'
}