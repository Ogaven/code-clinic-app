// Single source of truth for the real Lead.source values the Leads Pipeline
// supports filtering by — shared between LeadsPipeline.tsx's own filter
// pills and the Sources -> Pipeline ?source=X drill-down seeding below, so
// the two can never silently drift apart.
export const LEAD_SOURCES = ['WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'WEBSITE', 'QUIZ', 'SCOREAPP', 'FACEBOOK_LEAD_AD', 'WALKIN', 'OTHER'] as const

// Resolves what LeadsPipeline's srcFilter state should be seeded to from
// ?source=X on the Pipeline URL (see SourcesWorkspace.tsx's drill-down
// Link). Never trusts the URL value blindly — an unrecognized/stale source
// (e.g. a bookmarked link from before a source was renamed/removed) falls
// back to 'all' rather than silently filtering the board to zero results.
export function resolveInitialSourceFilter(initialSource: string | null | undefined): string {
  return initialSource && (LEAD_SOURCES as readonly string[]).includes(initialSource) ? initialSource : 'all'
}
