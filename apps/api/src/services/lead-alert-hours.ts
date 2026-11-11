/** Routine staff lead and inbox pushes only; urgent clinical alerts are exempt. */
export function withinLeadAlertHours(now: Date = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Kampala',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now))
  return hour >= 7 && hour < 18
}
