// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — missed-call text-back (Part F).
//
// PROVIDER GAP (see final report): this codebase has no PSTN/carrier
// telephony integration. The only voice pipeline is a self-hosted AI agent
// on a drachtio SIP trunk (ai-suite/voice/sip.service.ts) — it logs calls
// the AI itself answered, not "an inbound call to a normal business line
// went unanswered". "SMS" in this codebase (ai-suite/sms/sms.service.ts)
// is also, today, a WhatsApp passthrough, not a real SMS provider, despite
// `africastalking` being a dependency.
//
// What's built here is the provider-agnostic event/action architecture the
// spec asks for in that situation: recordMissedCall() is a generic intake
// point any provider's webhook could call (Twilio, Africa's Talking Voice,
// or the existing drachtio trunk once it's extended to report true PSTN
// misses); processTextBackQueue() is the dispatcher. Both run against a
// MOCK provider in tests/dry-run and clearly record textBackStatus =
// 'SKIPPED_NO_PROVIDER' for the parts that need a real integration.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import { sendOrSimulate, isCrmAutomationLive } from './dry-run'
import { sendSMS } from '../ai-suite/sms/sms.service'
import { getChannelConsentStatus } from './consent-log.service'
import { phoneVariants } from '../utils/phone'

export interface RecordMissedCallParams {
  provider: string // 'MOCK' until a real provider is connected
  externalCallId?: string
  fromNumber: string
  toNumber: string
}

export async function recordMissedCall(params: RecordMissedCallParams) {
  const patient = await prisma.patient.findFirst({
    where: { phone: { in: phoneVariants(params.fromNumber) } },
  })

  const call = await prisma.callEvent.create({
    data: {
      provider:       params.provider,
      externalCallId: params.externalCallId ?? null,
      fromNumber:     params.fromNumber,
      toNumber:       params.toNumber,
      status:         'MISSED',
      patientId:      patient?.id ?? null,
      textBackStatus: 'PENDING',
    },
  })

  await processTextBack(call.id)
  return call
}

async function processTextBack(callEventId: string): Promise<void> {
  const call = await prisma.callEvent.findUniqueOrThrow({ where: { id: callEventId } })
  if (call.textBackStatus !== 'PENDING') return

  // No real SMS provider is wired in this codebase today (see file header)
  // — sendSMS() is currently a WhatsApp passthrough. Route the text-back
  // through WhatsApp (the only channel that is actually real here) rather
  // than silently pretend a carrier SMS was sent.
  const REAL_SMS_PROVIDER_CONNECTED = false

  if (call.patientId) {
    const consented = await getChannelConsentStatus(call.patientId, 'SMS')
    if (!consented) {
      await prisma.callEvent.update({ where: { id: call.id }, data: { textBackStatus: 'SKIPPED_CONSENT' } })
      return
    }
  }

  const body = `Sorry we missed your call! This is Code Clinic — reply here or call us back and we'll get you sorted.`

  if (!REAL_SMS_PROVIDER_CONNECTED && isCrmAutomationLive()) {
    // Live mode requested but there's genuinely no SMS provider to call —
    // report the gap rather than silently substituting another channel.
    await prisma.callEvent.update({
      where: { id: call.id },
      data:  { textBackStatus: 'SKIPPED_NO_PROVIDER' },
    })
    return
  }

  const result = await sendOrSimulate('SMS', call.fromNumber, body, () => sendSMS(call.fromNumber, body))

  await prisma.callEvent.update({
    where: { id: call.id },
    data: {
      textBackStatus: result.dryRun ? 'DRY_RUN_SENT' : 'SENT',
      textBackSentAt: new Date(),
    },
  })
}