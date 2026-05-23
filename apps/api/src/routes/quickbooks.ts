import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { requireAuth } from '../middleware/auth'
import { prisma } from '../lib/prisma'
import { pushInvoiceToQB, pushPaymentToQB, pushExpenseToQB } from '../services/qbPush'

const router = Router()

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const OAuthClient = require('intuit-oauth') as any
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const QuickBooks = require('node-quickbooks') as any

// ─── 5-minute server-side cache ──────────────────────────────────────────────
const CACHE_TTL = 5 * 60 * 1_000
const cache     = new Map<string, { data: any; expiresAt: number }>()

function getCached(key: string): any | null {
  const entry = cache.get(key)
  if (entry && Date.now() < entry.expiresAt) return entry.data
  cache.delete(key)
  return null
}

function setCached(key: string, data: any): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL })
}

export function clearQBCache(): void {
  cache.clear()
}

// ─── OAuth client factory ─────────────────────────────────────────────────────
function getOAuthClient() {
  return new OAuthClient({
    clientId:     process.env.QUICKBOOKS_CLIENT_ID!,
    clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
    environment:  process.env.QUICKBOOKS_ENVIRONMENT || 'production',
    redirectUri:  process.env.QUICKBOOKS_REDIRECT_URI!,
  })
}

// ─── QB API client (with auto token-refresh) ─────────────────────────────────
async function getQBClient() {
  const setting = await prisma.appSetting.findUnique({ where: { key: 'quickbooks_tokens' } })
  if (!setting) throw new Error('QuickBooks not connected')

  const stored     = JSON.parse(setting.value) as Record<string, any>
  const useSandbox = process.env.QUICKBOOKS_ENVIRONMENT !== 'production'

  const obtainedAt = stored.access_token_obtained_at
    ?? (stored.connected_at ? new Date(stored.connected_at).getTime() : Date.now() - 7_200_000)
  const expiresAt  = obtainedAt + (stored.expires_in ?? 3600) * 1_000 - 120_000

  if (Date.now() > expiresAt) {
    try {
      const oauthClient = getOAuthClient()
      oauthClient.setToken({ refresh_token: stored.refresh_token })
      const refreshed = await oauthClient.refreshUsingToken(stored.refresh_token)
      const newTok    = refreshed.getJson() as Record<string, any>
      const updated   = {
        ...stored,
        access_token:             newTok.access_token,
        refresh_token:            newTok.refresh_token ?? stored.refresh_token,
        expires_in:               newTok.expires_in    ?? 3600,
        access_token_obtained_at: Date.now(),
      }
      await prisma.appSetting.update({ where: { key: 'quickbooks_tokens' }, data: { value: JSON.stringify(updated) } })
      return new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID!, process.env.QUICKBOOKS_CLIENT_SECRET!,
        updated.access_token, false, stored.realmId, useSandbox, false, null, '2.0',
        updated.refresh_token,
      )
    } catch (e) {
      console.warn('[QB] Token refresh failed, using existing token:', (e as Error).message)
    }
  }

  return new QuickBooks(
    process.env.QUICKBOOKS_CLIENT_ID!, process.env.QUICKBOOKS_CLIENT_SECRET!,
    stored.access_token, false, stored.realmId, useSandbox, false, null, '2.0',
    stored.refresh_token,
  )
}

function qbQuery(qbo: any, query: string): Promise<any> {
  return new Promise((resolve, reject) =>
    qbo.query(query, (err: any, data: any) =>
      err ? reject(err) : resolve(data?.QueryResponse ?? data),
    ),
  )
}

// ── GET /accounts/quickbooks/connect ─────────────────────────────────────────
// Browser navigates here directly; token is embedded in OAuth state so the
// callback can identify the user.
router.get('/connect', (req, res) => {
  const token      = (req.query.token as string) || ''
  const oauthClient = getOAuthClient()
  const authUri     = oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting],
    state: `codeclinic-qb|${token}`,
  })
  res.redirect(authUri)
})

// ── GET /accounts/quickbooks/callback ────────────────────────────────────────
router.get('/callback', async (req, res) => {
  const webApp = (process.env.APP_URL || 'http://localhost:3000').split(',')[0].trim()
  console.log('[QB CALLBACK] Starting…', {
    code:    req.query.code    ? 'present' : 'missing',
    realmId: req.query.realmId,
    state:   req.query.state,
  })
  try {
    const state     = (req.query.state as string) || ''
    const userToken = state.split('|')[1] || ''

    let connectedByUserId: string | undefined
    if (userToken) {
      try {
        const decoded       = jwt.verify(userToken, process.env.JWT_SECRET!) as any
        connectedByUserId   = decoded.id || decoded.userId
      } catch { /* expired or invalid — connection still proceeds */ }
    }

    const oauthClient  = getOAuthClient()
    const authResponse = await oauthClient.createToken(req.url)
    const tokens       = authResponse.getJson() as Record<string, any>
    const realmId      = req.query.realmId as string

    console.log('[QB TOKEN] Exchange success — has access_token:', !!tokens.access_token)

    const payload = JSON.stringify({
      access_token:              tokens.access_token,
      refresh_token:             tokens.refresh_token,
      realmId,
      expires_in:                tokens.expires_in ?? 3600,
      access_token_obtained_at:  Date.now(),
      connected_at:              new Date().toISOString(),
      connected_by:              connectedByUserId,
    })

    await prisma.appSetting.upsert({
      where:  { key: 'quickbooks_tokens' },
      update: { value: payload },
      create: { key: 'quickbooks_tokens', value: payload },
    })

    // Clear cache so next fetch gets fresh data
    clearQBCache()

    // Cache company info in the background
    try {
      const qbo = await getQBClient()
      qbo.getCompanyInfo(realmId, async (err: any, info: any) => {
        if (!err && info) {
          await prisma.appSetting.upsert({
            where:  { key: 'quickbooks_company' },
            create: { key: 'quickbooks_company', value: JSON.stringify(info) },
            update: { value: JSON.stringify(info) },
          })
          console.log('[QB COMPANY]', info.CompanyName)
        }
      })
    } catch (e) {
      console.warn('[QB COMPANY FETCH] Failed:', e)
    }

    res.redirect(`${webApp}/accounts/dashboard?qb=connected`)
  } catch (err) {
    console.error('[QB callback error]', err)
    res.redirect(`${webApp}/accounts/dashboard?qb=error`)
  }
})

// ── GET /accounts/quickbooks/status ──────────────────────────────────────────
router.get('/status', requireAuth, async (_req, res) => {
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: 'quickbooks_tokens' } })
    if (!setting) return res.json({ connected: false })

    const tokens        = JSON.parse(setting.value)
    const companySetting = await prisma.appSetting.findUnique({ where: { key: 'quickbooks_company' } })

    if (companySetting) {
      const info = JSON.parse(companySetting.value)
      return res.json({
        connected:   true,
        companyName: info?.CompanyName ?? info?.QueryResponse?.CompanyInfo?.[0]?.CompanyName,
        realmId:     tokens.realmId,
        connectedAt: tokens.connected_at,
      })
    }

    const qbo = await getQBClient()
    qbo.getCompanyInfo(tokens.realmId, (err: any, info: any) => {
      if (err) return res.json({ connected: true, realmId: tokens.realmId })
      res.json({ connected: true, companyName: info?.CompanyName, realmId: tokens.realmId, connectedAt: tokens.connected_at })
    })
  } catch {
    res.json({ connected: false })
  }
})

// ── POST /accounts/quickbooks/disconnect ─────────────────────────────────────
// Deletes QB tokens & company info from AppSetting ONLY — does NOT call QB.
router.post('/disconnect', requireAuth, async (_req, res) => {
  try {
    await prisma.appSetting.deleteMany({
      where: { key: { in: ['quickbooks_tokens', 'quickbooks_company', 'qb_default_item_id', 'qb_default_expense_account_id', 'qb_default_deposit_account_id'] } },
    })
    clearQBCache()
  } catch { /* ignore */ }
  res.json({ disconnected: true })
})

// ── POST /accounts/quickbooks/sync ───────────────────────────────────────────
// Clears the server-side cache so the next read fetches fresh data from QB.
router.post('/sync', requireAuth, async (_req, res) => {
  clearQBCache()
  res.json({ synced: true, message: 'Cache cleared — next fetch will pull fresh data from QuickBooks' })
})

// ─── READ endpoints (all cached 5 minutes) ───────────────────────────────────

// ── GET /accounts/quickbooks/chart-of-accounts ───────────────────────────────
router.get('/chart-of-accounts', requireAuth, async (_req, res) => {
  const cacheKey = 'chart-of-accounts'
  const hit = getCached(cacheKey)
  if (hit) return res.json({ success: true, data: hit, cached: true })
  try {
    const qbo  = await getQBClient()
    const data = await qbQuery(qbo, 'SELECT * FROM Account MAXRESULTS 1000')
    const list = data.Account || []
    setCached(cacheKey, list)
    res.json({ success: true, data: list })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/invoices ────────────────────────────────────────
router.get('/invoices', requireAuth, async (_req, res) => {
  const cacheKey = 'invoices'
  const hit = getCached(cacheKey)
  if (hit) return res.json({ success: true, data: hit, cached: true })
  try {
    const qbo  = await getQBClient()
    const data = await qbQuery(qbo, 'SELECT * FROM Invoice ORDERBY TxnDate DESC MAXRESULTS 1000')
    const list = data.Invoice || []
    setCached(cacheKey, list)
    res.json({ success: true, data: list })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/expenses ────────────────────────────────────────
router.get('/expenses', requireAuth, async (_req, res) => {
  const cacheKey = 'expenses'
  const hit = getCached(cacheKey)
  if (hit) return res.json({ success: true, data: hit, cached: true })
  try {
    const qbo  = await getQBClient()
    const data = await qbQuery(qbo, 'SELECT * FROM Purchase ORDERBY TxnDate DESC MAXRESULTS 1000')
    const list = data.Purchase || []
    setCached(cacheKey, list)
    res.json({ success: true, data: list })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/bills ───────────────────────────────────────────
router.get('/bills', requireAuth, async (_req, res) => {
  const cacheKey = 'bills'
  const hit = getCached(cacheKey)
  if (hit) return res.json({ success: true, data: hit, cached: true })
  try {
    const qbo  = await getQBClient()
    const data = await qbQuery(qbo, 'SELECT * FROM Bill ORDERBY TxnDate DESC MAXRESULTS 1000')
    const list = data.Bill || []
    setCached(cacheKey, list)
    res.json({ success: true, data: list })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/payments ────────────────────────────────────────
router.get('/payments', requireAuth, async (_req, res) => {
  const cacheKey = 'payments'
  const hit = getCached(cacheKey)
  if (hit) return res.json({ success: true, data: hit, cached: true })
  try {
    const qbo  = await getQBClient()
    const data = await qbQuery(qbo, 'SELECT * FROM Payment ORDERBY TxnDate DESC MAXRESULTS 1000')
    const list = data.Payment || []
    setCached(cacheKey, list)
    res.json({ success: true, data: list })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/customers ───────────────────────────────────────
router.get('/customers', requireAuth, async (_req, res) => {
  const cacheKey = 'customers'
  const hit = getCached(cacheKey)
  if (hit) return res.json({ success: true, data: hit, cached: true })
  try {
    const qbo  = await getQBClient()
    const data = await qbQuery(qbo, 'SELECT * FROM Customer MAXRESULTS 1000')
    const list = data.Customer || []
    setCached(cacheKey, list)
    res.json({ success: true, data: list })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/vendors ─────────────────────────────────────────
router.get('/vendors', requireAuth, async (_req, res) => {
  const cacheKey = 'vendors'
  const hit = getCached(cacheKey)
  if (hit) return res.json({ success: true, data: hit, cached: true })
  try {
    const qbo  = await getQBClient()
    const data = await qbQuery(qbo, 'SELECT * FROM Vendor MAXRESULTS 1000')
    const list = data.Vendor || []
    setCached(cacheKey, list)
    res.json({ success: true, data: list })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/journal-entries ─────────────────────────────────
router.get('/journal-entries', requireAuth, async (_req, res) => {
  const cacheKey = 'journal-entries'
  const hit = getCached(cacheKey)
  if (hit) return res.json({ success: true, data: hit, cached: true })
  try {
    const qbo  = await getQBClient()
    const data = await qbQuery(qbo, 'SELECT * FROM JournalEntry ORDERBY TxnDate DESC MAXRESULTS 1000')
    const list = data.JournalEntry || []
    setCached(cacheKey, list)
    res.json({ success: true, data: list })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/employees ───────────────────────────────────────
router.get('/employees', requireAuth, async (_req, res) => {
  const cacheKey = 'employees'
  const hit = getCached(cacheKey)
  if (hit) return res.json({ success: true, data: hit, cached: true })
  try {
    const qbo  = await getQBClient()
    const data = await qbQuery(qbo, 'SELECT * FROM Employee MAXRESULTS 1000')
    const list = data.Employee || []
    setCached(cacheKey, list)
    res.json({ success: true, data: list })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/profit-loss ─────────────────────────────────────
router.get('/profit-loss', requireAuth, async (req, res) => {
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]
  const today     = new Date().toISOString().split('T')[0]
  const startDate = (req.query.start_date as string) || yearStart
  const endDate   = (req.query.end_date   as string) || today
  const cacheKey  = `profit-loss:${startDate}:${endDate}`
  const hit = getCached(cacheKey)
  if (hit) return res.json({ success: true, data: hit, cached: true })
  try {
    const qbo  = await getQBClient()
    const data = await new Promise((resolve, reject) => {
      qbo.reportProfitAndLoss(
        { start_date: startDate, end_date: endDate, summarize_column_by: 'Month' },
        (err: any, d: any) => err ? reject(err) : resolve(d),
      )
    })
    setCached(cacheKey, data)
    res.json({ success: true, data })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/balance-sheet ───────────────────────────────────
router.get('/balance-sheet', requireAuth, async (req, res) => {
  const asOf     = (req.query.as_of as string) || new Date().toISOString().split('T')[0]
  const cacheKey = `balance-sheet:${asOf}`
  const hit = getCached(cacheKey)
  if (hit) return res.json({ success: true, data: hit, cached: true })
  try {
    const qbo  = await getQBClient()
    const data = await new Promise((resolve, reject) => {
      qbo.reportBalanceSheet({ as_of: asOf }, (err: any, d: any) => err ? reject(err) : resolve(d))
    })
    setCached(cacheKey, data)
    res.json({ success: true, data })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/cash-flow ───────────────────────────────────────
router.get('/cash-flow', requireAuth, async (req, res) => {
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]
  const today     = new Date().toISOString().split('T')[0]
  const startDate = (req.query.start_date as string) || yearStart
  const endDate   = (req.query.end_date   as string) || today
  const cacheKey  = `cash-flow:${startDate}:${endDate}`
  const hit = getCached(cacheKey)
  if (hit) return res.json({ success: true, data: hit, cached: true })
  try {
    const qbo  = await getQBClient()
    const data = await new Promise((resolve, reject) => {
      qbo.reportCashFlow(
        { start_date: startDate, end_date: endDate },
        (err: any, d: any) => err ? reject(err) : resolve(d),
      )
    })
    setCached(cacheKey, data)
    res.json({ success: true, data })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ─── WRITE endpoints (push Code Clinic data → QB) ────────────────────────────

// ── POST /accounts/quickbooks/push-invoice/:id ───────────────────────────────
// Syncs one local invoice to QuickBooks (find/create customer + create invoice).
router.post('/push-invoice/:id', requireAuth, async (req, res) => {
  try {
    await pushInvoiceToQB(req.params.id)
    const updated = await prisma.invoice.findUnique({
      where:  { id: req.params.id },
      select: { qbInvoiceId: true, qbSyncStatus: true, qbSyncedAt: true },
    })
    res.json({ success: true, ...updated })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// ── POST /accounts/quickbooks/push-payment/:id ───────────────────────────────
// Records a Code Clinic payment in QuickBooks against the linked QB invoice.
router.post('/push-payment/:id', requireAuth, async (req, res) => {
  try {
    await pushPaymentToQB(req.params.id)
    const updated = await prisma.payment.findUnique({
      where:  { id: req.params.id },
      select: { qbPaymentId: true },
    })
    res.json({ success: true, ...updated })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// ── POST /accounts/quickbooks/push-expense/:id ───────────────────────────────
// Creates a QB Purchase record from a Code Clinic expense.
router.post('/push-expense/:id', requireAuth, async (req, res) => {
  try {
    await pushExpenseToQB(req.params.id)
    const updated = await prisma.expense.findUnique({
      where:  { id: req.params.id },
      select: { qbPurchaseId: true },
    })
    res.json({ success: true, ...updated })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// ── POST /accounts/quickbooks/webhook ────────────────────────────────────────
router.post('/webhook', (req, res) => {
  console.log('[QB Webhook]', JSON.stringify(req.body))
  res.sendStatus(200)
})

export default router
