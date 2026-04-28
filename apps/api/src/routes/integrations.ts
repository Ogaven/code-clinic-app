import { Router, Request, Response, NextFunction } from 'express'
import { google } from 'googleapis'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import { requireAuth } from '../middleware/auth'
import { clinicalStaff } from '../middleware/rbac'
import { processIncrementalSync } from '../services/gcal'

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

// ─── Webhook channel helpers ──────────────────────────────────
const GCAL_CHANNEL_KEY = 'gcal_channel'

function getWebhookAddress(): string | null {
  if (process.env.GOOGLE_WEBHOOK_URL) return process.env.GOOGLE_WEBHOOK_URL
  if (process.env.RAILWAY_PUBLIC_DOMAIN)
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/integrations/google-calendar/webhook`
  return null
}

async function loadChannel(): Promise<any | null> {
  try {
    const rows = await prisma.$queryRaw<{ value: string }[]>`SELECT value FROM app_settings WHERE key = ${GCAL_CHANNEL_KEY} LIMIT 1`
    return rows.length ? JSON.parse(rows[0].value) : null
  } catch { return null }
}

async function saveChannel(data: any) {
  try {
    const value = JSON.stringify(data)
    await prisma.$executeRaw`
      INSERT INTO app_settings (key, value, "updatedAt") VALUES (${GCAL_CHANNEL_KEY}, ${value}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = ${value}, "updatedAt" = NOW()
    `
  } catch {}
}

async function deleteChannel() {
  try { await prisma.$executeRaw`DELETE FROM app_settings WHERE key = ${GCAL_CHANNEL_KEY}` } catch {}
}

async function registerWatchChannel(auth: any): Promise<void> {
  const address = getWebhookAddress()
  if (!address) {
    console.log('[GCal] No public webhook URL — skipping watch channel registration')
    return
  }
  try {
    const calendar  = google.calendar({ version: 'v3', auth })
    const channelId = randomUUID()
    const res = await calendar.events.watch({
      calendarId: 'primary',
      requestBody: {
        id:      channelId,
        type:    'web_hook',
        address,
        token:   process.env.GCAL_WEBHOOK_TOKEN || channelId,
      },
    })
    await saveChannel({
      channelId,
      resourceId:  res.data.resourceId,
      expiration:  res.data.expiration,
      registeredAt: new Date().toISOString(),
    })
    console.log('[GCal] Watch channel registered, expires:', res.data.expiration)
  } catch (e: any) {
    console.warn('[GCal] Watch channel registration failed:', e.message)
  }
}

async function stopWatchChannel(auth: any): Promise<void> {
  const channel = await loadChannel()
  if (!channel) return
  try {
    const calendar = google.calendar({ version: 'v3', auth })
    await calendar.channels.stop({
      requestBody: { id: channel.channelId, resourceId: channel.resourceId },
    })
    console.log('[GCal] Watch channel stopped')
  } catch (e: any) {
    console.warn('[GCal] Stop channel failed:', e.message)
  }
  await deleteChannel()
}

// ─── GET /integrations/google-calendar/status ────────────────
router.get('/google-calendar/status', requireAuth, async (_req, res) => {
  const tokens = await loadTokens()
  if (!tokens) return res.json({ connected: false })
  const emailRow = await prisma.$queryRaw<{ value: string }[]>`SELECT value FROM app_settings WHERE key = 'gcal_email' LIMIT 1`.catch(() => [])
  let email: string | null = emailRow.length ? emailRow[0].value : null
  if (email) { try { email = JSON.parse(email) } catch { /* raw value is fine */ } }
  const channel = await loadChannel()
  const channelExpiry = channel?.expiration ? new Date(Number(channel.expiration)).toISOString() : null
  const channelActive = channel && channelExpiry ? new Date(channelExpiry) > new Date() : false
  res.json({
    connected:     true,
    email,
    hasRefresh:    !!tokens.refresh_token,
    expiry:        tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    redirectUri:   getRedirectUri(),
    webhookActive: channelActive,
    webhookExpiry: channelExpiry,
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
    // Register push notification channel for two-way sync (fire-and-forget)
    registerWatchChannel(auth).catch((e: any) => console.warn('[GCal] Watch registration error:', e.message))
    res.redirect(`${front}${returnTo}?gcal=connected`)
  } catch (e: any) {
    console.error('[GCal] Token exchange error:', e.message)
    res.redirect(`${front}${returnTo}?gcal=error&reason=${encodeURIComponent(e.message)}`)
  }
})

// ─── DELETE /integrations/google-calendar/disconnect ─────────
router.delete('/google-calendar/disconnect', requireAuth, async (_req, res) => {
  const auth = await getAuthedClient()
  if (auth) stopWatchChannel(auth).catch(() => {})
  await deleteTokens()
  await prisma.$executeRaw`DELETE FROM app_settings WHERE key = 'gcal_sync_token'`.catch(() => {})
  res.json({ message: 'Disconnected' })
})

// ─── POST /integrations/google-calendar/reset ─────────────────
// Clears expired/invalid tokens so status shows "Not connected".
router.post('/google-calendar/reset', requireAuth, async (_req, res) => {
  await deleteTokens()
  res.json({ message: 'Tokens cleared — reconnect Google Calendar' })
})

// ─── POST /integrations/google-calendar/sync ─────────────────
router.post('/google-calendar/sync', requireAuth, clinicalStaff, async (req, res) => {
  console.log('[GCal Sync] Manual sync triggered by user', (req as any).user?.email)

  const tokens = await loadTokens()
  if (!tokens) {
    console.log('[GCal Sync] No tokens stored — not connected')
    return res.status(401).json({ error: 'Google Calendar not connected. Please connect first.' })
  }

  console.log('[GCal Sync] Token status — access_token:%s refresh_token:%s expiry:%s',
    tokens.access_token ? 'present' : 'MISSING',
    tokens.refresh_token ? 'present' : 'MISSING',
    tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'none',
  )

  const auth = makeOAuth2Client()
  auth.setCredentials(tokens)
  auth.on('tokens', async (t) => {
    const current = await loadTokens()
    await saveTokens({ ...current, ...t })
    console.log('[GCal Sync] Tokens auto-refreshed, new expiry:', t.expiry_date ? new Date(t.expiry_date).toISOString() : 'none')
  })

  // Proactive token refresh if access token is expired
  if (tokens.expiry_date && Date.now() >= tokens.expiry_date) {
    console.log('[GCal Sync] Access token expired — refreshing proactively')
    if (!tokens.refresh_token) {
      console.error('[GCal Sync] No refresh token available — reconnect required')
      await deleteTokens()
      return res.status(401).json({ error: 'token_expired', message: 'Google session expired — please reconnect Google Calendar.' })
    }
    try {
      const { credentials } = await auth.refreshAccessToken()
      const merged = { ...tokens, ...credentials }
      await saveTokens(merged)
      auth.setCredentials(merged)
      console.log('[GCal Sync] Proactive refresh succeeded, new expiry:', credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : 'none')
    } catch (refreshErr: any) {
      console.error('[GCal Sync] Proactive refresh failed:', refreshErr.message)
      await deleteTokens()
      return res.status(401).json({ error: 'token_expired', message: 'Google session expired — please reconnect Google Calendar.' })
    }
  }

  // Token health-check: verify the token works before looping over 50+ appointments
  try {
    const calendar = google.calendar({ version: 'v3', auth })
    await calendar.calendarList.list({ maxResults: 1 })
    console.log('[GCal Sync] Token health check passed')
  } catch (healthErr: any) {
    console.error('[GCal Sync] Token health check FAILED — code:%s message:%s', healthErr.code || healthErr.status, healthErr.message)
    if (healthErr.code === 401 || healthErr.status === 401 || healthErr.message?.includes('invalid_grant')) {
      await deleteTokens()
      return res.status(401).json({ error: 'token_expired', message: 'Google session expired — please reconnect Google Calendar.' })
    }
    return res.status(500).json({ error: 'Google Calendar API unreachable: ' + healthErr.message })
  }

  const { calendarId = 'primary', daysBack = 1, daysForward = 30 } = req.body

  try {
    const calendar = google.calendar({ version: 'v3', auth })

    const since = new Date(); since.setDate(since.getDate() - Number(daysBack))
    const until = new Date(); until.setDate(until.getDate() + Number(daysForward))

    console.log('[GCal Sync] Query window: %s → %s (calendarId: %s)', since.toISOString(), until.toISOString(), calendarId)

    const appointments = await prisma.appointment.findMany({
      where: { startAt: { gte: since, lte: until }, status: { not: 'CANCELLED' } },
      include: {
        patient: { select: { firstName: true, lastName: true, phone: true } },
        doctor:  { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
        service: { select: { name: true, durationMins: true } },
      },
    })

    console.log('[GCal Sync] Appointments found:', appointments.length)

    let created = 0, updated = 0, errors = 0
    const sampleErrors: string[] = []

    for (const appt of appointments) {
      const storedEventId = (appt as any).googleEventId as string | null
      console.log('[GCal Sync] Processing appt %s  startAt=%s  googleEventId=%s', appt.id, appt.startAt.toISOString(), storedEventId || 'none')

      const event = {
        summary: `${appt.patient.firstName} ${appt.patient.lastName} — ${appt.service.name}`,
        description: [
          `Patient: ${appt.patient.firstName} ${appt.patient.lastName}`,
          `Phone:   ${appt.patient.phone}`,
          `Service: ${appt.service.name} (${appt.service.durationMins} min)`,
          `Doctor:  Dr. ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`,
          `Status:  ${appt.status}`,
          ``,
          `Manage: ${process.env.APP_URL || 'http://localhost:3000'}/receptionist/scheduling`,
        ].join('\n'),
        start:      { dateTime: appt.startAt.toISOString(), timeZone: 'Africa/Kampala' },
        end:        { dateTime: appt.endAt.toISOString(),   timeZone: 'Africa/Kampala' },
        colorId:    statusColorId(appt.status),
        extendedProperties: { private: { codeclinicId: appt.id } },
      }

      try {
        let eventId: string

        if (storedEventId) {
          // Fast path: use stored event ID directly
          try {
            await calendar.events.patch({ calendarId, eventId: storedEventId, requestBody: event })
            eventId = storedEventId
            updated++
            console.log('[GCal Sync] Updated event %s (fast path)', eventId)
          } catch (patchErr: any) {
            if (patchErr.code !== 404) throw patchErr
            // Event deleted in GCal — re-create it
            const ins = await calendar.events.insert({ calendarId, requestBody: event })
            eventId = ins.data.id!
            created++
            console.log('[GCal Sync] Re-created event %s (was deleted)', eventId)
          }
        } else {
          // Slow path: search by extended property (first-time sync)
          const existing = await (calendar.events.list as any)({
            calendarId,
            privateExtendedProperty: `codeclinicId=${appt.id}`,
            maxResults: 1,
          })
          if (existing.data.items?.length) {
            eventId = existing.data.items[0].id!
            await calendar.events.patch({ calendarId, eventId, requestBody: event })
            updated++
            console.log('[GCal Sync] Updated event %s (search path)', eventId)
          } else {
            const ins = await calendar.events.insert({ calendarId, requestBody: event })
            eventId = ins.data.id!
            created++
            console.log('[GCal Sync] Created event %s', eventId)
          }
        }

        // Persist event ID for fast future syncs
        await prisma.appointment.update({ where: { id: appt.id }, data: { googleEventId: eventId } }).catch(() => {})

        // Respect Google Calendar API rate limits (3 req/s per user)
        await new Promise(r => setTimeout(r, 350))
      } catch (e: any) {
        const msg = `${appt.id}: [${e.code || e.status || '?'}] ${e.message}`
        console.error('[GCal Sync] Failed for appt', msg)
        errors++
        if (sampleErrors.length < 3) sampleErrors.push(msg)
      }
    }

    console.log('[GCal Sync] Complete — created:%d updated:%d errors:%d', created, updated, errors)

    const synced = created + updated
    res.json({
      success:  errors === 0 || synced > 0,
      created,  updated,  errors,
      total:    appointments.length,
      message:  synced > 0
        ? `Synced ${synced} of ${appointments.length} appointments${errors > 0 ? ` (${errors} failed)` : ''}`
        : errors > 0
          ? `Sync failed for all ${errors} appointments — check Railway logs`
          : 'No appointments in range',
      ...(sampleErrors.length ? { sampleErrors } : {}),
    })
  } catch (e: any) {
    console.error('[GCal Sync] Fatal error — code:%s message:%s', e.code, e.message)
    if (e.code === 401 || e.message?.includes('invalid_grant')) {
      await deleteTokens()
      return res.status(401).json({ error: 'token_expired', message: 'Google session expired — please reconnect Google Calendar.' })
    }
    res.status(500).json({ error: 'Sync failed: ' + e.message })
  }
})

// ─── POST /integrations/google-calendar/webhook ──────────────
// Google Calendar push notification endpoint (no auth — called by Google)
router.post('/google-calendar/webhook', async (req, res) => {
  // Always respond 200 immediately so Google does not retry
  res.sendStatus(200)

  const state      = req.headers['x-goog-resource-state'] as string
  const channelId  = req.headers['x-goog-channel-id']     as string

  if (state === 'sync') return // Initial handshake — no data yet

  // Verify channel ID matches what we registered
  const stored = await loadChannel().catch(() => null)
  if (stored && stored.channelId !== channelId) {
    console.warn('[GCal] Webhook: unknown channel ID', channelId)
    return
  }

  // Run incremental sync in the background
  processIncrementalSync()
    .then(r => { if (r.updated > 0 || r.cancelled > 0) console.log('[GCal] Webhook sync:', r) })
    .catch((e: any) => console.warn('[GCal] Webhook sync error:', e.message))
})

// ─── POST /integrations/google-calendar/watch ────────────────
// Manually register (or renew) the push notification channel
router.post('/google-calendar/watch', requireAuth, clinicalStaff, async (_req, res) => {
  const auth = await getAuthedClient()
  if (!auth) return res.status(401).json({ error: 'Google Calendar not connected' })

  // Stop existing channel first (ignore errors)
  await stopWatchChannel(auth).catch(() => {})
  await registerWatchChannel(auth)

  const channel = await loadChannel()
  res.json({ success: true, channel })
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
