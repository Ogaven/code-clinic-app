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
const geofenceSchema = z.object({
  enabled: z.boolean().default(false),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMetres: z.number().int().min(10).max(50_000),
  maximumAccuracyMetres: z.number().int().min(5).max(10_000).default(250),
})
const GEOFENCE_KEY = 'attendance_clinic_geofence'

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

router.get('/config', requireAuth, async (_req, res) => {
  const row = await prisma.appSetting.findUnique({ where: { key: GEOFENCE_KEY } })
  if (!row) { res.json({ configured: false, enabled: false }); return }
  try { res.json({ configured: true, ...geofenceSchema.parse(JSON.parse(row.value)) }) }
  catch { res.status(500).json({ error: 'Attendance geofence configuration is invalid' }) }
})

router.put('/config', requireAuth, adminOnly, async (req, res) => {
  const parsed = geofenceSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid geofence configuration' }); return }
  await prisma.appSetting.upsert({ where: { key: GEOFENCE_KEY }, update: { value: JSON.stringify(parsed.data) }, create: { key: GEOFENCE_KEY, value: JSON.stringify(parsed.data) } })
  res.json({ configured: true, ...parsed.data })
})

router.get('/admin', requireAuth, adminOnly, async (req, res) => {
  const fromValue = typeof req.query.from === 'string' ? req.query.from : typeof req.query.date === 'string' ? req.query.date : undefined
  const toValue = typeof req.query.to === 'string' ? req.query.to : fromValue
  const from = kampalaDay(fromValue ? new Date(`${fromValue}T12:00:00+03:00`) : new Date()).date
  const to = kampalaDay(toValue ? new Date(`${toValue}T12:00:00+03:00`) : new Date()).date
  const role = typeof req.query.role === 'string' ? req.query.role : undefined
  const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined
  const status = typeof req.query.status === 'string' ? req.query.status : undefined
  const rows = await prisma.staffAttendance.findMany({
    where: { attendanceDate: { gte: from, lte: to }, ...(userId ? { userId } : {}), ...(status ? { status } : {}), ...(role ? { user: { role: role as any } } : {}) },
    include: { user: { select: { id: true, firstName: true, lastName: true, role: true, isActive: true } } },
    orderBy: [{ attendanceDate: 'desc' }, { checkInAt: 'asc' }],
  })
  res.json(rows)
})

export default router
