import { describe, expect, it } from 'vitest'
import { approvedAssignmentsFilter } from '../routes/practice-intelligence-tasks'

describe('AI Practice Intelligence assignment isolation', () => {
  it('restricts a doctor to their own approved AI recommendations', () => {
    expect(approvedAssignmentsFilter('doctor-123')).toEqual({
      entityType: 'PRACTICE_INTELLIGENCE',
      assignedToId: 'doctor-123',
      approvalStatus: 'APPROVED',
    })
  })

  it('uses the receptionist identity rather than a shared staff scope', () => {
    const doctor = approvedAssignmentsFilter('doctor-123')
    const receptionist = approvedAssignmentsFilter('receptionist-456')
    expect(receptionist.assignedToId).toBe('receptionist-456')
    expect(receptionist.assignedToId).not.toBe(doctor.assignedToId)
    expect(receptionist.approvalStatus).toBe('APPROVED')
  })

  it('never includes pending, rejected or other task categories in the filter', () => {
    const filter = approvedAssignmentsFilter('staff-1')
    expect(filter).toEqual({
      entityType: 'PRACTICE_INTELLIGENCE',
      assignedToId: 'staff-1',
      approvalStatus: 'APPROVED',
    })
    expect(Object.keys(filter).sort()).toEqual(['approvalStatus', 'assignedToId', 'entityType'])
  })
})
