/**
 * QuickBooks push helpers — fire-and-forget sync from Code Clinic → QB.
 *
 * SAFETY: no delete / void / void operations. Only find, create, update.
 */
import { prisma } from '../lib/prisma'

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const OAuthClient  = require('intuit-oauth')   as any
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const QuickBooks   = require('node-quickbooks') as any

// ─── QB client factory (with auto token-refresh) ─────────────────────────────

function makeOAuthClient() {
  return new OAuthClient({
    clientId:     process.env.QUICKBOOKS_CLIENT_ID!,
    clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
    environment:  process.env.QUICKBOOKS_ENVIRONMENT || 'production',
    redirectUri:  process.env.QUICKBOOKS_REDIRECT_URI!,
  })
}

/**
 * Returns a ready QuickBooks API client, refreshing the access token when
 * it's within 2 minutes of expiry.  Returns null if QB is not connected.
 */
async function getQBClient(): Promise<any | null> {
  const setting = await prisma.appSetting.findUnique({ where: { key: 'quickbooks_tokens' } })
  if (!setting) return null

  const stored     = JSON.parse(setting.value) as Record<string, any>
  const useSandbox = process.env.QUICKBOOKS_ENVIRONMENT !== 'production'

  // Auto-refresh: access tokens last 1 h; refresh 2 min before expiry
  const obtainedAt = stored.access_token_obtained_at
    ?? (stored.connected_at ? new Date(stored.connected_at).getTime() : Date.now() - 7_200_000)
  const expiresAt  = obtainedAt + (stored.expires_in ?? 3600) * 1_000 - 120_000

  if (Date.now() > expiresAt) {
    try {
      const oauthClient = makeOAuthClient()
      oauthClient.setToken({ refresh_token: stored.refresh_token })
      const refreshed = await oauthClient.refreshUsingToken(stored.refresh_token)
      const newTok    = refreshed.getJson() as Record<string, any>
      const updated   = {
        ...stored,
        access_token:              newTok.access_token,
        refresh_token:             newTok.refresh_token ?? stored.refresh_token,
        expires_in:                newTok.expires_in    ?? 3600,
        access_token_obtained_at:  Date.now(),
      }
      await prisma.appSetting.update({
        where:  { key: 'quickbooks_tokens' },
        data:   { value: JSON.stringify(updated) },
      })
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

// ─── Promise wrappers for QB callbacks ───────────────────────────────────────

function qbQuery(qbo: any, query: string): Promise<any> {
  return new Promise((resolve, reject) =>
    qbo.query(query, (err: any, data: any) =>
      err ? reject(err) : resolve(data?.QueryResponse ?? data),
    ),
  )
}

function qbCreate<T>(fn: (cb: (err: any, data: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) =>
    fn((err, data) => err ? reject(err) : resolve(data)),
  )
}

// ─── Find-or-create helpers ───────────────────────────────────────────────────

async function findOrCreateCustomer(
  qbo: any,
  displayName: string,
  phone?: string,
  email?: string,
): Promise<string> {
  const safeName = (displayName || 'Unknown Patient').replace(/'/g, "''").substring(0, 100)
  try {
    const res = await qbQuery(qbo, `SELECT * FROM Customer WHERE DisplayName = '${safeName}' MAXRESULTS 1`)
    if (res.Customer?.length) return res.Customer[0].Id as string
  } catch { /* customer not found — fall through to create */ }

  const payload: Record<string, any> = { DisplayName: safeName }
  if (phone) payload.PrimaryPhone    = { FreeFormNumber: phone }
  if (email) payload.PrimaryEmailAddr = { Address: email }

  const created = await qbCreate<any>(cb => qbo.createCustomer(payload, cb))
  return created.Id as string
}

async function getOrCreateDefaultItem(qbo: any): Promise<string> {
  const cached = await prisma.appSetting.findUnique({ where: { key: 'qb_default_item_id' } })
  if (cached) return cached.value

  try {
    const res = await qbQuery(qbo, "SELECT * FROM Item WHERE Type = 'Service' MAXRESULTS 1")
    if (res.Item?.length) {
      const id = res.Item[0].Id as string
      await prisma.appSetting.upsert({
        where:  { key: 'qb_default_item_id' },
        update: { value: id },
        create: { key: 'qb_default_item_id', value: id },
      })
      return id
    }
  } catch { /* no items yet — create one */ }

  // Need an income account to back the new item
  const acctRes = await qbQuery(qbo, "SELECT * FROM Account WHERE AccountType = 'Income' MAXRESULTS 1")
  if (!acctRes.Account?.length) throw new Error('[QB] No Income account found; cannot create default item')

  const item = await qbCreate<any>(cb => qbo.createItem({
    Name:              'Clinic Services',
    Type:              'Service',
    IncomeAccountRef:  { value: acctRes.Account[0].Id },
  }, cb))

  await prisma.appSetting.upsert({
    where:  { key: 'qb_default_item_id' },
    update: { value: item.Id },
    create: { key: 'qb_default_item_id', value: item.Id },
  })
  return item.Id as string
}

async function getDefaultExpenseAccount(qbo: any): Promise<string> {
  const cached = await prisma.appSetting.findUnique({ where: { key: 'qb_default_expense_account_id' } })
  if (cached) return cached.value

  const res = await qbQuery(qbo, "SELECT * FROM Account WHERE AccountType = 'Expense' MAXRESULTS 1")
  if (!res.Account?.length) throw new Error('[QB] No Expense account found in QuickBooks')

  const id = res.Account[0].Id as string
  await prisma.appSetting.upsert({
    where:  { key: 'qb_default_expense_account_id' },
    update: { value: id },
    create: { key: 'qb_default_expense_account_id', value: id },
  })
  return id
}

async function getDefaultDepositAccount(qbo: any): Promise<string> {
  const cached = await prisma.appSetting.findUnique({ where: { key: 'qb_default_deposit_account_id' } })
  if (cached) return cached.value

  // Prefer "Undeposited Funds" which exists in every QB company
  try {
    const res = await qbQuery(qbo, "SELECT * FROM Account WHERE Name = 'Undeposited Funds' MAXRESULTS 1")
    if (res.Account?.length) {
      const id = res.Account[0].Id as string
      await prisma.appSetting.upsert({
        where:  { key: 'qb_default_deposit_account_id' },
        update: { value: id },
        create: { key: 'qb_default_deposit_account_id', value: id },
      })
      return id
    }
  } catch { /* fall through to bank */ }

  const bankRes = await qbQuery(qbo, "SELECT * FROM Account WHERE AccountType = 'Bank' MAXRESULTS 1")
  if (!bankRes.Account?.length) throw new Error('[QB] No Bank account found in QuickBooks')

  const id = bankRes.Account[0].Id as string
  await prisma.appSetting.upsert({
    where:  { key: 'qb_default_deposit_account_id' },
    update: { value: id },
    create: { key: 'qb_default_deposit_account_id', value: id },
  })
  return id
}

// ─── Public push functions ────────────────────────────────────────────────────

/**
 * Push a Code Clinic invoice to QuickBooks.
 * Idempotent: skips if already SYNCED.
 */
export async function pushInvoiceToQB(invoiceId: string): Promise<void> {
  const qbo = await getQBClient()
  if (!qbo) return  // QB not connected

  const invoice = await prisma.invoice.findUnique({
    where:   { id: invoiceId },
    include: { patient: true },
  })
  if (!invoice) return
  if (invoice.qbSyncStatus === 'SYNCED' && invoice.qbInvoiceId) return

  try {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { qbSyncStatus: 'PENDING' } })

    const patientName = `${invoice.patient.firstName} ${invoice.patient.lastName}`.trim()

    let qbCustomerId = (invoice.qbCustomerId ?? undefined) as string | undefined
    if (!qbCustomerId) {
      qbCustomerId = await findOrCreateCustomer(
        qbo,
        patientName,
        invoice.patient.phone  ?? undefined,
        invoice.patient.email  ?? undefined,
      )
    }

    const defaultItemId = await getOrCreateDefaultItem(qbo)

    let lineItems: Array<{ description?: string; unitPrice: number; quantity: number }> = []
    try { lineItems = JSON.parse(invoice.lineItems) } catch { /* malformed — use total as single line */ }

    const qbLines = lineItems.length
      ? lineItems.map(item => ({
          DetailType:            'SalesItemLineDetail',
          Amount:                Math.round(item.unitPrice * item.quantity),
          Description:           item.description ?? 'Service',
          SalesItemLineDetail:   {
            ItemRef:   { value: defaultItemId },
            Qty:       item.quantity ?? 1,
            UnitPrice: item.unitPrice ?? 0,
          },
        }))
      : [{
          DetailType:          'SalesItemLineDetail',
          Amount:              invoice.totalUGX,
          Description:         `Invoice ${invoice.invoiceNumber}`,
          SalesItemLineDetail: { ItemRef: { value: defaultItemId }, Qty: 1, UnitPrice: invoice.totalUGX },
        }]

    const today      = new Date().toISOString().split('T')[0]
    const qbInvoice  = await qbCreate<any>(cb => qbo.createInvoice({
      CustomerRef: { value: qbCustomerId },
      DocNumber:   invoice.invoiceNumber,
      TxnDate:     today,
      ...(invoice.dueDate ? { DueDate: invoice.dueDate.toISOString().split('T')[0] } : {}),
      Line:        qbLines,
    }, cb))

    await prisma.invoice.update({
      where: { id: invoiceId },
      data:  {
        qbInvoiceId:  qbInvoice.Id,
        qbCustomerId,
        qbSyncStatus: 'SYNCED',
        qbSyncedAt:   new Date(),
      },
    })
    console.log(`[QB] Invoice ${invoice.invoiceNumber} → QB #${qbInvoice.Id}`)
  } catch (err: any) {
    console.error('[QB] pushInvoiceToQB failed:', err?.Fault?.Error?.[0]?.Detail ?? err?.message ?? err)
    await prisma.invoice.update({ where: { id: invoiceId }, data: { qbSyncStatus: 'FAILED' } }).catch(() => {})
  }
}

/**
 * Push a Code Clinic payment to QuickBooks, linked to its QB invoice.
 * Idempotent: skips if already synced.
 */
export async function pushPaymentToQB(paymentId: string): Promise<void> {
  const qbo = await getQBClient()
  if (!qbo) return

  const payment = await prisma.payment.findUnique({
    where:   { id: paymentId },
    include: { invoice: { include: { patient: true } } },
  })
  if (!payment || payment.qbPaymentId) return

  // Ensure the invoice is in QB first
  if (!payment.invoice.qbInvoiceId) {
    await pushInvoiceToQB(payment.invoice.id)
    const refreshed = await prisma.invoice.findUnique({ where: { id: payment.invoice.id } })
    if (!refreshed?.qbInvoiceId) return  // invoice push failed
    ;(payment.invoice as any).qbInvoiceId  = refreshed.qbInvoiceId
    ;(payment.invoice as any).qbCustomerId = refreshed.qbCustomerId
  }

  try {
    const inv            = payment.invoice as any
    let   qbCustomerId   = inv.qbCustomerId as string | undefined
    if (!qbCustomerId) {
      const name     = `${inv.patient.firstName} ${inv.patient.lastName}`.trim()
      qbCustomerId   = await findOrCreateCustomer(qbo, name, inv.patient.phone ?? undefined)
    }

    const depositAccountId = await getDefaultDepositAccount(qbo)

    const qbPayment = await qbCreate<any>(cb => qbo.createPayment({
      CustomerRef:          { value: qbCustomerId },
      TotalAmt:             payment.amountUGX,
      TxnDate:              payment.paidAt.toISOString().split('T')[0],
      DepositToAccountRef:  { value: depositAccountId },
      Line: [{
        Amount:    payment.amountUGX,
        LinkedTxn: [{ TxnId: inv.qbInvoiceId, TxnType: 'Invoice' }],
      }],
    }, cb))

    await prisma.payment.update({ where: { id: paymentId }, data: { qbPaymentId: qbPayment.Id } })
    console.log(`[QB] Payment ${paymentId} → QB #${qbPayment.Id}`)
  } catch (err: any) {
    console.error('[QB] pushPaymentToQB failed:', err?.Fault?.Error?.[0]?.Detail ?? err?.message ?? err)
  }
}

/**
 * Push a Code Clinic expense to QuickBooks as a Purchase record.
 * Idempotent: skips if already synced.
 */
export async function pushExpenseToQB(expenseId: string): Promise<void> {
  const qbo = await getQBClient()
  if (!qbo) return

  const expense = await prisma.expense.findUnique({ where: { id: expenseId } })
  if (!expense || expense.qbPurchaseId) return

  try {
    const expenseAccountId = await getDefaultExpenseAccount(qbo)

    const qbPurchase = await qbCreate<any>(cb => qbo.createPurchase({
      AccountRef:  { value: expenseAccountId },
      PaymentType: 'Cash',
      TxnDate:     expense.date.toISOString().split('T')[0],
      TotalAmt:    expense.amountUGX,
      Line: [{
        DetailType:                       'AccountBasedExpenseLineDetail',
        Amount:                           expense.amountUGX,
        Description:                      `${expense.category}: ${expense.description}`,
        AccountBasedExpenseLineDetail:    { AccountRef: { value: expenseAccountId } },
      }],
    }, cb))

    await prisma.expense.update({ where: { id: expenseId }, data: { qbPurchaseId: qbPurchase.Id } })
    console.log(`[QB] Expense ${expenseId} → QB Purchase #${qbPurchase.Id}`)
  } catch (err: any) {
    console.error('[QB] pushExpenseToQB failed:', err?.Fault?.Error?.[0]?.Detail ?? err?.message ?? err)
  }
}
