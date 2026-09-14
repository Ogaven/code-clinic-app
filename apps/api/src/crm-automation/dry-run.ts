// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — global live/dry-run gate.
//
// Per the build spec (Part W): no automation built in this workstream may
// send a real WhatsApp/SMS/email/push/social message, missed-call text-back,
// review request, or re-engagement campaign until explicitly turned on.
//
// isCrmAutomationLive() is the single choke point every send-capable path in
// crm-automation/* must call before touching a real provider. It defaults to
// OFF (dry-run) unless CRM_AUTOMATION_LIVE=true is explicitly set, and it is
// ALWAYS forced OFF under NODE_ENV=test regardless of that env var, so tests
// can never fire a real send no matter how the environment is configured.
// ─────────────────────────────────────────────────────────────────────────

export function isCrmAutomationLive(): boolean {
  if (process.env.NODE_ENV === 'test') return false
  return process.env.CRM_AUTOMATION_LIVE === 'true'
}

export interface DryRunSendResult {
  dryRun: boolean
  wouldSend: {
    channel: string
    to: string
    body: string
  }
}

// Every "send a message" call site in crm-automation/* routes through this
// so dry-run mode is enforced in exactly one place instead of scattered
// `if (isLive)` checks that could be forgotten at a new call site.
export async function sendOrSimulate(
  channel: 'SMS' | 'WHATSAPP' | 'EMAIL',
  to: string,
  body: string,
  realSend: () => Promise<unknown>
): Promise<DryRunSendResult> {
  if (!isCrmAutomationLive()) {
    return { dryRun: true, wouldSend: { channel, to, body } }
  }
  await realSend()
  return { dryRun: false, wouldSend: { channel, to, body } }
}