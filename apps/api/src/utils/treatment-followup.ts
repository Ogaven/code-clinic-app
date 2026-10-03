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
  if ('followUpAt' in body) {
    if (body.followUpAt === null || body.followUpAt === '') {
      data.followUpAt = null
    } else {
      const d = new Date(body.followUpAt)
      if (isNaN(d.getTime())) return { data, error: 'Invalid followUpAt date' }
      data.followUpAt = d
    }
  }
  if ('followUpReason' in body) data.followUpReason = body.followUpReason === '' ? null : body.followUpReason
  if ('followUpNote' in body) data.followUpNote = body.followUpNote === '' ? null : body.followUpNote
  // Assigned clinician — reuses the existing TreatmentPlan.doctorId field
  // (no new assignment field). null unassigns.
  if ('doctorId' in body) data.doctorId = body.doctorId === '' ? null : body.doctorId
  return { data }
}

// Statuses a treatment plan can carry (pipeline.ts VALID_STATUSES) that mean
// there is nothing left for staff to act on — a followUpAt left over from
// before the plan reached one of these is not a live commitment anymore.
// Shared by the alert scheduler and the pipeline "Follow Up" queue so both
// agree on exactly which plans are still actionable.
export const NON_ACTIONABLE_STATUSES = ['Completed', 'Cancelled', 'Declined']
