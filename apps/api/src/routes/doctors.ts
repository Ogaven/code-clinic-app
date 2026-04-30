import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import multer from 'multer'
import { requireAuth } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { uploadAvatar, getPublicUrl } from '../services/storage/r2'
import { uploadLimiter } from '../middleware/rateLimit'

const router = Router()
const prisma = new PrismaClient()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } })
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']

function formatDoctor(d: any) {
  const key = d.user.avatarR2Key
  let avatarUrl: string | null = null
  if (key) {
    // base64 data URL stored directly (legacy fallback)
    avatarUrl = key.startsWith('data:') ? key : getPublicUrl(key)
  }
  return {
    id: d.id,
    userId: d.userId,
    firstName: d.user.firstName,
    lastName: d.user.lastName,
    email: d.user.email,
    phone: d.user.phone,
    specialisation: d.specialisation,
    colour: d.colour,
    workingDays: d.workingDays,
    workingHours: d.workingHours,
    serviceIds: d.serviceIds ?? '[]',
    avatarUrl,
    isActive: d.isActive,
  }
}

const INCLUDE = {
  user: { select: { id: true, firstName: true, lastName: true, avatarR2Key: true, email: true, phone: true } },
}

// POST /doctors — create new doctor (RECEPTIONIST + ADMIN allowed)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { firstName, lastName, email, phone, specialisation } = req.body
    if (!firstName || !lastName || !email) {
      res.status(400).json({ error: 'firstName, lastName and email are required' }); return
    }
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) { res.status(409).json({ error: 'Email already in use' }); return }

    const tempPw = await bcrypt.hash('Doctor@2024!', 12)
    const user = await prisma.user.create({
      data: { email, passwordHash: tempPw, role: 'DOCTOR', firstName, lastName, phone: phone || null, isActive: true },
    })
    const doctor = await prisma.doctor.create({
      data: {
        userId: user.id,
        specialisation: specialisation || null,
        colour: '#4A90D9',
        workingDays: JSON.stringify([1, 2, 3, 4, 5]),
        workingHours: JSON.stringify({ start: '08:00', end: '18:00' }),
        serviceIds: '[]',
        isActive: true,
      },
      include: INCLUDE,
    })
    res.status(201).json(formatDoctor(doctor))
  } catch (e: any) {
    if (e.code === 'P2002') { res.status(409).json({ error: 'Email already in use' }); return }
    console.error('[POST /doctors]', e.message)
    res.status(500).json({ error: 'Failed to create doctor' })
  }
})

// GET /doctors
router.get('/', requireAuth, async (_req, res) => {
  try {
    const doctors = await prisma.doctor.findMany({
      where: { isActive: true },
      include: INCLUDE,
      orderBy: { user: { firstName: 'asc' } },
    })
    res.json(doctors.map(formatDoctor))
  } catch { res.status(500).json({ error: 'Failed to fetch doctors' }) }
})

// GET /doctors/all (admin — includes inactive)
router.get('/all', requireAuth, adminOnly, async (_req, res) => {
  try {
    const doctors = await prisma.doctor.findMany({
      include: INCLUDE,
      orderBy: { user: { firstName: 'asc' } },
    })
    res.json(doctors.map(formatDoctor))
  } catch { res.status(500).json({ error: 'Failed to fetch doctors' }) }
})

// PATCH /doctors/:id
router.patch('/:id', requireAuth, adminOnly, async (req, res) => {
  try {
    const {
      firstName, lastName, phone, email,
      description,      // UI label — stored in specialisation column
      specialisation,   // legacy alias
      colour,
      workingDays,
      workingHours,     // accepts per-day map OR legacy {start, end}
      serviceIds,
      isActive,
    } = req.body

    // Build doctor update payload
    const doctorData: any = {}
    const desc = description ?? specialisation
    if (desc          !== undefined) doctorData.specialisation = desc
    if (colour        !== undefined) doctorData.colour         = colour
    if (workingDays   !== undefined) doctorData.workingDays    = JSON.stringify(workingDays)
    if (workingHours  !== undefined) doctorData.workingHours   = JSON.stringify(workingHours)
    if (serviceIds    !== undefined) doctorData.serviceIds     = JSON.stringify(serviceIds)
    if (isActive      !== undefined) doctorData.isActive       = isActive

    const doctor = await prisma.doctor.update({
      where: { id: req.params.id },
      data: doctorData,
      include: INCLUDE,
    })

    // Update User fields if provided
    const userData: any = {}
    if (firstName !== undefined) userData.firstName = firstName
    if (lastName  !== undefined) userData.lastName  = lastName
    if (phone     !== undefined) userData.phone     = phone
    if (email     !== undefined) userData.email     = email

    if (Object.keys(userData).length > 0) {
      await prisma.user.update({ where: { id: doctor.userId }, data: userData })
    }

    res.json({ success: true })
  } catch (e: any) {
    if (e.code === 'P2025') { res.status(404).json({ error: 'Doctor not found' }); return }
    res.status(500).json({ error: 'Failed to update doctor' })
  }
})

// POST /doctors/:id/avatar — upload doctor profile photo (jpg/png → R2 or base64 fallback)
router.post('/:id/avatar', requireAuth, uploadLimiter, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    if (!ALLOWED_MIME.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Only JPEG, PNG or WebP allowed' })
    }

    const doctor = await prisma.doctor.findUnique({
      where: { id: req.params.id },
      include: { user: true },
    })
    if (!doctor) return res.status(404).json({ error: 'Doctor not found' })

    let avatarUrl: string

    try {
      // Primary path: upload to R2 (or local file fallback when R2 not configured)
      const r2Key = await uploadAvatar(req.file.buffer, req.file.mimetype, 'doctors', doctor.userId)
      await prisma.user.update({ where: { id: doctor.userId }, data: { avatarR2Key: r2Key } })
      avatarUrl = getPublicUrl(r2Key)
    } catch {
      // Fallback: store raw base64 data URL directly in DB so it always works
      const base64 = req.file.buffer.toString('base64')
      const dataUrl = `data:${req.file.mimetype};base64,${base64}`
      await prisma.user.update({ where: { id: doctor.userId }, data: { avatarR2Key: dataUrl } })
      avatarUrl = dataUrl
    }

    res.json({ avatarUrl })
  } catch (err: any) {
    console.error('[doctor avatar] error:', err.message)
    res.status(500).json({ error: err.message || 'Upload failed' })
  }
})

// ─── Check In / Check Out ────────────────────────────────────────────────────

// POST /doctors/check-in
router.post('/check-in', requireAuth, async (req, res) => {
  try {
    const { type = 'CHECK_IN', note, lat, lng } = req.body
    const userId = req.user!.id

    // Find the doctor record for this user
    const doctor = await prisma.doctor.findFirst({
      where: { userId },
      include: { user: { select: { firstName: true, lastName: true } } },
    })
    if (!doctor) { res.status(404).json({ error: 'Doctor record not found' }); return }

    const record = await prisma.doctorCheckIn.create({
      data: { doctorId: doctor.id, userId, type, note, lat, lng },
    })

    const timeStr = new Date().toLocaleTimeString('en-UG', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
    })
    const doctorName = `Dr. ${doctor.user.firstName} ${doctor.user.lastName}`
    const isCheckIn = type === 'CHECK_IN'
    const msgAdmin = isCheckIn
      ? `${doctorName} has checked in at ${timeStr}`
      : `${doctorName} has checked out at ${timeStr}`
    const msgReception = isCheckIn
      ? `${doctorName} is now available`
      : `${doctorName} is no longer available`

    // Notify all ADMIN and RECEPTIONIST users
    const targets = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'RECEPTIONIST'] }, isActive: true },
      select: { id: true, role: true },
    })
    for (const t of targets) {
      await prisma.notification.create({
        data: {
          userId: t.id,
          type: 'SYSTEM',
          title: isCheckIn ? 'Doctor Check-In' : 'Doctor Check-Out',
          body: t.role === 'ADMIN' ? msgAdmin : msgReception,
          href: '/scheduling',
        },
      }).catch(() => {})
    }

    res.json({ success: true, type, time: timeStr, id: record.id })
  } catch (e) {
    console.error('[check-in]', e)
    res.status(500).json({ error: 'Check-in failed' })
  }
})

// GET /doctors/check-in/today
router.get('/check-in/today', requireAuth, async (req, res) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const record = await prisma.doctorCheckIn.findFirst({
      where: { userId: req.user!.id, type: 'CHECK_IN', createdAt: { gte: today } },
      orderBy: { createdAt: 'desc' },
    })
    if (!record) { res.json({ checkedIn: false }); return }
    const timeStr = new Date(record.createdAt).toLocaleTimeString('en-UG', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
    })
    res.json({ checkedIn: true, time: timeStr, id: record.id })
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch check-in status' })
  }
})

// GET /doctors/check-in/history
router.get('/check-in/history', requireAuth, async (req, res) => {
  try {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const records = await prisma.doctorCheckIn.findMany({
      where: { userId: req.user!.id, createdAt: { gte: sevenDaysAgo } },
      orderBy: { createdAt: 'desc' },
    })
    res.json(records)
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch check-in history' })
  }
})

export default router
