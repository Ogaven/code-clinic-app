import { describe, expect, it } from 'vitest'
import { notificationFeedWhere, LEGACY_DELIVERY_FAILURE_TITLE_PREFIX } from '../routes/receptionist'

// Regression coverage for the production incident where ~170 pre-fix
// delivery-failure notifications (type SYSTEM, created before
// notifyStaffOfDeliveryFailure was narrowed to ADMIN-only/PROVIDER_HEALTH)
// kept cluttering staff feeds because they were never deleted — by design,
// diagnostic/notification history must never be destructively removed. The
// fix hides that exact superseded title+type combination from the LIST
// query only; the rows themselves are untouched in the database.

describe('notificationFeedWhere', () => {
  it('builds a where clause that excludes only the legacy SYSTEM delivery-failure title, scoped to the requesting user', () => {
    expect(notificationFeedWhere('user-1')).toEqual({
      userId: 'user-1',
      NOT: { type: 'SYSTEM', title: { startsWith: LEGACY_DELIVERY_FAILURE_TITLE_PREFIX } },
    })
  })
})

// Prisma's `NOT: { a, b }` negates the AND of every key in that object —
// mirrored here (can't run a real Prisma query without a DB) to prove the
// filter's actual semantics, not just its shape, against representative rows.
function matchesPrismaWhere(row: { userId: string; type: string; title: string }, userId: string): boolean {
  const where = notificationFeedWhere(userId)
  if (row.userId !== where.userId) return false
  const legacyTitlePrefix = where.NOT.title.startsWith
  const excluded = row.type === where.NOT.type && row.title.startsWith(legacyTitlePrefix)
  return !excluded
}

describe('legacy delivery-failure suppression semantics', () => {
  it('hides a legacy SYSTEM delivery-failure notification (the exact superseded shape)', () => {
    const row = { userId: 'u1', type: 'SYSTEM', title: '⚠️ Staff WhatsApp alerts are failing to deliver' }
    expect(matchesPrismaWhere(row, 'u1')).toBe(false)
  })

  it('does NOT hide the new PROVIDER_HEALTH-typed notification, even with an overlapping-looking title', () => {
    const row = { userId: 'u1', type: 'PROVIDER_HEALTH', title: '⚠️ Staff WhatsApp alerts are failing to deliver (#131042)' }
    expect(matchesPrismaWhere(row, 'u1')).toBe(true)
  })

  it('does NOT hide an unrelated SYSTEM notification that merely shares the type but not the title', () => {
    const row = { userId: 'u1', type: 'SYSTEM', title: 'Nightly patient-tag job completed' }
    expect(matchesPrismaWhere(row, 'u1')).toBe(true)
  })

  it('does NOT hide a genuine patient ESCALATION notification', () => {
    const row = { userId: 'u1', type: 'ESCALATION', title: 'Patient concern needs attention' }
    expect(matchesPrismaWhere(row, 'u1')).toBe(true)
  })

  it('does NOT hide an APPOINTMENT or CONFIRMATION notification', () => {
    expect(matchesPrismaWhere({ userId: 'u1', type: 'APPOINTMENT', title: 'New booking' }, 'u1')).toBe(true)
    expect(matchesPrismaWhere({ userId: 'u1', type: 'CONFIRMATION', title: 'Appointment confirmed' }, 'u1')).toBe(true)
  })

  it('never matches another user\'s row regardless of type/title', () => {
    const row = { userId: 'someone-else', type: 'SYSTEM', title: '⚠️ Staff WhatsApp alerts are failing to deliver' }
    expect(matchesPrismaWhere(row, 'u1')).toBe(false) // excluded, but for the userId mismatch reason, not the title
  })
})
