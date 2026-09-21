// Covers submitWalkInIntake (apps/api/src/services/previsit-intake.service.ts):
//  - a brand-new phone number creates exactly one Patient (CREATED)
//  - an existing patient matched by a different Ugandan phone format is
//    matched, not duplicated (MATCHED_EXISTING)
//  - two concurrent submissions for the same phone never create two patients
//    — this exercises the advisory-lock transaction's serialization contract:
//    the fake $transaction here only lets one callback run at a time (mirrors
//    what pg_advisory_xact_lock guarantees in real Postgres), so this proves
//    the find-then-create logic is race-free *given* that guarantee holds
//  - a conflicting existing DOB is never silently overwritten and is flagged
//    REQUIRES_REVIEW instead
import { describe, expect, it, beforeEach } from 'vitest'
import { submitWalkInIntake } from '../services/previsit-intake.service'
import type { Patient } from '@prisma/client'

let patients: Patient[]
let idSeq = 0

function makeFakePrisma() {
  // Mirrors the real advisory-lock guarantee: only one $transaction callback
  // runs at a time, and each fully completes (including the find+create it
  // performs) before the next one starts — exactly what
  // pg_advisory_xact_lock(hashtext(phone)) held for the transaction's
  // duration provides in production.
  let queue: Promise<void> = Promise.resolve()

  return {
    $transaction: (fn: (tx: any) => Promise<any>) => {
      const run = queue.then(() => fn(tx))
      queue = run.then(() => undefined, () => undefined)
      return run
    },
  }
}

const tx = {
  $executeRaw: async () => undefined,
  patient: {
    findFirst: async ({ where }: any) => {
      const phones: string[] = where.phone.in
      return patients.find(p => phones.includes(p.phone)) ?? null
    },
    create: async ({ data }: any) => {
      const p = { id: `p${++idSeq}`, ...data } as Patient
      patients.push(p)
      return p
    },
    update: async ({ where, data }: any) => {
      const p = patients.find(pp => pp.id === where.id)!
      Object.assign(p, data)
      return p
    },
  },
}

beforeEach(() => {
  patients = []
  idSeq = 0
})

describe('submitWalkInIntake', () => {
  it('creates exactly one Patient for a brand-new phone number', async () => {
    const prisma: any = makeFakePrisma()
    const result = await submitWalkInIntake(prisma, {
      phone: '0772000000', firstName: 'Jane', lastName: 'Doe',
    })
    expect(result.outcome).toBe('CREATED')
    expect(patients).toHaveLength(1)
  })

  it('matches an existing patient by a different Ugandan phone format instead of duplicating', async () => {
    const prisma: any = makeFakePrisma()
    await submitWalkInIntake(prisma, { phone: '+256772000001', firstName: 'Sam', lastName: 'Okello' })
    expect(patients).toHaveLength(1)

    const result = await submitWalkInIntake(prisma, { phone: '0772000001', firstName: 'Sam', lastName: 'Okello' })
    expect(result.outcome).toBe('MATCHED_EXISTING')
    expect(patients).toHaveLength(1)
  })

  it('two concurrent submissions for the same phone never create two patients', async () => {
    const prisma: any = makeFakePrisma()
    const input = { phone: '0772000002', firstName: 'Ada', lastName: 'Nakato' }

    const [r1, r2] = await Promise.all([
      submitWalkInIntake(prisma, input),
      submitWalkInIntake(prisma, input),
    ])

    expect(patients).toHaveLength(1)
    const outcomes = [r1.outcome, r2.outcome].sort()
    expect(outcomes).toEqual(['CREATED', 'MATCHED_EXISTING'])
  })

  it('fills in empty fields on an existing match but never overwrites a conflicting DOB — flags REQUIRES_REVIEW', async () => {
    const prisma: any = makeFakePrisma()
    await submitWalkInIntake(prisma, {
      phone: '0772000003', firstName: 'Grace', lastName: 'Auma', dob: '2015-04-10', address: undefined,
    })
    expect(patients[0].dob?.toISOString().slice(0, 10)).toBe('2015-04-10')
    expect(patients[0].address).toBeUndefined()

    const result = await submitWalkInIntake(prisma, {
      phone: '0772000003', firstName: 'Grace', lastName: 'Auma',
      dob: '2016-01-01', // conflicts with stored 2015-04-10
      address: 'Ntinda',  // currently empty — safe to fill in
    })

    expect(result.outcome).toBe('REQUIRES_REVIEW')
    expect(result.conflicts).toContain('dob')
    // DOB must NOT have been overwritten by the conflicting submitted value.
    expect(patients[0].dob?.toISOString().slice(0, 10)).toBe('2015-04-10')
    // But the genuinely-empty address field is safe to fill in.
    expect(patients[0].address).toBe('Ntinda')
  })

  // Milestone: URGENT HOTFIX — Walk-in Intake. email/referralSource were
  // already part of WalkInIntakeInput and the fill-in-if-empty logic before
  // this milestone — only the form and route needed to actually pass them
  // through. These tests lock in that the service-layer contract already
  // works correctly for both new fields.
  it('stores email and referralSource on a brand-new walk-in patient', async () => {
    const prisma: any = makeFakePrisma()
    await submitWalkInIntake(prisma, {
      phone: '0772000010', firstName: 'Peter', lastName: 'Ochieng',
      email: 'peter@example.com', referralSource: 'Facebook',
    })
    expect(patients[0].email).toBe('peter@example.com')
    expect(patients[0].referralSource).toBe('Facebook')
  })

  it('fills in email and referralSource on an existing patient when currently empty', async () => {
    const prisma: any = makeFakePrisma()
    await submitWalkInIntake(prisma, { phone: '0772000011', firstName: 'Mary', lastName: 'Nabirye' })
    expect(patients[0].email).toBeUndefined()

    await submitWalkInIntake(prisma, {
      phone: '0772000011', firstName: 'Mary', lastName: 'Nabirye',
      email: 'mary@example.com', referralSource: 'Walk-in',
    })
    expect(patients[0].email).toBe('mary@example.com')
    expect(patients[0].referralSource).toBe('Walk-in')
  })

  it('never overwrites an existing email/referralSource with a differing submitted value', async () => {
    const prisma: any = makeFakePrisma()
    await submitWalkInIntake(prisma, {
      phone: '0772000012', firstName: 'Sarah', lastName: 'Kintu',
      email: 'sarah@example.com', referralSource: 'Instagram',
    })

    await submitWalkInIntake(prisma, {
      phone: '0772000012', firstName: 'Sarah', lastName: 'Kintu',
      email: 'different@example.com', referralSource: 'Google Search',
    })

    expect(patients[0].email).toBe('sarah@example.com')
    expect(patients[0].referralSource).toBe('Instagram')
  })
})
