import { Router } from 'express'
import fs from 'fs'
import { requireAuth } from '../../middleware/auth'

const router = Router()

const CACHE_FILE = '/tmp/codeclinic-meta-usage.json'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

const UG_WABA   = '1754698499275270'   // Code Clinic Uganda (routed via AT)
const KE_WABA   = '1035568108843333'   // Elyrac AI Kenya (Meta Cloud API direct)
const GRAPH_VER = 'v25.0'

// Meta per-message pricing changed July 1 2025 — lookback only from Dec 1 2025
const DATA_SINCE = new Date('2025-12-01T00:00:00Z')

interface DataPoint { start: number; end: number; volume: number; cost?: number }
interface WabaUsage {
  wabaId:      string
  wabaName:    string
  phone:       string
  daily:       DataPoint[]
  thisMonth:   { volume: number; cost: number }
  lastMonth:   { volume: number; cost: number }
  fetchedAt:   string
}
interface UsageCache {
  uganda:    WabaUsage
  kenya:     WabaUsage
  cachedAt:  string
}

function readCache(): UsageCache | null {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8')
    const c   = JSON.parse(raw) as UsageCache
    if (Date.now() - new Date(c.cachedAt).getTime() < CACHE_TTL_MS) return c
    return null
  } catch {
    return null
  }
}

function writeCache(data: UsageCache): void {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf-8') } catch {}
}

async function fetchWabaAnalytics(wabaId: string, token: string): Promise<DataPoint[]> {
  const now   = Math.floor(Date.now() / 1000)
  const since = Math.floor(Math.max(DATA_SINCE.getTime() / 1000, Date.now() / 1000 - 90 * 86400))

  const url = `https://graph.facebook.com/${GRAPH_VER}/${wabaId}/pricing_analytics`
    + `?start=${since}&end=${now}&granularity=DAILY&access_token=${token}`

  const res  = await fetch(url)
  const json = await res.json() as { data?: { data_points?: DataPoint[] }[]; error?: any }

  if (json.error) {
    console.warn(`[MetaUsage] API error for WABA ${wabaId}:`, json.error.message)
    return []
  }

  return json.data?.[0]?.data_points ?? []
}

function summariseMonth(points: DataPoint[], year: number, month: number) {
  const start = new Date(year, month - 1, 1).getTime() / 1000
  const end   = new Date(year, month, 1).getTime() / 1000
  const inMonth = points.filter(p => p.start >= start && p.start < end)
  return {
    volume: inMonth.reduce((s, p) => s + p.volume, 0),
    cost:   inMonth.reduce((s, p) => s + (p.cost ?? 0), 0),
  }
}

async function buildUsage(token: string): Promise<UsageCache> {
  const now  = new Date()
  const yr   = now.getUTCFullYear()
  const mo   = now.getUTCMonth() + 1
  const prev = mo === 1 ? { yr: yr - 1, mo: 12 } : { yr, mo: mo - 1 }

  const [ugPoints, kePoints] = await Promise.all([
    fetchWabaAnalytics(UG_WABA, token),
    fetchWabaAnalytics(KE_WABA, token),
  ])

  // Keep only last 30 days of daily points for the chart
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 86400
  const trim   = (pts: DataPoint[]) => pts.filter(p => p.start >= cutoff)

  return {
    uganda: {
      wabaId:    UG_WABA,
      wabaName:  'Code Clinic (Uganda)',
      phone:     '+256 741 087667',
      daily:     trim(ugPoints),
      thisMonth: summariseMonth(ugPoints, yr, mo),
      lastMonth: summariseMonth(ugPoints, prev.yr, prev.mo),
      fetchedAt: now.toISOString(),
    },
    kenya: {
      wabaId:    KE_WABA,
      wabaName:  'Elyrac AI (Kenya)',
      phone:     '+254 701 944393',
      daily:     trim(kePoints),
      thisMonth: summariseMonth(kePoints, yr, mo),
      lastMonth: summariseMonth(kePoints, prev.yr, prev.mo),
      fetchedAt: now.toISOString(),
    },
    cachedAt: now.toISOString(),
  }
}

// GET /ai-suite/meta-usage
router.get('/meta-usage', requireAuth, async (_req, res) => {
  try {
    const cached = readCache()
    if (cached) return res.json(cached)

    const token = process.env.WHATSAPP_TOKEN
    if (!token) return res.status(503).json({ error: 'WHATSAPP_TOKEN not configured' })

    const data = await buildUsage(token)
    writeCache(data)
    res.json(data)
  } catch (err: any) {
    console.error('[MetaUsage] fetch error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /ai-suite/meta-usage/refresh — force-bust the cache
router.post('/meta-usage/refresh', requireAuth, async (_req, res) => {
  try {
    try { fs.unlinkSync(CACHE_FILE) } catch {}
    const token = process.env.WHATSAPP_TOKEN
    if (!token) return res.status(503).json({ error: 'WHATSAPP_TOKEN not configured' })
    const data = await buildUsage(token)
    writeCache(data)
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
