// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — lead source integration readiness (Product Experience
// Closure, Part 12).
//
// Reports honest connection status per source. The rule this file exists to
// enforce: a source is never reported CONNECTED just because an enum value,
// a webhook route, or ingestion code exists — only real configuration
// evidence (a secret/token is actually present) counts. Booleans and status
// strings only; no secret/token VALUE is ever read out of this module.
//
// This module does not make any live external call (no Graph API request,
// no ScoreApp ping) — per this milestone's explicit scope, Meta billing/
// webhook health is a separate workstream. Where local configuration exists
// but the external subscription/permission state can't be safely verified
// without an external call, the honest status is SETUP_REQUIRED with a
// clear explanation, never CONNECTED.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'

export type SourceStatus = 'CONNECTED' | 'SETUP_REQUIRED' | 'NOT_CONNECTED'

export interface SourceReadiness {
  key: string
  label: string
  status: SourceStatus
  detail: string
}

export async function sourceReadiness(): Promise<SourceReadiness[]> {
  const aiConfig = await prisma.aiAgentConfig.findFirst()
  const hasFacebookToken = !!(aiConfig?.facebookPageAccessToken || process.env.FACEBOOK_PAGE_ACCESS_TOKEN)
  const hasWhatsappToken = !!process.env.WHATSAPP_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID
  const hasScoreAppSecret = !!process.env.SCOREAPP_WEBHOOK_SECRET

  const results: SourceReadiness[] = [
    {
      key: 'WHATSAPP', label: 'WhatsApp',
      status: hasWhatsappToken ? 'CONNECTED' : 'NOT_CONNECTED',
      detail: hasWhatsappToken ? 'Inbound messages create/attach leads automatically.' : 'WhatsApp Business API credentials are not configured.',
    },
    {
      key: 'FACEBOOK', label: 'Facebook',
      status: hasFacebookToken ? 'CONNECTED' : 'NOT_CONNECTED',
      detail: hasFacebookToken ? 'Page access token configured — inbound Messenger messages create leads.' : 'No Facebook Page access token configured.',
    },
    {
      key: 'INSTAGRAM', label: 'Instagram',
      status: hasFacebookToken ? 'CONNECTED' : 'NOT_CONNECTED',
      detail: hasFacebookToken ? 'Shares the Facebook Page access token — inbound Instagram DMs create leads.' : 'No Facebook/Instagram access token configured.',
    },
    {
      key: 'WEBSITE', label: 'Website',
      status: 'CONNECTED',
      detail: 'Self-hosted contact form and quiz funnels — no external dependency.',
    },
    {
      key: 'QUIZ', label: 'Internal Quiz',
      status: 'CONNECTED',
      detail: 'Self-hosted quiz funnels feature — no external dependency.',
    },
    {
      key: 'SCOREAPP', label: 'ScoreApp',
      status: hasScoreAppSecret ? 'SETUP_REQUIRED' : 'NOT_CONNECTED',
      detail: hasScoreAppSecret
        ? 'Webhook secret configured, but no webhook URL has been confirmed registered on the ScoreApp account yet.'
        : 'No webhook secret configured — the receiver rejects every submission until this is set.',
    },
    {
      // Singular "AD", not plural "ADS" — must exactly match the real
      // Lead.source value the webhook actually writes (see
      // facebook.routes.ts's lead-ads handler), or SourcesWorkspace.tsx's
      // per-row readiness lookup (keyed on the real source value) silently
      // never resolves for this source, even though the top-level pill
      // list looks correct because it iterates this array directly.
      key: 'FACEBOOK_LEAD_AD', label: 'Facebook Lead Ads',
      status: hasFacebookToken ? 'SETUP_REQUIRED' : 'NOT_CONNECTED',
      detail: hasFacebookToken
        ? "Page token configured, but this Page's leadgen webhook subscription and leads_retrieval permission have not been verified — that check is a separate Meta account workstream."
        : 'No Facebook Page access token configured.',
    },
    {
      key: 'WALKIN', label: 'Walk-in',
      status: 'CONNECTED',
      detail: 'Manual entry — no integration required.',
    },
    {
      key: 'OTHER', label: 'Other',
      status: 'CONNECTED',
      detail: 'Manual entry — no integration required.',
    },
  ]

  return results
}
