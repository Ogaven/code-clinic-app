/**
 * Guardian phone-match migration — Part C auto-migration (v2, sibling-aware).
 *
 * Groups patients by normalized guardian phone so siblings share ONE
 * FamilyAccount + ONE Guardian instead of duplicating per patient.
 *
 * Usage:
 *   DRY RUN (preview only — default):
 *     DATABASE_URL='...' npx tsx src/migrate-guardian-phonematch.ts
 *
 *   EXECUTE (actual writes):
 *     DATABASE_URL='...' npx tsx src/migrate-guardian-phonematch.ts --execute
 */
import { prisma } from './lib/prisma'

const DRY_RUN = !process.argv.includes('--execute')

// ── Phone normalization ────────────────────────────────────────────────────────
// Strips all non-digits, then takes the last 9 digits (Uganda local number).
function normalizePhone(raw: string | null): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  return digits.slice(-9)
}

// ── Name splitting ─────────────────────────────────────────────────────────────
// First whitespace-delimited word → firstName, remainder → lastName.
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

// ── Best name selection ────────────────────────────────────────────────────────
// Among siblings with the same guardian, pick the longest trimmed name as most
// complete (e.g. "Susan Nakato" beats "Susan Nakato " with trailing space).
function bestName(names: string[]): string {
  return names.reduce((best, n) =>
    n.trim().length > best.trim().length ? n : best
  , names[0])
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════')
  console.log(` Guardian phone-match migration v2 (sibling-aware)`)
  console.log(` [${DRY_RUN ? 'DRY RUN — no writes' : '⚠️  EXECUTE MODE — writing to production'}]`)
  console.log('══════════════════════════════════════════════════════════════')

  const ONE_YEAR_MS = 365.25 * 24 * 60 * 60 * 1000
  const EIGHTEEN_MS = 18 * ONE_YEAR_MS

  // Fetch all minors with nextOfKin data and no existing familyAccount
  const candidates = await prisma.patient.findMany({
    where: {
      nextOfKinPhone:  { not: null },
      nextOfKinName:   { not: null },
      familyAccountId: null,
      dob: { not: null, gte: new Date(Date.now() - EIGHTEEN_MS) },
    },
    select: {
      id: true, patientNumber: true, firstName: true, lastName: true,
      phone: true, dob: true, nextOfKinName: true, nextOfKinPhone: true,
      nextOfKinRelation: true, familyAccountId: true,
    },
    orderBy: { patientNumber: 'asc' },
  })

  console.log(`\nTotal minors with nextOfKin data and no familyAccount: ${candidates.length}`)

  // Filter to phone-match subset
  const matches = candidates.filter(p =>
    p.nextOfKinPhone &&
    normalizePhone(p.phone) !== '' &&
    normalizePhone(p.phone) === normalizePhone(p.nextOfKinPhone)
  )

  const nonMatches = candidates.filter(p =>
    !p.nextOfKinPhone ||
    normalizePhone(p.phone) === '' ||
    normalizePhone(p.phone) !== normalizePhone(p.nextOfKinPhone)
  )

  console.log(`Phone matches (will migrate):      ${matches.length} patients`)
  console.log(`Phone differs (will NOT touch):    ${nonMatches.length}`)

  // ── Group by normalized guardian phone ────────────────────────────────────
  // Siblings share the same guardian phone → one FamilyAccount per group.
  const groups = new Map<string, typeof matches>()
  for (const p of matches) {
    const key = normalizePhone(p.nextOfKinPhone)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(p)
  }

  const siblingGroups = [...groups.values()].filter(g => g.length > 1)
  console.log(`Unique guardian phone groups:       ${groups.size} FamilyAccount(s) will be created`)
  console.log(`Sibling groups (2+ patients):       ${siblingGroups.length}`)

  // ── Preview ────────────────────────────────────────────────────────────────
  console.log('\n──────────────────────────────────────────────────────────────')
  console.log(' PREVIEW — families to create (grouped by guardian phone):')
  console.log('──────────────────────────────────────────────────────────────')

  let groupNum = 0
  for (const [, patients] of groups) {
    groupNum++
    const chosenName = bestName(patients.map(p => p.nextOfKinName!))
    const { firstName: gnFirst, lastName: gnLast } = splitName(chosenName)
    const relation = patients.find(p => p.nextOfKinRelation)?.nextOfKinRelation ?? 'parent'
    const isSiblingGroup = patients.length > 1

    console.log(
      `\n  [Group ${groupNum}${isSiblingGroup ? ' ★ SIBLINGS' : ''}]` +
      `\n  → FamilyAccount: "${gnFirst} ${gnLast} Family"` +
      `\n  → Guardian: firstName="${gnFirst}" lastName="${gnLast}"` +
      ` phone=${patients[0].nextOfKinPhone} relation=${relation} isCommunicationContact=true`
    )
    for (const p of patients) {
      const age = ((Date.now() - new Date(p.dob!).getTime()) / ONE_YEAR_MS).toFixed(1)
      const nameNote = isSiblingGroup ? ` [nextOfKinName="${p.nextOfKinName}"]` : ''
      console.log(`     • #${p.patientNumber} ${p.firstName} ${p.lastName} (age ${age})${nameNote}`)
    }
  }

  // ── Non-matches ────────────────────────────────────────────────────────────
  console.log('\n──────────────────────────────────────────────────────────────')
  console.log(' Patients with DIFFERENT nextOfKinPhone — SKIPPED (manual entry needed):')
  console.log('──────────────────────────────────────────────────────────────')
  if (nonMatches.length === 0) {
    console.log('  (none)')
  } else {
    for (const p of nonMatches) {
      const age = ((Date.now() - new Date(p.dob!).getTime()) / ONE_YEAR_MS).toFixed(1)
      console.log(
        `  #${p.patientNumber} ${p.firstName} ${p.lastName} (age ${age})` +
        `  patient=${p.phone}  nextOfKin=${p.nextOfKinPhone}  relation=${p.nextOfKinRelation}`
      )
    }
  }

  if (DRY_RUN) {
    console.log('\n══════════════════════════════════════════════════════════════')
    console.log(` DRY RUN complete.`)
    console.log(`   ${groups.size} FamilyAccount(s) would be created`)
    console.log(`   ${matches.length} patients would be linked`)
    console.log(`   ${siblingGroups.length} sibling group(s) detected (shared FamilyAccount)`)
    console.log(' Re-run with --execute to apply.')
    console.log('══════════════════════════════════════════════════════════════\n')
    await prisma.$disconnect()
    return
  }

  // ── EXECUTE ────────────────────────────────────────────────────────────────
  const EIGHTEEN_YEARS_AGO = new Date(Date.now() - EIGHTEEN_MS)

  // Capture pre-migration at-risk count for audit comparison
  const preMigrationAtRisk = await prisma.patient.count({
    where: {
      dob:            { gte: EIGHTEEN_YEARS_AGO },
      familyAccountId: null,
      guardianId:      null,
    },
  })

  console.log('\n══════════════════════════════════════════════════════════════')
  console.log(` EXECUTING: ${groups.size} FamilyAccount group(s), ${matches.length} patient(s)...`)
  console.log(` Pre-migration at-risk count: ${preMigrationAtRisk}`)
  console.log('══════════════════════════════════════════════════════════════')

  let migratedPatients = 0
  let groupErrors = 0

  for (const [, patients] of groups) {
    const chosenName = bestName(patients.map(p => p.nextOfKinName!))
    const { firstName: gnFirst, lastName: gnLast } = splitName(chosenName)
    const relation   = patients.find(p => p.nextOfKinRelation)?.nextOfKinRelation ?? 'parent'
    const repPhone   = patients[0].nextOfKinPhone!

    try {
      await prisma.$transaction(async (tx) => {
        // 1. One FamilyAccount for the entire group
        const family = await tx.familyAccount.create({
          data: { name: `${gnFirst} ${gnLast} Family` },
        })

        // 2. One Guardian
        await tx.guardian.create({
          data: {
            familyAccountId:        family.id,
            firstName:              gnFirst,
            lastName:               gnLast,
            phone:                  repPhone,
            relationship:           relation,
            isCommunicationContact: true,
            isActive:               true,
          },
        })

        // 3. Link ALL patients in this group to the SAME FamilyAccount
        for (const p of patients) {
          await tx.patient.update({
            where: { id: p.id },
            data:  { familyAccountId: family.id },
          })
        }
      })

      for (const p of patients) {
        console.log(`  ✅ #${p.patientNumber} ${p.firstName} ${p.lastName} → ${gnFirst} ${gnLast} (${repPhone})`)
        migratedPatients++
      }
    } catch (err: any) {
      console.error(`  ❌ Group ${repPhone} (${patients.map(p => `#${p.patientNumber}`).join(', ')}) FAILED: ${err.message}`)
      groupErrors++
    }
  }

  // ── Post-migration audit ───────────────────────────────────────────────────
  console.log('\n──────────────────────────────────────────────────────────────')
  console.log(' POST-MIGRATION AUDIT')
  console.log('──────────────────────────────────────────────────────────────')

  const totalMinors = await prisma.patient.count({
    where: { dob: { gte: EIGHTEEN_YEARS_AGO } },
  })
  const nowLinked = await prisma.patient.count({
    where: { dob: { gte: EIGHTEEN_YEARS_AGO }, familyAccountId: { not: null } },
  })
  const stillAtRisk = await prisma.patient.count({
    where: { dob: { gte: EIGHTEEN_YEARS_AGO }, familyAccountId: null, guardianId: null },
  })

  const atRiskDrop = preMigrationAtRisk - stillAtRisk

  console.log(`  Total minors (age < 18):          ${totalMinors}`)
  console.log(`  Minors with familyAccount now:    ${nowLinked}`)
  console.log(`  Still at-risk (no guardian link): ${stillAtRisk}`)
  console.log(`  At-risk before migration:         ${preMigrationAtRisk}`)
  console.log(`  At-risk drop:                     ${atRiskDrop} (expected: ${migratedPatients})`)
  console.log(`  Patients migrated this run:       ${migratedPatients} of ${matches.length}`)
  console.log(`  FamilyAccount groups created:     ${groups.size - groupErrors} of ${groups.size}`)
  console.log(`  Group errors:                     ${groupErrors}`)

  if (atRiskDrop === migratedPatients && groupErrors === 0) {
    console.log(`  ✅ At-risk drop matches migrated count exactly — consistent.`)
  } else if (groupErrors > 0) {
    console.log(`  ⚠️  ${groupErrors} group(s) failed — at-risk drop may be partial.`)
  } else {
    console.log(`  ⚠️  Drop ${atRiskDrop} ≠ migrated ${migratedPatients} — investigate.`)
  }

  console.log('\n══════════════════════════════════════════════════════════════')
  console.log(' Migration complete.')
  console.log('══════════════════════════════════════════════════════════════\n')

  await prisma.$disconnect()
  if (groupErrors > 0) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
