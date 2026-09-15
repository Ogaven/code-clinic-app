import { Router }    from 'express'
import fs            from 'fs'
import { requireAuth } from '../../middleware/auth'
import { prisma }    from '../../lib/prisma'
import { isSmsChannelActive } from '../sms/sms.service'
import { resolveAiUsageRange, type AiUsageRangeKey } from './meta-usage.routes'

const router = Router()

const CACHE_FILE  = '/tmp/codeclinic-channel-analytics.json'
const CACHE_TTL   = 60 * 60 * 1000        // 1 hour
const META_CACHE  = '/tmp/codeclinic-meta-usage.json'

// A channel's presence in aiConversation data (or its message counts being
// nonzero) is not the same question as whether it's currently an active
// Code Clinic patient channel — that's a business decision, not a data
// query. WhatsApp/Instagram/Facebook/Website Chat are fixed as active (no
// toggle exists for them). SMS and Calling are genuinely derived from the
// same real switches their own send paths check — isSmsChannelActive() is
// the exact gate sendSMS() itself uses (sms.service.ts), and
// calling_agents_enabled is the exact AppSetting the SIP voice pipeline
// checks before answering (sip.service.ts / voice-channel.ts) — so this can
// never silently drift from what the system is actually doing, and matches
// the equivalent surface on the Admin CRM Automation page
// (routes/crm-automation.ts's /automation-status).
async function getPatientChannelStatus(): Promise<Record<string, 'ACTIVE' | 'PAUSED'>> {
  const callingSetting = await prisma.appSetting.findUnique({ where: { key: 'calling_agents_enabled' } })
  const callingActive  = callingSetting?.value !== 'false'

  return {
    WHATSAPP:          'ACTIVE',
    WEBSITE:           'ACTIVE',
    FACEBOOK:          'ACTIVE',
    FACEBOOK_COMMENT:  'ACTIVE',
    INSTAGRAM:         'ACTIVE',
    INSTAGRAM_COMMENT: 'ACTIVE',
    SMS:               isSmsChannelActive() ? 'ACTIVE' : 'PAUSED',
    CALLING:           callingActive ? 'ACTIVE' : 'PAUSED',
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
}

interface Analytics {
  channels:      Record<string, ChannelData>
  channelStatus: Record<string, 'ACTIVE' | 'PAUSED'>
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

async function fetchOperationalVolume(range: { start: Date; end: Date }, channels: Record<string, ChannelData>): Promise<OperationalVolume> {
  const [confirmationsSent, followupsSent, escalations, callEvents] = await Promise.all([
    prisma.aiScheduledMessage.count({
      where: { templateType: 'APPOINTMENT_CONFIRMATION', sent: true, scheduledFor: { gte: range.start, lt: range.end } },
    }),
    prisma.aiScheduledMessage.count({
      where: { templateType: { in: ['FOLLOWUP', 'MISSED_APPOINTMENT'] }, sent: true, scheduledFor: { gte: range.start, lt: range.end } },
    }),
    prisma.escalation.count({ where: { createdAt: { gte: range.start, lt: range.end } } }),
    prisma.callEvent.count({ where: { occurredAt: { gte: range.start, lt: range.end } } }),
  ])

  const totalInteractions = Object.values(channels).reduce((sum, c) => sum + c.selected.total, 0)

  return { confirmationsSent, followupsSent, escalations, callEvents, totalInteractions }
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

// GET /ai-suite/channel-analytics?range=today|7d|30d|month|prev_month (default 30d)
// Only the default range is file-cached (matches the previous fixed-30d
// behaviour) -- an explicitly chosen non-default range always computes fresh
// so a stale cached window is never shown as if it were the requested one.
router.get('/channel-analytics', requireAuth, async (req, res) => {
  try {
    const resolved = resolveAiUsageRange(req.query.range)
    const useCache = resolved.range === '30d'

    if (useCache) {
      const cached = readCache(CACHE_FILE)
      if (cached) return res.json(cached)
    }

    const data = await buildAnalytics(resolved)
    if (useCache) writeCache(CACHE_FILE, data)
    res.json(data)
  } catch (err: any) {
    console.error('[ChannelAnalytics]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /ai-suite/channel-analytics/refresh?range=...
router.post('/channel-analytics/refresh', requireAuth, async (req, res) => {
  try {
    const resolved = resolveAiUsageRange(req.query.range)
    try { fs.unlinkSync(CACHE_FILE) } catch {}
    const data = await buildAnalytics(resolved)
    if (resolved.range === '30d') writeCache(CACHE_FILE, data)
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
