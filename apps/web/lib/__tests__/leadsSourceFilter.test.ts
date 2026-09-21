import { describe, expect, it } from 'vitest'
import { LEAD_SOURCES, resolveInitialSourceFilter } from '../leadsSourceFilter'

// Milestone: CRM UX/IA/Dashboard refinement — regression coverage for the
// known-deferred Sources -> Pipeline drill-down fix. SourcesWorkspace.tsx
// has always linked a source to `${leadsHref}?source=X`, but LeadsPipeline
// never consumed that query param at all — clicking a source silently did
// nothing. This is the pure seeding logic LeadsPipeline.tsx now imports.
describe('resolveInitialSourceFilter — Sources -> Pipeline ?source=X drill-down', () => {
  it('seeds the filter from a real, recognized source value', () => {
    expect(resolveInitialSourceFilter('WHATSAPP')).toBe('WHATSAPP')
    expect(resolveInitialSourceFilter('FACEBOOK_LEAD_AD')).toBe('FACEBOOK_LEAD_AD')
  })

  it('every real source value LeadsPipeline\'s own filter pills support is accepted', () => {
    for (const s of LEAD_SOURCES) {
      expect(resolveInitialSourceFilter(s)).toBe(s)
    }
  })

  it('falls back to "all" for an unrecognized/stale source value — never silently filters the board to zero results', () => {
    expect(resolveInitialSourceFilter('SOME_REMOVED_SOURCE')).toBe('all')
    expect(resolveInitialSourceFilter('facebook_lead_ads')).toBe('all') // wrong case/plural — must not fuzzy-match
  })

  it('falls back to "all" when no source param is present at all (normal /leads visit, not a drill-down)', () => {
    expect(resolveInitialSourceFilter(null)).toBe('all')
    expect(resolveInitialSourceFilter(undefined)).toBe('all')
    expect(resolveInitialSourceFilter('')).toBe('all')
  })
})
