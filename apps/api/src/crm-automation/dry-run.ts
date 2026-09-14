// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — per-feature live/dry-run gates.
//
// A single global CRM_AUTOMATION_LIVE flag used to be the ONLY gate for every
// send-capable path (acknowledgement, SLA warm messages, backlog campaigns,
// waitlist notifications, review requests, sequence touches, missed-call
// text-back). That meant flipping one switch armed everything at once,
// including features (backlog/marketing/waitlist broadcast) this business
// explicitly wants to stay off until separately, deliberately configured.
//
// isCrmFeatureLive(feature) is now the single choke point every send-capable
// path must call. Each feature has its own env var; CRM_AUTOMATION_LIVE is
// kept as a master kill switch (defense in depth, not a substitute for the
// per-feature gate):
//   MASTER OFF              -> every feature is dry-run, regardless of its
//                              own flag.
//   MASTER ON + feature OFF -> that feature is dry-run.
//   MASTER ON + feature ON  -> that feature may execute (still subject to
//                              consent/eligibility checks elsewhere).
// NODE_ENV=test forces every feature OFF regardless of any env var, so tests
// can never fire a real send no matter how the environment is configured.
// ─────────────────────────────────────────────────────────────────────────

export type CrmFeature = 'OPERATIONAL' | 'MARKETING' | 'BACKLOG' | 'WAITLIST' | 'REVIEW_REQUEST'

export const CRM_FEATURES: CrmFeature[] = ['OPERATIONAL', 'MARKETING', 'BACKLOG', 'WAITLIST', 'REVIEW_REQUEST']

const FEATURE_ENV_VAR: Record<CrmFeature, string> = {
  OPERATIONAL:    'CRM_OPERATIONAL_AUTOMATION_LIVE',
  MARKETING:      'CRM_MARKETING_AUTOMATION_LIVE',
  BACKLOG:        'CRM_BACKLOG_REENGAGEMENT_LIVE',
  WAITLIST:       'CRM_WAITLIST_AUTOMATION_LIVE',
  REVIEW_REQUEST: 'CRM_REVIEW_REQUEST_AUTOMATION_LIVE',
}

function isMasterLive(): boolean {
  if (process.env.NODE_ENV === 'test') return false
  return process.env.CRM_AUTOMATION_LIVE === 'true'
}

// Back-compat export — reports ONLY the master kill-switch state. Retained
// because a couple of call sites (reporting/status) legitimately want "is
// automation live at all"; no send path may use this alone to decide
// whether to fire — that's what isCrmFeatureLive() is for.
export function isCrmAutomationLive(): boolean {
  return isMasterLive()
}

export function isCrmFeatureLive(feature: CrmFeature): boolean {
  if (process.env.NODE_ENV === 'test') return false
  if (!isMasterLive()) return false
  return process.env[FEATURE_ENV_VAR[feature]] === 'true'
}

// Admin-visibility helper (Part 11) — current mode per feature, safe to
// return over an API response (no secrets, just booleans).
export function crmFeatureStatus(): Record<CrmFeature, boolean> {
  const status = {} as Record<CrmFeature, boolean>
  for (const feature of CRM_FEATURES) status[feature] = isCrmFeatureLive(feature)
  return status
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
// `if (isLive)` checks that could be forgotten at a new call site. `feature`
// is mandatory — there is no path where a caller can send without declaring
// which feature bucket it belongs to.
export async function sendOrSimulate(
  feature: CrmFeature,
  channel: 'SMS' | 'WHATSAPP' | 'EMAIL',
  to: string,
  body: string,
  realSend: () => Promise<unknown>
): Promise<DryRunSendResult> {
  if (!isCrmFeatureLive(feature)) {
    return { dryRun: true, wouldSend: { channel, to, body } }
  }
  await realSend()
  return { dryRun: false, wouldSend: { channel, to, body } }
}
