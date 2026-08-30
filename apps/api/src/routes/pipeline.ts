import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { prisma } from '../lib/prisma'
import { authenticatedDoctorId } from '../lib/doctor-access'

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

// Same vocabulary as the Treatment Plan status dropdown in the patient profile
// (apps/web/.../patients/[id]/page.tsx) and Case Acceptance's report (reports.ts).
// Kept in sync deliberately — this is the shared source of truth all three read.
const VALID_STATUSES = ['Planned', 'In Progress', 'Completed', 'On Hold', 'Declined', 'Cancelled']

// ── Africa/Kampala calendar boundaries ──────────────────────────────────────
// Kampala is a fixed UTC+3 offset with no DST, so "local midnight" for any
// Y-M-D is always exactly 3 hours behind that same Y-M-D at UTC midnight.
// Computed explicitly here rather than relying on the API process's TZ env
// var (main.ts sets it, but a KPI boundary shouldn't silently depend on that).
const KAMPALA_OFFSET_MS = 3 * 60 * 60 * 1000

function kampalaYMD(d: Date = new Date()): { y: number; m: number; day: number } {
  const shifted = new Date(d.getTime() + KAMPALA_OFFSET_MS)
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), day: shifted.getUTCDate() }
}
function kampalaMidnightUTC(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m, day, 0, 0, 0, 0) - KAMPALA_OFFSET_MS)
}

type PeriodKey = 'today' | 'week' | 'month' | 'all' | 'custom'

// Resolves a period key into a half-open [start, end) UTC instant range
// (end === null means "all time", i.e. no upper or lower bound at all).
function resolvePeriod(key: string, customStart?: string, customEnd?: string): { start: Date | null; end: Date | null; label: string } {
  const { y, m, day } = kampalaYMD()

  if (key === 'today') {
    return { start: kampalaMidnightUTC(y, m, day), end: kampalaMidnightUTC(y, m, day + 1), label: 'Today' }
  }
  if (key === 'week') {
    // Monday-Sunday, same convention as AdminAppointmentsList.tsx / dashboard.
    const dow = new Date(Date.UTC(y, m, day)).getUTCDay() // 0=Sun..6=Sat
    const monday = day - (dow === 0 ? 6 : dow - 1)
    return { start: kampalaMidnightUTC(y, m, monday), end: kampalaMidnightUTC(y, m, monday + 7), label: 'This Week' }
  }
  if (key === 'month') {
    return { start: kampalaMidnightUTC(y, m, 1), end: kampalaMidnightUTC(y, m + 1, 1), label: 'This Month' }
  }
  if (key === 'custom' && customStart && customEnd) {
    const [sy, sm, sd] = customStart.split('-').map(Number)
    const [ey, em, ed] = customEnd.split('-').map(Number)
    return { start: kampalaMidnightUTC(sy, sm - 1, sd), end: kampalaMidnightUTC(ey, em - 1, ed + 1), label: `${customStart} to ${customEnd}` }
  }
  return { start: null, end: null, label: 'All Time' }
}

// GET /pipeline/treatment?period=today|week|month|all|custom&start=YYYY-MM-DD&end=YYYY-MM-DD
// Returns treatment plans enriched with service name, doctor name, computed value,
// days since creation, plus aggregate metrics for the dashboard strip.
//
// `plans` (the board) is scoped to the SAME createdAt cohort as the period-scoped
// KPI metrics below — selecting Today/Week/Month filters both together, matching
// the period selector's own promise. `period=all` returns everything, unfiltered.
// Money at Risk and Avg Days to Schedule remain deliberately all-time regardless
// of `period` — see the comment above `moneyAtRisk`.
router.get('/treatment', requireAuth, async (req, res) => {
  try {
    const doctorId = await authenticatedDoctorId(prisma, req.user!)
    if (req.user!.role === 'DOCTOR' && !doctorId) { res.status(404).json({ error: 'Doctor record not found' }); return }
    const periodKey = ((req.query.period as string) || 'month') as PeriodKey
    const { start: periodStart, end: periodEnd, label: periodLabel } =
      resolvePeriod(periodKey, req.query.start as string | undefined, req.query.end as string | undefined)
    const plans = await prisma.treatmentPlan.findMany({
      where: doctorId ? { doctorId } : {},
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, patientNumber: true } },
        doctor: { include: { user: { select: { firstName: true, lastName: true } } } },
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

    const now = new Date()

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
        doctorName:    p.doctor ? `Dr. ${p.doctor.user.firstName} ${p.doctor.user.lastName}` : 'Unassigned',
        value,
        daysSince,
      }
    })

    // ── Metrics ──────────────────────────────────────────────────────────────
    // Period-scoped cohort: plans PRESENTED (createdAt) within the selected
    // window. `periodStart === null` means "all time" — every plan qualifies.
    const inPeriod = periodStart
      ? enriched.filter(p => {
          const t = new Date(p.createdAt).getTime()
          return t >= periodStart.getTime() && t < periodEnd!.getTime()
        })
      : enriched

    const presentedValue = inPeriod.reduce((s, p) => s + p.value, 0)

    const acceptedStages = ['Accepted & Scheduled', 'Accepted & Unscheduled', 'Completed']
    // "Accepted Value" for the period = of the plans PRESENTED in this window,
    // how much value (by current stage) has been accepted — the same
    // cohort-by-presentation-date methodology Case Acceptance's report uses,
    // since TreatmentPlan has no separate "accepted at" timestamp to filter by.
    const acceptedValue = inPeriod
      .filter(p => acceptedStages.includes(p.stage))
      .reduce((s, p) => s + p.value, 0)

    const presentedForRate = inPeriod
      .filter(p => p.stage !== 'Declined')
      .reduce((s, p) => s + p.value, 0)
    const conversionRate = presentedForRate > 0
      ? Math.round((acceptedValue / presentedForRate) * 100)
      : 0

    // Money at Risk and Avg Days to Schedule are deliberately NOT period-scoped.
    // Both describe CURRENT operational state — an unscheduled-but-accepted plan
    // presented three months ago is still real money at risk today, and hiding
    // it just because it wasn't presented "this week" would be actively
    // misleading, not just imprecise. Always computed from the full, unfiltered
    // pipeline regardless of the selected period — labelled "All time" in the UI.
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
      plans:   inPeriod,
      metrics: { presentedValue, acceptedValue, conversionRate, moneyAtRisk, avgDaysToSchedule },
      period:  { key: periodKey, start: periodStart?.toISOString() ?? null, end: periodEnd?.toISOString() ?? null, label: periodLabel },
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
    if (!['ADMIN', 'RECEPTIONIST', 'DOCTOR'].includes(req.user!.role)) { res.status(403).json({ error: 'Access denied' }); return }
    const doctorId = await authenticatedDoctorId(prisma, req.user!)
    if (req.user!.role === 'DOCTOR' && !doctorId) { res.status(404).json({ error: 'Doctor record not found' }); return }
    const result = await prisma.treatmentPlan.updateMany({ where: { id: req.params.id, ...(doctorId ? { doctorId } : {}) }, data: { stage } })
    if (result.count !== 1) { res.status(404).json({ error: 'Treatment plan not found' }); return }
    res.json({ id: req.params.id, stage })
  } catch (e) {
    console.error('[Pipeline] stage update error:', e)
    res.status(500).json({ error: 'Failed to update stage' })
  }
})

// PATCH /pipeline/treatment/:id/status — moves a card between Pipeline's board
// columns AND updates the real Treatment Plan status in one write, since the
// board now reads/writes this same field (not the separate `stage` column).
router.patch('/treatment/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body
    if (!status || !VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }); return
    }
    if (!['ADMIN', 'RECEPTIONIST', 'DOCTOR'].includes(req.user!.role)) { res.status(403).json({ error: 'Access denied' }); return }
    const doctorId = await authenticatedDoctorId(prisma, req.user!)
    if (req.user!.role === 'DOCTOR' && !doctorId) { res.status(404).json({ error: 'Doctor record not found' }); return }
    const result = await prisma.treatmentPlan.updateMany({ where: { id: req.params.id, ...(doctorId ? { doctorId } : {}) }, data: { status } })
    if (result.count !== 1) { res.status(404).json({ error: 'Treatment plan not found' }); return }
    res.json({ id: req.params.id, status })
  } catch (e) {
    console.error('[Pipeline] status update error:', e)
    res.status(500).json({ error: 'Failed to update status' })
  }
})

// PATCH /pipeline/treatment/bulk-status — apply the same status to multiple plans
router.patch('/treatment/bulk-status', requireAuth, async (req, res) => {
  try {
    const { ids, status } = req.body as { ids: string[]; status: string }
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids must be a non-empty array' }); return
    }
    if (!status || !VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }); return
    }
    if (!['ADMIN', 'RECEPTIONIST', 'DOCTOR'].includes(req.user!.role)) { res.status(403).json({ error: 'Access denied' }); return }
    const doctorId = await authenticatedDoctorId(prisma, req.user!)
    if (req.user!.role === 'DOCTOR' && !doctorId) { res.status(404).json({ error: 'Doctor record not found' }); return }
    const result = await prisma.treatmentPlan.updateMany({
      where: { id: { in: ids }, ...(doctorId ? { doctorId } : {}) },
      data:  { status },
    })
    res.json({ updated: result.count })
  } catch (e) {
    console.error('[Pipeline] bulk status update error:', e)
    res.status(500).json({ error: 'Failed to bulk update statuses' })
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
    if (!['ADMIN', 'RECEPTIONIST', 'DOCTOR'].includes(req.user!.role)) { res.status(403).json({ error: 'Access denied' }); return }
    const doctorId = await authenticatedDoctorId(prisma, req.user!)
    if (req.user!.role === 'DOCTOR' && !doctorId) { res.status(404).json({ error: 'Doctor record not found' }); return }
    const result = await prisma.treatmentPlan.updateMany({
      where: { id: { in: ids }, ...(doctorId ? { doctorId } : {}) },
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
    if (!['ADMIN', 'RECEPTIONIST'].includes(req.user!.role)) { res.status(403).json({ error: 'Access denied' }); return }
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
    if (!['ADMIN', 'RECEPTIONIST'].includes(req.user!.role)) { res.status(403).json({ error: 'Access denied' }); return }
    await prisma.treatmentPlan.delete({ where: { id: req.params.id } })
    res.json({ ok: true })
  } catch (e) {
    console.error('[Pipeline] delete error:', e)
    res.status(500).json({ error: 'Failed to delete plan' })
  }
})

// GET /pipeline/needs-review — plans that are stale and need Justine's attention
router.get('/needs-review', requireAuth, async (req, res) => {
  try {
    const doctorId = await authenticatedDoctorId(prisma, req.user!)
    if (req.user!.role === 'DOCTOR' && !doctorId) { res.status(404).json({ error: 'Doctor record not found' }); return }
    const now = new Date()
    const sixtyDaysAgo  = new Date(now.getTime() - 60  * 86_400_000)
    const ninetyDaysAgo = new Date(now.getTime() - 90  * 86_400_000)

    // Consulted > 60 days (consult only, no follow-up action)
    const consultStale = await prisma.treatmentPlan.findMany({
      where:   { stage: 'Consulted', createdAt: { lt: sixtyDaysAgo }, ...(doctorId ? { doctorId } : {}) },
      include: { patient: { select: { id: true, firstName: true, lastName: true, phone: true, patientNumber: true } } },
      orderBy: { createdAt: 'asc' },
    })

    // Accepted & Unscheduled or Accepted & Scheduled > 90 days (money at risk / stuck)
    const acceptedStale = await prisma.treatmentPlan.findMany({
      where: {
        stage:     { in: ['Accepted & Unscheduled', 'Accepted & Scheduled', 'Treatment Presented', 'Follow-up Due'] },
        updatedAt: { lt: ninetyDaysAgo },
        ...(doctorId ? { doctorId } : {}),
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
