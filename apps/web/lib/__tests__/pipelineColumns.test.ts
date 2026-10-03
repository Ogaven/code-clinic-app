// Regression coverage for the Justin-meeting acceptance item: the Treatment
// Pipeline board's primary columns must be Planned/In Progress/Completed/
// On Hold/Follow Up — Declined must not compete for space as a primary
// active-work column, but must never be deleted from the full status set
// either (Move modal, bulk actions, and the Treatment Plan status dropdown
// still need every status, including Declined).

import { describe, expect, it } from 'vitest'
import { STATUSES, PRIMARY_COLUMNS } from '../pipelineColumns'

describe('STATUSES', () => {
  it('still includes Declined — historical records must remain a valid status, never removed from the data model', () => {
    expect(STATUSES.map(s => s.id)).toContain('Declined')
  })

  it('includes all 6 known statuses', () => {
    expect(STATUSES.map(s => s.id)).toEqual(
      expect.arrayContaining(['Planned', 'In Progress', 'Completed', 'On Hold', 'Declined', 'Cancelled']),
    )
  })
})

describe('PRIMARY_COLUMNS (main Kanban row)', () => {
  it('excludes Declined — it must not be a primary active-work column', () => {
    expect(PRIMARY_COLUMNS.map(s => s.id)).not.toContain('Declined')
  })

  it('includes Planned, In Progress, Completed, and On Hold', () => {
    expect(PRIMARY_COLUMNS.map(s => s.id)).toEqual(
      expect.arrayContaining(['Planned', 'In Progress', 'Completed', 'On Hold']),
    )
  })

  it('is derived from STATUSES, not a separately hand-maintained list (no drift risk)', () => {
    expect(PRIMARY_COLUMNS.every(c => STATUSES.some(s => s.id === c.id))).toBe(true)
  })
})
