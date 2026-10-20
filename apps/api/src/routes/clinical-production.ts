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
        input.appointmentId ? tx.appointment.findUnique({ where: { id: input.appointmentId }, select: { patientId: true } }) : null,
        input.treatmentPlanId ? tx.treatmentPlan.findUnique({ where: { id: input.treatmentPlanId }, select: { patientId: true } }) : null,
      ])
      if (!patient || (input.appointmentId && !appointment) || (input.treatmentPlanId && !treatmentPlan) ||
        !productionLinksMatchPatient({ patientId: input.patientId, appointmentPatientId: appointment?.patientId, treatmentPlanPatientId: treatmentPlan?.patientId })) {
        return { status: 400, error: 'Invalid patient or linked clinical record' }
      }
      if (input.kind !== 'DELIVERY') {
        const original = await tx.clinicalProductionEntry.findUnique({ where: { id: input.originalEntryId! } })
        if (!original || original.kind !== 'DELIVERY' || original.patientId !== input.patientId) return { status: 400, error: 'Invalid original delivery' }
        const corrections = await tx.clinicalProductionEntry.aggregate({ where: { originalEntryId: original.id }, _sum: { amountUGX: true } })
        const remaining = original.amountUGX + (corrections._sum.amountUGX ?? 0) + input.amountUGX
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

export default router
