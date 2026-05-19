import { google } from 'googleapis'
import { prisma } from '../lib/prisma'
const GCAL_KEY       = 'gcal_tokens'
const SYNC_TOKEN_KEY = 'gcal_sync_token'

// ─── Token helpers ────────────────────────────────────────────

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
  } catch {}
}

async function getAuthedClient() {
  const tokens = await loadTokens()
  if (!tokens) return null
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  )
  auth.setCredentials(tokens)
  auth.on('tokens', async (t) => {
    const current = await loadTokens()
    await saveTokens({ ...current, ...t })
  })
  return auth
}

// ─── Helpers ──────────────────────────────────────────────────

function statusColorId(status: string): string {
  return ({ CONFIRMED: '9', PENDING: '5', COMPLETED: '2', CANCELLED: '11', NO_SHOW: '8', IN_PROGRESS: '3' } as any)[status] ?? '1'
}

type AppointmentForSync = {
  id:           string
  startAt:      Date
  endAt:        Date
  status:       string
  googleEventId?: string | null
  patient: { firstName: string; lastName: string; phone: string }
  doctor:  { user: { firstName: string; lastName: string; email?: string | null } }
  service: { name: string; durationMins: number }
}

function buildEventBody(appt: AppointmentForSync) {
  const appUrl = process.env.APP_URL || 'http://localhost:3000'
  return {
    summary: `${appt.patient.firstName} ${appt.patient.lastName} — ${appt.service.name}`,
    description: [
      `Patient: ${appt.patient.firstName} ${appt.patient.lastName}`,
      `Phone:   ${appt.patient.phone}`,
      `Service: ${appt.service.name} (${appt.service.durationMins} min)`,
      `Doctor:  Dr. ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`,
      `Status:  ${appt.status}`,
      ``,
      `Manage: ${appUrl}/receptionist/scheduling`,
    ].join('\n'),
    start:   { dateTime: appt.startAt.toISOString(), timeZone: 'Africa/Nairobi' },
    end:     { dateTime: appt.endAt.toISOString(),   timeZone: 'Africa/Nairobi' },
    colorId: statusColorId(appt.status),
    extendedProperties: { private: { codeclinicId: appt.id } },
  }
}

async function searchEventByApptId(calendar: any, appointmentId: string): Promise<string | null> {
  try {
    const res = await (calendar.events.list as any)({
      calendarId: 'primary',
      privateExtendedProperty: `codeclinicId=${appointmentId}`,
      maxResults: 1,
    })
    return res.data.items?.[0]?.id ?? null
  } catch { return null }
}

// ─── App → Google sync ────────────────────────────────────────

export async function syncAppointmentToGCal(appt: AppointmentForSync): Promise<void> {
  const auth = await getAuthedClient()
  if (!auth) return

  try {
    const calendar = google.calendar({ version: 'v3', auth })
    const event    = buildEventBody(appt)

    if (appt.googleEventId) {
      // Fast path: direct update using stored event ID
      try {
        await calendar.events.patch({ calendarId: 'primary', eventId: appt.googleEventId, requestBody: event })
        return
      } catch (e: any) {
        if (e.code !== 404) throw e
        // Event was deleted in Google Calendar — re-create it below
      }
    }

    // Search for existing event (handles legacy appointments without googleEventId)
    const existingId = await searchEventByApptId(calendar, appt.id)

    let eventId: string
    if (existingId) {
      await calendar.events.patch({ calendarId: 'primary', eventId: existingId, requestBody: event })
      eventId = existingId
    } else {
      const created = await calendar.events.insert({ calendarId: 'primary', requestBody: event })
      eventId = created.data.id!
    }

    // Persist event ID for fast future updates
    if (eventId && eventId !== appt.googleEventId) {
      await prisma.appointment.update({ where: { id: appt.id }, data: { googleEventId: eventId } }).catch(() => {})
    }
  } catch (e: any) {
    console.warn('[GCal] Sync failed for appt', appt.id, ':', e.message)
  }
}

export async function deleteAppointmentFromGCal(appointmentId: string, googleEventId: string | null | undefined): Promise<void> {
  const auth = await getAuthedClient()
  if (!auth) return

  try {
    const calendar = google.calendar({ version: 'v3', auth })
    const eventId  = googleEventId || await searchEventByApptId(calendar, appointmentId)
    if (!eventId) return
    await calendar.events.delete({ calendarId: 'primary', eventId })
  } catch (e: any) {
    if (e.code !== 404 && e.code !== 410) {
      console.warn('[GCal] Delete failed for appt', appointmentId, ':', e.message)
    }
  }
}

// ─── Google → App incremental sync (triggered by webhook) ─────

export async function processIncrementalSync(): Promise<{ updated: number; cancelled: number }> {
  const auth = await getAuthedClient()
  if (!auth) return { updated: 0, cancelled: 0 }

  try {
    const calendar = google.calendar({ version: 'v3', auth })

    const tokenRows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT value FROM app_settings WHERE key = ${SYNC_TOKEN_KEY} LIMIT 1
    `.catch(() => [] as { value: string }[])

    const syncToken = tokenRows.length ? tokenRows[0].value : undefined

    const params: any = { calendarId: 'primary', maxResults: 250 }
    if (syncToken) {
      params.syncToken = syncToken
    } else {
      const since = new Date()
      since.setDate(since.getDate() - 30)
      params.timeMin = since.toISOString()
    }

    const res   = await calendar.events.list(params)
    const items = res.data.items || []
    let updated = 0, cancelled = 0

    for (const event of items) {
      const codeclinicId = event.extendedProperties?.private?.codeclinicId
      if (!codeclinicId) continue

      const appt = await prisma.appointment.findUnique({ where: { id: codeclinicId } }).catch(() => null)
      if (!appt) continue

      if (event.status === 'cancelled') {
        if (appt.status !== 'CANCELLED') {
          await prisma.appointment.update({ where: { id: codeclinicId }, data: { status: 'CANCELLED' } }).catch(() => {})
          cancelled++
        }
      } else if (event.start?.dateTime && event.end?.dateTime) {
        const newStart = new Date(event.start.dateTime)
        const newEnd   = new Date(event.end.dateTime)
        const startDiff = Math.abs(newStart.getTime() - new Date(appt.startAt).getTime())
        const endDiff   = Math.abs(newEnd.getTime()   - new Date(appt.endAt).getTime())

        // Only update if time changed by more than 60 seconds (avoids echo-back loops)
        if (startDiff > 60_000 || endDiff > 60_000) {
          await prisma.appointment.update({
            where: { id: codeclinicId },
            data:  { startAt: newStart, endAt: newEnd, googleEventId: event.id ?? appt.googleEventId },
          }).catch(() => {})
          updated++
        }
      }
    }

    // Persist next sync token
    if (res.data.nextSyncToken) {
      const tok = res.data.nextSyncToken
      await prisma.$executeRaw`
        INSERT INTO app_settings (key, value, "updatedAt") VALUES (${SYNC_TOKEN_KEY}, ${tok}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = ${tok}, "updatedAt" = NOW()
      `.catch(() => {})
    }

    return { updated, cancelled }
  } catch (e: any) {
    console.warn('[GCal] Incremental sync error:', e.message)
    if (e.code === 410) {
      // Sync token expired — clear so next call does a fresh full sync
      await prisma.$executeRaw`DELETE FROM app_settings WHERE key = ${SYNC_TOKEN_KEY}`.catch(() => {})
    }
    return { updated: 0, cancelled: 0 }
  }
}
