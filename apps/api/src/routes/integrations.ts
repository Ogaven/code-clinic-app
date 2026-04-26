import { Router, Request, Response, NextFunction } from 'express'
import { google } from 'googleapis'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/auth'
import { clinicalStaff } from '../middleware/rbac'

const router = Router()
const prisma = new PrismaClient()

// ─── OAuth2 client factory ────────────────────────────────────
function getRedirectUri() {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI
  if (process.env.RAILWAY_PUBLIC_DOMAIN)
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/integrations/google-calendar/callback`
  return 'http://localhost:4000/api/integrations/google-calendar/callback'
}

function makeOAuth2Client() {
  const redirectUri = getRedirectUri()
  console.log('[GCal] Using redirect URI:', redirectUri)
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri,
  )
}

// ─── DB-backed token store (persists across Railway deploys) ──
const GCAL_KEY = 'gcal_tokens'

async function loadTokens(): Promise<any | null> {
  try {
    const rows = await prisma.$queryRaw<{ value: string }[]>`SELECT value FROM app_settings WHERE key = ${GCAL_KEY} LIMIT 1`
    return rows.length ? JSON.parse(rows[0].value) : null
  } catch { return null }
}

async function saveTokens(tokens: any) {
  try {
    const value = JSON.stringify(tokens)
    await prisma.$executeRaw`
      INSERT INTO app_settings (key, value, "updatedAt")
      VALUES (${GCAL_KEY}, ${value}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = ${value}, "updatedAt" = NOW()
    `
  } catch (e) { console.error('[GCal] saveTokens error:', e) }
}

async function deleteTokens() {
  try { await prisma.$executeRaw`DELETE FROM app_settings WHERE key = ${GCAL_KEY}` } catch {}
}

async function getAuthedClient() {
  const tokens = await loadTokens()
  if (!tokens) return null
  const auth = makeOAuth2Client()
  auth.setCredentials(tokens)
  auth.on('tokens', async (t) => {
    const current = await loadTokens()
    await saveTokens({ ...current, ...t })
  })
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
router.get('/google-calendar/status', requireAuth, async (_req, res) => {
  const tokens = await loadTokens()
  if (!tokens) return res.json({ connected: false })
  const emailRow = await prisma.$queryRaw<{ value: string }[]>`SELECT value FROM app_settings WHERE key = 'gcal_email' LIMIT 1`.catch(() => [])
  let email: string | null = emailRow.length ? emailRow[0].value : null
  // Handle legacy rows that were stored with JSON.stringify (have surrounding quotes)
  if (email) { try { email = JSON.parse(email) } catch { /* raw value is fine */ } }
  res.json({
    connected:  true,
    email,
    hasRefresh: !!tokens.refresh_token,
    expiry:     tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    redirectUri: getRedirectUri(),
  })
})

// ─── GET /integrations/google-calendar/auth-url ──────────────
// Returns JSON { url } — frontend fetches this then navigates; avoids token-in-URL issues
router.get('/google-calendar/auth-url', requireAuth, clinicalStaff, (req, res) => {
  const auth     = makeOAuth2Client()
  const returnTo = (req.query.returnTo as string) || '/scheduling'
  const url = auth.generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    state: encodeURIComponent(returnTo),
  })
  res.json({ url })
})

// ─── GET /integrations/google-calendar/auth ──────────────────
// Legacy: browser navigates here → redirected to Google consent screen
router.get('/google-calendar/auth',
  acceptTokenFromQuery, requireAuth, clinicalStaff,
  (req, res) => {
    const auth     = makeOAuth2Client()
    const returnTo = (req.query.returnTo as string) || '/scheduling'
    const url  = auth.generateAuthUrl({
      access_type: 'offline',
      prompt:      'consent',
      scope: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      state: encodeURIComponent(returnTo),
    })
    res.redirect(url)
  },
)

// ─── GET /integrations/google-calendar/callback ──────────────
// Google sends user back here with ?code=
router.get('/google-calendar/callback', async (req, res) => {
  const { code, error, state } = req.query as Record<string, string>
  const front    = process.env.APP_URL || 'http://localhost:3000'
  const returnTo = state ? decodeURIComponent(state) : '/scheduling'
  console.log('[GCal] Callback hit — code:', !!code, 'error:', error || 'none', 'redirectUri:', getRedirectUri())

  if (error || !code) {
    const reason = error || 'no_code'
    console.error('[GCal] OAuth error:', reason)
    return res.redirect(`${front}${returnTo}?gcal=error&reason=${encodeURIComponent(reason)}`)
  }

  try {
    const auth       = makeOAuth2Client()
    const { tokens } = await auth.getToken(code)
    await saveTokens(tokens)
    // Fetch and persist the authenticated user's email
    try {
      auth.setCredentials(tokens)
      const oauth2 = google.oauth2({ version: 'v2', auth })
      const info   = await oauth2.userinfo.get()
      const email  = info.data.email
      if (email) {
        await prisma.$executeRaw`
          INSERT INTO app_settings (key, value, "updatedAt") VALUES ('gcal_email', ${email}, NOW())
          ON CONFLICT (key) DO UPDATE SET value = ${email}, "updatedAt" = NOW()
        `
        console.log('[GCal] Connected as', email)
      }
    } catch (emailErr: any) { console.warn('[GCal] Could not fetch email:', emailErr.message) }
    res.redirect(`${front}${returnTo}?gcal=connected`)
  } catch (e: any) {
    console.error('[GCal] Token exchange error:', e.message)
    res.redirect(`${front}${returnTo}?gcal=error&reason=${encodeURIComponent(e.message)}`)
  }
})

// ─── DELETE /integrations/google-calendar/disconnect ─────────
router.delete('/google-calendar/disconnect', requireAuth, clinicalStaff, async (_req, res) => {
  await deleteTokens()
  res.json({ message: 'Disconnected' })
})

// ─── POST /integrations/google-calendar/sync ─────────────────
router.post('/google-calendar/sync', requireAuth, clinicalStaff, async (req, res) => {
  const auth = await getAuthedClient()
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
          `Manage: ${process.env.APP_URL || 'http://localhost:3000'}/receptionist/appointments`,
        ].join('\n'),
        start:      { dateTime: appt.startAt.toISOString(), timeZone: 'Africa/Kampala' },
        end:        { dateTime: appt.endAt.toISOString(),   timeZone: 'Africa/Kampala' },
        colorId:    statusColorId(appt.status),
        extendedProperties: { private: { codeclinicId: appt.id } },
      }

      try {
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
        // Respect Google Calendar API rate limits (3 req/s per user)
        await new Promise(r => setTimeout(r, 350))
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
      await deleteTokens()
      return res.status(401).json({ error: 'Google session expired — please reconnect.' })
    }
    res.status(500).json({ error: 'Sync failed: ' + e.message })
  }
})

// ─── GET /integrations/google-calendar/calendars ─────────────
// Returns the list of calendars in the connected Google account
router.get('/google-calendar/calendars', requireAuth, async (_req, res) => {
  const tokens = await loadTokens()
  if (!tokens) {
    console.log('[GCal] calendars: no tokens stored — not connected')
    return res.status(401).json({ error: 'Google Calendar not connected' })
  }

  console.log('[GCal] calendars: access_token=%s refresh_token=%s expiry=%s',
    tokens.access_token ? 'present' : 'MISSING',
    tokens.refresh_token ? 'present' : 'MISSING',
    tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'none',
  )

  const auth = makeOAuth2Client()
  auth.setCredentials(tokens)
  auth.on('tokens', async (t) => {
    const current = await loadTokens()
    await saveTokens({ ...current, ...t })
    console.log('[GCal] calendars: auto-refreshed tokens saved, expiry=%s',
      t.expiry_date ? new Date(t.expiry_date).toISOString() : 'none')
  })

  // Proactively refresh if the access token is already expired
  if (tokens.expiry_date && Date.now() >= tokens.expiry_date) {
    console.log('[GCal] calendars: access token expired — refreshing proactively')
    if (!tokens.refresh_token) {
      console.error('[GCal] calendars: no refresh_token available — reconnect required')
      return res.status(401).json({ error: 'Google session expired — please reconnect.' })
    }
    try {
      const { credentials } = await auth.refreshAccessToken()
      const merged = { ...tokens, ...credentials }
      await saveTokens(merged)
      auth.setCredentials(merged)
      console.log('[GCal] calendars: proactive refresh succeeded, new expiry=%s',
        credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : 'none')
    } catch (refreshErr: any) {
      console.error('[GCal] calendars: proactive refresh failed:', refreshErr.message)
      await deleteTokens()
      return res.status(401).json({ error: 'Google session expired — please reconnect.' })
    }
  }

  try {
    const calendar = google.calendar({ version: 'v3', auth })
    const r = await calendar.calendarList.list({ maxResults: 50 })
    const items = (r.data.items || []).map(c => ({
      id:      c.id!,
      summary: c.summary || c.id || 'Calendar',
      primary: !!c.primary,
    }))
    console.log('[GCal] calendars: fetched %d calendars', items.length)
    res.json(items)
  } catch (e: any) {
    console.error('[GCal] calendars error — code=%s status=%s message=%s', e.code, e.status, e.message)
    if (e.code === 401 || e.status === 401 || e.message?.includes('invalid_grant')) {
      await deleteTokens()
      return res.status(401).json({ error: 'Google session expired — please reconnect.' })
    }
    res.status(500).json({ error: e.message || 'Unknown error fetching calendars' })
  }
})

function statusColorId(status: string): string {
  return ({ CONFIRMED: '9', PENDING: '5', COMPLETED: '2', CANCELLED: '11', NO_SHOW: '8', IN_PROGRESS: '3' } as any)[status] ?? '1'
}

export default router
