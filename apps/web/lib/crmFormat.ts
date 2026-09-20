// Small pure formatting helpers pulled out of CrmDashboard.tsx so they can be
// unit-tested directly (this repo's web test environment is 'node', not
// jsdom — no component rendering, only extracted logic — see lib/dob.ts for
// the same pattern).

export function formatFunnelRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

export function formatResponseMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`
  return `${(minutes / 60).toFixed(1)}h`
}

export interface ResponseLeaderboardEntry { leadCount: number; avgMinutes: number }

// Weighted average across owners (by their own lead count) — a straight
// average of averages would understate a high-volume owner's real impact on
// overall responsiveness. Returns null (never 0) when there is no data, so
// callers can render "unavailable" instead of a misleading zero.
export function overallAverageResponseMinutes(entries: ResponseLeaderboardEntry[] | null): number | null {
  if (!entries || entries.length === 0) return null
  const totalLeads = entries.reduce((sum, o) => sum + o.leadCount, 0)
  if (totalLeads === 0) return null
  return entries.reduce((sum, o) => sum + o.avgMinutes * o.leadCount, 0) / totalLeads
}
