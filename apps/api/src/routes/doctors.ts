import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { getSignedDownloadUrl } from '../services/storage/r2'

const router = Router()
const prisma = new PrismaClient()

async function formatDoctor(d: any) {
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
    avatarUrl: d.user.avatarR2Key
      ? await getSignedDownloadUrl(d.user.avatarR2Key).catch(() => null)
      : null,
    isActive: d.isActive,
  }
}

const INCLUDE = {
  user: { select: { id: true, firstName: true, lastName: true, avatarR2Key: true, email: true, phone: true } },
}

// GET /doctors
router.get('/', requireAuth, async (_req, res) => {
  try {
    const doctors = await prisma.doctor.findMany({
      where: { isActive: true },
      include: INCLUDE,
      orderBy: { user: { firstName: 'asc' } },
    })
    res.json(await Promise.all(doctors.map(formatDoctor)))
  } catch { res.status(500).json({ error: 'Failed to fetch doctors' }) }
})

// GET /doctors/all (admin — includes inactive)
router.get('/all', requireAuth, adminOnly, async (_req, res) => {
  try {
    const doctors = await prisma.doctor.findMany({
      include: INCLUDE,
      orderBy: { user: { firstName: 'asc' } },
    })
    res.json(await Promise.all(doctors.map(formatDoctor)))
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

export default router
