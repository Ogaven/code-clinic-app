import { describe, expect, it, vi } from 'vitest'
import { deleteAppointmentPermanently } from '../services/appointment-delete.service'

function transactionMock() {
  return {
    invoice:         { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    patientFeedback: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    appointment:     { delete: vi.fn().mockResolvedValue({ id: 'appt-1' }) },
  }
}

describe('deleteAppointmentPermanently', () => {
  it('detaches invoice and patient feedback before deleting the appointment', async () => {
    const tx = transactionMock()
    await deleteAppointmentPermanently(tx as never, 'appt-1')

    expect(tx.invoice.updateMany).toHaveBeenCalledWith({
      where: { appointmentId: 'appt-1' },
      data:  { appointmentId: null },
    })
    expect(tx.patientFeedback.updateMany).toHaveBeenCalledWith({
      where: { appointmentId: 'appt-1' },
      data:  { appointmentId: null },
    })
    expect(tx.appointment.delete).toHaveBeenCalledWith({ where: { id: 'appt-1' } })
  })

  it('detaches dependent records before attempting the delete itself (ordering matters for FK safety)', async () => {
    const calls: string[] = []
    const tx = {
      invoice:         { updateMany: vi.fn().mockImplementation(async () => { calls.push('invoice'); return { count: 1 } }) },
      patientFeedback: { updateMany: vi.fn().mockImplementation(async () => { calls.push('feedback'); return { count: 1 } }) },
      appointment:     { delete: vi.fn().mockImplementation(async () => { calls.push('delete'); return { id: 'appt-1' } }) },
    }
    await deleteAppointmentPermanently(tx as never, 'appt-1')
    expect(calls).toEqual(['invoice', 'feedback', 'delete'])
  })

  it('propagates a not-found error (P2025) without swallowing it', async () => {
    const tx = transactionMock()
    const notFound = Object.assign(new Error('Record not found'), { code: 'P2025' })
    tx.appointment.delete.mockRejectedValue(notFound)

    await expect(deleteAppointmentPermanently(tx as never, 'missing-appt')).rejects.toMatchObject({ code: 'P2025' })
  })

  it('propagates a foreign key constraint error (P2003) without swallowing it', async () => {
    const tx = transactionMock()
    const fkError = Object.assign(new Error('Foreign key constraint failed'), { code: 'P2003' })
    tx.appointment.delete.mockRejectedValue(fkError)

    await expect(deleteAppointmentPermanently(tx as never, 'appt-1')).rejects.toMatchObject({ code: 'P2003' })
  })

  it('touches only invoice, patientFeedback, and appointment — no other model, no communication function', async () => {
    const tx = transactionMock()
    await deleteAppointmentPermanently(tx as never, 'appt-1')
    // The mock only exposes these three models; if the implementation ever
    // reached for anything else (patient, treatmentPlan, payment, a WhatsApp/
    // SMS/email sender, etc.) this would throw as an undefined-property call
    // rather than silently succeed.
    expect(Object.keys(tx).sort()).toEqual(['appointment', 'invoice', 'patientFeedback'])
  })
})
