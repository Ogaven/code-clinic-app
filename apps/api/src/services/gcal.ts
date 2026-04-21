import { google } from 'googleapis'
import fs from 'fs'
import path from 'path'

const TOKEN_FILE = fs.existsSync('/data')
  ? '/data/gcal-tokens.json'
  : path.resolve(process.cwd(), '../../gcal-tokens.json')

function loadTokens(): any | null {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8')) } catch { return null }
}
function saveTokens(tokens: any) {
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2)) } catch {}
}

function getAuthedClient() {
  const tokens = loadTokens()
  if (!tokens) return null
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  )
  auth.setCredentials(tokens)
  auth.on('tokens', (t) => saveTokens({ ...loadTokens(), ...t }))
  return auth
}

function statusColorId(status: string): string {
  return ({ CONFIRMED: '9', PENDING: '5', COMPLETED: '2', CANCELLED: '11', NO_SHOW: '8', IN_PROGRESS: '3' } as any)[status] ?? '1'
}

export async function syncAppointmentToGCal(appt: {
  id: string
  startAt: Date
  endAt: Date
  status: string
  patient: { firstName: string; lastName: string; phone: string }
  doctor: { user: { firstName: string; lastName: string; email?: string | null } }
  service: { name: string; durationMins: number }
}) {
  const auth = getAuthedClient()
  if (!auth) return

  try {
    const calendar = google.calendar({ version: 'v3', auth })
    const appUrl = process.env.APP_URL || 'http://localhost:3000'
    const event = {
      summary: `${appt.patient.firstName} ${appt.patient.lastName} — ${appt.service.name}`,
      description: [
        `Patient: ${appt.patient.firstName} ${appt.patient.lastName}`,
        `Phone:   ${appt.patient.phone}`,
        `Service: ${appt.service.name} (${appt.service.durationMins} min)`,
        `Doctor:  Dr. ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`,
        `Status:  ${appt.status}`,
        ``,
        `Manage: ${appUrl}/scheduling`,
      ].join('\n'),
      start:      { dateTime: appt.startAt.toISOString(), timeZone: 'Africa/Kampala' },
      end:        { dateTime: appt.endAt.toISOString(),   timeZone: 'Africa/Kampala' },
      colorId:    statusColorId(appt.status),
      extendedProperties: { private: { codeclinicId: appt.id } },
    }

    const existing = await (calendar.events.list as any)({
      calendarId: 'primary',
      privateExtendedProperty: `codeclinicId=${appt.id}`,
      maxResults: 1,
    })

    if (existing.data.items?.length) {
      await calendar.events.patch({ calendarId: 'primary', eventId: existing.data.items[0].id!, requestBody: event })
    } else {
      await calendar.events.insert({ calendarId: 'primary', requestBody: event })
    }
  } catch (e: any) {
    console.warn('[GCal] Auto-sync failed for appt', appt.id, ':', e.message)
  }
}
