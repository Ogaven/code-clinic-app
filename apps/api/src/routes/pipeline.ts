import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { prisma } from '../lib/prisma'

const router = Router()

const VALID_STAGES = [
  'Consulted',
  'Treatment Presented',
  'Accepted & Scheduled',
  'Accepted & Unscheduled',
  'Completed',
  'Declined',
  'Follow-up Due',
]

// GET /pipeline/treatment
// Returns all treatment plans enriched with service name, doctor name, computed value,
// days since creation, plus aggregate metrics for the dashboard strip.
router.get('/treatment', requireAuth, async (req, res) => {
  try {
    const plans = await prisma.treatmentPlan.findMany({
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, patientNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Batch-fetch services referenced by any plan
    const serviceIds = [...new Set(plans.map(p => p.serviceId).filter(Boolean))] as string[]
    const serviceMap = new Map<string, string>()
    if (serviceIds.length > 0) {
      const services = await prisma.service.findMany({
        where:  { id: { in: serviceIds } },
        select: { id: true, name: true },
      })
      services.forEach(s => serviceMap.set(s.id, s.name))
    }

    // Batch-fetch most recent non-cancelled appointment per patient to surface doctor name
    const patientIds = [...new Set(plans.map(p => p.patientId))]
    const doctorByPatient = new Map<string, string>()
    if (patientIds.length > 0) {
      const appts = await prisma.appointment.findMany({
        where: {
          patientId: { in: patientIds },
          status:    { notIn: ['CANCELLED'] },
        },
        include: {
          doctor: { include: { user: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      })
      appts.forEach(a => {
        if (!doctorByPatient.has(a.patientId)) {
          doctorByPatient.set(
            a.patientId,
            `Dr. ${a.doctor.user.firstName} ${a.doctor.user.lastName}`,
          )
        }
      })
    }

    const now          = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const enriched = plans.map(p => {
      const value     = Number(p.costPerUnit) * p.quantity - Number(p.discount)
      const daysSince = Math.floor((now.getTime() - new Date(p.createdAt).getTime()) / 86_400_000)
      const treatmentName = p.serviceId
        ? (serviceMap.get(p.serviceId) || 'Unknown Service')
        : (p.notes?.split('\n')[0]?.slice(0, 60) || 'General')
      return {
        ...p,
        costPerUnit:   Number(p.costPerUnit),
        discount:      Number(p.discount),
        treatmentName,
        doctorName:    doctorByPatient.get(p.patientId) || '—',
        value,
        daysSince,
      }
    })

    // ── Metrics ──────────────────────────────────────────────────────────────
    const thisMonth      = enriched.filter(p => new Date(p.createdAt) >= startOfMonth)
    const totalPresentedMonth = thisMonth.reduce((s, p) => s + p.value, 0)

    const acceptedStages = ['Accepted & Scheduled', 'Accepted & Unscheduled', 'Completed']
    const totalAccepted  = enriched
      .filter(p => acceptedStages.includes(p.stage))
      .reduce((s, p) => s + p.value, 0)

    const totalPresented = enriched
      .filter(p => p.stage !== 'Declined')
      .reduce((s, p) => s + p.value, 0)
    const conversionRate = totalPresented > 0
      ? Math.round((totalAccepted / totalPresented) * 100)
      : 0

    const moneyAtRisk = enriched
      .filter(p => p.stage === 'Accepted & Unscheduled')
      .reduce((s, p) => s + p.value, 0)

    const scheduledPlans = enriched.filter(p => p.stage === 'Accepted & Scheduled')
    const avgDaysToSchedule = scheduledPlans.length > 0
      ? Math.round(
          scheduledPlans.reduce((s, p) => {
            const days = (new Date(p.updatedAt).getTime() - new Date(p.createdAt).getTime()) / 86_400_000
            return s + Math.max(0, days)
          }, 0) / scheduledPlans.length,
        )
      : 0

    res.json({
      plans:   enriched,
      metrics: { totalPresentedMonth, totalAccepted, conversionRate, moneyAtRisk, avgDaysToSchedule },
    })
  } catch (e) {
    console.error('[Pipeline] fetch error:', e)
    res.status(500).json({ error: 'Failed to fetch treatment pipeline' })
  }
})

// PATCH /pipeline/treatment/:id/stage
router.patch('/treatment/:id/stage', requireAuth, async (req, res) => {
  try {
    const { stage } = req.body
    if (!stage || !VALID_STAGES.includes(stage)) {
      res.status(400).json({ error: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` }); return
    }
    const plan = await prisma.treatmentPlan.update({
      where: { id: req.params.id },
      data:  { stage },
    })
    res.json({ id: plan.id, stage: plan.stage })
  } catch (e) {
    console.error('[Pipeline] stage update error:', e)
    res.status(500).json({ error: 'Failed to update stage' })
  }
})

// PATCH /pipeline/treatment/bulk — apply the same stage to multiple plans
router.patch('/treatment/bulk', requireAuth, async (req, res) => {
  try {
    const { ids, stage } = req.body as { ids: string[]; stage: string }
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids must be a non-empty array' }); return
    }
    if (!stage || !VALID_STAGES.includes(stage)) {
      res.status(400).json({ error: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` }); return
    }
    const result = await prisma.treatmentPlan.updateMany({
      where: { id: { in: ids } },
      data:  { stage },
    })
    res.json({ updated: result.count })
  } catch (e) {
    console.error('[Pipeline] bulk stage update error:', e)
    res.status(500).json({ error: 'Failed to bulk update stages' })
  }
})

// DELETE /pipeline/treatment/bulk — remove multiple plans (must be BEFORE /:id)
router.delete('/treatment/bulk', requireAuth, async (req, res) => {
  try {
    const { ids } = req.body as { ids: string[] }
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids must be a non-empty array' }); return
    }
    const result = await prisma.treatmentPlan.deleteMany({ where: { id: { in: ids } } })
    res.json({ deleted: result.count })
  } catch (e) {
    console.error('[Pipeline] bulk delete error:', e)
    res.status(500).json({ error: 'Failed to bulk delete plans' })
  }
})

// DELETE /pipeline/treatment/:id — remove a plan from the pipeline
router.delete('/treatment/:id', requireAuth, async (req, res) => {
  try {
    await prisma.treatmentPlan.delete({ where: { id: req.params.id } })
    res.json({ ok: true })
  } catch (e) {
    console.error('[Pipeline] delete error:', e)
    res.status(500).json({ error: 'Failed to delete plan' })
  }
})

// GET /pipeline/needs-review — plans that are stale and need Justine's attention
router.get('/needs-review', requireAuth, async (_req, res) => {
  try {
    const now = new Date()
    const sixtyDaysAgo  = new Date(now.getTime() - 60  * 86_400_000)
    const ninetyDaysAgo = new Date(now.getTime() - 90  * 86_400_000)

    // Consulted > 60 days (consult only, no follow-up action)
    const consultStale = await prisma.treatmentPlan.findMany({
      where:   { stage: 'Consulted', createdAt: { lt: sixtyDaysAgo } },
      include: { patient: { select: { id: true, firstName: true, lastName: true, phone: true, patientNumber: true } } },
      orderBy: { createdAt: 'asc' },
    })

    // Accepted & Unscheduled or Accepted & Scheduled > 90 days (money at risk / stuck)
    const acceptedStale = await prisma.treatmentPlan.findMany({
      where: {
        stage:     { in: ['Accepted & Unscheduled', 'Accepted & Scheduled', 'Treatment Presented', 'Follow-up Due'] },
        updatedAt: { lt: ninetyDaysAgo },
      },
      include: { patient: { select: { id: true, firstName: true, lastName: true, phone: true, patientNumber: true } } },
      orderBy: { updatedAt: 'asc' },
    })

    // Enrich with last appointment date per patient
    const allPatientIds = [...new Set([
      ...consultStale.map(p => p.patientId),
      ...acceptedStale.map(p => p.patientId),
    ])]

    const lastAppts = allPatientIds.length > 0
      ? await prisma.appointment.findMany({
          where:   { patientId: { in: allPatientIds }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
          select:  { patientId: true, startAt: true },
          orderBy: { startAt: 'desc' },
        })
      : []

    const lastApptByPatient = new Map<string, Date>()
    lastAppts.forEach(a => {
      if (!lastApptByPatient.has(a.patientId)) lastApptByPatient.set(a.patientId, a.startAt)
    })

    const enrich = (plan: any) => ({
      id:            plan.id,
      patientId:     plan.patientId,
      patientName:   `${plan.patient.firstName} ${plan.patient.lastName}`,
      patientNumber: plan.patient.patientNumber,
      phone:         plan.patient.phone,
      stage:         plan.stage,
      daysSince:     Math.floor((now.getTime() - new Date(plan.updatedAt || plan.createdAt).getTime()) / 86_400_000),
      createdAt:     plan.createdAt,
      updatedAt:     plan.updatedAt,
      lastApptDate:  lastApptByPatient.get(plan.patientId) ?? null,
      treatmentName: plan.notes?.split('\n')[0]?.slice(0, 60) || 'General',
      value:         Number(plan.costPerUnit) * plan.quantity - Number(plan.discount),
    })

    res.json({
      consultOnly:   consultStale.map(enrich),
      stuckPlans:    acceptedStale.map(enrich),
      total:         consultStale.length + acceptedStale.length,
    })
  } catch (e) {
    console.error('[Pipeline] needs-review error:', e)
    res.status(500).json({ error: 'Failed to fetch needs-review plans' })
  }
})

export default router
