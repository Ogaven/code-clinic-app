import { Router, Request, Response, NextFunction } from 'express'
import { google } from 'googleapis'
import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'
import { requireAuth } from '../middleware/auth'
import { adminOnly, clinicalStaff } from '../middleware/rbac'

const router = Router()
const prisma = new PrismaClient()

// ─── OAuth2 client factory ────────────────────────────────────
function makeOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/integrations/google-calendar/callback',
  )
}

// Token file lives next to the SQLite DB in the repo root
const TOKEN_FILE = path.resolve(process.cwd(), '../../gcal-tokens.json')

function loadTokens(): any | null {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8')) } catch { return null }
}
function saveTokens(tokens: any) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2))
}
function deleteTokens() {
  try { fs.unlinkSync(TOKEN_FILE) } catch { }
}
function getAuthedClient() {
  const tokens = loadTokens()
  if (!tokens) return null
  const auth = makeOAuth2Client()
  auth.setCredentials(tokens)
  auth.on('tokens', (t) => saveTokens({ ...loadTokens(), ...t }))
  return auth
}

// Middleware: also accept ?token= query param for browser-redirect routes
function acceptTokenFromQuery(req: Request, _res: Response, next: NextFunction) {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`
  }
  next()
}

// ─── GET /integrations/google-calendar/status ────────────────
router.get('/google-calendar/status', requireAuth, (_req, res) => {
  const tokens = loadTokens()
  if (!tokens) return res.json({ connected: false })
  res.json({
    connected:  true,
    hasRefresh: !!tokens.refresh_token,
    expiry:     tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
  })
})

// ─── GET /integrations/google-calendar/auth ──────────────────
// Browser navigates here → redirected to Google consent screen
router.get('/google-calendar/auth',
  acceptTokenFromQuery, requireAuth, clinicalStaff,
  (_req, res) => {
    const auth = makeOAuth2Client()
    const url  = auth.generateAuthUrl({
      access_type: 'offline',
      prompt:      'consent',   // Always return refresh_token
      scope: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
      ],
    })
    res.redirect(url)
  },
)

// ─── GET /integrations/google-calendar/callback ──────────────
// Google sends user back here with ?code=
router.get('/google-calendar/callback', async (req, res) => {
  const { code, error } = req.query as Record<string, string>
  const front = process.env.APP_URL || 'http://localhost:3000'

  if (error || !code) {
    const reason = error || 'no_code'
    console.error('[GCal] OAuth error:', reason)
    return res.redirect(`${front}/scheduling?gcal=error&reason=${encodeURIComponent(reason)}`)
  }

  try {
    const auth       = makeOAuth2Client()
    const { tokens } = await auth.getToken(code)
    saveTokens(tokens)
    console.log('[GCal] ✅ Connected — tokens saved')
    res.redirect(`${front}/scheduling?gcal=connected`)
  } catch (e: any) {
    console.error('[GCal] Token exchange error:', e.message)
    res.redirect(`${front}/scheduling?gcal=error&reason=${encodeURIComponent(e.message)}`)
  }
})

// ─── DELETE /integrations/google-calendar/disconnect ─────────
router.delete('/google-calendar/disconnect', requireAuth, clinicalStaff, (_req, res) => {
  deleteTokens()
  res.json({ message: 'Disconnected' })
})

// ─── POST /integrations/google-calendar/sync ─────────────────
router.post('/google-calendar/sync', requireAuth, clinicalStaff, async (req, res) => {
  const auth = getAuthedClient()
  if (!auth) {
    return res.status(401).json({ error: 'Google Calendar not connected. Please connect first.' })
  }

  const { calendarId = 'primary', daysBack = 1, daysForward = 30 } = req.body

  try {
    const calendar = google.calendar({ version: 'v3', auth })

    const since = new Date(); since.setDate(since.getDate() - Number(daysBack))
    const until = new Date(); until.setDate(until.getDate() + Number(daysForward))

    const appointments = await prisma.appointment.findMany({
      where: { startAt: { gte: since, lte: until }, status: { not: 'CANCELLED' } },
      include: {
        patient: { select: { firstName: true, lastName: true, phone: true } },
        doctor:  { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
        service: { select: { name: true, durationMins: true } },
      },
    })

    let created = 0, updated = 0, errors = 0

    for (const appt of appointments) {
      const event = {
        summary: `${appt.patient.firstName} ${appt.patient.lastName} — ${appt.service.name}`,
        description: [
          `Patient: ${appt.patient.firstName} ${appt.patient.lastName}`,
          `Phone:   ${appt.patient.phone}`,
          `Service: ${appt.service.name} (${appt.service.durationMins} min)`,
          `Doctor:  Dr. ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`,
          `Status:  ${appt.status}`,
          ``,
          `Manage: ${process.env.APP_URL || 'http://localhost:3000'}/scheduling`,
        ].join('\n'),
        start:      { dateTime: appt.startAt.toISOString(), timeZone: 'Africa/Kampala' },
        end:        { dateTime: appt.endAt.toISOString(),   timeZone: 'Africa/Kampala' },
        colorId:    statusColorId(appt.status),
        attendees:  appt.doctor.user.email
          ? [{ email: appt.doctor.user.email, displayName: `Dr. ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}` }]
          : undefined,
        extendedProperties: { private: { codeclinicId: appt.id } },
      }

      try {
        // Look for an existing event we created before
        const existing = await (calendar.events.list as any)({
          calendarId,
          privateExtendedProperty: `codeclinicId=${appt.id}`,
          maxResults: 1,
        })

        if (existing.data.items?.length) {
          await calendar.events.patch({ calendarId, eventId: existing.data.items[0].id!, requestBody: event })
          updated++
        } else {
          await calendar.events.insert({ calendarId, requestBody: event })
          created++
        }
      } catch (e: any) {
        console.error('[GCal] Event error:', appt.id, e.message)
        errors++
      }
    }

    res.json({
      success: true, created, updated, errors,
      total:   appointments.length,
      message: `Synced ${created + updated} of ${appointments.length} appointments`,
    })
  } catch (e: any) {
    console.error('[GCal] Sync error:', e.message)
    if (e.code === 401 || e.message?.includes('invalid_grant')) {
      deleteTokens()
      return res.status(401).json({ error: 'Google session expired — please reconnect.' })
    }
    res.status(500).json({ error: 'Sync failed: ' + e.message })
  }
})

function statusColorId(status: string): string {
  return ({ CONFIRMED: '9', PENDING: '5', COMPLETED: '2', CANCELLED: '11', NO_SHOW: '8', IN_PROGRESS: '3' } as any)[status] ?? '1'
}

export default router
