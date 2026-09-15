// Core find-or-create logic for the public walk-in / pre-visit intake form
// (POST /pre-visit/submit in routes/previsit.ts). Pulled out of the route so
// it can be unit-tested directly against a mocked PrismaClient without
// spinning up Express.
//
// Two problems this closes, both pre-existing before this file was added:
//
// 1. CONCURRENCY: Patient.phone has no DB unique constraint (legacy Google
//    Sheets import data may already contain duplicate phone numbers, so
//    adding one is out of scope here -- see project notes). The old code was
//    a plain `findFirst` followed by `create`/`update`, with no locking, so
//    two near-simultaneous submits for the same phone (double-tap, two QR
//    scans) could both pass the findFirst check before either had committed
//    a `create`, producing two Patient rows for the same person. This is
//    fixed with a Postgres advisory lock (`pg_advisory_xact_lock`) keyed on
//    the normalized phone number, taken as the FIRST statement inside a
//    `$transaction` and held for the entire find+create/update -- it
//    auto-releases when the transaction commits or rolls back, so no manual
//    unlock is needed and concurrent submits for the same phone are
//    serialized without any schema change.
//
// 2. DATA INTEGRITY: the old code unconditionally overwrote every field on
//    an existing matched patient with whatever the public form submitted --
//    an unauthenticated walk-in visitor could silently clobber real stored
//    data (a different DOB, a misspelled name) with self-entered
//    information. This version only fills in fields that are CURRENTLY
//    EMPTY on the existing record, and flags any genuine conflict (existing
//    value and submitted value both present and different, for the identity
//    fields name/DOB) as `REQUIRES_REVIEW` instead of applying it.
import type { PrismaClient, Patient } from '@prisma/client'
import { normalizePhone, phoneVariants } from '../utils/phone'

export type IntakeOutcome = 'CREATED' | 'MATCHED_EXISTING' | 'REQUIRES_REVIEW'

export interface WalkInIntakeInput {
  phone:              string
  firstName:          string
  lastName:           string
  dob?:               string | null
  gender?:            string | null
  address?:           string | null
  district?:          string | null
  nextOfKinName?:     string | null
  nextOfKinPhone?:    string | null
  nextOfKinRelation?: string | null
  allergies?:         string | null
  medicalHistory?:    string | null
}

export interface WalkInIntakeResult {
  patient:    Patient
  outcome:    IntakeOutcome
  conflicts?: ('name' | 'dob')[]
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

// Loose, case/whitespace-insensitive comparison -- "Jane" vs "jane " is not
// a conflict, "Jane" vs "Janet" is.
function valuesConflict(existing: string | null | undefined, submitted: string | null | undefined): boolean {
  if (isEmpty(existing) || isEmpty(submitted)) return false
  return existing!.trim().toLowerCase() !== submitted!.trim().toLowerCase()
}

function dobConflict(existing: Date | null, submittedRaw: string | null | undefined): boolean {
  if (!existing || isEmpty(submittedRaw)) return false
  const submitted = new Date(submittedRaw!)
  if (Number.isNaN(submitted.getTime())) return false
  return existing.toISOString().slice(0, 10) !== submitted.toISOString().slice(0, 10)
}

// Any Prisma client shape that exposes $transaction + $executeRaw + patient
// CRUD is accepted here -- lets tests pass a lightweight fake instead of a
// real PrismaClient.
type TxCapablePrisma = Pick<PrismaClient, '$transaction'>

export async function submitWalkInIntake(
  prisma: TxCapablePrisma,
  input: WalkInIntakeInput,
): Promise<WalkInIntakeResult> {
  const normalizedPhone = normalizePhone(input.phone)

  return prisma.$transaction(async (tx: any) => {
    // Must be the FIRST statement in the transaction and must be held for
    // the whole find+create/update below -- that's what actually prevents
    // the race. hashtext() collapses the phone string to an int4 the way
    // pg_advisory_xact_lock expects; collisions across unrelated phone
    // numbers are harmless here (worst case is briefly serializing two
    // different people's submits, never a correctness problem).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${normalizedPhone}))`

    const existing: Patient | null = await tx.patient.findFirst({
      where: { phone: { in: phoneVariants(normalizedPhone) } },
    })

    if (!existing) {
      const created = await tx.patient.create({
        data: {
          firstName: input.firstName,
          lastName:  input.lastName,
          phone:     normalizedPhone,
          dob:       input.dob ? new Date(input.dob) : undefined,
          gender:    input.gender || undefined,
          address:   input.address || undefined,
          district:  input.district || undefined,
          nextOfKinName:     input.nextOfKinName || undefined,
          nextOfKinPhone:    input.nextOfKinPhone || undefined,
          nextOfKinRelation: input.nextOfKinRelation || undefined,
          allergies:         input.allergies || undefined,
          medicalHistory:    input.medicalHistory || undefined,
        },
      })
      return { patient: created, outcome: 'CREATED' as const }
    }

    // Matched an existing patient by phone. Identify real conflicts on the
    // identity fields before touching anything.
    const conflicts: ('name' | 'dob')[] = []
    if (valuesConflict(existing.firstName, input.firstName) || valuesConflict(existing.lastName, input.lastName)) {
      conflicts.push('name')
    }
    if (dobConflict(existing.dob, input.dob)) {
      conflicts.push('dob')
    }

    // Only fill in fields that are currently empty -- never overwrite a
    // real stored value (including phone itself, which this function never
    // touches on an update) with self-entered public-form data.
    const fillIn: Record<string, unknown> = {}
    if (isEmpty(existing.firstName) && !isEmpty(input.firstName)) fillIn.firstName = input.firstName
    if (isEmpty(existing.lastName)  && !isEmpty(input.lastName))  fillIn.lastName  = input.lastName
    if (!existing.dob && input.dob && !Number.isNaN(new Date(input.dob).getTime())) fillIn.dob = new Date(input.dob)
    if (isEmpty(existing.gender)            && !isEmpty(input.gender))            fillIn.gender            = input.gender
    if (isEmpty(existing.address)           && !isEmpty(input.address))           fillIn.address           = input.address
    if (isEmpty(existing.district)          && !isEmpty(input.district))          fillIn.district          = input.district
    if (isEmpty(existing.nextOfKinName)     && !isEmpty(input.nextOfKinName))     fillIn.nextOfKinName     = input.nextOfKinName
    if (isEmpty(existing.nextOfKinPhone)    && !isEmpty(input.nextOfKinPhone))    fillIn.nextOfKinPhone    = input.nextOfKinPhone
    if (isEmpty(existing.nextOfKinRelation) && !isEmpty(input.nextOfKinRelation)) fillIn.nextOfKinRelation = input.nextOfKinRelation
    if (isEmpty(existing.allergies)         && !isEmpty(input.allergies))         fillIn.allergies         = input.allergies
    if (isEmpty(existing.medicalHistory)    && !isEmpty(input.medicalHistory))    fillIn.medicalHistory    = input.medicalHistory

    let patient = existing
    if (Object.keys(fillIn).length > 0) {
      patient = await tx.patient.update({ where: { id: existing.id }, data: fillIn })
    }

    return {
      patient,
      outcome:    conflicts.length > 0 ? ('REQUIRES_REVIEW' as const) : ('MATCHED_EXISTING' as const),
      conflicts:  conflicts.length > 0 ? conflicts : undefined,
    }
  })
}
