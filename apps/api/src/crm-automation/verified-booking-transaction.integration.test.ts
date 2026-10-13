import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { linkVerifiedBookingInTransaction } from './verified-booking-transaction'

// This suite MUST NOT connect to the application's normal DATABASE_URL.
// Provision a disposable database with the existing Prisma schema, then set
// CRM_INTEGRATION_DATABASE_URL to its URL. No migrations are run by this suite.
const integrationUrl = process.env.CRM_INTEGRATION_DATABASE_URL
const enabled = !!integrationUrl && (() => {
  try {
    const url = new URL(integrationUrl)
    return /(^|[_-])(test|testing|ci)([_-]|$)/i.test(url.pathname.slice(1)) &&
      integrationUrl !== process.env.DATABASE_URL
  } catch { return false }
})()

const describeIntegration = enabled ? describe : describe.skip

describeIntegration('verified booking — disposable PostgreSQL integration', () => {
  let prisma: PrismaClient
  const leadIds: string[] = []
  beforeAll(() => {
    if (!enabled) throw new Error('Refusing to use a non-test database')
    prisma = new PrismaClient({ datasources: { db: { url: integrationUrl } } })
  })
  afterAll(async () => {
    if (!prisma) return
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } })
    await prisma.$disconnect()
  })

  async function makeLead() {
    const lead = await prisma.lead.create({ data: { source: 'OTHER', status: 'CONTACTED', stage: 'CONTACTED' } })
    leadIds.push(lead.id)
    return lead
  }

  it('commits lead linkage and one audit record together', async () => {
    const lead = await makeLead()
    const result = await prisma.$transaction(tx =>
      linkVerifiedBookingInTransaction(tx, lead, 'integration-patient', 'integration-admin'))
    expect(result?.status).toBe('CONVERTED')
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).convertedToPatientId)
      .toBe('integration-patient')
    const history = await prisma.leadStageHistory.findMany({ where: { leadId: lead.id } })
    expect(history).toHaveLength(1)
    expect(history[0].reason).toBe('staff_verified_patient_booking')
  })

  it('rolls back linkage when history creation fails', async () => {
    const lead = await makeLead()
    await expect(prisma.$transaction(async tx => {
      const sabotagedTx = {
        lead: tx.lead,
        leadStageHistory: { create: async () => { throw new Error('simulated history failure') } },
      }
      return linkVerifiedBookingInTransaction(sabotagedTx, lead, 'integration-patient', 'integration-admin')
    })).rejects.toThrow('simulated history failure')
    const unchanged = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })
    expect(unchanged.status).toBe('CONTACTED')
    expect(unchanged.convertedToPatientId).toBeNull()
    expect(await prisma.leadStageHistory.count({ where: { leadId: lead.id } })).toBe(0)
  })

  it('rejects stale competing conversion without duplicate audit history', async () => {
    const lead = await makeLead()
    const first = await prisma.$transaction(tx =>
      linkVerifiedBookingInTransaction(tx, lead, 'integration-patient', 'integration-admin'))
    expect(first).not.toBeNull()
    const second = await prisma.$transaction(tx =>
      linkVerifiedBookingInTransaction(tx, lead, 'other-patient', 'other-admin'))
    expect(second).toBeNull()
    expect(await prisma.leadStageHistory.count({ where: { leadId: lead.id } })).toBe(1)
  })
})
