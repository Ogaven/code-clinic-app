// Covers confirmation-reply.service.ts — the strict, non-LLM reply
// classifier used by the confirmation-dashboard fast-path (whatsapp.service.ts).
// The one rule that must never break: a "cancel" reply NEVER sets
// Appointment.status to CANCELLED directly — it only flags the appointment
// for staff review. Only "confirm" applies a real (non-destructive) status
// change. Ambiguous text must never match at all.
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../lib/prisma', () => ({
  prisma: {
    appointment: { update: vi.fn(async () => ({})) },
    aiMessage:   { create: vi.fn(async () => ({})) },
    user:        { findMany: vi.fn(async () => [{ id: 'staff-1', role: 'RECEPTIONIST' }]) },
    notification: { create: vi.fn(async () => ({})) },
  },
}))

import { prisma } from '../lib/prisma'
import { classifyConfirmationReply, applyConfirmationReply } from '../ai-suite/whatsapp/confirmation-reply.service'

beforeEach(() => { vi.clearAllMocks() })

describe('classifyConfirmationReply — strict exact-match only', () => {
  it.each(['yes', 'YES', ' Yes ', 'y', 'confirm', 'confirmed', '1'])('classifies "%s" as CONFIRM', (text) => {
    expect(classifyConfirmationReply(text)).toBe('CONFIRM')
  })

  it.each(['no', 'NO', 'n', 'cancel', '2'])('classifies "%s" as CANCEL_REQUESTED', (text) => {
    expect(classifyConfirmationReply(text)).toBe('CANCEL_REQUESTED')
  })

  it.each(['reschedule', 'change', '3'])('classifies "%s" as RESCHEDULE_REQUESTED', (text) => {
    expect(classifyConfirmationReply(text)).toBe('RESCHEDULE_REQUESTED')
  })

  it.each([
    'maybe next week i think',
    'yes but not sure',
    'can I cancel and rebook for december',
    '',
    'ok',
  ])('does NOT classify ambiguous text "%s" — must fall through to the general agent', (text) => {
    expect(classifyConfirmationReply(text)).toBeNull()
  })
})

describe('applyConfirmationReply — cancel/reschedule are staff-review only, never destructive', () => {
  it('CONFIRM applies a real, non-destructive status change to CONFIRMED', async () => {
    await applyConfirmationReply({
      classification: 'CONFIRM', conversationId: 'c1', appointmentId: 'a1',
      patientName: 'Jane Doe', phone: '+256772000000',
    })
    expect(prisma.appointment.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { status: 'CONFIRMED' } })
  })

  it('CANCEL_REQUESTED never calls appointment.update — it only notifies staff for manual review', async () => {
    await applyConfirmationReply({
      classification: 'CANCEL_REQUESTED', conversationId: 'c1', appointmentId: 'a1',
      patientName: 'Jane Doe', phone: '+256772000000',
    })
    expect(prisma.appointment.update).not.toHaveBeenCalled()
    expect(prisma.notification.create).toHaveBeenCalled()
    const notif = (prisma.notification.create as any).mock.calls[0][0].data
    expect(notif.title).toMatch(/Cancellation Requested/i)
    expect(notif.body).not.toMatch(/cancelled automatically|has been cancelled/i)
  })

  it('RESCHEDULE_REQUESTED never calls appointment.update either', async () => {
    await applyConfirmationReply({
      classification: 'RESCHEDULE_REQUESTED', conversationId: 'c1', appointmentId: 'a1',
      patientName: 'Jane Doe', phone: '+256772000000',
    })
    expect(prisma.appointment.update).not.toHaveBeenCalled()
    expect(prisma.notification.create).toHaveBeenCalled()
  })
})
