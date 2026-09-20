// Pure request-shape builder for GET /campaigns/segment-count, extracted out
// of the Campaigns page so the "does selecting a date range actually change
// the request" question is testable without rendering the component. Used
// by both the count-preview fetch and (implicitly, by construction) proves
// what the broadcast-send payload looks like for the same inputs -- segment/
// preset/from/to are the only fields either request cares about.
export function buildSegmentCountParams(
  segment: string,
  preset?: string,
  from?: string,
  to?: string,
): URLSearchParams {
  const params = new URLSearchParams({ segment })
  if (segment === 'NEW') {
    params.set('preset', preset || 'today')
    if ((preset || 'today') === 'custom') {
      params.set('from', from ?? '')
      params.set('to', to ?? '')
    }
  }
  return params
}
