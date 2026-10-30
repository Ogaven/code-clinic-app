// Shared by every route that can write a TreatmentPlan's internal follow-up
// fields (clinical.ts's create/edit form, pipeline.ts's board actions) so the
// validation/parsing rules live in exactly one place. Pulls the internal
// follow-up/hold scheduling fields out of a request body — all optional, all
// independent of `status`/`stage`. Undefined means "leave unchanged"; an
// explicit null/'' clears the field. followUpAt is validated as a real date
// when present so a bad client payload can't write "Invalid Date" into the
// DB (which would silently break the alert scheduler's comparisons).
export function parseFollowUpFields(body: any): { data: Record<string, any>; error?: string } {
  const data: Record<string, any> = {}
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { data, error: 'Invalid follow-up payload' }
  if ('followUpAt' in body) {
    if (body.followUpAt === null || body.followUpAt === '') {
      data.followUpAt = null
    } else {
      if (typeof body.followUpAt !== 'string' || !body.followUpAt.trim()) return { data, error: 'Invalid followUpAt date' }
      const raw = body.followUpAt.trim()
      // Reject impossible calendar dates that JavaScript silently normalizes (e.g. February 31).
      const calendarDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
      if (calendarDate) {
        const [, year, month, day] = calendarDate
        const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`)
        if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) return { data, error: 'Invalid followUpAt date' }
      }
      const d = new Date(raw)
      if (isNaN(d.getTime())) return { data, error: 'Invalid followUpAt date' }
      data.followUpAt = d
    }
  }
  for (const field of ['followUpReason', 'followUpNote'] as const) {
    if (field in body) {
      const value = body[field]
      if (value !== null && (typeof value !== 'string' || value.length > 2000)) return { data: {}, error: `Invalid ${field} (maximum 2000 characters)` }
      data[field] = value === '' ? null : value
    }
  }
  // Assigned clinician — reuses the existing TreatmentPlan.doctorId field.
  if ('doctorId' in body) {
    const value = body.doctorId
    if (value !== null && (typeof value !== 'string' || value.length > 200 || (value.length > 0 && !value.trim()))) return { data: {}, error: 'Invalid doctorId' }
    data.doctorId = value === '' ? null : value
  }
  return { data }
}

// Statuses a treatment plan can carry (pipeline.ts VALID_STATUSES) that mean
// there is nothing left for staff to act on — a followUpAt left over from
// before the plan reached one of these is not a live commitment anymore.
// Shared by the alert scheduler and the pipeline "Follow Up" queue so both
// agree on exactly which plans are still actionable.
export const NON_ACTIONABLE_STATUSES = ['Completed', 'Cancelled', 'Declined']
