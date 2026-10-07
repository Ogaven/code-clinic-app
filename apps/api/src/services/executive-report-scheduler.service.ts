import cron from 'node-cron'
import { buildExecutiveReport, type ExecutivePeriod } from './executive-report.service'
import { sendExecutiveReportEmail } from './communications/email'

function recipients(): string[] {
  return (process.env.EXECUTIVE_REPORT_RECIPIENTS || '')
    .split(',')
    .map(v => v.trim())
    .filter(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
}

export async function deliverScheduledExecutiveReport(period: ExecutivePeriod): Promise<{ sent: number; skipped: boolean }> {
  const to = recipients()
  if (!to.length) {
    console.info('[ExecutiveReport] Scheduled delivery skipped: EXECUTIVE_REPORT_RECIPIENTS is not configured')
    return { sent: 0, skipped: true }
  }
  const report = await buildExecutiveReport(period)
  for (const address of to) await sendExecutiveReportEmail(address, report)
  console.info(`[ExecutiveReport] ${period} report sent to ${to.length} configured recipient(s)`)
  return { sent: to.length, skipped: false }
}

export function startExecutiveReportScheduler(): void {
  // Kampala timezone is explicit even though the API process also runs in EAT.
  // Weekly: Monday 08:00. Monthly: first day of month 08:15.
  cron.schedule('0 8 * * 1', () => {
    deliverScheduledExecutiveReport('weekly').catch(err => console.error('[ExecutiveReport] Weekly delivery failed:', err))
  }, { timezone: 'Africa/Kampala' })
  cron.schedule('15 8 1 * *', () => {
    deliverScheduledExecutiveReport('monthly').catch(err => console.error('[ExecutiveReport] Monthly delivery failed:', err))
  }, { timezone: 'Africa/Kampala' })
}
