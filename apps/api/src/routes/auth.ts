import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import * as OTPAuth from 'otpauth'
import QRCode from 'qrcode'
import { validate } from '../middleware/validate'
import { requireAuth } from '../middleware/auth'
import { authLimiter } from '../middleware/rateLimit'
import { getPublicUrl } from '../services/storage/r2'
import { blacklistToken } from '../lib/tokenBlacklist'
import { prisma } from '../lib/prisma'
import { env } from '../lib/env'
import { logAudit } from '../services/audit.service'

const router = Router()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

const totpSchema = z.object({
  token: z.string().length(6),
})

function signAccess(user: { id: string; email: string; role: string; firstName: string; lastName: string; doctorId?: string; permissions?: string }) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName,
      ...(user.doctorId   ? { doctorId:    user.doctorId   } : {}),
      ...(user.permissions !== undefined ? { permissions: user.permissions } : {}) },
    process.env.JWT_SECRET!,
    { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
  )
}

async function getSignPayload(user: { id: string; email: string; role: string; firstName: string; lastName: string }) {
  const fullUser = await prisma.user.findUnique({ where: { id: user.id }, select: { permissions: true, doctor: { select: { id: true } } } })
  const base: { id: string; email: string; role: string; firstName: string; lastName: string; doctorId?: string; permissions: string } = {
    ...user, permissions: fullUser?.permissions || '{}',
  }
  if (user.role === 'DOCTOR') base.doctorId = fullUser?.doctor?.id
  return base
}

function signRefresh(userId: string) {
  return jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET!, { expiresIn: '30d' })
}

function setRefreshCookie(res: any, token: string) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/auth/refresh',
  })
}

// GET /auth/needs-setup — check if DB has any users
router.get('/needs-setup', async (_req, res) => {
  try {
    const count = await prisma.user.count()
    res.json({ needsSetup: count === 0 })
  } catch {
    res.json({ needsSetup: false })
  }
})

// POST /auth/setup — create admin account (upserts so always works)
router.post('/setup', async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body
    if (!firstName || !lastName || !email || !password || password.length < 6) {
      res.status(400).json({ error: 'All fields required. Password min 6 characters.' })
      return
    }
    const hash = await bcrypt.hash(password, 12)
    const user = await prisma.user.upsert({
      where: { email },
      update: { passwordHash: hash, firstName, lastName, role: 'ADMIN' },
      create: { email, passwordHash: hash, role: 'ADMIN', firstName, lastName, phone: '+256700000000' },
    })
    const accessToken  = signAccess({ ...user, permissions: user.permissions ?? undefined })
    const refreshToken = signRefresh(user.id)
    setRefreshCookie(res, refreshToken)
    res.json({ accessToken, user: { id: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName } })
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Setup failed' })
  }
})

// POST /auth/login
router.post('/login', authLimiter, validate(loginSchema), async (req, res) => {
  const { email, password } = req.body

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !user.isActive) {
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }

  if (!user.passwordHash) {
    res.status(401).json({ error: 'This account uses Google sign-in. Use "Continue with Google".' })
    return
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    logAudit({ userId: user.id, actionType: 'LOGIN_FAILED', entityType: 'STAFF', entityId: user.id, entityName: `${user.firstName} ${user.lastName}`, severity: 'WARNING', req })
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } })

  if (user.twoFactorEnabled) {
    const tempToken = jwt.sign({ id: user.id, step: '2fa' }, process.env.JWT_SECRET!, { expiresIn: '5m' })
    res.json({ requiresTwoFactor: true, tempToken })
    return
  }

  const payload = await getSignPayload(user)
  const accessToken = signAccess(payload)
  const refreshToken = signRefresh(user.id)
  setRefreshCookie(res, refreshToken)

  logAudit({ userId: user.id, actionType: 'LOGIN', entityType: 'STAFF', entityId: user.id, entityName: `${user.firstName} ${user.lastName}`, req })

  const avatarUrl = user.avatarR2Key
    ? (user.avatarR2Key.startsWith('data:') ? user.avatarR2Key : getPublicUrl(user.avatarR2Key))
    : null
  res.json({
    accessToken,
    user: { id: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName, avatarR2Key: user.avatarR2Key, avatarUrl,
      permissions: payload.permissions || '{}',
      ...(payload.doctorId ? { doctorId: payload.doctorId } : {}) },
  })
})

// ── Google OAuth ──────────────────────────────────────────────

// GET /auth/google — redirect to Google
router.get('/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) { res.status(501).json({ error: 'Google OAuth not configured. Add GOOGLE_CLIENT_ID to Railway.' }); return }
  const appUrl = process.env.APP_URL || 'https://codeclinic-production-73f628.up.railway.app'
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl}/api-proxy/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  })
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})

// GET /auth/google/callback — handle Google OAuth callback
router.get('/google/callback', async (req, res) => {
  const { code } = req.query
  const appUrl = process.env.APP_URL || 'https://codeclinic-production-73f628.up.railway.app'

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${appUrl}/api-proxy/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    })
    const tokenData = await tokenRes.json() as any

    // Get user info from Google
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const profile = await profileRes.json() as any

    // Only allow Google sign-in for accounts already created by an admin.
    // Self-registration via Google is disabled — prevents unknown users getting
    // a default RECEPTIONIST role and accessing the system.
    const user = await prisma.user.findUnique({ where: { email: profile.email } })
    if (!user) {
      res.redirect(`${appUrl}/login?error=google_no_account`)
      return
    }
    if (!user.isActive) {
      res.redirect(`${appUrl}/login?error=google_inactive`)
      return
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } })

    const googlePayload = await getSignPayload(user)
    const accessToken  = signAccess(googlePayload)
    const refreshToken = signRefresh(user.id)
    setRefreshCookie(res, refreshToken)
    logAudit({ userId: user.id, actionType: 'LOGIN', entityType: 'STAFF', entityId: user.id, entityName: `${user.firstName} ${user.lastName}`, notes: 'Google OAuth', req })

    // Redirect to frontend callback page with token
    const userData = encodeURIComponent(JSON.stringify({
      id: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName,
      permissions: googlePayload.permissions || '{}',
      ...(googlePayload.doctorId ? { doctorId: googlePayload.doctorId } : {}),
    }))
    res.redirect(`${appUrl}/auth/callback?token=${accessToken}&user=${userData}`)
  } catch (e: any) {
    res.redirect(`${appUrl}/login?error=google_failed`)
  }
})

// POST /auth/2fa/validate
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

  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(user.twoFactorSecret), digits: 6, period: 30 })
  const delta = totp.validate({ token: req.body.token, window: 1 })
  if (delta === null) { res.status(401).json({ error: 'Invalid authentication code' }); return }

  const tfaPayload = await getSignPayload(user)
  const accessToken = signAccess(tfaPayload)
  const refreshToken = signRefresh(user.id)
  setRefreshCookie(res, refreshToken)
  res.json({ accessToken, user: { id: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName,
    permissions: tfaPayload.permissions || '{}',
    ...(tfaPayload.doctorId ? { doctorId: tfaPayload.doctorId } : {}) } })
})

// POST /auth/refresh
router.post('/refresh', async (req, res) => {
  const token = req.cookies?.refreshToken
  if (!token) { res.status(401).json({ error: 'No refresh token' }); return }
  try {
    const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as { id: string }
    const user = await prisma.user.findUnique({ where: { id: payload.id } })
    if (!user || !user.isActive) { res.status(401).json({ error: 'User not found' }); return }
    const refreshPayload = await getSignPayload(user)
    const accessToken = signAccess(refreshPayload)
    const newRefresh = signRefresh(user.id)
    setRefreshCookie(res, newRefresh)
    res.json({ accessToken })
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' })
  }
})

// POST /auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  try {
    // Blacklist the current access token so it cannot be reused before expiry
    if (req.token) {
      const decoded = jwt.decode(req.token) as { exp?: number } | null
      if (decoded?.exp) {
        const ttl = decoded.exp - Math.floor(Date.now() / 1000)
        if (ttl > 0) await blacklistToken(req.token, ttl)
      }
    }
    logAudit({ userId: req.user!.id, actionType: 'LOGOUT', entityType: 'STAFF', entityId: req.user!.id, entityName: `${req.user!.firstName} ${req.user!.lastName}`, req })
    res.clearCookie('refreshToken', { path: '/auth/refresh' })
    res.json({ message: 'Logged out' })
  } catch {
    res.clearCookie('refreshToken', { path: '/auth/refresh' })
    res.json({ message: 'Logged out' })
  }
})

// POST /auth/2fa/setup
router.post('/2fa/setup', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
  if (!user) { res.status(404).json({ error: 'User not found' }); return }
  const secret = new OTPAuth.Secret()
  const totp = new OTPAuth.TOTP({ issuer: 'CodeClinic', label: user.email, secret, digits: 6, period: 30 })
  const qrDataUrl = await QRCode.toDataURL(totp.toString())
  await prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: secret.base32 } })
  res.json({ secret: secret.base32, qrDataUrl, otpAuthUrl: totp.toString() })
})

// POST /auth/2fa/verify
router.post('/2fa/verify', requireAuth, validate(totpSchema), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
  if (!user?.twoFactorSecret) { res.status(400).json({ error: '2FA setup required first' }); return }
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(user.twoFactorSecret), digits: 6, period: 30 })
  const delta = totp.validate({ token: req.body.token, window: 1 })
  if (delta === null) { res.status(400).json({ error: 'Invalid code' }); return }
  await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } })
  res.json({ message: '2FA enabled' })
})

// PATCH /auth/me — update own profile (name, phone, bio, avatar)
router.patch('/me', requireAuth, async (req, res) => {
  const { firstName, lastName, phone, bio, avatar } = req.body
  try {
    const data: any = {}
    if (firstName) data.firstName = firstName.trim()
    if (lastName)  data.lastName  = lastName.trim()
    if (phone !== undefined) data.phone = phone?.trim() || null
    if (bio   !== undefined) data.bio   = bio?.trim()   || null
    if (avatar !== undefined) data.avatarR2Key = avatar   // base64 data URL or R2 key

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data,
      select: { id:true, email:true, role:true, firstName:true, lastName:true, phone:true, avatarR2Key:true },
    })
    const avatarUrl = updated.avatarR2Key
      ? (updated.avatarR2Key.startsWith('data:') ? updated.avatarR2Key : getPublicUrl(updated.avatarR2Key))
      : null
    res.json({ ...updated, avatarUrl, avatar: avatarUrl })
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to update profile' })
  }
})

// GET /auth/me
router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id:true, email:true, role:true, firstName:true, lastName:true, phone:true, avatarR2Key:true, twoFactorEnabled:true, lastLogin:true, createdAt:true,
      doctor: { select: { id:true, specialisation:true, colour:true, photoR2Key:true } } },
  })
  if (!user) { res.status(404).json({ error: 'User not found' }); return }
  const avatarUrl = user.avatarR2Key
    ? (user.avatarR2Key.startsWith('data:') ? user.avatarR2Key : getPublicUrl(user.avatarR2Key))
    : null
  res.json({ ...user, avatarUrl })
})

export default router
