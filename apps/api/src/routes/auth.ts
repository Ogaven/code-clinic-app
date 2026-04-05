import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import * as OTPAuth from 'otpauth'
import QRCode from 'qrcode'
import { PrismaClient } from '@prisma/client'
import { validate } from '../middleware/validate'
import { requireAuth } from '../middleware/auth'
import { authLimiter } from '../middleware/rateLimit'

const router = Router()
const prisma = new PrismaClient()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

const totpSchema = z.object({
  token: z.string().length(6),
})

function signAccess(user: { id: string; email: string; role: string; firstName: string; lastName: string }) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' },
  )
}

function signRefresh(userId: string) {
  return jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET!, { expiresIn: '7d' })
}

function setRefreshCookie(res: any, token: string) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/auth/refresh',
  })
}

// POST /auth/login
router.post('/login', authLimiter, validate(loginSchema), async (req, res) => {
  const { email, password } = req.body

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !user.isActive) {
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } })

  if (user.twoFactorEnabled) {
    // Return temp token for 2FA step
    const tempToken = jwt.sign({ id: user.id, step: '2fa' }, process.env.JWT_SECRET!, { expiresIn: '5m' })
    res.json({ requiresTwoFactor: true, tempToken })
    return
  }

  const accessToken = signAccess(user)
  const refreshToken = signRefresh(user.id)
  setRefreshCookie(res, refreshToken)

  res.json({
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarR2Key: user.avatarR2Key,
    },
  })
})

// POST /auth/2fa/validate  — second step after password
router.post('/2fa/validate', authLimiter, validate(totpSchema), async (req, res) => {
  const authHeader = req.headers.authorization
  const tempToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!tempToken) { res.status(401).json({ error: 'Temp token required' }); return }

  let payload: any
  try {
    payload = jwt.verify(tempToken, process.env.JWT_SECRET!)
  } catch {
    res.status(401).json({ error: 'Invalid or expired temp token' })
    return
  }

  if (payload.step !== '2fa') { res.status(401).json({ error: 'Invalid token step' }); return }

  const user = await prisma.user.findUnique({ where: { id: payload.id } })
  if (!user?.twoFactorSecret) { res.status(400).json({ error: '2FA not configured' }); return }

  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(user.twoFactorSecret),
    digits: 6,
    period: 30,
  })

  const delta = totp.validate({ token: req.body.token, window: 1 })
  if (delta === null) {
    res.status(401).json({ error: 'Invalid authentication code' })
    return
  }

  const accessToken = signAccess(user)
  const refreshToken = signRefresh(user.id)
  setRefreshCookie(res, refreshToken)

  res.json({
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
    },
  })
})

// POST /auth/refresh
router.post('/refresh', async (req, res) => {
  const token = req.cookies?.refreshToken
  if (!token) { res.status(401).json({ error: 'No refresh token' }); return }

  try {
    const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as { id: string }
    const user = await prisma.user.findUnique({ where: { id: payload.id } })
    if (!user || !user.isActive) { res.status(401).json({ error: 'User not found' }); return }

    const accessToken = signAccess(user)
    const newRefresh = signRefresh(user.id)
    setRefreshCookie(res, newRefresh)

    res.json({ accessToken })
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' })
  }
})

// POST /auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('refreshToken', { path: '/auth/refresh' })
  res.json({ message: 'Logged out successfully' })
})

// POST /auth/2fa/setup — generate TOTP secret
router.post('/2fa/setup', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
  if (!user) { res.status(404).json({ error: 'User not found' }); return }

  const secret = new OTPAuth.Secret()
  const totp = new OTPAuth.TOTP({
    issuer: 'CodeClinic',
    label: user.email,
    secret,
    digits: 6,
    period: 30,
  })

  const qrUri = totp.toString()
  const qrDataUrl = await QRCode.toDataURL(qrUri)

  // Store secret temporarily (user must verify before it activates)
  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorSecret: secret.base32 },
  })

  res.json({ secret: secret.base32, qrDataUrl, otpAuthUrl: qrUri })
})

// POST /auth/2fa/verify — activate 2FA after setup
router.post('/2fa/verify', requireAuth, validate(totpSchema), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
  if (!user?.twoFactorSecret) { res.status(400).json({ error: '2FA setup required first' }); return }

  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(user.twoFactorSecret),
    digits: 6,
    period: 30,
  })

  const delta = totp.validate({ token: req.body.token, window: 1 })
  if (delta === null) {
    res.status(400).json({ error: 'Invalid code. Please try again.' })
    return
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorEnabled: true },
  })

  res.json({ message: '2FA enabled successfully' })
})

// GET /auth/me
router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true, email: true, role: true, firstName: true,
      lastName: true, phone: true, avatarR2Key: true,
      twoFactorEnabled: true, lastLogin: true, createdAt: true,
      doctor: { select: { id: true, specialisation: true, colour: true, photoR2Key: true } },
    },
  })
  res.json(user)
})

export default router
