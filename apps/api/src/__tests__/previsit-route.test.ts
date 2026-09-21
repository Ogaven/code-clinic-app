// Milestone: URGENT HOTFIX — Walk-in Intake. Covers routes/previsit.ts's
// POST /submit handler directly (same "call the real handler with a fake
// req/res" technique as push-subscription-ownership.test.ts): the new
// email/referralSource fields are destructured from the request body,
// validated when an email is supplied, and passed through to
// submitWalkInIntake unchanged. No real patient is created — the service
// call is mocked.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// First test in this file cold-imports routes/previsit.ts and its dependency
// tree — comfortably past the 5s default under system load (same rationale
// as push-subscription-ownership.test.ts).
vi.setConfig({ testTimeout: 20000 })

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET ??= 'test-secret-at-least-32-characters-long'
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-chars'

const { submitWalkInIntakeMock, prismaMock, sendPushToUserMock } = vi.hoisted(() => ({
  submitWalkInIntakeMock: vi.fn(),
  prismaMock: {
    appointment: { update: vi.fn().mockResolvedValue({}) },
    patientActivity: { create: vi.fn().mockResolvedValue({}) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    notification: { create: vi.fn().mockResolvedValue({}) },
  },
  sendPushToUserMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../services/previsit-intake.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/previsit-intake.service')>()
  return { ...actual, submitWalkInIntake: submitWalkInIntakeMock }
})
vi.mock('../services/push.service', () => ({ sendPushToUser: sendPushToUserMock }))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn() } }))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findHandler(router: any, method: string, path: string) {
  for (const layer of router.stack) {
    if (layer.route?.path === path) {
      const matches = layer.route.stack.filter((l: any) => l.method === method)
      if (matches.length > 0) return matches[matches.length - 1].handle
    }
  }
  throw new Error(`No handler for ${method.toUpperCase()} ${path}`)
}

function fakeRes() {
  const res: any = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  submitWalkInIntakeMock.mockResolvedValue({
    patient: { id: 'p-1', firstName: 'Jane', lastName: 'Doe' },
    outcome: 'CREATED',
  })
})

describe('POST /pre-visit/submit — email/referralSource', () => {
  it('rejects an invalid email format with 400, before ever calling submitWalkInIntake', async () => {
    const { default: previsitRouter } = await import('../routes/previsit')
    const handler = findHandler(previsitRouter, 'post', '/submit')
    const res = fakeRes()

    await handler({ body: { phone: '0772000000', firstName: 'Jane', lastName: 'Doe', email: 'not-an-email' } }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(submitWalkInIntakeMock).not.toHaveBeenCalled()
  })

  it('accepts a submission with no email at all (field remains optional)', async () => {
    const { default: previsitRouter } = await import('../routes/previsit')
    const handler = findHandler(previsitRouter, 'post', '/submit')
    const res = fakeRes()

    await handler({ body: { phone: '0772000000', firstName: 'Jane', lastName: 'Doe' } }, res)

    expect(res.status).not.toHaveBeenCalledWith(400)
    expect(submitWalkInIntakeMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ email: undefined, referralSource: undefined }),
    )
  })

  it('passes a valid email and referralSource straight through to submitWalkInIntake', async () => {
    const { default: previsitRouter } = await import('../routes/previsit')
    const handler = findHandler(previsitRouter, 'post', '/submit')
    const res = fakeRes()

    await handler({
      body: {
        phone: '0772000000', firstName: 'Jane', lastName: 'Doe',
        email: 'jane@example.com', referralSource: 'Facebook',
      },
    }, res)

    expect(res.status).not.toHaveBeenCalledWith(400)
    expect(submitWalkInIntakeMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ email: 'jane@example.com', referralSource: 'Facebook' }),
    )
  })
})
