import { google } from 'googleapis'
import { prisma } from '../lib/prisma'

// Explicit opt-in only. No worker is scheduled until deployment credentials,
// worksheet access, data minimization and retention have been approved.
const SPREADSHEET_ID = '1xlTWS4OaVWnHfebV0FggFij56Ai9uzHc6GMVR7MhqX4'
const SHEET_GID = 1741829078
const COLUMNS = ['Intake event ID', 'Submitted at (UTC)', 'Patient number', 'First name', 'Last name', 'Phone', 'Intake outcome']

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
  const owner = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`
  const acquired = await prisma.walkInSheetExportLease.updateMany({
    where: { id: 'walkin-sheets', expiresAt: { lte: new Date() } },
    data: { owner, expiresAt: new Date(Date.now() + 30 * 60_000) },
  })
  if (!acquired.count) return { processed: 0, skipped: true }
  try {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(sheetId,title))' })
  const title = metadata.data.sheets?.find(sheet => sheet.properties?.sheetId === SHEET_GID)?.properties?.title
  if (!title) throw new Error('Walk-in worksheet gid not found; refusing to write to another tab')
  const range = `'${title.replace(/'/g, "''")}'!A:G`
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
    const claimed = await prisma.walkInSheetOutbox.updateMany({
      where: { id: task.id, status: task.status, attempts: task.attempts },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    })
    if (claimed.count !== 1) continue
    try {
      const existing = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range })
      const rows = existing.data.values || []
      // Never overwrite the user's existing worksheet or install headers
      // automatically. Staff must explicitly approve the seven-column schema.
      if (!rows.length || COLUMNS.some((column, index) => rows[0]?.[index] !== column)) {
        throw new Error('Worksheet must contain the approved seven-column header row; refusing to overwrite existing data')
      }
      if (!rows.slice(1).some(row => row[0] === task.activityId)) {
        const [activity, patient] = await Promise.all([
          prisma.patientActivity.findUnique({ where: { id: task.activityId } }),
          prisma.patient.findUnique({ where: { id: task.patientId } }),
        ])
        if (!activity || !patient) throw new Error('Referenced intake activity or patient not found')
        let outcome = ''
        try { outcome = String(JSON.parse(activity.metadata || '{}').outcome || '') } catch { /* no outcome */ }
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID, range, valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [[task.activityId, activity.createdAt.toISOString(),
            patient.patientNumber, cell(patient.firstName), cell(patient.lastName), cell(patient.phone), cell(outcome)]] },
        })
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
