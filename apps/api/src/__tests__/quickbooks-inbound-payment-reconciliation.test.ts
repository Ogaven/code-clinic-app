import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  appSetting: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  invoice: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  payment: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
  $transaction: vi.fn(),
}))

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))

import { normalizeQuickBooksWebhookEvents, syncQuickBooksPaymentObject } from '../routes/quickbooks'

describe('QuickBooks inbound payment reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
    prismaMock.invoice.findUnique.mockResolvedValue({
      totalUGX: 500000,
      status: 'SENT',
      dueDate: new Date('2099-01-01T00:00:00.000Z'),
    })
  })

  it('creates one local mirror for an exactly matched QB invoice and marks it paid', async () => {
    prismaMock.invoice.findMany.mockResolvedValue([{ id: 'inv-1', patientId: 'patient-1' }])
    prismaMock.payment.findFirst.mockResolvedValue(null)
    prismaMock.payment.aggregate.mockResolvedValue({ _sum: { amountUGX: 500000 } })

    const result = await syncQuickBooksPaymentObject({
      Id: 'qb-pay-1',
      TxnDate: '2026-10-07',
      TotalAmt: 500000,
      PaymentRefNum: 'RCPT-1',
      Line: [{ Amount: 500000, LinkedTxn: [{ TxnId: 'qb-inv-1', TxnType: 'Invoice' }] }],
    })

    expect(result).toEqual({ matched: 1, skipped: 0 })
    expect(prismaMock.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoiceId: 'inv-1',
        patientId: 'patient-1',
        amountUGX: 500000,
        qbPaymentId: 'qb-pay-1',
        method: 'QUICKBOOKS',
      }),
    })
    expect(prismaMock.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { paidUGX: 500000, status: 'PAID' },
    })
  })

  it('does not infer a patient when a QB invoice maps ambiguously', async () => {
    prismaMock.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', patientId: 'patient-1' },
      { id: 'inv-2', patientId: 'patient-2' },
    ])

    const result = await syncQuickBooksPaymentObject({
      Id: 'qb-pay-2',
      TotalAmt: 100000,
      Line: [{ Amount: 100000, LinkedTxn: [{ TxnId: 'qb-inv-2', TxnType: 'Invoice' }] }],
    })

    expect(result).toEqual({ matched: 0, skipped: 1 })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('preserves a voided payment row for audit while removing it from collected revenue', async () => {
    prismaMock.payment.findMany.mockResolvedValue([{ id: 'pay-1', invoiceId: 'inv-1' }])
    prismaMock.payment.aggregate.mockResolvedValue({ _sum: { amountUGX: 0 } })

    const result = await syncQuickBooksPaymentObject({
      Id: 'qb-pay-void',
      TotalAmt: 0,
      PrivateNote: 'Voided',
      Line: [],
    })

    expect(result).toEqual({ matched: 1, skipped: 0 })
    expect(prismaMock.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: {
        amountUGX: 0,
        method: 'QUICKBOOKS_VOIDED',
        notes: 'Voided in QuickBooks',
      },
    })
    expect(prismaMock.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { paidUGX: 0, status: 'SENT' },
    })
  })
})


describe('QuickBooks webhook payload normalization', () => {
  it('normalizes Intuit legacy eventNotifications payment events', () => {
    expect(normalizeQuickBooksWebhookEvents({
      eventNotifications: [{
        realmId: '310687',
        dataChangeEvent: {
          entities: [{
            id: '1234',
            operation: 'Create',
            name: 'Payment',
            lastUpdated: '2026-10-07T07:49:40.738Z',
          }],
        },
      }],
    })).toEqual([{
      entityName: 'Payment',
      operation: 'Create',
      realmId: '310687',
      entityId: '1234',
    }])
  })

  it('normalizes non-payment legacy entities so the webhook can safely ignore them', () => {
    expect(normalizeQuickBooksWebhookEvents({
      eventNotifications: [{
        realmId: '310687',
        dataChangeEvent: {
          entities: [{ id: '55', operation: 'Update', name: 'Customer' }],
        },
      }],
    })).toEqual([{
      entityName: 'Customer',
      operation: 'Update',
      realmId: '310687',
      entityId: '55',
    }])
  })

  it('retains support for the CloudEvent-style array', () => {
    expect(normalizeQuickBooksWebhookEvents([{
      type: 'com.intuit.quickbooks.payment.deleted',
      intuitaccountid: '310687',
      intuitentityid: '99',
    }])).toEqual([{
      entityName: 'Payment',
      operation: 'deleted',
      realmId: '310687',
      entityId: '99',
    }])
  })
})
