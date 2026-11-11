/** Routine staff lead and inbox pushes only; urgent clinical alerts are exempt. */
function hourInKampala(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Kampala',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now))
}

export function withinLeadAlertHours(now: Date = new Date()): boolean {
  const hour = hourInKampala(now)
  return hour >= 7 && hour < 18
}

/** Routine treatment follow-up staff alerts (not patient messages or urgent clinical alerts). */
export function withinTreatmentFollowupAlertHours(now: Date = new Date()): boolean {
  const hour = hourInKampala(now)
  return hour >= 9 && hour < 18
}
