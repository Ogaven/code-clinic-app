import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'

const router = Router()

// GET /reports/case-acceptance?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/case-acceptance', requireAuth, async (req, res) => {
  try {
    const now = new Date()
    // Default: current month in EAT (UTC+3)
    const eatOffset = 3 * 60 * 60 * 1000
    const eatNow    = new Date(now.getTime() + eatOffset)
    const defaultFrom = new Date(Date.UTC(eatNow.getUTCFullYear(), eatNow.getUTCMonth(), 1))
    const defaultTo   = new Date(Date.UTC(eatNow.getUTCFullYear(), eatNow.getUTCMonth() + 1, 0, 23, 59, 59, 999))

    const fromDate = req.query.from ? new Date((req.query.from as string) + 'T00:00:00.000Z') : defaultFrom
    const toDate   = req.query.to   ? new Date((req.query.to   as string) + 'T23:59:59.999Z') : defaultTo

    // Treatment plans created in the date range, with each patient's appointments in same window
    const plans = await prisma.treatmentPlan.findMany({
      where: { createdAt: { gte: fromDate, lte: toDate } },
      include: {
        patient: {
          include: {
            appointments: {
              where: {
                startAt: { gte: fromDate, lte: toDate },
                status: { not: 'CANCELLED' },
              },
              include: {
                doctor: {
                  include: {
                    user: { select: { firstName: true, lastName: true } },
                  },
                },
              },
              orderBy: { startAt: 'asc' },
              take: 1,
            },
          },
        },
      },
    })

    const presented    = plans.length
    const accepted     = plans.filter((p: any) => ['In Progress', 'Completed'].includes(p.status)).length
    const followUp     = plans.filter((p: any) => p.status === 'Planned').length
    const declined     = plans.filter((p: any) => p.status === 'Declined').length
    const onHold       = plans.filter((p: any) => p.status === 'On Hold').length
    const inProgress   = plans.filter((p: any) => p.status === 'In Progress').length
    const completed    = plans.filter((p: any) => p.status === 'Completed').length
    const acceptanceRate = presented > 0 ? Math.round((accepted / presented) * 100) : 0

    // Per-doctor breakdown — attribute via first appointment in range
    const doctorMap = new Map<string, {
      name: string
      presented: number
      accepted: number
      declined: number
      followUp: number
      onHold: number
    }>()

    for (const plan of plans) {
      const appt      = plan.patient.appointments[0]
      const doctorKey = appt?.doctor?.id ?? 'unassigned'
      const doctorName = appt?.doctor?.user
        ? `Dr. ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`
        : 'Unassigned'

      if (!doctorMap.has(doctorKey)) {
        doctorMap.set(doctorKey, { name: doctorName, presented: 0, accepted: 0, declined: 0, followUp: 0, onHold: 0 })
      }
      const entry = doctorMap.get(doctorKey)!
      entry.presented++
      if (['In Progress', 'Completed'].includes(plan.status)) entry.accepted++
      if (plan.status === 'Declined')  entry.declined++
      if (plan.status === 'Planned')   entry.followUp++
      if (plan.status === 'On Hold')   entry.onHold++
    }

    const byDoctor = Array.from(doctorMap.values())
      .map(d => ({
        ...d,
        acceptanceRate: d.presented > 0 ? Math.round((d.accepted / d.presented) * 100) : 0,
      }))
      .sort((a, b) => b.presented - a.presented)

    res.json({
      summary: { presented, accepted, followUp, declined, onHold, acceptanceRate },
      byStatus: { planned: followUp, inProgress, completed, onHold, declined },
      byDoctor,
    })
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to generate case acceptance report' })
  }
})

export default router
