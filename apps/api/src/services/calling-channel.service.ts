import { prisma } from '../lib/prisma'

// Calling is a paused Code Clinic patient channel by business policy — it
// must stay paused whenever the `calling_agents_enabled` AppSetting row is
// missing or ambiguous, not just when it's explicitly 'false'. Fail-closed:
// only an explicit 'true' turns calling on. This is the single source of
// truth for "is calling live" — sip.service.ts (inbound answer/decline),
// voice-channel.ts (outbound trigger), and both channel-status display
// endpoints (routes/crm-automation.ts, ai-suite/meta/channel-analytics.routes.ts)
// all call this instead of re-deriving the same check, so the answer can
// never drift between what's displayed and what the voice pipeline actually
// does.
export async function isCallingChannelActive(): Promise<boolean> {
  const setting = await prisma.appSetting.findUnique({ where: { key: 'calling_agents_enabled' } })
  return setting?.value === 'true'
}
