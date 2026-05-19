import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import multer from 'multer'
import { requireAuth } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { auditLog } from '../middleware/audit'
import { uploadLimiter } from '../middleware/rateLimit'
import { uploadAvatar, deleteFile, getPublicUrl } from '../services/storage/r2'
import { sendCredentialsEmail } from '../services/communications/email'
import { prisma } from '../lib/prisma'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']

function generatePassword(length = 16): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$!'
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

const createEmployeeSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  role: z.enum(['DOCTOR', 'RECEPTIONIST', 'ACCOUNTS', 'DEVELOPER']),
  specialisation: z.string().optional(),
  colour: z.string().optional(),
})

// GET /employees
router.get('/', requireAuth, adminOnly, async (_req, res) => {
  const employees = await prisma.user.findMany({
    where: { role: { not: 'ADMIN' } },
    select: {
      id: true, email: true, role: true, firstName: true, lastName: true,
      phone: true, isActive: true, lastLogin: true, avatarR2Key: true, createdAt: true,
      doctor: { select: { id: true, specialisation: true, colour: true, photoR2Key: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Use permanent public URLs for avatars (signed URLs expire after 1h)
  const withAvatars = employees.map((e) => ({
    ...e,
    avatarUrl: e.avatarR2Key ? getPublicUrl(e.avatarR2Key) : null,
    doctor: e.doctor ? {
      ...e.doctor,
      photoUrl: e.doctor.photoR2Key ? getPublicUrl(e.doctor.photoR2Key) : null,
    } : null,
  }))

  res.json(withAvatars)
})

// POST /employees
router.post('/', requireAuth, adminOnly, validate(createEmployeeSchema), auditLog('employees'), async (req, res) => {
  const { firstName, lastName, email, phone, role, specialisation, colour } = req.body

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    res.status(409).json({ error: 'An employee with this email already exists' })
    return
  }

  const password = generatePassword()
  const passwordHash = await bcrypt.hash(password, 12)

  const user = await prisma.user.create({
    data: {
      email, firstName, lastName, phone, role, passwordHash,
      doctor: role === 'DOCTOR' ? {
        create: {
          specialisation: specialisation || 'General Dentistry',
          colour: colour || '#4A90D9',
        },
      } : undefined,
    },
    include: { doctor: true },
  })

  // Send credentials email
  try {
    await sendCredentialsEmail({ email, firstName, lastName, role, password })
  } catch (err) {
    console.error('Failed to send credentials email:', err)
    // Don't fail — employee is created, email can be resent
  }

  res.status(201).json({
    id: user.id,
    email: user.email,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    message: 'Employee created and credentials sent via email',
  })
})

// PATCH /employees/:id/role
router.patch('/:id/role', requireAuth, adminOnly, auditLog('employees'), async (req, res) => {
  const { role } = req.body
  const VALID_ROLES = ['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'ACCOUNTS', 'DEVELOPER']
  if (!VALID_ROLES.includes(role)) {
    res.status(400).json({ error: 'Invalid role' })
    return
  }
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { role },
    select: { id: true, email: true, role: true, firstName: true, lastName: true },
  })
  res.json(user)
})

// PATCH /employees/:id — activate/deactivate or update details
router.patch('/:id', requireAuth, adminOnly, auditLog('employees'), async (req, res) => {
  const { isActive, firstName, lastName, phone } = req.body
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { isActive, firstName, lastName, phone },
    select: { id: true, email: true, role: true, firstName: true, lastName: true, isActive: true },
  })
  res.json(user)
})

// POST /employees/:id/avatar — upload profile photo
router.post('/:id/avatar', requireAuth, uploadLimiter,
  upload.single('avatar'),
  async (req, res) => {
    const { id } = req.params

    // Admin and Receptionist can upload for anyone; others only for themselves
    const isPrivileged = req.user!.role === 'ADMIN' || req.user!.role === 'RECEPTIONIST'
    if (!isPrivileged && req.user!.id !== id) {
      res.status(403).json({ error: 'You can only update your own avatar' })
      return
    }

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' })
      return
    }

    if (!ALLOWED_MIME.includes(req.file.mimetype)) {
      res.status(400).json({ error: 'Only JPEG, PNG or WebP images are allowed' })
      return
    }

    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) { res.status(404).json({ error: 'User not found' }); return }

    try {
      // Delete old avatar if exists
      if (user.avatarR2Key) {
        await deleteFile(user.avatarR2Key).catch(console.error)
      }

      const r2Key = await uploadAvatar(req.file.buffer, req.file.mimetype, 'avatars', id)
      await prisma.user.update({ where: { id }, data: { avatarR2Key: r2Key } })

      const avatarUrl = getPublicUrl(r2Key)
      res.json({ avatarUrl, r2Key })
    } catch (err: any) {
      console.error('[avatar upload] error:', err)
      res.status(500).json({ error: err.message || 'Upload failed' })
    }
  },
)

// DELETE /employees/:id/avatar
router.delete('/:id/avatar', requireAuth, async (req, res) => {
  const { id } = req.params
  if (req.user!.role !== 'ADMIN' && req.user!.id !== id) {
    res.status(403).json({ error: 'Access denied' })
    return
  }

  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) { res.status(404).json({ error: 'User not found' }); return }

  if (user.avatarR2Key) {
    await deleteFile(user.avatarR2Key).catch(console.error)
    await prisma.user.update({ where: { id }, data: { avatarR2Key: null } })
  }

  res.json({ message: 'Avatar removed' })
})

export default router
