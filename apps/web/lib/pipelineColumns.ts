// Treatment Pipeline board column configuration — extracted out of
// TreatmentPipelineBoard.tsx so the "which statuses are primary active
// columns" rule is a plain, independently testable data module instead of
// something only reachable by rendering the client component.

export interface StatusColumn {
  id: string
  label: string
  headerColor: string
  headerBg: string
}

// The full set of values a plan's status can hold. Same 6 values as the
// Treatment Plan status dropdown (patient profile) and Case Acceptance's
// report, so all three stay genuinely in sync — this is the shared field,
// not a separate copy. Used for the Move modal, bulk status actions, and
// validation — a plan can be set to any of these.
export const STATUSES: StatusColumn[] = [
  { id: 'Planned',     label: 'Planned',     headerColor: '#1D4ED8', headerBg: '#DBEAFE' },
  { id: 'In Progress', label: 'In Progress', headerColor: '#92400E', headerBg: '#FDE68A' },
  { id: 'Completed',   label: 'Completed',   headerColor: '#065F46', headerBg: '#D1FAE5' },
  { id: 'On Hold',     label: 'On Hold',     headerColor: '#854D0E', headerBg: '#FEF9C3' },
  { id: 'Declined',    label: 'Declined',    headerColor: '#9F1239', headerBg: '#FFE4E6' },
  { id: 'Cancelled',   label: 'Cancelled',   headerColor: '#991B1B', headerBg: '#FEE2E2' },
]

// Primary ACTIVE operational columns rendered on the main Kanban row.
// "Declined" is deliberately excluded — a declined treatment isn't live
// operational work, so it no longer competes for space with the columns
// staff actually act on day to day. It is NOT deleted or hidden: Declined
// plans remain stored exactly as-is and stay reachable via the dedicated
// "Declined (history)" section. "Cancelled" is left as a primary column —
// out of scope for this change, not reported as a problem.
export const PRIMARY_COLUMNS: StatusColumn[] = STATUSES.filter(s => s.id !== 'Declined')
