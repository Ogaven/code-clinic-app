import { Router }    from 'express'
import fs            from 'fs'
import { requireAuth } from '../../middleware/auth'
import { prisma }    from '../../lib/prisma'

const router = Router()

const CACHE_FILE  = '/tmp/codeclinic-channel-analytics.json'
const CACHE_TTL   = 60 * 60 * 1000        // 1 hour
const META_CACHE  = '/tmp/codeclinic-meta-usage.json'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DayPoint    { day: string; agent: number; user: number }
interface MonthTotal  { agent: number; user: number; total: number }
interface ChannelData { daily: DayPoint[]; thisMonth: MonthTotal; lastMonth: MonthTotal; allTimeConvs: number }

interface DoBalance {
  accountBalance:     string
  monthToDateUsage:   string
  monthToDateBalance: string
  generatedAt:        string
}

interface Analytics {
  channels:      Record<string, ChannelData>
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

async function fetchChannelData(): Promise<Record<string, ChannelData>> {
  const now   = new Date()
  const yr    = now.getUTCFullYear()
  const mo    = now.getUTCMonth() + 1
  const prev  = mo === 1 ? { yr: yr - 1, mo: 12 } : { yr, mo: mo - 1 }

  const thisMonthStart = new Date(Date.UTC(yr, mo - 1, 1))
  const lastMonthStart = new Date(Date.UTC(prev.yr, prev.mo - 1, 1))
  const since30        = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const [daily, thisMonthAgg, lastMonthAgg, allTimeConvs] = await Promise.all([
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
    }
  }

  return channels
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

async function buildAnalytics(): Promise<Analytics> {
  const [channels, digitalocean] = await Promise.all([
    fetchChannelData(),
    fetchDoBalance(),
  ])

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

  const now = new Date().toISOString()
  return { channels, meta, digitalocean, cachedAt: now }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /ai-suite/channel-analytics
router.get('/channel-analytics', requireAuth, async (_req, res) => {
  try {
    const cached = readCache(CACHE_FILE)
    if (cached) return res.json(cached)

    const data = await buildAnalytics()
    writeCache(CACHE_FILE, data)
    res.json(data)
  } catch (err: any) {
    console.error('[ChannelAnalytics]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /ai-suite/channel-analytics/refresh
router.post('/channel-analytics/refresh', requireAuth, async (_req, res) => {
  try {
    try { fs.unlinkSync(CACHE_FILE) } catch {}
    const data = await buildAnalytics()
    writeCache(CACHE_FILE, data)
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
