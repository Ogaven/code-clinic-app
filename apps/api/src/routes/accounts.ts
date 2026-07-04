import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { generateInvoiceNumber, calculateNetPay } from '../services/accounts/ugandaTax'
import { prisma } from '../lib/prisma'
import { pushInvoiceToQB, pushPaymentToQB, pushExpenseToQB } from '../services/qbPush'
import { logAudit } from '../services/audit.service'

const router = Router()

// ── Helper: serialise fields ──────────────────────────────────────────────────
function serialise(obj: any): any {
  return JSON.parse(JSON.stringify(obj))
}

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════

router.get('/dashboard', requireAuth, async (_req: Request, res: Response) => {
  try {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yearStart  = new Date(now.getFullYear(), 0, 1)

    // Revenue this month (paid invoices)
    const monthRevAgg = await prisma.payment.aggregate({
      _sum: { amountUGX: true },
      where: { paidAt: { gte: monthStart } },
    })

    // Revenue today
    const todayRevAgg = await prisma.payment.aggregate({
      _sum: { amountUGX: true },
      where: { paidAt: { gte: todayStart } },
    })

    // Revenue this year
    const yearRevAgg = await prisma.payment.aggregate({
      _sum: { amountUGX: true },
      where: { paidAt: { gte: yearStart } },
    })

    // Outstanding debt (SENT + OVERDUE invoices)
    const debtAgg = await prisma.invoice.aggregate({
      _sum: { totalUGX: true },
      where: { status: { in: ['SENT', 'OVERDUE'] } },
    })

    // Expenses this month
    const expAgg = await prisma.expense.aggregate({
      _sum: { amountUGX: true },
      where: { date: { gte: monthStart } },
    })

    // Unpaid invoices count
    const unpaidCount = await prisma.invoice.count({ where: { status: { in: ['SENT', 'OVERDUE'] } } })

    // Recent invoices (last 10)
    const recentInvoices = await prisma.invoice.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { patient: { select: { firstName: true, lastName: true } } },
    })

    // Monthly revenue trend (last 6 months)
    const trend = await Promise.all(
      Array.from({ length: 6 }).map(async (_, i) => {
        const d = new Date()
        d.setMonth(d.getMonth() - (5 - i))
        const start = new Date(d.getFullYear(), d.getMonth(), 1)
        const end   = new Date(d.getFullYear(), d.getMonth() + 1, 1)
        const agg = await prisma.payment.aggregate({
          _sum: { amountUGX: true },
          where: { paidAt: { gte: start, lt: end } },
        })
        return {
          month: start.toLocaleString('en-UG', { month: 'short' }),
          revenue: Number(agg._sum.amountUGX || 0),
        }
      })
    )

    // Expense trend (last 6 months)
    const expenseTrend = await Promise.all(
      Array.from({ length: 6 }).map(async (_, i) => {
        const d = new Date()
        d.setMonth(d.getMonth() - (5 - i))
        const start = new Date(d.getFullYear(), d.getMonth(), 1)
        const end   = new Date(d.getFullYear(), d.getMonth() + 1, 1)
        const agg = await prisma.expense.aggregate({
          _sum: { amountUGX: true },
          where: { date: { gte: start, lt: end } },
        })
        return {
          month: start.toLocaleString('en-UG', { month: 'short' }),
          expenses: Number(agg._sum.amountUGX || 0),
        }
      })
    )

    const combined = trend.map((t, i) => ({ ...t, expenses: expenseTrend[i].expenses }))

    res.json(serialise({
      todayRevenue:  Number(todayRevAgg._sum.amountUGX  || 0),
      monthRevenue:  Number(monthRevAgg._sum.amountUGX  || 0),
      yearRevenue:   Number(yearRevAgg._sum.amountUGX   || 0),
      outstandingDebt: Number(debtAgg._sum.totalUGX     || 0),
      monthExpenses: Number(expAgg._sum.amountUGX       || 0),
      unpaidInvoices: unpaidCount,
      recentInvoices: serialise(recentInvoices),
      trend: combined,
    }))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch dashboard' })
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// INVOICES
// ══════════════════════════════════════════════════════════════════════════════

router.get('/invoices', requireAuth, async (req: Request, res: Response) => {
  try {
    const { status, patientId, from, to, limit = '50', offset = '0' } = req.query as Record<string, string>
    const where: any = {}
    if (status) where.status = status
    if (patientId) where.patientId = patientId
    if (from || to) where.createdAt = {}
    if (from) where.createdAt.gte = new Date(from)
    if (to) where.createdAt.lte = new Date(to)

    const [total, invoices] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        take: parseInt(limit),
        skip: parseInt(offset),
        orderBy: { createdAt: 'desc' },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
          appointment: { select: { id: true, startAt: true } },
          payments: true,
        },
      }),
    ])

    res.json(serialise({ total, data: invoices }))
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch invoices' })
  }
})

router.post('/invoices', requireAuth, async (req: Request, res: Response) => {
  const { patientId, appointmentId, lineItems, dueDate, applyVAT } = req.body
  if (!patientId || !lineItems?.length) {
    return res.status(400).json({ error: 'patientId and lineItems required' })
  }
  try {
    // Calculate totals
    const subtotal = lineItems.reduce((s: number, item: any) => s + (item.unitPrice * item.quantity), 0)
    const vatAmount = applyVAT ? Math.round(subtotal * 0.18) : 0
    const total     = subtotal + vatAmount

    // Get next invoice sequence
    const count = await prisma.invoice.count()
    const invoiceNumber = generateInvoiceNumber(count + 1)

    const invoice = await prisma.invoice.create({
      data: {
        patientId,
        appointmentId: appointmentId || null,
        invoiceNumber,
        lineItems,
        subtotalUGX: Math.round(subtotal),
        vatUGX:      Math.round(vatAmount),
        totalUGX:    Math.round(total),
        status:      'DRAFT',
        dueDate:     dueDate ? new Date(dueDate) : null,
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
      },
    })

    logAudit({ userId: req.user!.id, actionType: 'CREATE', entityType: 'INVOICE', entityId: invoice.id, entityName: `${invoice.invoiceNumber} — ${invoice.patient.firstName} ${invoice.patient.lastName}`, req })
    res.status(201).json(serialise(invoice))

    // Fire-and-forget QB push (does not block response)
    pushInvoiceToQB(invoice.id).catch(e => console.error('[QB] Invoice push error:', e))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to create invoice' })
  }
})

router.get('/invoices/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        patient: true,
        appointment: { include: { service: true, doctor: { include: { user: true } } } },
        payments: true,
      },
    })
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' })
    res.json(serialise(invoice))
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch invoice' })
  }
})

router.patch('/invoices/:id', requireAuth, async (req: Request, res: Response) => {
  const { status, dueDate } = req.body
  try {
    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: {
        ...(status ? { status } : {}),
        ...(dueDate ? { dueDate: new Date(dueDate) } : {}),
      },
    })
    res.json(serialise(invoice))
  } catch (e) {
    res.status(500).json({ error: 'Failed to update invoice' })
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// PAYMENTS
// ══════════════════════════════════════════════════════════════════════════════

router.post('/payments', requireAuth, async (req: Request, res: Response) => {
  const { invoiceId, amountUGX, method, reference } = req.body
  if (!invoiceId || !amountUGX || !method) {
    return res.status(400).json({ error: 'invoiceId, amountUGX, and method required' })
  }
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: true },
    })
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' })

    const payment = await prisma.payment.create({
      data: {
        invoiceId,
        patientId: invoice.patientId,
        amountUGX: Math.round(amountUGX),
        method,
        reference: reference || null,
        paidAt: new Date(),
      },
    })

    // Check if invoice is now fully paid
    const totalPaid = invoice.payments.reduce((s, p) => s + Number(p.amountUGX), 0) + amountUGX
    if (totalPaid >= Number(invoice.totalUGX)) {
      await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'PAID' } })

      // Clear patient debt
      await prisma.patient.update({
        where: { id: invoice.patientId },
        data: { accountBalance: { decrement: Math.round(amountUGX) } },
      })
    }

    logAudit({ userId: req.user!.id, actionType: 'PAYMENT_RECEIVED', entityType: 'PAYMENT', entityId: payment.id, entityName: `${invoiceId} — UGX ${amountUGX.toLocaleString()}`, req })
    res.status(201).json(serialise(payment))

    // Fire-and-forget QB push
    pushPaymentToQB(payment.id).catch(e => console.error('[QB] Payment push error:', e))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to record payment' })
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// EXPENSES
// ══════════════════════════════════════════════════════════════════════════════

router.get('/expenses', requireAuth, async (req: Request, res: Response) => {
  try {
    const { from, to, category } = req.query as Record<string, string>
    const where: any = {}
    if (category) where.category = category
    if (from || to) where.date = {}
    if (from) where.date.gte = new Date(from)
    if (to) where.date.lte = new Date(to)

    const expenses = await prisma.expense.findMany({
      where,
      orderBy: { date: 'desc' },
      include: { recordedBy: { select: { firstName: true, lastName: true } } },
    })
    res.json(serialise(expenses))
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch expenses' })
  }
})

router.post('/expenses', requireAuth, requireRole('ADMIN', 'ACCOUNTS'), async (req: Request, res: Response) => {
  const { category, amountUGX, description, date } = req.body
  if (!category || !amountUGX) return res.status(400).json({ error: 'category and amountUGX required' })
  try {
    const expense = await prisma.expense.create({
      data: {
        category,
        amountUGX: Math.round(amountUGX),
        description: description || '',
        recordedById: (req as any).user.userId,
        date: date ? new Date(date) : new Date(),
      },
    })
    res.status(201).json(serialise(expense))

    // Fire-and-forget QB push
    pushExpenseToQB(expense.id).catch(e => console.error('[QB] Expense push error:', e))
  } catch (e) {
    res.status(500).json({ error: 'Failed to create expense' })
  }
})

router.delete('/expenses/:id', requireAuth, requireRole('ADMIN', 'ACCOUNTS'), async (req: Request, res: Response) => {
  try {
    await prisma.expense.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete expense' })
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// PAYROLL
// ══════════════════════════════════════════════════════════════════════════════

router.get('/payroll', requireAuth, requireRole('ADMIN', 'ACCOUNTS'), async (req: Request, res: Response) => {
  try {
    const { month } = req.query as Record<string, string>
    const where = month ? { month } : {}
    const payroll = await prisma.staffPayroll.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { firstName: true, lastName: true, role: true } } },
    })
    res.json(serialise(payroll))
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch payroll' })
  }
})

router.post('/payroll/:month/run', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  const { month } = req.params // format: YYYY-MM
  const { staffSalaries } = req.body as { staffSalaries: Array<{ userId: string; grossUGX: number }> }

  if (!staffSalaries?.length) return res.status(400).json({ error: 'staffSalaries required' })

  try {
    const results = await Promise.all(
      staffSalaries.map(async ({ userId, grossUGX }) => {
        const { nssfEmployee, nssfEmployer, paye, net } = calculateNetPay(grossUGX)

        // Upsert payroll record
        return prisma.staffPayroll.upsert({
          where: { userId_month: { userId, month } },
          update: {
            grossUGX:      Math.round(grossUGX),
            nssfEmployee:  Math.round(nssfEmployee),
            nssfEmployer:  Math.round(nssfEmployer),
            paye:          Math.round(paye),
            netUGX:        Math.round(net),
            status:        'PENDING',
          },
          create: {
            userId,
            month,
            grossUGX:      Math.round(grossUGX),
            nssfEmployee:  Math.round(nssfEmployee),
            nssfEmployer:  Math.round(nssfEmployer),
            paye:          Math.round(paye),
            netUGX:        Math.round(net),
            status:        'PENDING',
          },
          include: { user: { select: { firstName: true, lastName: true } } },
        })
      })
    )
    res.json(serialise(results))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to run payroll' })
  }
})

router.patch('/payroll/:id/mark-paid', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const payroll = await prisma.staffPayroll.update({
      where: { id: req.params.id },
      data: { status: 'PAID' },
    })
    res.json(serialise(payroll))
  } catch (e) {
    res.status(500).json({ error: 'Failed to update payroll' })
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════════════════════════════════════

// P&L report
router.get('/reports/pl', requireAuth, requireRole('ADMIN', 'ACCOUNTS'), async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query as Record<string, string>
    const start = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1)
    const end   = to   ? new Date(to)   : new Date()

    const [revenue, expenses] = await Promise.all([
      prisma.payment.aggregate({ _sum: { amountUGX: true }, where: { paidAt: { gte: start, lte: end } } }),
      prisma.expense.aggregate({ _sum: { amountUGX: true }, where: { date: { gte: start, lte: end } } }),
    ])

    const rev = Number(revenue._sum.amountUGX || 0)
    const exp = Number(expenses._sum.amountUGX || 0)

    res.json({ from: start, to: end, revenue: rev, expenses: exp, netProfit: rev - exp })
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate P&L report' })
  }
})

// Debtors aging report
router.get('/reports/debtors', requireAuth, requireRole('ADMIN', 'ACCOUNTS'), async (req: Request, res: Response) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where: { status: { in: ['SENT', 'OVERDUE'] } },
      include: { patient: { select: { firstName: true, lastName: true, phone: true } } },
      orderBy: { dueDate: 'asc' },
    })

    const now = Date.now()
    const aged = invoices.map(inv => {
      const daysOverdue = inv.dueDate
        ? Math.max(0, Math.floor((now - inv.dueDate.getTime()) / 86_400_000))
        : 0
      return {
        ...serialise(inv),
        daysOverdue,
        ageBucket: daysOverdue === 0 ? 'current' : daysOverdue <= 30 ? '1-30' : daysOverdue <= 60 ? '31-60' : '60+',
      }
    })

    res.json(aged)
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate debtors report' })
  }
})

export default router
