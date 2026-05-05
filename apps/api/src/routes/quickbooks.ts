import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/auth'

const router = Router()
const prisma = new PrismaClient()

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const OAuthClient = require('intuit-oauth') as any
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const QuickBooks = require('node-quickbooks') as any

function getOAuthClient() {
  return new OAuthClient({
    clientId:     process.env.QUICKBOOKS_CLIENT_ID!,
    clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
    environment:  process.env.QUICKBOOKS_ENVIRONMENT || 'production',
    redirectUri:  process.env.QUICKBOOKS_REDIRECT_URI!,
  })
}

async function getQBClient() {
  const setting = await prisma.appSetting.findUnique({ where: { key: 'quickbooks_tokens' } })
  if (!setting) throw new Error('QuickBooks not connected')
  const tokens = JSON.parse(setting.value)
  const useSandbox = process.env.QUICKBOOKS_ENVIRONMENT !== 'production'
  return new QuickBooks(
    process.env.QUICKBOOKS_CLIENT_ID!,
    process.env.QUICKBOOKS_CLIENT_SECRET!,
    tokens.access_token,
    false,
    tokens.realmId,
    useSandbox,
    false,
    null,
    '2.0',
    tokens.refresh_token,
  )
}

function qbQuery(qbo: any, query: string): Promise<any> {
  return new Promise((resolve, reject) => {
    qbo.query(query, (err: any, data: any) => {
      if (err) reject(err)
      else resolve(data?.QueryResponse ?? data)
    })
  })
}

// ── GET /accounts/quickbooks/connect ─────────────────────────────────────────
router.get('/connect', requireAuth, (req, res) => {
  const oauthClient = getOAuthClient()
  const authUri = oauthClient.authorizeUri({
    scope: ['com.intuit.quickbooks.accounting', 'com.intuit.quickbooks.payment'],
    state: 'codeclinic-qb',
  })
  res.redirect(authUri)
})

// ── GET /accounts/quickbooks/callback ────────────────────────────────────────
router.get('/callback', async (req, res) => {
  const webApp = (process.env.APP_URL || 'http://localhost:3000').split(',')[0].trim()
  try {
    const oauthClient = getOAuthClient()
    const authResponse = await oauthClient.createToken(req.url)
    const tokens = authResponse.getJson()
    const realmId = req.query.realmId as string

    const payload = JSON.stringify({
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      realmId,
      expires_in:    tokens.expires_in,
      connected_at:  new Date().toISOString(),
    })

    await prisma.appSetting.upsert({
      where:  { key: 'quickbooks_tokens' },
      update: { value: payload },
      create: { key: 'quickbooks_tokens', value: payload },
    })

    res.redirect(`${webApp}/accounts/dashboard?qb=connected`)
  } catch (err) {
    console.error('[QB callback error]', err)
    res.redirect(`${webApp}/accounts/dashboard?qb=error`)
  }
})

// ── GET /accounts/quickbooks/status ──────────────────────────────────────────
router.get('/status', requireAuth, async (req, res) => {
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: 'quickbooks_tokens' } })
    if (!setting) return res.json({ connected: false })

    const tokens = JSON.parse(setting.value)
    const qbo    = await getQBClient()

    qbo.getCompanyInfo(tokens.realmId, (err: any, info: any) => {
      if (err) return res.json({ connected: false })
      res.json({
        connected:   true,
        companyName: info?.CompanyName,
        realmId:     tokens.realmId,
        connectedAt: tokens.connected_at,
      })
    })
  } catch {
    res.json({ connected: false })
  }
})

// ── POST /accounts/quickbooks/disconnect ─────────────────────────────────────
router.post('/disconnect', requireAuth, async (req, res) => {
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: 'quickbooks_tokens' } })
    if (setting) {
      const tokens      = JSON.parse(setting.value)
      const oauthClient = getOAuthClient()
      oauthClient.setToken(tokens)
      await oauthClient.revoke().catch(() => {})
      await prisma.appSetting.delete({ where: { key: 'quickbooks_tokens' } })
    }
  } catch {}
  res.json({ disconnected: true })
})

// ── GET /accounts/quickbooks/chart-of-accounts ───────────────────────────────
router.get('/chart-of-accounts', requireAuth, async (req, res) => {
  try {
    const qbo  = await getQBClient()
    const data = await qbQuery(qbo, 'SELECT * FROM Account MAXRESULTS 1000')
    res.json({ success: true, data: data.Account || [] })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/invoices ────────────────────────────────────────
router.get('/invoices', requireAuth, async (req, res) => {
  try {
    const qbo  = await getQBClient()
    const data = await qbQuery(qbo, 'SELECT * FROM Invoice ORDERBY TxnDate DESC MAXRESULTS 1000')
    res.json({ success: true, data: data.Invoice || [] })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/expenses ────────────────────────────────────────
router.get('/expenses', requireAuth, async (req, res) => {
  try {
    const qbo  = await getQBClient()
    const data = await qbQuery(qbo, 'SELECT * FROM Purchase ORDERBY TxnDate DESC MAXRESULTS 1000')
    res.json({ success: true, data: data.Purchase || [] })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/bills ───────────────────────────────────────────
router.get('/bills', requireAuth, async (req, res) => {
  try {
    const qbo  = await getQBClient()
    const data = await qbQuery(qbo, 'SELECT * FROM Bill ORDERBY TxnDate DESC MAXRESULTS 1000')
    res.json({ success: true, data: data.Bill || [] })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/payments ────────────────────────────────────────
router.get('/payments', requireAuth, async (req, res) => {
  try {
    const qbo  = await getQBClient()
    const data = await qbQuery(qbo, 'SELECT * FROM Payment ORDERBY TxnDate DESC MAXRESULTS 1000')
    res.json({ success: true, data: data.Payment || [] })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/customers ───────────────────────────────────────
router.get('/customers', requireAuth, async (req, res) => {
  try {
    const qbo  = await getQBClient()
    const data = await qbQuery(qbo, 'SELECT * FROM Customer MAXRESULTS 1000')
    res.json({ success: true, data: data.Customer || [] })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/vendors ─────────────────────────────────────────
router.get('/vendors', requireAuth, async (req, res) => {
  try {
    const qbo  = await getQBClient()
    const data = await qbQuery(qbo, 'SELECT * FROM Vendor MAXRESULTS 1000')
    res.json({ success: true, data: data.Vendor || [] })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/journal-entries ─────────────────────────────────
router.get('/journal-entries', requireAuth, async (req, res) => {
  try {
    const qbo  = await getQBClient()
    const data = await qbQuery(qbo, 'SELECT * FROM JournalEntry ORDERBY TxnDate DESC MAXRESULTS 1000')
    res.json({ success: true, data: data.JournalEntry || [] })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/employees ───────────────────────────────────────
router.get('/employees', requireAuth, async (req, res) => {
  try {
    const qbo  = await getQBClient()
    const data = await qbQuery(qbo, 'SELECT * FROM Employee MAXRESULTS 1000')
    res.json({ success: true, data: data.Employee || [] })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/profit-loss ─────────────────────────────────────
router.get('/profit-loss', requireAuth, async (req, res) => {
  try {
    const qbo  = await getQBClient()
    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]
    const today     = new Date().toISOString().split('T')[0]
    const params = {
      start_date: (req.query.start_date as string) || yearStart,
      end_date:   (req.query.end_date as string)   || today,
      summarize_column_by: 'Month',
    }
    const data = await new Promise((resolve, reject) => {
      qbo.reportProfitAndLoss(params, (err: any, d: any) => {
        if (err) reject(err); else resolve(d)
      })
    })
    res.json({ success: true, data })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/balance-sheet ───────────────────────────────────
router.get('/balance-sheet', requireAuth, async (req, res) => {
  try {
    const qbo    = await getQBClient()
    const params = { as_of: (req.query.as_of as string) || new Date().toISOString().split('T')[0] }
    const data   = await new Promise((resolve, reject) => {
      qbo.reportBalanceSheet(params, (err: any, d: any) => {
        if (err) reject(err); else resolve(d)
      })
    })
    res.json({ success: true, data })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/cash-flow ───────────────────────────────────────
router.get('/cash-flow', requireAuth, async (req, res) => {
  try {
    const qbo       = await getQBClient()
    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]
    const today     = new Date().toISOString().split('T')[0]
    const params = {
      start_date: (req.query.start_date as string) || yearStart,
      end_date:   (req.query.end_date as string)   || today,
    }
    const data = await new Promise((resolve, reject) => {
      qbo.reportCashFlow(params, (err: any, d: any) => {
        if (err) reject(err); else resolve(d)
      })
    })
    res.json({ success: true, data })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── POST /accounts/quickbooks/webhook ────────────────────────────────────────
router.post('/webhook', (req, res) => {
  console.log('[QB Webhook]', JSON.stringify(req.body))
  res.sendStatus(200)
})

export default router
