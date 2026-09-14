// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — missed-call text-back (Part F).
//
// The voice pipeline is a self-hosted AI agent on a drachtio SIP trunk
// (ai-suite/voice/sip.service.ts) that auto-answers every inbound call —
// there is no ring/no-answer window. A genuine "missed call" only happens
// when (a) staff toggle the AI receptionist off (calling_agents_enabled
// setting false — the trunk declines with SIP 486) or (b) call setup
// itself throws. Both paths call recordMissedCall() directly from
// sip.service.ts's handleInboundCall.
//
// Real Africa's Talking carrier SMS is now wired (ai-suite/sms/sms.service.ts,
// isRealSmsProviderConfigured()) rather than the WhatsApp passthrough this
// used to fall back to unconditionally. Actual sending still requires the
// dedicated CRM_MISSED_CALL_TEXTBACK_LIVE flag (see dry-run.ts) — deploying
// this code does not by itself start sending real SMS.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import { sendOrSimulate, isCrmFeatureLive } from './dry-run'
import { sendSMS, isRealSmsProviderConfigured } from '../ai-suite/sms/sms.service'
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

  if (call.patientId) {
    const consented = await getChannelConsentStatus(call.patientId, 'SMS')
    if (!consented) {
      await prisma.callEvent.update({ where: { id: call.id }, data: { textBackStatus: 'SKIPPED_CONSENT' } })
      return
    }
  }

  const body = `Sorry we missed your call! This is Code Clinic — reply here or call us back and we'll get you sorted.`

  if (!isRealSmsProviderConfigured() && isCrmFeatureLive('MISSED_CALL_TEXTBACK')) {
    // Live mode requested but there's genuinely no SMS provider configured
    // (AT_API_KEY/AT_USERNAME absent) — report the gap rather than silently
    // substituting another channel.
    await prisma.callEvent.update({
      where: { id: call.id },
      data:  { textBackStatus: 'SKIPPED_NO_PROVIDER' },
    })
    return
  }

  const result = await sendOrSimulate('MISSED_CALL_TEXTBACK', 'SMS', call.fromNumber, body, () => sendSMS(call.fromNumber, body))

  await prisma.callEvent.update({
    where: { id: call.id },
    data: {
      textBackStatus: result.dryRun ? 'DRY_RUN_SENT' : 'SENT',
      textBackSentAt: new Date(),
    },
  })
}