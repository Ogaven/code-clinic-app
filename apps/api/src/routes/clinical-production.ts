import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { prisma } from '../lib/prisma'
import { isMatchingProductionReplay, productionLinksMatchPatient, validateProductionEntry } from '../utils/clinical-production-validation'

const router = Router()
const payloadSchema = z.object({
  patientId: z.string().min(1),
  appointmentId: z.string().min(1).optional(),
  treatmentPlanId: z.string().min(1).optional(),
  deliveredAt: z.string().datetime({ offset: true }),
  amountUGX: z.number().int().safe(),
  kind: z.enum(['DELIVERY', 'REVERSAL', 'ADJUSTMENT']),
  originalEntryId: z.string().min(1).optional(),
  sourceKey: z.string().min(1).max(128),
  note: z.string().min(1).max(2000),
}).strict()

// Admin-only first milestone. No patient messaging or inferred production.
// Ledger and audit are committed in the same database transaction.
router.post('/entries', requireAuth, adminOnly, async (req, res) => {
  const parsed = payloadSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid clinical production payload' })
  const input = parsed.data
  const invalid = validateProductionEntry(input)
  if (invalid) return res.status(400).json({ error: invalid })
  const deliveredAt = new Date(input.deliveredAt)
  if (deliveredAt.getTime() > Date.now() + 5 * 60_000) return res.status(400).json({ error: 'Delivery date cannot be in the future' })
  try {
    const result = await prisma.$transaction(async tx => {
      // PostgreSQL transaction-scoped advisory lock serializes correction and
      // idempotency checks across concurrent requests without patient writes.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(726198, 42)`
      const existing = await tx.clinicalProductionEntry.findUnique({ where: { sourceKey: input.sourceKey } })
      if (existing) {
        const matches = ['DELIVERY', 'REVERSAL', 'ADJUSTMENT'].includes(existing.kind) &&
          isMatchingProductionReplay({ ...existing, kind: existing.kind as 'DELIVERY' | 'REVERSAL' | 'ADJUSTMENT' }, { ...input, deliveredAt })
        if (!matches) return { status: 409, error: 'Idempotency key already used for a different entry' }
        return { status: 200, entry: existing }
      }
      const [patient, appointment, treatmentPlan] = await Promise.all([
        tx.patient.findUnique({ where: { id: input.patientId }, select: { id: true } }),
        input.appointmentId ? tx.appointment.findUnique({ where: { id: input.appointmentId }, select: { patientId: true, status: true } }) : null,
        input.treatmentPlanId ? tx.treatmentPlan.findUnique({ where: { id: input.treatmentPlanId }, select: { patientId: true } }) : null,
      ])
      if (!patient || (input.appointmentId && !appointment) || (input.treatmentPlanId && !treatmentPlan) ||
        !productionLinksMatchPatient({ patientId: input.patientId, appointmentPatientId: appointment?.patientId, treatmentPlanPatientId: treatmentPlan?.patientId })) {
        return { status: 400, error: 'Invalid patient or linked clinical record' }
      }
      if (input.kind === 'DELIVERY' && appointment && !['COMPLETED', 'DEPARTED', 'SESSION_COMPLETE', 'READY_CHECKOUT'].includes(appointment.status)) {
        return { status: 400, error: 'Linked appointment must have a completed clinical session' }
      }
      if (input.kind !== 'DELIVERY') {
        const original = await tx.clinicalProductionEntry.findUnique({ where: { id: input.originalEntryId! } })
        if (!original || original.kind !== 'DELIVERY' || original.approvalStatus !== 'APPROVED' || original.patientId !== input.patientId ||
          input.appointmentId && input.appointmentId !== original.appointmentId ||
          input.treatmentPlanId && input.treatmentPlanId !== original.treatmentPlanId ||
          deliveredAt.getTime() < original.deliveredAt.getTime()) return { status: 400, error: 'Invalid original delivery' }
        const corrections = await tx.clinicalProductionEntry.aggregate({ where: { originalEntryId: original.id, approvalStatus: 'APPROVED' }, _sum: { amountUGX: true } })
        const remaining = original.amountUGX + (corrections._sum.amountUGX ?? 0) + input.amountUGX
        if (!Number.isSafeInteger(remaining)) return { status: 400, error: 'Correction total exceeds supported UGX range' }
        if (remaining < 0) return { status: 400, error: 'Correction exceeds delivered value' }
        if (input.kind === 'REVERSAL' && remaining !== 0) return { status: 400, error: 'Reversal must offset the full remaining delivered value' }
      }
      const entry = await tx.clinicalProductionEntry.create({ data: {
        patientId: input.patientId, appointmentId: input.appointmentId, treatmentPlanId: input.treatmentPlanId,
        deliveredAt, amountUGX: input.amountUGX, kind: input.kind, originalEntryId: input.originalEntryId,
        sourceKey: input.sourceKey, note: input.note.trim(), recordedById: req.user!.id,
      } })
      await tx.auditLog.create({ data: {
        userId: req.user!.id, action: 'CREATE', resource: 'CLINICAL_PRODUCTION', resourceId: entry.id,
        entityType: 'CLINICAL_PRODUCTION', entityId: entry.id, actionType: 'CREATE', severity: 'INFO',
        metadata: JSON.stringify({ kind: entry.kind, amountUGX: entry.amountUGX, sourceKey: entry.sourceKey }),
      } })
      return { status: 201, entry }
    })
    return res.status(result.status).json('error' in result ? { error: result.error } : { entry: result.entry })
  } catch (error) {
    console.error('[ClinicalProduction] Failed to record entry:', error)
    return res.status(500).json({ error: 'Could not record clinical production entry' })
  }
})

const reportSchema = z.object({
  startDate: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/),
  endDate: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/),
})

// Read-only verified ledger activity. Report by actual delivery date, not
// appointment booking date, invoice creation or cash collection.
router.get('/summary', requireAuth, adminOnly, async (req, res) => {
  const parsed = reportSchema.safeParse(req.query)
  if (!parsed.success || parsed.data.startDate > parsed.data.endDate) return res.status(400).json({ error: 'Invalid date range' })
  const { isValidKampalaCalendarDate } = await import('../utils/practice-kampala-date')
  if (!isValidKampalaCalendarDate(parsed.data.startDate) || !isValidKampalaCalendarDate(parsed.data.endDate)) {
    return res.status(400).json({ error: 'Invalid calendar date' })
  }
  const start = new Date(parsed.data.startDate + 'T00:00:00+03:00')
  const end = new Date(parsed.data.endDate + 'T00:00:00+03:00')
  end.setUTCDate(end.getUTCDate() + 1)
  if (end.getTime() - start.getTime() > 31 * 86_400_000) return res.status(400).json({ error: 'Maximum reporting range is 31 days' })
  try {
    const groups = await prisma.clinicalProductionEntry.groupBy({
      by: ['kind'], where: { deliveredAt: { gte: start, lt: end }, approvalStatus: 'APPROVED' },
      _sum: { amountUGX: true }, _count: { id: true },
    })
    const delivery = groups.find(g => g.kind === 'DELIVERY')
    const reversal = groups.find(g => g.kind === 'REVERSAL')
    const adjustment = groups.find(g => g.kind === 'ADJUSTMENT')
    const deliveryUGX = delivery?._sum.amountUGX ?? 0
    const reversalUGX = reversal?._sum.amountUGX ?? 0
    const adjustmentUGX = adjustment?._sum.amountUGX ?? 0
    const netClinicalProductionUGX = deliveryUGX + reversalUGX + adjustmentUGX
    if (![deliveryUGX, reversalUGX, adjustmentUGX, netClinicalProductionUGX].every(Number.isSafeInteger)) {
      return res.status(500).json({ error: 'Ledger totals exceed supported integer range' })
    }
    return res.json({
      startDate: parsed.data.startDate, endDate: parsed.data.endDate,
      deliveryUGX, reversalUGX, adjustmentUGX,
      netClinicalProductionUGX,
      deliveryCount: delivery?._count.id ?? 0,
      reversalCount: reversal?._count.id ?? 0,
      adjustmentCount: adjustment?._count.id ?? 0,
      basis: 'APPROVED_CLINICAL_PRODUCTION_LEDGER',
      disclaimer: 'Corrections are counted on their recorded effective delivery date. Staff-recorded values are separate from invoices and cash collections; only approved entries are included; pending and rejected entries are excluded.',
    })
  } catch (error) {
    console.error('[ClinicalProduction] Summary failed:', error)
    return res.status(500).json({ error: 'Unable to retrieve clinical production summary' })
  }
})

const approvalSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().min(3).max(2000),
}).strict()

// Approval is separate from recording. A different administrator must decide.
router.post('/entries/:id/decision', requireAuth, adminOnly, async (req, res) => {
  const parsed = approvalSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Decision and explanation required' })
  const entryId = req.params.id
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(726198, 42)`
      const entry = await tx.clinicalProductionEntry.findUnique({ where: { id: entryId } })
      if (!entry) return { status: 404, error: 'Entry not found' }
      if (entry.approvalStatus !== 'PENDING') return { status: 409, error: 'Entry already reviewed' }
      if (entry.recordedById === req.user!.id) return { status: 403, error: 'Recorder cannot approve or reject their own entry' }
      if (entry.kind !== 'DELIVERY' && parsed.data.decision === 'APPROVED') {
        const original = await tx.clinicalProductionEntry.findUnique({ where: { id: entry.originalEntryId! } })
        if (!original || original.approvalStatus !== 'APPROVED') {
          return { status: 409, error: 'Original delivery must be approved before approving a correction' }
        }
      }
      if (entry.kind !== 'DELIVERY' && parsed.data.decision === 'APPROVED') {
        const original = await tx.clinicalProductionEntry.findUnique({ where: { id: entry.originalEntryId! } })
        if (!original) return { status: 409, error: 'Original delivery not found' }
        const approvedCorrections = await tx.clinicalProductionEntry.aggregate({
          where: { originalEntryId: original.id, approvalStatus: 'APPROVED' },
          _sum: { amountUGX: true },
        })
        const remaining = original.amountUGX + (approvedCorrections._sum.amountUGX ?? 0) + entry.amountUGX
        if (!Number.isSafeInteger(remaining) || remaining < 0) {
          return { status: 409, error: 'Approval would exceed the remaining delivered value' }
        }
        if (entry.kind === 'REVERSAL' && remaining !== 0) {
          return { status: 409, error: 'Reversal must offset the remaining approved delivery value' }
        }
      }
      const updated = await tx.clinicalProductionEntry.updateMany({
        where: { id: entryId, approvalStatus: 'PENDING' },
        data: { approvalStatus: parsed.data.decision, approvedById: req.user!.id, approvedAt: new Date(), approvalNote: parsed.data.note },
      })
      if (updated.count !== 1) return { status: 409, error: 'Entry already reviewed' }
      await tx.auditLog.create({ data: {
        userId: req.user!.id, action: 'UPDATE', resource: 'CLINICAL_PRODUCTION', resourceId: entryId,
        entityType: 'CLINICAL_PRODUCTION', entityId: entryId, actionType: 'STATUS_CHANGE', severity: 'INFO',
        metadata: JSON.stringify({ decision: parsed.data.decision, note: parsed.data.note }),
      } })
      return { status: 200, approvalStatus: parsed.data.decision }
    })
    return res.status(result.status).json('error' in result ? { error: result.error } : { approvalStatus: result.approvalStatus })
  } catch (error) {
    console.error('[ClinicalProduction] Decision failed:', error)
    return res.status(500).json({ error: 'Unable to review production entry' })
  }
})

router.get('/entries/pending', requireAuth, adminOnly, async (_req, res) => {
  try {
    const entries = await prisma.clinicalProductionEntry.findMany({
      where: { approvalStatus: 'PENDING' },
      select: {
        id: true, patientId: true, appointmentId: true, treatmentPlanId: true,
        deliveredAt: true, amountUGX: true, kind: true, originalEntryId: true,
        note: true, recordedById: true, createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })
    return res.json({ entries, limit: 100 })
  } catch (error) {
    console.error('[ClinicalProduction] Pending queue failed:', error)
    return res.status(500).json({ error: 'Unable to retrieve pending entries' })
  }
})

export default router
