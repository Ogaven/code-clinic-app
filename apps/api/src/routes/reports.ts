import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'

const router = Router()

type PatientEntry = { name: string; service: string; date: string; value: number }

// GET /reports/case-acceptance?from=YYYY-MM-DD&to=YYYY-MM-DD&doctorId=...
router.get('/case-acceptance', requireAuth, async (req, res) => {
  try {
    const eatOffset  = 3 * 60 * 60 * 1000
    const eatNow     = new Date(Date.now() + eatOffset)
    const defaultFrom = new Date(Date.UTC(eatNow.getUTCFullYear(), eatNow.getUTCMonth(), 1))
    const defaultTo   = new Date(Date.UTC(eatNow.getUTCFullYear(), eatNow.getUTCMonth() + 1, 0, 23, 59, 59, 999))

    const fromDate = req.query.from ? new Date((req.query.from as string) + 'T00:00:00.000Z') : defaultFrom
    const toDate   = req.query.to   ? new Date((req.query.to   as string) + 'T23:59:59.999Z') : defaultTo

    const plans = await prisma.treatmentPlan.findMany({
      where: { createdAt: { gte: fromDate, lte: toDate } },
      include: {
        patient: {
          select: {
            firstName: true,
            lastName: true,
            appointments: {
              where: {
                startAt: { gte: fromDate, lte: toDate },
                status: { not: 'CANCELLED' },
              },
              include: {
                doctor: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
              },
              orderBy: { startAt: 'asc' },
              take: 1,
            },
          },
        },
      },
    })

    // Resolve service names from serviceId (no Prisma relation on TreatmentPlan)
    const serviceIds = [...new Set(plans.map((p: any) => p.serviceId).filter(Boolean))] as string[]
    const services   = serviceIds.length > 0
      ? await prisma.service.findMany({ where: { id: { in: serviceIds } }, select: { id: true, name: true } })
      : []
    const svcMap = new Map(services.map((s: any) => [s.id, s.name]))

    function proper(s: string) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '' }
    function patientName(p: any) { return `${proper(p.firstName)} ${proper(p.lastName)}`.trim() }

    const presented  = plans.length
    const accepted   = plans.filter((p: any) => ['In Progress', 'Completed'].includes(p.status)).length
    const followUp   = plans.filter((p: any) => p.status === 'Planned').length
    const declined   = plans.filter((p: any) => p.status === 'Declined').length
    const onHold     = plans.filter((p: any) => p.status === 'On Hold').length
    const inProgress = plans.filter((p: any) => p.status === 'In Progress').length
    const completed  = plans.filter((p: any) => p.status === 'Completed').length
    const acceptanceRate = presented > 0 ? Math.round((accepted / presented) * 100) : 0

    // Per-doctor breakdown with patient lists
    const doctorMap = new Map<string, {
      id: string
      name: string
      presented: number; accepted: number; declined: number; followUp: number; onHold: number
      patients: { accepted: PatientEntry[]; declined: PatientEntry[]; pending: PatientEntry[] }
    }>()

    for (const plan of plans as any[]) {
      const appt       = plan.patient.appointments[0]
      const doctorKey  = appt?.doctor?.id ?? 'unassigned'
      const doctorName = appt?.doctor?.user
        ? `Dr. ${proper(appt.doctor.user.firstName)} ${proper(appt.doctor.user.lastName)}`
        : 'Unassigned'

      if (!doctorMap.has(doctorKey)) {
        doctorMap.set(doctorKey, {
          id: doctorKey, name: doctorName,
          presented: 0, accepted: 0, declined: 0, followUp: 0, onHold: 0,
          patients: { accepted: [], declined: [], pending: [] },
        })
      }

      const entry = doctorMap.get(doctorKey)!
      entry.presented++

      const svcName  = plan.serviceId ? (svcMap.get(plan.serviceId) ?? plan.stage) : plan.stage
      const dateStr  = (plan.createdAt as Date).toISOString().slice(0, 10)
      const value    = Math.round(plan.costPerUnit * plan.quantity * (1 - plan.discount / 100))
      const pName    = patientName(plan.patient)
      const row      = { name: pName, service: svcName, date: dateStr, value }

      if (['In Progress', 'Completed'].includes(plan.status)) { entry.accepted++;  entry.patients.accepted.push(row) }
      else if (plan.status === 'Declined')                     { entry.declined++;  entry.patients.declined.push(row) }
      else if (plan.status === 'Planned')                      { entry.followUp++;  entry.patients.pending.push(row) }
      else if (plan.status === 'On Hold')                      { entry.onHold++ }
    }

    const byDoctor = Array.from(doctorMap.values())
      .map(d => ({ ...d, acceptanceRate: d.presented > 0 ? Math.round((d.accepted / d.presented) * 100) : 0 }))
      .sort((a, b) => b.presented - a.presented)

    res.json({
      summary: { presented, accepted, followUp, declined, onHold, acceptanceRate, target: 90 },
      byStatus: { planned: followUp, inProgress, completed, onHold, declined },
      byDoctor,
    })
  } catch (e: any) {
    console.error('[Reports] case-acceptance error:', e.message)
    res.status(500).json({ error: 'Failed to generate case acceptance report' })
  }
})

export default router
