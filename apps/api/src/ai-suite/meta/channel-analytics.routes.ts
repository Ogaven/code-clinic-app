import { Router }    from 'express'
import fs            from 'fs'
import { requireAuth } from '../../middleware/auth'
import { prisma }    from '../../lib/prisma'
import { isSmsChannelActive } from '../sms/sms.service'
import { resolveAiUsageRange, type AiUsageRangeKey } from './meta-usage.routes'
import { isCallingChannelActive } from '../../services/calling-channel.service'
import { getWhatsAppDeliveryHealth } from '../../services/provider-health.service'

const router = Router()

const CACHE_FILE  = '/tmp/codeclinic-channel-analytics.json'
const CACHE_TTL   = 60 * 60 * 1000        // 1 hour
const META_CACHE  = '/tmp/codeclinic-meta-usage.json'

export type ChannelStatus = 'ACTIVE' | 'DEGRADED' | 'ERROR' | 'CONFIG_REQUIRED' | 'PAUSED' | 'UNKNOWN'

// Each channel's status is derived from the real signal that channel
// actually has — never a hardcoded "Active":
//  - WhatsApp reuses the same delivery-health classification already computed
//    from real AiMessage/MetaDeliveryFailure rows for the Delivery Health card
//    (provider-health.service.ts) — HEALTHY/DEGRADED/DOWN/UNKNOWN, so this can
//    never say "Active" while deliveries are actually failing.
//  - Facebook/Instagram read the exact access-token lookup their own send
//    paths use (facebook.routes.ts: aiAgentConfig row, falling back to the
//    env var) — no token means the channel genuinely cannot send, so it's
//    reported CONFIG_REQUIRED rather than pretended-active.
//  - Website Chat is first-party (talks directly to this API, no external
//    provider to be down or unconfigured), so ACTIVE is a true statement, not
//    an assumption.
//  - SMS and Calling are the same real switches their own send paths check —
//    isSmsChannelActive() is the exact gate sendSMS() uses (sms.service.ts),
//    and isCallingChannelActive() is the exact fail-closed check the SIP
//    voice pipeline uses (calling-channel.service.ts) — so this can never
//    silently drift from what the system is actually doing.
async function getPatientChannelStatus(): Promise<Record<string, ChannelStatus>> {
  const [waHealth, agentConfig] = await Promise.all([
    getWhatsAppDeliveryHealth(),
    prisma.aiAgentConfig.findFirst(),
  ])

  const waStatus: ChannelStatus =
    waHealth.status === 'HEALTHY'  ? 'ACTIVE' :
    waHealth.status === 'DEGRADED' ? 'DEGRADED' :
    waHealth.status === 'DOWN'     ? 'ERROR' :
                                      'UNKNOWN'

  const fbConfigured = !!(agentConfig?.facebookPageAccessToken || process.env.FACEBOOK_PAGE_ACCESS_TOKEN)
  const igConfigured = !!(agentConfig?.instagramAccessToken    || process.env.INSTAGRAM_ACCESS_TOKEN)

  return {
    WHATSAPP:          waStatus,
    WEBSITE:           'ACTIVE',
    FACEBOOK:          fbConfigured ? 'ACTIVE' : 'CONFIG_REQUIRED',
    FACEBOOK_COMMENT:  fbConfigured ? 'ACTIVE' : 'CONFIG_REQUIRED',
    INSTAGRAM:         igConfigured ? 'ACTIVE' : 'CONFIG_REQUIRED',
    INSTAGRAM_COMMENT: igConfigured ? 'ACTIVE' : 'CONFIG_REQUIRED',
    SMS:               isSmsChannelActive() ? 'ACTIVE' : 'PAUSED',
    CALLING:           (await isCallingChannelActive()) ? 'ACTIVE' : 'PAUSED',
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface DayPoint    { day: string; agent: number; user: number }
interface MonthTotal  { agent: number; user: number; total: number }
interface ChannelData { daily: DayPoint[]; thisMonth: MonthTotal; lastMonth: MonthTotal; allTimeConvs: number; selected: MonthTotal }

interface DoBalance {
  accountBalance:     string
  monthToDateUsage:   string
  monthToDateBalance: string
  generatedAt:        string
}

// Real counts for the operational features that live outside the AI
// conversation/message tables (confirmations, follow-ups, escalations,
// calling), for the same selected date range as the channel data above.
// Each traces to an existing model already used by that feature's own
// dedicated page/report -- this is a summary, not a new source of truth.
interface OperationalVolume {
  confirmationsSent: number  // aiScheduledMessage(templateType=APPOINTMENT_CONFIRMATION, sent=true)
  followupsSent:     number  // aiScheduledMessage(templateType in FOLLOWUP/MISSED_APPOINTMENT, sent=true)
  escalations:       number  // Escalation rows created in range
  callEvents:        number  // CallEvent rows in range (provider is MOCK until a real telephony provider is wired up -- see schema.prisma)
  totalInteractions: number  // sum of every message-channel's `selected.total` below -- one honest "AI interactions" figure, not invented
  humanHandovers:      number       // real takeover EVENTS in range (takeover.service.ts's SYSTEM "takenOverAt" marker) -- not a current-state snapshot, an event count
  engagedConversations: number      // distinct conversations with a real inbound USER message in range -- the denominator for aiResolutionRatePct
  aiResolutionRatePct:  number | null // % of engagedConversations with zero takeover events in range; null (never 0%) when there's no real traffic to measure
}

interface Analytics {
  channels:      Record<string, ChannelData>
  channelStatus: Record<string, ChannelStatus>
  operational:   OperationalVolume
  range:         AiUsageRangeKey
  meta:          any
  digitalocean:  DoBalance | { notConfigured: true }
  cachedAt:      string
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

function readCache(file: string): any | null {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (Date.now() - new Date(c.cachedAt).getTime() < CACHE_TTL) return c
    return null
  } catch { return null }
}

function writeCache(file: string, data: any) {
  try { fs.writeFileSync(file, JSON.stringify(data), 'utf-8') } catch {}
}

// ── Channel analytics from DB ─────────────────────────────────────────────────

async function fetchChannelData(selectedRange: { start: Date; end: Date }): Promise<Record<string, ChannelData>> {
  const now   = new Date()
  const yr    = now.getUTCFullYear()
  const mo    = now.getUTCMonth() + 1
  const prev  = mo === 1 ? { yr: yr - 1, mo: 12 } : { yr, mo: mo - 1 }

  const thisMonthStart = new Date(Date.UTC(yr, mo - 1, 1))
  const lastMonthStart = new Date(Date.UTC(prev.yr, prev.mo - 1, 1))
  const since30        = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const [daily, thisMonthAgg, lastMonthAgg, allTimeConvs, selectedAgg] = await Promise.all([
    // Daily breakdown (last 30 days)
    prisma.$queryRaw<{ channel: string; day: string; agent_msgs: number; user_msgs: number }[]>`
      SELECT
        c.channel,
        DATE_TRUNC('day', m."createdAt")::text AS day,
        SUM(CASE WHEN m.role = 'AGENT' THEN 1 ELSE 0 END)::int AS agent_msgs,
        SUM(CASE WHEN m.role = 'USER'  THEN 1 ELSE 0 END)::int AS user_msgs
      FROM ai_messages m
      JOIN ai_conversations c ON c.id = m."conversationId"
      WHERE m."createdAt" >= ${since30}
      GROUP BY c.channel, DATE_TRUNC('day', m."createdAt")
      ORDER BY c.channel, day
    `,

    // This month totals
    prisma.$queryRaw<{ channel: string; agent_msgs: number; user_msgs: number }[]>`
      SELECT
        c.channel,
        SUM(CASE WHEN m.role = 'AGENT' THEN 1 ELSE 0 END)::int AS agent_msgs,
        SUM(CASE WHEN m.role = 'USER'  THEN 1 ELSE 0 END)::int AS user_msgs
      FROM ai_messages m
      JOIN ai_conversations c ON c.id = m."conversationId"
      WHERE m."createdAt" >= ${thisMonthStart}
      GROUP BY c.channel
    `,

    // Last month totals
    prisma.$queryRaw<{ channel: string; agent_msgs: number; user_msgs: number }[]>`
      SELECT
        c.channel,
        SUM(CASE WHEN m.role = 'AGENT' THEN 1 ELSE 0 END)::int AS agent_msgs,
        SUM(CASE WHEN m.role = 'USER'  THEN 1 ELSE 0 END)::int AS user_msgs
      FROM ai_messages m
      JOIN ai_conversations c ON c.id = m."conversationId"
      WHERE m."createdAt" >= ${lastMonthStart} AND m."createdAt" < ${thisMonthStart}
      GROUP BY c.channel
    `,

    // All-time conversation counts per channel
    prisma.aiConversation.groupBy({
      by: ['channel'],
      _count: { id: true },
    }),

    // Totals for the caller-selected date range (independent of the fixed
    // this/last-month comparison above, which stays as-is so the existing
    // %-change badge keeps its established meaning).
    prisma.$queryRaw<{ channel: string; agent_msgs: number; user_msgs: number }[]>`
      SELECT
        c.channel,
        SUM(CASE WHEN m.role = 'AGENT' THEN 1 ELSE 0 END)::int AS agent_msgs,
        SUM(CASE WHEN m.role = 'USER'  THEN 1 ELSE 0 END)::int AS user_msgs
      FROM ai_messages m
      JOIN ai_conversations c ON c.id = m."conversationId"
      WHERE m."createdAt" >= ${selectedRange.start} AND m."createdAt" < ${selectedRange.end}
      GROUP BY c.channel
    `,
  ])

  const channels: Record<string, ChannelData> = {}

  const allChannels = ['WHATSAPP', 'WEBSITE', 'FACEBOOK', 'FACEBOOK_COMMENT', 'INSTAGRAM', 'INSTAGRAM_COMMENT', 'SMS']
  for (const ch of allChannels) {
    const dayPts = daily.filter(r => r.channel === ch).map(r => ({
      day:   r.day.slice(0, 10),
      agent: r.agent_msgs,
      user:  r.user_msgs,
    }))

    const thisR = thisMonthAgg.find(r => r.channel === ch)
    const lastR = lastMonthAgg.find(r => r.channel === ch)
    const allR  = allTimeConvs.find(r => r.channel === ch)
    const selR  = selectedAgg.find(r => r.channel === ch)

    channels[ch] = {
      daily:    dayPts,
      thisMonth: {
        agent: thisR?.agent_msgs ?? 0,
        user:  thisR?.user_msgs  ?? 0,
        total: (thisR?.agent_msgs ?? 0) + (thisR?.user_msgs ?? 0),
      },
      lastMonth: {
        agent: lastR?.agent_msgs ?? 0,
        user:  lastR?.user_msgs  ?? 0,
        total: (lastR?.agent_msgs ?? 0) + (lastR?.user_msgs ?? 0),
      },
      allTimeConvs: allR?._count.id ?? 0,
      selected: {
        agent: selR?.agent_msgs ?? 0,
        user:  selR?.user_msgs  ?? 0,
        total: (selR?.agent_msgs ?? 0) + (selR?.user_msgs ?? 0),
      },
    }
  }

  return channels
}

// ── Operational volume (confirmations, follow-ups, escalations, calling) ──────

export async function fetchOperationalVolume(range: { start: Date; end: Date }, channels: Record<string, ChannelData>): Promise<OperationalVolume> {
  const [confirmationsSent, followupsSent, escalations, callEvents, humanHandovers, engagedConvIds, handedOverConvIds] = await Promise.all([
    prisma.aiScheduledMessage.count({
      where: { templateType: 'APPOINTMENT_CONFIRMATION', sent: true, scheduledFor: { gte: range.start, lt: range.end } },
    }),
    prisma.aiScheduledMessage.count({
      where: { templateType: { in: ['FOLLOWUP', 'MISSED_APPOINTMENT'] }, sent: true, scheduledFor: { gte: range.start, lt: range.end } },
    }),
    prisma.escalation.count({ where: { createdAt: { gte: range.start, lt: range.end } } }),
    prisma.callEvent.count({ where: { occurredAt: { gte: range.start, lt: range.end } } }),
    // Real takeover EVENTS in range — the SYSTEM-role marker takeover.service.ts
    // writes on every takeoverConversation() call. An event count, not a
    // current-state snapshot (AiConversation.agentEnabled only reflects "right
    // now", not "how many times did staff have to step in this period").
    prisma.aiMessage.count({
      where: { role: 'SYSTEM', metadata: { contains: 'takenOverAt' }, createdAt: { gte: range.start, lt: range.end } },
    }),
    prisma.aiMessage.findMany({
      where: { role: 'USER', createdAt: { gte: range.start, lt: range.end } },
      select: { conversationId: true },
      distinct: ['conversationId'],
    }),
    prisma.aiMessage.findMany({
      where: { role: 'SYSTEM', metadata: { contains: 'takenOverAt' }, createdAt: { gte: range.start, lt: range.end } },
      select: { conversationId: true },
      distinct: ['conversationId'],
    }),
  ])

  const totalInteractions = Object.values(channels).reduce((sum, c) => sum + c.selected.total, 0)

  // AI Resolution Rate = % of conversations with real inbound activity this
  // period that Sarah handled without any human takeover event in the same
  // period. Real data only: both the numerator and denominator are distinct
  // conversationIds from actual AiMessage rows -- never a guessed or
  // hardcoded figure. null (never a misleading 0%) when there's no engaged
  // conversation to measure in this period at all.
  const engagedConversations = engagedConvIds.length
  const handedOverSet = new Set(handedOverConvIds.map(c => c.conversationId))
  const resolvedWithoutHandover = engagedConvIds.filter(c => !handedOverSet.has(c.conversationId)).length
  const aiResolutionRatePct = engagedConversations > 0
    ? Math.round((resolvedWithoutHandover / engagedConversations) * 1000) / 10
    : null

  return { confirmationsSent, followupsSent, escalations, callEvents, totalInteractions, humanHandovers, engagedConversations, aiResolutionRatePct }
}

// ── DigitalOcean balance ──────────────────────────────────────────────────────

async function fetchDoBalance(): Promise<DoBalance | { notConfigured: true }> {
  const token = process.env.DIGITALOCEAN_API_TOKEN
  if (!token) return { notConfigured: true }

  try {
    const res  = await fetch('https://api.digitalocean.com/v2/customers/my/balance', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      console.warn('[DO] Balance fetch failed:', res.status, await res.text())
      return { notConfigured: true }
    }
    const json = await res.json() as any
    return {
      accountBalance:     json.account_balance     ?? '0.00',
      monthToDateUsage:   json.month_to_date_usage  ?? '0.00',
      monthToDateBalance: json.month_to_date_balance ?? '0.00',
      generatedAt:        json.generated_at         ?? new Date().toISOString(),
    }
  } catch (e: any) {
    console.warn('[DO] Balance error:', e.message)
    return { notConfigured: true }
  }
}

// ── Build full analytics payload ──────────────────────────────────────────────

async function buildAnalytics(selectedRange: { start: Date; end: Date; range: AiUsageRangeKey }): Promise<Analytics> {
  const [channels, digitalocean] = await Promise.all([
    fetchChannelData(selectedRange),
    fetchDoBalance(),
  ])

  const operational = await fetchOperationalVolume(selectedRange, channels)

  // Reuse the existing meta-usage cache if fresh — no double-fetch
  let meta: any = null
  try {
    const raw = JSON.parse(fs.readFileSync(META_CACHE, 'utf-8'))
    if (Date.now() - new Date(raw.cachedAt).getTime() < 6 * 60 * 60 * 1000) meta = raw
  } catch {}

  // If meta cache stale, fetch fresh (but don't block on it failing)
  if (!meta) {
    const token = process.env.WHATSAPP_TOKEN
    if (token) {
      try {
        const { buildUsage } = await import('./meta-usage.routes') as any
        meta = await buildUsage(token)
      } catch { /* meta data optional */ }
    }
  }

  const channelStatus = await getPatientChannelStatus()
  const now = new Date().toISOString()
  return { channels, channelStatus, operational, range: selectedRange.range, meta, digitalocean, cachedAt: now }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// meta (WABA usage/cost) and digitalocean (infra account balance) are
// financial/provider-billing detail, same boundary as /ai-suite/meta-billing
// and /ai-usage (both adminOnly) — the shared 30d file cache holds the full
// payload for every role, so the redaction has to happen per-request on the
// way out rather than by branching what gets cached.
function forNonAdmin(data: Analytics): Analytics {
  return { ...data, meta: null, digitalocean: { notConfigured: true } }
}

// GET /ai-suite/channel-analytics?range=today|7d|30d|month|prev_month (default 30d)
// Only the default range is file-cached (matches the previous fixed-30d
// behaviour) -- an explicitly chosen non-default range always computes fresh
// so a stale cached window is never shown as if it were the requested one.
router.get('/channel-analytics', requireAuth, async (req, res) => {
  try {
    const resolved = resolveAiUsageRange(req.query.range)
    const useCache = resolved.range === '30d'
    const isAdmin = req.user?.role === 'ADMIN'

    if (useCache) {
      const cached = readCache(CACHE_FILE)
      if (cached) return res.json(isAdmin ? cached : forNonAdmin(cached))
    }

    const data = await buildAnalytics(resolved)
    if (useCache) writeCache(CACHE_FILE, data)
    res.json(isAdmin ? data : forNonAdmin(data))
  } catch (err: any) {
    console.error('[ChannelAnalytics]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /ai-suite/channel-analytics/refresh?range=...
router.post('/channel-analytics/refresh', requireAuth, async (req, res) => {
  try {
    const resolved = resolveAiUsageRange(req.query.range)
    const isAdmin = req.user?.role === 'ADMIN'
    try { fs.unlinkSync(CACHE_FILE) } catch {}
    const data = await buildAnalytics(resolved)
    if (resolved.range === '30d') writeCache(CACHE_FILE, data)
    res.json(isAdmin ? data : forNonAdmin(data))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
