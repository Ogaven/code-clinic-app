import { describe, expect, it, vi } from 'vitest'
import { linkVerifiedBookingInTransaction } from './verified-booking-transaction'

const lead = { id: 'lead-1', status: 'CONTACTED', stage: 'CONTACTED' }
const createTx = (count = 1) => ({
  lead: {
    updateMany: vi.fn().mockResolvedValue({ count }),
    findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'lead-1', status: 'CONVERTED' }),
  },
  leadStageHistory: { create: vi.fn().mockResolvedValue({ id: 'history-1' }) },
})

describe('verified booking atomic transaction', () => {
  it('links with a compare-and-set on original status and stage, and writes audit history', async () => {
    const tx = createTx()
    const result = await linkVerifiedBookingInTransaction(tx, lead, 'patient-1', 'admin-1')
    expect(result).toMatchObject({ status: 'CONVERTED' })
    expect(tx.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'lead-1', convertedToPatientId: null, status: 'CONTACTED', stage: 'CONTACTED' },
      data: { convertedToPatientId: 'patient-1', status: 'CONVERTED', stage: 'CONVERTED' },
    })
    expect(tx.leadStageHistory.create).toHaveBeenCalledWith({ data: {
      leadId: 'lead-1', fromStage: 'CONTACTED', toStage: 'CONVERTED', changedBy: 'admin-1',
      trigger: 'MANUAL', reason: 'staff_verified_patient_booking',
    } })
  })

  it('rejects a competing conversion without writing duplicate history', async () => {
    const tx = createTx(0)
    expect(await linkVerifiedBookingInTransaction(tx, lead, 'patient-1', 'admin-1')).toBeNull()
    expect(tx.leadStageHistory.create).not.toHaveBeenCalled()
    expect(tx.lead.findUniqueOrThrow).not.toHaveBeenCalled()
  })

  it('propagates audit-history failure so Prisma rolls back the surrounding transaction', async () => {
    const tx = createTx()
    tx.leadStageHistory.create.mockRejectedValueOnce(new Error('history insert failed'))
    await expect(linkVerifiedBookingInTransaction(tx, lead, 'patient-1', 'admin-1'))
      .rejects.toThrow('history insert failed')
    expect(tx.lead.findUniqueOrThrow).not.toHaveBeenCalled()
  })
})
