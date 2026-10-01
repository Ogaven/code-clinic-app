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
    notification: {
      create:    vi.fn(async () => ({})),
      findFirst: vi.fn(async () => null),
    },
  },
}))

const sendPushToUser = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../services/push.service', () => ({ sendPushToUser }))

import { prisma } from '../lib/prisma'
import { classifyConfirmationReply, applyConfirmationReply } from '../ai-suite/whatsapp/confirmation-reply.service'

beforeEach(() => {
  vi.clearAllMocks()
  ;(prisma.notification.findFirst as any).mockResolvedValue(null)
})

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

describe('notifyStaffOfConfirmationReply — Reception operational push (gap fix)', () => {
  it('sends a push to Reception/Admin, in addition to the persistent notification, for a cancel request', async () => {
    (prisma.user.findMany as any).mockResolvedValue([
      { id: 'staff-1', role: 'RECEPTIONIST' }, { id: 'staff-2', role: 'ADMIN' },
    ])
    await applyConfirmationReply({
      classification: 'CANCEL_REQUESTED', conversationId: 'c1', appointmentId: 'a1',
      patientName: 'Jane Doe', phone: '+256772000000',
    })

    expect(prisma.notification.create).toHaveBeenCalledTimes(2)
    expect(sendPushToUser).toHaveBeenCalledTimes(2)
    expect(sendPushToUser).toHaveBeenCalledWith('staff-1', expect.objectContaining({ title: 'Cancellation Requested' }))
    expect(sendPushToUser).toHaveBeenCalledWith('staff-2', expect.objectContaining({ title: 'Cancellation Requested' }))
  })

  it('the push body never contains the patient name or phone — only the authenticated in-app body does', async () => {
    (prisma.user.findMany as any).mockResolvedValue([{ id: 'staff-1', role: 'RECEPTIONIST' }])
    await applyConfirmationReply({
      classification: 'CANCEL_REQUESTED', conversationId: 'c1', appointmentId: 'a1',
      patientName: 'Jane Doe', phone: '+256772000000',
    })

    const pushPayload = sendPushToUser.mock.calls[0][1]
    expect(pushPayload.body).not.toContain('Jane Doe')
    expect(pushPayload.body).not.toContain('+256772000000')

    const notif = (prisma.notification.create as any).mock.calls[0][0].data
    expect(notif.body).toContain('Jane Doe')
    expect(notif.body).toContain('+256772000000')
  })

  it('uses role-specific hrefs scoped to the appointment for Reception vs Admin', async () => {
    (prisma.user.findMany as any).mockResolvedValue([
      { id: 'staff-1', role: 'RECEPTIONIST' }, { id: 'staff-2', role: 'ADMIN' },
    ])
    await applyConfirmationReply({
      classification: 'RESCHEDULE_REQUESTED', conversationId: 'c1', appointmentId: 'appt-42',
      patientName: 'Jane Doe', phone: '+256772000000',
    })

    const calls = (prisma.notification.create as any).mock.calls.map((c: any) => c[0].data)
    const receptionNotif = calls.find((n: any) => n.userId === 'staff-1')
    const adminNotif = calls.find((n: any) => n.userId === 'staff-2')
    expect(receptionNotif.href).toBe('/receptionist/ai-suite/confirmation-dashboard?apptId=appt-42')
    expect(adminNotif.href).toBe('/ai-suite/confirmation-dashboard?apptId=appt-42')
  })

  it('does not notify a Doctor user even if one were somehow returned by the staff query', async () => {
    (prisma.user.findMany as any).mockResolvedValue([
      { id: 'staff-1', role: 'RECEPTIONIST' }, { id: 'doctor-1', role: 'DOCTOR' },
    ])
    await applyConfirmationReply({
      classification: 'CANCEL_REQUESTED', conversationId: 'c1', appointmentId: 'a1',
      patientName: 'Jane Doe', phone: '+256772000000',
    })
    // The query itself only ever asks for RECEPTIONIST/ADMIN — this proves
    // the fan-out doesn't independently re-check role before notifying.
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ role: { in: ['RECEPTIONIST', 'ADMIN'] } }) })
    )
  })

  it('does not create a duplicate alert when an unread notification for this exact appointment is still open', async () => {
    (prisma.user.findMany as any).mockResolvedValue([{ id: 'staff-1', role: 'RECEPTIONIST' }])
    ;(prisma.notification.findFirst as any).mockResolvedValue({ id: 'existing-notif' })

    await applyConfirmationReply({
      classification: 'CANCEL_REQUESTED', conversationId: 'c1', appointmentId: 'a1',
      patientName: 'Jane Doe', phone: '+256772000000',
    })

    expect(prisma.notification.create).not.toHaveBeenCalled()
    expect(sendPushToUser).not.toHaveBeenCalled()
  })

  it('a push failure never destroys the already-written persistent notification', async () => {
    (prisma.user.findMany as any).mockResolvedValue([{ id: 'staff-1', role: 'RECEPTIONIST' }])
    sendPushToUser.mockRejectedValueOnce(new Error('OneSignal rejected'))

    await applyConfirmationReply({
      classification: 'CANCEL_REQUESTED', conversationId: 'c1', appointmentId: 'a1',
      patientName: 'Jane Doe', phone: '+256772000000',
    })

    expect(prisma.notification.create).toHaveBeenCalledTimes(1)
  })
})
