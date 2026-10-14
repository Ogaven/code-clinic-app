import { google } from 'googleapis'
import { prisma } from '../lib/prisma'

// Explicit opt-in only. No worker is scheduled until deployment credentials,
// worksheet access, data minimization and retention have been approved.
const SPREADSHEET_ID = '1xlTWS4OaVWnHfebV0FggFij56Ai9uzHc6GMVR7MhqX4'
const SHEET_GID = 1741829078
// Existing Google Form Responses 2 columns A:P are preserved exactly.
const EXISTING_HEADERS = { surname: 'Surname', givenName: 'Given Name', contact: 'Contact' }
const EVENT_ID_HEADER = 'Code Clinic EMR Intake Event ID' // Reserved column Q; staff must approve and add header before enabling.
const EVENT_ID_COLUMN_INDEX = 16
const GOOGLE_REQUEST_TIMEOUT_MS = 30_000

function cell(value: unknown): string {
  const text = String(value ?? '')
  // Prevent spreadsheet formula injection from patient-supplied fields.
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text
}

export async function deliverWalkInSheetOutbox(): Promise<{ processed: number; skipped: boolean }> {
  if (process.env.WALKIN_SHEETS_EXPORT_ENABLED !== 'true') return { processed: 0, skipped: true }
  const email = process.env.WALKIN_SHEETS_SERVICE_ACCOUNT_EMAIL
  const privateKey = process.env.WALKIN_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!email || !privateKey) throw new Error('Walk-in Sheets service account credentials not configured')
  const auth = new google.auth.JWT({ email, key: privateKey, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
  const sheets = google.sheets({ version: 'v4', auth })
  // A database lease serializes the Google Sheets read-before-append step
  // across all API instances. A stale lease expires after 30 minutes.
  // Every Google request has a 30-second timeout and a run handles at most
  // 10 tasks; the lease duration is deliberately much longer than a run.
  const owner = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`
  const acquired = await prisma.walkInSheetExportLease.updateMany({
    where: { id: 'walkin-sheets', expiresAt: { lte: new Date() } },
    data: { owner, expiresAt: new Date(Date.now() + 30 * 60_000) },
  })
  if (!acquired.count) return { processed: 0, skipped: true }
  try {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(sheetId,title))' }, { timeout: GOOGLE_REQUEST_TIMEOUT_MS })
  const title = metadata.data.sheets?.find(sheet => sheet.properties?.sheetId === SHEET_GID)?.properties?.title
  if (!title) throw new Error('Walk-in worksheet gid not found; refusing to write to another tab')
  const range = `'${title.replace(/'/g, "''")}'!A:Q`
  // Repair activities saved by the intake fallback when the outbox table
  // was temporarily unavailable. These are explicitly marked events only;
  // do not backfill unrelated or historical patient activities.
  // Restrict reconciliation to a rolling window. Otherwise the oldest
  // already-repaired 100 activities can permanently starve newer events.
  const fallbackActivities = await prisma.patientActivity.findMany({
    where: {
      userId: 'pre-visit-form',
      action: 'Submitted walk-in intake form',
      createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60_000) },
      metadata: { contains: '"sheetExportPendingReconciliation":true' },
    },
    select: { id: true, patientId: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  if (fallbackActivities.length) {
    await prisma.walkInSheetOutbox.createMany({
      data: fallbackActivities.map(activity => ({
        activityId: activity.id,
        patientId: activity.patientId,
      })),
      skipDuplicates: true,
    })
  }
  // Recover work claimed by a process that crashed before acknowledging Sheets.
  // A retry checks the event ID in the sheet before appending again.
  await prisma.walkInSheetOutbox.updateMany({
    where: { status: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
    data: { status: 'RETRY', nextAttemptAt: new Date() },
  })
  const pending = await prisma.walkInSheetOutbox.findMany({
    where: { status: { in: ['PENDING', 'RETRY'] }, nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: 'asc' }, take: 10,
  })
  let processed = 0
  for (const task of pending) {
    // Renew the lease before each item, and stop if another instance has
    // taken ownership. A slow batch cannot continue writing on an old lease.
    const renewed = await prisma.walkInSheetExportLease.updateMany({
      where: { id: 'walkin-sheets', owner, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date(Date.now() + 30 * 60_000) },
    })
    if (renewed.count !== 1) throw new Error('Walk-in Sheets export lease lost; stopping batch')
    const claimed = await prisma.walkInSheetOutbox.updateMany({
      where: { id: task.id, status: task.status, attempts: task.attempts },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    })
    if (claimed.count !== 1) continue
    try {
      const existing = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range }, { timeout: GOOGLE_REQUEST_TIMEOUT_MS })
      const rows = existing.data.values || []
      // Never overwrite the existing worksheet or its historical form
      // headers. The owner must explicitly approve the reserved Q1 header.
      const header = rows[0] || []
      if (header[1] !== EXISTING_HEADERS.surname || header[2] !== EXISTING_HEADERS.givenName ||
          header[3] !== EXISTING_HEADERS.contact || header[EVENT_ID_COLUMN_INDEX] !== EVENT_ID_HEADER) {
        throw new Error('Existing Form Responses 2 headers or reserved column Q do not match; staff must approve and add the event ID header before export')
      }
      if (!rows.slice(1).some(row => row[EVENT_ID_COLUMN_INDEX] === task.activityId)) {
        // Reconfirm ownership immediately before any external write. A
        // worker that has lost its lease must not append a spreadsheet row.
        const stillOwner = await prisma.walkInSheetExportLease.count({
          where: { id: 'walkin-sheets', owner, expiresAt: { gt: new Date() } },
        })
        if (stillOwner !== 1) throw new Error('Walk-in Sheets export lease lost before append')
        const [activity, patient] = await Promise.all([
          prisma.patientActivity.findUnique({ where: { id: task.activityId } }),
          prisma.patient.findUnique({ where: { id: task.patientId } }),
        ])
        if (!activity || !patient) throw new Error('Referenced intake activity or patient not found')
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID, range, valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          // Match existing Google Form Responses 2 columns without rewriting
          // legacy rows. Column Q is an explicitly reserved dedupe key.
          requestBody: { values: [[
            activity.createdAt.toISOString(), cell(patient.lastName), cell(patient.firstName),
            cell(patient.phone), '', cell(patient.email), cell(patient.address), '',
            cell(patient.referralSource), '', '', '', cell(patient.nextOfKinPhone),
            '', '', '', task.activityId,
          ]] },
        }, { timeout: GOOGLE_REQUEST_TIMEOUT_MS })
      }
      await prisma.walkInSheetOutbox.update({ where: { id: task.id }, data: { status: 'EXPORTED', exportedAt: new Date(), lastError: null } })
      processed++
    } catch (error) {
      const delayMinutes = Math.min(360, Math.pow(2, Math.min(task.attempts + 1, 8)))
      await prisma.walkInSheetOutbox.update({
        where: { id: task.id },
        data: { status: 'RETRY', nextAttemptAt: new Date(Date.now() + delayMinutes * 60000),
          lastError: error instanceof Error ? error.message.slice(0, 500) : 'Google Sheets export failed' },
      })
    }
  }
  return { processed, skipped: false }
  } finally {
    await prisma.walkInSheetExportLease.updateMany({
      where: { id: 'walkin-sheets', owner },
      data: { owner: null, expiresAt: new Date(0) },
    }).catch(error => console.error('[WalkInSheets] Failed to release export lease:', error))
  }
}
