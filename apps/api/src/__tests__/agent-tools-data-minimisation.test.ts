import { describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

// Permanent regression guard for the GDPR data-minimisation fix (2026-09).
// The AI receptionist (voice + WhatsApp booking agent) must never receive
// clinical/medical data — it books, reschedules, cancels, quotes prices, and
// checks balances. It has no legitimate reason to see medical notes, medical
// history, allergies, dental charts, treatment notes, diagnoses, or
// prescriptions. See the GDPR audit finding: handle_get_patient_by_phone in
// agent-tools.ts previously decrypted and returned Patient.medicalNotesEncrypted
// directly into the OpenAI conversation on effectively every interaction.

const FORBIDDEN_KEYS = [
  'medical_notes',
  'medicalNotes',
  'medicalHistory',
  'allergies',
  'dentalChart',
  'treatmentNotes',
  'treatmentNote',
  'treatmentPlan',
  'diagnosis',
  'diagnoses',
  'prescription',
  'prescriptions',
  'clinicalNote',
  'clinicalNotes',
]

const ALLOWED_KEYS = [
  'found',
  'id',
  'full_name',
  'first_name',
  'phone',
  'email',
  'date_of_birth',
  'gender',
  'total_outstanding_ugx',
  'last_visit_date',
  'last_doctor',
  'upcoming_appointments',
]

// ── Part 1: static source scan ──────────────────────────────────────────────
// Fails the build if any receptionist-agent tool file reintroduces a
// forbidden field name as an object key, even before a test would exercise
// the code path. Deliberately matches `key:` / `'key':` / `"key":` shapes so
// it doesn't false-positive on comments mentioning these words in prose.

const AGENT_TOOL_FILES = [
  path.resolve(__dirname, '../services/agent/agent-tools.ts'),
  path.resolve(__dirname, '../services/agent/agent-prompt.ts'),
  path.resolve(__dirname, '../services/agent/unified-agent.ts'),
  path.resolve(__dirname, '../ai-suite/agent/agent.service.ts'),
]

describe('AI receptionist tools — GDPR data minimisation (static scan)', () => {
  it.each(AGENT_TOOL_FILES)('finds no forbidden clinical-data keys in %s', (file) => {
    const content = fs.readFileSync(file, 'utf8')
    const offenders: string[] = []
    for (const key of FORBIDDEN_KEYS) {
      const keyPattern = new RegExp(`['"\`]?\\b${key}\\b['"\`]?\\s*:`)
      if (keyPattern.test(content)) offenders.push(key)
    }
    expect(offenders).toEqual([])
  })
})

// ── Part 2: behavioural test against the real tool executor ────────────────
// Proves that even when the underlying Patient row DOES contain clinical
// data, executeAgentTool('get_patient_by_phone', ...) never surfaces it in
// its return value — the thing that actually gets serialised back to OpenAI.
// No OpenAI API call is made; only Prisma is mocked. The global
// no-real-sends setup additionally blocks any accidental real network call.

const patientRow = {
  id: 'patient-1',
  firstName: 'Test',
  lastName: 'Patient',
  phone: '+256700000000',
  email: 'test@example.com',
  dob: new Date('1990-01-01'),
  gender: 'FEMALE',
  // Deliberately populated with realistic-shaped sensitive data so the test
  // fails loudly if any of it ever leaks back out.
  medicalNotesEncrypted: 'aa11bb22cc33:dd44ee55ff66:9f8e7d6c5b4a3210',
  medicalHistory: 'Type 2 diabetes, hypertension',
  allergies: 'Penicillin, latex',
  invoices: [{ totalUGX: 100000, paidUGX: 40000, status: 'PARTIAL' }],
  appointments: [
    {
      id: 'appt-1',
      startAt: new Date(Date.now() + 86400000),
      endAt: new Date(Date.now() + 90000000),
      status: 'CONFIRMED',
      doctor: { user: { firstName: 'Steven', lastName: 'Mugabe' } },
      service: { name: 'Teeth Cleaning' },
    },
  ],
}

const prismaMock = {
  patient: {
    findFirst: vi.fn().mockResolvedValue(patientRow),
  },
}

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

describe('executeAgentTool("get_patient_by_phone") — behavioural', () => {
  it('returns booking/reception data but never clinical data, even when present on the row', async () => {
    const { executeAgentTool } = await import('../services/agent/agent-tools')

    const result = await executeAgentTool(
      'get_patient_by_phone',
      { phone_number: '+256700000000' },
      { phoneNumber: '+256700000000', channel: 'WHATSAPP' }
    )

    // Allowed data made it through.
    expect(result.found).toBe(true)
    expect(result.full_name).toBe('Test Patient')
    expect(result.phone).toBe('+256700000000')
    expect(result.total_outstanding_ugx).toBe(60000)
    expect(result.upcoming_appointments).toHaveLength(1)
    expect(result.upcoming_appointments[0].service).toBe('Teeth Cleaning')

    // Forbidden clinical fields did not make it through, by key name...
    for (const key of FORBIDDEN_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(result, key)).toBe(false)
    }

    // ...or hidden anywhere in the serialised payload (the exact shape that
    // gets sent back into the OpenAI conversation as a tool result).
    const serialised = JSON.stringify(result)
    expect(serialised).not.toContain('diabetes')
    expect(serialised).not.toContain('hypertension')
    expect(serialised).not.toContain('Penicillin')
    expect(serialised).not.toContain('latex')
    expect(serialised).not.toContain(patientRow.medicalNotesEncrypted)

    // Sanity check: every key actually returned is on the allowed list —
    // catches a future field being added without a matching test update.
    for (const returnedKey of Object.keys(result)) {
      expect(ALLOWED_KEYS).toContain(returnedKey)
    }
  }, 20000) // generous timeout — first dynamic import of agent-tools.ts also
  // loads its transitive deps (openai, nodemailer) for the first time in this
  // test file, which is slower than the actual assertions being made
})
