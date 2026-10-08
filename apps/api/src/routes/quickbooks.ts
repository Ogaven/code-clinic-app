import { Router } from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
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
export async function getQBClient() {
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

export function fetchQuickBooksCollection(qbo: any, method: string, entity: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const finder = qbo?.[method]
    if (typeof finder !== 'function') {
      return reject(new Error(`QuickBooks SDK does not support ${method}`))
    }
    finder.call(qbo, { fetchAll: true }, (err: any, data: any) => {
      if (err) return reject(err)
      // node-quickbooks returns a plain entity array when fetchAll is enabled.
      // Keep QueryResponse support for non-fetchAll/mocked responses.
      const rows = Array.isArray(data)
        ? data
        : (data?.QueryResponse?.[entity] ?? data?.[entity] ?? [])
      resolve(Array.isArray(rows) ? rows : [])
    })
  })
}

function newestFirst(rows: any[]): any[] {
  return [...rows].sort((a, b) => String(b?.TxnDate ?? '').localeCompare(String(a?.TxnDate ?? '')))
}

// Independent read-only diagnostics used by the reconciliation audit. Count
// queries and financial reports do not create or modify QuickBooks records.
function fetchQuickBooksCount(qbo: any, method: string): Promise<number | null> {
  return new Promise(resolve => {
    const finder = qbo?.[method]
    if (typeof finder !== 'function') return resolve(null)
    finder.call(qbo, { count: true }, (err: any, data: any) => {
      if (err) return resolve(null)
      const value = data?.QueryResponse?.totalCount ?? data?.totalCount
      const count = Number(value)
      resolve(Number.isFinite(count) ? count : null)
    })
  })
}

function reportHasData(report: any): boolean | null {
  if (!report || typeof report !== 'object') return null
  const noDataOption = report?.Header?.Option?.find?.((option: any) => option?.Name === 'NoReportData')?.Value
  if (String(noDataOption).toLowerCase() === 'true') return false
  const rows = report?.Rows?.Row
  if (Array.isArray(rows) && rows.length > 0) return true
  return noDataOption != null ? String(noDataOption).toLowerCase() !== 'true' : false
}

function fetchQuickBooksReportEvidence(qbo: any): Promise<{ profitAndLossHasData: boolean | null; balanceSheetHasData: boolean | null }> {
  const today = new Date().toISOString().split('T')[0]
  const profitAndLoss = new Promise<boolean | null>(resolve => {
    qbo.reportProfitAndLoss({ date_macro: 'All' }, (err: any, data: any) => resolve(err ? null : reportHasData(data)))
  })
  const balanceSheet = new Promise<boolean | null>(resolve => {
    qbo.reportBalanceSheet({ as_of: today }, (err: any, data: any) => resolve(err ? null : reportHasData(data)))
  })
  return Promise.all([profitAndLoss, balanceSheet]).then(([profitAndLossHasData, balanceSheetHasData]) => ({ profitAndLossHasData, balanceSheetHasData }))
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
// Reconciles QuickBooks payments into existing Code Clinic invoices. This is
// read-only against QuickBooks: it never creates, edits, voids or deletes QB data.
router.post('/sync', requireAuth, async (_req, res) => {
  try {
    const result = await reconcileQuickBooksPayments()
    clearQBCache()
    res.json({ synced: true, ...result })
  } catch (err: any) {
    console.error('[QB Sync] payment reconciliation failed:', err?.message ?? err)
    res.status(400).json({ error: err?.message ?? 'QuickBooks reconciliation failed' })
  }
})

// ─── READ endpoints (all cached 5 minutes) ───────────────────────────────────

// ── GET /accounts/quickbooks/chart-of-accounts ───────────────────────────────
router.get('/chart-of-accounts', requireAuth, async (_req, res) => {
  const cacheKey = 'chart-of-accounts'
  const hit = getCached(cacheKey)
  if (hit) return res.json({ success: true, data: hit, cached: true })
  try {
    const qbo  = await getQBClient()
    const list = await fetchQuickBooksCollection(qbo, 'findAccounts', 'Account')
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
    const list = newestFirst(await fetchQuickBooksCollection(qbo, 'findInvoices', 'Invoice'))
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
    const list = newestFirst(await fetchQuickBooksCollection(qbo, 'findPurchases', 'Purchase'))
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
    const list = newestFirst(await fetchQuickBooksCollection(qbo, 'findBills', 'Bill'))
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
    const list = newestFirst(await fetchQuickBooksCollection(qbo, 'findPayments', 'Payment'))
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
    const list = await fetchQuickBooksCollection(qbo, 'findCustomers', 'Customer')
    setCached(cacheKey, list)
    res.json({ success: true, data: list })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// ── GET /accounts/quickbooks/audit/patient-reconciliation ───────────────────
// Strictly read-only audit. Compares QuickBooks customers with Code Clinic
// patients and invoice-linked QB customer IDs. It never creates, links, edits,
// merges or deletes records in either system.
router.get('/audit/patient-reconciliation', requireAuth, async (_req, res) => {
  try {
    const tokenSetting = await prisma.appSetting.findUnique({ where: { key: 'quickbooks_tokens' } })
    if (!tokenSetting) throw new Error('QuickBooks not connected')
    const storedTokens = JSON.parse(tokenSetting.value) as Record<string, any>
    const qbo = await getQBClient()
    const liveCompanyInfo = await new Promise<any>((resolve, reject) => {
      qbo.getCompanyInfo(storedTokens.realmId, (err: any, info: any) => err ? reject(err) : resolve(info))
    })
    // Cloudflare returns an HTML 524 after its origin timeout. Fail earlier
    // with an actionable JSON error rather than leaving the browser waiting.
    const auditDeadline = <T>(work: Promise<T>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('QuickBooks audit timed out while reading company data. Please retry; no records were changed.')), 45_000)
        work.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
      })
    const [qbCustomers, qbInvoices, qbPayments, qbPurchases, qbCounts, reportEvidence] = await auditDeadline(Promise.all([
      fetchQuickBooksCollection(qbo, 'findCustomers', 'Customer'),
      fetchQuickBooksCollection(qbo, 'findInvoices', 'Invoice'),
      fetchQuickBooksCollection(qbo, 'findPayments', 'Payment'),
      fetchQuickBooksCollection(qbo, 'findPurchases', 'Purchase'),
      Promise.all([
        fetchQuickBooksCount(qbo, 'findCustomers'),
        fetchQuickBooksCount(qbo, 'findInvoices'),
        fetchQuickBooksCount(qbo, 'findPayments'),
        fetchQuickBooksCount(qbo, 'findPurchases'),
      ]),
      fetchQuickBooksReportEvidence(qbo),
    ]))
    // Cross-entity evidence helps distinguish an actually empty QB company from
    // a customer-list problem without exposing transaction or patient details.
    const invoiceCustomerRefs = new Set(
      qbInvoices.map((invoice: any) => String(invoice?.CustomerRef?.value ?? '')).filter(Boolean),
    )
    const paymentCustomerRefs = new Set(
      qbPayments.map((payment: any) => String(payment?.CustomerRef?.value ?? '')).filter(Boolean),
    )
    const referencedCustomerIds = new Set([...invoiceCustomerRefs, ...paymentCustomerRefs])
    const patients = await prisma.patient.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        invoices: {
          where: { qbCustomerId: { not: null } },
          select: { qbCustomerId: true, qbInvoiceId: true, qbSyncStatus: true },
        },
      },
    })

    const normalizeText = (value: unknown) =>
      String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
    const normalizePhone = (value: unknown) => String(value ?? '').replace(/\D/g, '')
    const phoneKeys = (value: unknown) => {
      const digits = normalizePhone(value)
      if (!digits) return []
      const keys = new Set([digits])
      // Uganda numbers are commonly stored as 07..., 2567... or +2567....
      if (digits.startsWith('256') && digits.length >= 12) keys.add('0' + digits.slice(3))
      if (digits.startsWith('0') && digits.length >= 10) keys.add('256' + digits.slice(1))
      return [...keys]
    }

    const qbById = new Map(qbCustomers.map((customer: any) => [String(customer?.Id ?? ''), customer]))
    const patientById = new Map(patients.map(patient => [patient.id, patient]))

    const exactLinks: Array<{ patientId: string; qbCustomerId: string; basis: string }> = []
    const brokenInvoiceLinks: Array<{ patientId: string; qbCustomerId: string }> = []
    for (const patient of patients) {
      const linkedIds = [...new Set(patient.invoices.map(invoice => invoice.qbCustomerId).filter(Boolean) as string[])]
      for (const qbCustomerId of linkedIds) {
        if (qbById.has(qbCustomerId)) exactLinks.push({ patientId: patient.id, qbCustomerId, basis: 'invoice_qb_customer_id' })
        else brokenInvoiceLinks.push({ patientId: patient.id, qbCustomerId })
      }
    }

    const linkedPatientIds = new Set(exactLinks.map(link => link.patientId))
    const linkedQbIds = new Set(exactLinks.map(link => link.qbCustomerId))
    const candidateMatches: Array<{
      patientId: string
      qbCustomerId: string
      signals: string[]
      confidence: 'strong' | 'review'
    }> = []

    for (const patient of patients) {
      if (linkedPatientIds.has(patient.id)) continue
      const patientName = normalizeText(`${patient.firstName} ${patient.lastName}`)
      const patientEmail = normalizeText(patient.email)
      const patientPhones = new Set(phoneKeys(patient.phone))

      for (const customer of qbCustomers as any[]) {
        const qbCustomerId = String(customer?.Id ?? '')
        if (!qbCustomerId || linkedQbIds.has(qbCustomerId)) continue

        const qbName = normalizeText(customer?.DisplayName || [customer?.GivenName, customer?.FamilyName].filter(Boolean).join(' '))
        const qbEmail = normalizeText(customer?.PrimaryEmailAddr?.Address)
        const qbPhones = phoneKeys(customer?.PrimaryPhone?.FreeFormNumber)
        const signals: string[] = []
        if (patientEmail && qbEmail && patientEmail === qbEmail) signals.push('email')
        if (patientPhones.size && qbPhones.some(phone => patientPhones.has(phone))) signals.push('phone')
        if (patientName && qbName && patientName === qbName) signals.push('name')
        if (!signals.length) continue

        const strong = signals.includes('email') || signals.includes('phone') || signals.length >= 2
        candidateMatches.push({
          patientId: patient.id,
          qbCustomerId,
          signals,
          confidence: strong ? 'strong' : 'review',
        })
      }
    }

    const candidatePatientIds = new Set(candidateMatches.map(match => match.patientId))
    const candidateQbIds = new Set(candidateMatches.map(match => match.qbCustomerId))
    const codeClinicOnly = patients
      .filter(patient => !linkedPatientIds.has(patient.id) && !candidatePatientIds.has(patient.id))
      .map(patient => patient.id)
    const quickBooksOnly = (qbCustomers as any[])
      .map(customer => String(customer?.Id ?? ''))
      .filter(id => id && !linkedQbIds.has(id) && !candidateQbIds.has(id))

    const linkedInvoices = patients.flatMap(patient => patient.invoices)
    res.json({
      success: true,
      readOnly: true,
      generatedAt: new Date().toISOString(),
      connection: {
        environment: process.env.QUICKBOOKS_ENVIRONMENT || 'production',
        realmId: String(storedTokens.realmId ?? ''),
        companyName: String(liveCompanyInfo?.CompanyName ?? liveCompanyInfo?.QueryResponse?.CompanyInfo?.[0]?.CompanyName ?? ''),
        connectedAt: storedTokens.connected_at ?? null,
        liveCompanyInfoVerified: true,
      },
      diagnostics: {
        // Independent QBO count queries let us distinguish a collection parser
        // problem from a genuinely empty API result without exposing records.
        countQuery: {
          customers: qbCounts[0],
          invoices: qbCounts[1],
          payments: qbCounts[2],
          purchases: qbCounts[3],
        },
        reports: reportEvidence,
      },
      summary: {
        codeClinicPatients: patients.length,
        quickBooksCustomers: qbCustomers.length,
        quickBooksInvoices: qbInvoices.length,
        quickBooksPayments: qbPayments.length,
        quickBooksPurchases: qbPurchases.length,
        quickBooksReferencedCustomers: referencedCustomerIds.size,
        exactLinkedPatients: linkedPatientIds.size,
        exactLinkedQuickBooksCustomers: linkedQbIds.size,
        candidateMatches: candidateMatches.length,
        strongCandidates: candidateMatches.filter(match => match.confidence === 'strong').length,
        reviewCandidates: candidateMatches.filter(match => match.confidence === 'review').length,
        codeClinicOnly: codeClinicOnly.length,
        quickBooksOnly: quickBooksOnly.length,
        invoiceQbLinks: linkedInvoices.length,
        brokenInvoiceQbCustomerLinks: brokenInvoiceLinks.length,
      },
      // IDs and match signals are returned for authorized staff review; no
      // automatic linking is performed and no clinical data is included.
      exactLinks,
      candidateMatches,
      codeClinicOnlyPatientIds: codeClinicOnly,
      quickBooksOnlyCustomerIds: quickBooksOnly,
      brokenInvoiceLinks,
    })
  } catch (err: any) {
    console.error('[QB Audit] patient reconciliation failed:', err?.message ?? err)
    res.status(400).json({ error: err?.message ?? 'QuickBooks patient reconciliation audit failed' })
  }
})

// ── GET /accounts/quickbooks/vendors ─────────────────────────────────────────
router.get('/vendors', requireAuth, async (_req, res) => {
  const cacheKey = 'vendors'
  const hit = getCached(cacheKey)
  if (hit) return res.json({ success: true, data: hit, cached: true })
  try {
    const qbo  = await getQBClient()
    const list = await fetchQuickBooksCollection(qbo, 'findVendors', 'Vendor')
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
    const list = newestFirst(await fetchQuickBooksCollection(qbo, 'findJournalEntries', 'JournalEntry'))
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
    const list = await fetchQuickBooksCollection(qbo, 'findEmployees', 'Employee')
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


// Intuit's production webhook can arrive in the legacy eventNotifications
// envelope when "cloud event payload format" is disabled. Keep support for
// the CloudEvent-style array as well so changing that Intuit setting later
// does not silently drop payment events.
export function normalizeQuickBooksWebhookEvents(body: any): Array<{
  entityName: string
  operation: string
  realmId: string
  entityId: string
}> {
  if (Array.isArray(body)) {
    return body.map((event: any) => {
      const type = String(event?.type || '')
      const parts = type.split('.').filter(Boolean)
      return {
        entityName: String(event?.entityName || (type.toLowerCase().includes('.payment.') ? 'Payment' : '')),
        operation: String(event?.operation || parts[parts.length - 1] || ''),
        realmId: String(event?.intuitaccountid || ''),
        entityId: String(event?.intuitentityid || ''),
      }
    })
  }

  const notifications = Array.isArray(body?.eventNotifications) ? body.eventNotifications : []
  return notifications.flatMap((notification: any) => {
    const realmId = String(notification?.realmId || '')
    const entities = Array.isArray(notification?.dataChangeEvent?.entities)
      ? notification.dataChangeEvent.entities
      : []
    return entities.map((entity: any) => ({
      entityName: String(entity?.name || ''),
      operation: String(entity?.operation || ''),
      realmId,
      entityId: String(entity?.id || ''),
    }))
  })
}

// ── POST /accounts/quickbooks/webhook ────────────────────────────────────────
// Intuit requires HMAC-SHA256 verification of the exact raw payload. This
// endpoint fails closed until the Production Webhooks Verifier Token is set.
router.post('/webhook', async (req, res) => {
  const verifier = process.env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN
  const signature = req.get('intuit-signature') || ''
  const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody

  if (!verifier || !rawBody || !signature) {
    console.warn('[QB Webhook] rejected: verifier token/signature/raw body unavailable')
    return res.sendStatus(401)
  }

  const expected = crypto.createHmac('sha256', verifier).update(rawBody).digest('base64')
  const valid = expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  if (!valid) return res.sendStatus(401)

  // Acknowledge after authentication; processing is intentionally asynchronous
  // so Intuit is not kept waiting on QuickBooks API reads.
  res.sendStatus(200)

  try {
    const stored = await prisma.appSetting.findUnique({ where: { key: 'quickbooks_tokens' } })
    if (!stored) return
    const connectedRealm = String(JSON.parse(stored.value).realmId || '')
    const events = normalizeQuickBooksWebhookEvents(req.body)

    for (const event of events) {
      if (event.entityName.toLowerCase() !== 'payment' || !event.entityId || event.realmId !== connectedRealm) continue
      if (event.operation.toLowerCase() === 'delete') {
        await markQuickBooksPaymentReversed(event.entityId, 'Deleted in QuickBooks')
        continue
      }
      await syncQuickBooksPayment(event.entityId)
    }
  } catch (e: any) {
    console.error('[QB Webhook] processing failed:', e?.message ?? e)
  }
})

async function recalculateInvoicePaymentState(tx: any, invoiceId: string): Promise<void> {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { totalUGX: true, status: true, dueDate: true },
  })
  if (!invoice) return

  const aggregate = await tx.payment.aggregate({
    where: { invoiceId },
    _sum: { amountUGX: true },
  })
  const paidUGX = aggregate._sum.amountUGX || 0
  let status = invoice.status
  if (status !== 'DRAFT' && status !== 'CANCELLED') {
    status = paidUGX >= invoice.totalUGX
      ? 'PAID'
      : paidUGX > 0
        ? 'PARTIAL'
        : invoice.dueDate && invoice.dueDate.getTime() < Date.now()
          ? 'OVERDUE'
          : 'SENT'
  }

  await tx.invoice.update({
    where: { id: invoiceId },
    data: { paidUGX, status },
  })
}

async function markQuickBooksPaymentReversed(qbPaymentId: string, reason: string): Promise<number> {
  const payments = await prisma.payment.findMany({
    where: { qbPaymentId },
    select: { id: true, invoiceId: true },
  })
  if (!payments.length) return 0

  await prisma.$transaction(async tx => {
    for (const payment of payments) {
      // Preserve the mirror row for auditability instead of deleting financial history.
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          amountUGX: 0,
          method: 'QUICKBOOKS_VOIDED',
          notes: reason,
        },
      })
    }
    for (const invoiceId of [...new Set(payments.map(payment => payment.invoiceId))]) {
      await recalculateInvoicePaymentState(tx, invoiceId)
    }
  })
  clearQBCache()
  return payments.length
}

export async function syncQuickBooksPaymentObject(qbPayment: any): Promise<{ matched: number; skipped: number }> {
  const qbPaymentId = String(qbPayment?.Id || '')
  if (!qbPaymentId) return { matched: 0, skipped: 1 }

  const isVoided = Number(qbPayment?.TotalAmt || 0) === 0 &&
    String(qbPayment?.PrivateNote || '').toLowerCase().includes('void')
  if (isVoided) {
    const matched = await markQuickBooksPaymentReversed(qbPaymentId, 'Voided in QuickBooks')
    return { matched, skipped: matched ? 0 : 1 }
  }

  const linked = (qbPayment?.Line || []).flatMap((line: any) =>
    (line?.LinkedTxn || [])
      .filter((txn: any) => txn?.TxnType === 'Invoice' && txn?.TxnId)
      .map((txn: any) => ({ qbInvoiceId: String(txn.TxnId), amountUGX: Math.round(Number(line.Amount || 0)) })),
  ).filter((row: any) => row.amountUGX > 0)

  if (!linked.length) return { matched: 0, skipped: 1 }

  let matched = 0
  let skipped = 0
  for (const row of linked) {
    const invoices = await prisma.invoice.findMany({
      where: { qbInvoiceId: row.qbInvoiceId },
      select: { id: true, patientId: true },
      take: 2,
    })
    // Never infer identity: exactly one existing Code Clinic invoice must own
    // this QB invoice ID, otherwise leave the event untouched for review.
    if (invoices.length !== 1) {
      console.warn(`[QB Webhook] Payment ${qbPaymentId}: invoice ${row.qbInvoiceId} has ${invoices.length} Code Clinic matches; skipped`)
      skipped += 1
      continue
    }
    const invoice = invoices[0]

    await prisma.$transaction(async tx => {
      const existing = await tx.payment.findFirst({ where: { qbPaymentId, invoiceId: invoice.id } })
      const paidAt = qbPayment?.TxnDate ? new Date(`${qbPayment.TxnDate}T12:00:00.000Z`) : new Date()
      const reference = qbPayment?.PaymentRefNum ? String(qbPayment.PaymentRefNum) : null

      if (existing) {
        await tx.payment.update({
          where: { id: existing.id },
          data: { amountUGX: row.amountUGX, paidAt, reference, method: 'QUICKBOOKS', notes: 'Synced from QuickBooks' },
        })
      } else {
        await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            patientId: invoice.patientId,
            amountUGX: row.amountUGX,
            method: 'QUICKBOOKS',
            reference,
            paidAt,
            qbPaymentId,
            notes: 'Synced from QuickBooks',
          },
        })
      }

      await recalculateInvoicePaymentState(tx, invoice.id)
    })
    matched += 1
  }
  clearQBCache()
  return { matched, skipped }
}

async function syncQuickBooksPayment(qbPaymentId: string): Promise<void> {
  const qbo = await getQBClient()
  const qbPayment: any = await new Promise((resolve, reject) =>
    qbo.getPayment(qbPaymentId, (err: any, payment: any) => err ? reject(err) : resolve(payment)),
  )
  await syncQuickBooksPaymentObject(qbPayment)
}

export function fetchAllQuickBooksPayments(qbo: any): Promise<any[]> {
  return new Promise((resolve, reject) =>
    qbo.findPayments({ fetchAll: true }, (err: any, data: any) => {
      if (err) return reject(err)
      const payments = Array.isArray(data)
        ? data
        : (data?.QueryResponse?.Payment ?? data?.Payment ?? [])
      resolve(Array.isArray(payments) ? payments : [])
    }),
  )
}

async function reconcileQuickBooksPayments(): Promise<{ paymentsScanned: number; invoiceMatches: number; skipped: number }> {
  const qbo = await getQBClient()
  const payments = await fetchAllQuickBooksPayments(qbo)
  let paymentsScanned = 0
  let invoiceMatches = 0
  let skipped = 0

  // node-quickbooks exposes entity-specific find methods rather than a generic
  // query() method. fetchAll makes the SDK paginate up to its 1000-row page cap.
  for (const payment of payments) {
    const result = await syncQuickBooksPaymentObject(payment)
    paymentsScanned += 1
    invoiceMatches += result.matched
    skipped += result.skipped
  }

  return { paymentsScanned, invoiceMatches, skipped }
}

export default router
