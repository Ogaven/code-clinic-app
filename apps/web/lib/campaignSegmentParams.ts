// Pure request-shape builder for GET /campaigns/segment-count, extracted out
// of the Campaigns page so the "does selecting a date range actually change
// the request" question is testable without rendering the component. Used
// by both the count-preview fetch and (implicitly, by construction) proves
// what the broadcast-send payload looks like for the same inputs -- segment/
// preset/from/to are the only fields either request cares about.
//
// registeredPreset/registeredFrom/registeredTo is a SEPARATE date concept
// (Patient.createdAt, "date added") from preset/from/to (NEW segment's own
// "first attended appointment" date) — it is combinable with ANY segment
// (ALL/ACTIVE/NEW alike), not just NEW. See campaigns.ts's SegmentSpec for
// the backend side of this same split.
export function buildSegmentCountParams(
  segment: string,
  preset?: string,
  from?: string,
  to?: string,
  registeredPreset?: string,
  registeredFrom?: string,
  registeredTo?: string,
): URLSearchParams {
  const params = new URLSearchParams({ segment })
  if (segment === 'NEW') {
    params.set('preset', preset || 'today')
    if ((preset || 'today') === 'custom') {
      params.set('from', from ?? '')
      params.set('to', to ?? '')
    }
  }
  if (registeredPreset) {
    params.set('registeredPreset', registeredPreset)
    if (registeredPreset === 'custom') {
      params.set('registeredFrom', registeredFrom ?? '')
      params.set('registeredTo', registeredTo ?? '')
    }
  }
  return params
}
