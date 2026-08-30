import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { prisma } from '../lib/prisma'

const router = Router()
const locationSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracy: z.number().positive().max(100_000).optional(),
  source: z.enum(['WEB', 'PWA', 'ADMIN']).default('WEB'),
}).refine(v => (v.latitude == null) === (v.longitude == null), 'Latitude and longitude must be supplied together')

const KAMPALA_OFFSET_MS = 3 * 60 * 60 * 1000

export function kampalaDay(now = new Date()) {
  const local = new Date(now.getTime() + KAMPALA_OFFSET_MS)
  const y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate()
  return {
    date: new Date(Date.UTC(y, m, d)),
    start: new Date(Date.UTC(y, m, d) - KAMPALA_OFFSET_MS),
    end: new Date(Date.UTC(y, m, d + 1) - KAMPALA_OFFSET_MS),
  }
}

router.post('/check-in', requireAuth, async (req, res) => {
  const parsed = locationSchema.safeParse(req.body || {})
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid location' }); return }
  const { date } = kampalaDay()
  const location = parsed.data
  try {
    const attendance = await prisma.staffAttendance.create({
      data: {
        userId: req.user!.id, attendanceDate: date, checkInAt: new Date(), source: location.source,
        checkInLat: location.latitude, checkInLng: location.longitude, checkInAccuracy: location.accuracy,
      },
    })
    res.status(201).json(attendance)
  } catch (error: any) {
    if (error?.code === 'P2002') { res.status(409).json({ error: 'Already checked in today' }); return }
    res.status(500).json({ error: 'Check-in failed' })
  }
})

router.post('/check-out', requireAuth, async (req, res) => {
  const parsed = locationSchema.safeParse(req.body || {})
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid location' }); return }
  const { date } = kampalaDay()
  const location = parsed.data
  const result = await prisma.staffAttendance.updateMany({
    where: { userId: req.user!.id, attendanceDate: date, checkOutAt: null },
    data: { checkOutAt: new Date(), checkOutLat: location.latitude, checkOutLng: location.longitude, checkOutAccuracy: location.accuracy },
  })
  if (result.count !== 1) { res.status(409).json({ error: 'No open attendance session to check out' }); return }
  const attendance = await prisma.staffAttendance.findUnique({ where: { userId_attendanceDate: { userId: req.user!.id, attendanceDate: date } } })
  res.json(attendance)
})

router.get('/today', requireAuth, async (req, res) => {
  const { date } = kampalaDay()
  const attendance = await prisma.staffAttendance.findUnique({ where: { userId_attendanceDate: { userId: req.user!.id, attendanceDate: date } } })
  res.json({ checkedIn: Boolean(attendance), currentlyCheckedIn: Boolean(attendance && !attendance.checkOutAt), attendance })
})

router.get('/me', requireAuth, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 180)
  res.json(await prisma.staffAttendance.findMany({ where: { userId: req.user!.id }, orderBy: { attendanceDate: 'desc' }, take: limit }))
})

router.get('/admin', requireAuth, adminOnly, async (req, res) => {
  const day = kampalaDay(req.query.date ? new Date(`${req.query.date}T12:00:00+03:00`) : new Date())
  const role = typeof req.query.role === 'string' ? req.query.role : undefined
  const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined
  const rows = await prisma.staffAttendance.findMany({
    where: { attendanceDate: day.date, ...(userId ? { userId } : {}), ...(role ? { user: { role: role as any } } : {}) },
    include: { user: { select: { id: true, firstName: true, lastName: true, role: true, isActive: true } } },
    orderBy: { checkInAt: 'asc' },
  })
  res.json(rows)
})

export default router
