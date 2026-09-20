// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — default PATIENT sequence templates (Parts B/C).
//
// Creates the two recall sequences and the treatment-follow-up sequence the
// doctor's spec calls for, using the EXISTING sequence engine (nothing new
// added to the schema or the enrollment/dispatch code for this). Every
// sequence is created — and, on every subsequent boot, kept — in `DRAFT`
// status with clearly-marked placeholder message copy.
//
// This is deliberate, not an oversight: the engine will not evaluate a DRAFT
// sequence for enrollment at all (evaluateRulesForEvent only matches
// status:'ACTIVE' — see automation-events.service.ts), so deploying this
// file sends nothing to any patient, existing or future, no matter how many
// patients are already overdue/incomplete today. An admin reviews the touch
// copy in the Sequences tab (CRM Automation Settings) and explicitly
// activates each sequence only once the clinic has approved real wording —
// this mirrors how every other sequence in this system is already created
// (POST /crm-automation/sequences hardcodes status:'DRAFT' too).
//
// Idempotent by design: upserted by the unique `key`, safe to call on every
// server boot. Never touches a sequence again after first creation (an
// admin may have already edited/activated it) — the upsert's `update: {}`
// is intentionally empty.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import { PATIENT_RECALL_CONFLICT_GROUP, PATIENT_TREATMENT_FOLLOWUP_CONFLICT_GROUP } from './sequence-groups'

const PLACEHOLDER = (text: string) => `[PLACEHOLDER — requires clinic content approval before this sequence is activated] ${text}`

interface SeedSequence {
  key: string
  name: string
  description: string
  triggerEventType: string
  triggerCondition: Record<string, string>
  conflictGroup: string
  touches: Array<{ order: number; delayDays: number; messageTemplate: string }>
}

const DEFAULT_SEQUENCES: SeedSequence[] = [
  {
    key: 'recall_due_reminder',
    name: 'Recall Due Reminder',
    description: 'Initial recall reminder cadence once a patient\'s recall status becomes DUE (initial, ~day 3-5, ~day 7-10).',
    triggerEventType: 'recall_status_changed',
    triggerCondition: { toValue: 'DUE' },
    conflictGroup: PATIENT_RECALL_CONFLICT_GROUP,
    touches: [
      { order: 0, delayDays: 0, messageTemplate: PLACEHOLDER('Hi {firstName}, it\'s time for your regular check-up at Code Clinic! Reply here to book your visit.') },
      { order: 1, delayDays: 4, messageTemplate: PLACEHOLDER('Hi {firstName}, just checking in — would you like to book your upcoming dental visit?') },
      { order: 2, delayDays: 8, messageTemplate: PLACEHOLDER('Hi {firstName}, your check-up is still due. Let us know a time that works and we\'ll get you booked.') },
    ],
  },
  {
    key: 'recall_dormant_reactivation',
    name: 'Dormant Patient Reactivation',
    description: 'Longer-horizon win-back cadence once a patient\'s recall status reaches OVERDUE_180_PLUS (day 0 and day 30).',
    triggerEventType: 'recall_status_changed',
    triggerCondition: { toValue: 'OVERDUE_180_PLUS' },
    conflictGroup: PATIENT_RECALL_CONFLICT_GROUP,
    touches: [
      { order: 0, delayDays: 0,  messageTemplate: PLACEHOLDER('Hi {firstName}, it\'s been a while since your last visit to Code Clinic — we\'d love to see you again for a check-up.') },
      { order: 1, delayDays: 30, messageTemplate: PLACEHOLDER('Hi {firstName}, we\'re still here whenever you\'re ready to book your next dental visit.') },
    ],
  },
  {
    key: 'treatment_incomplete_followup',
    name: 'Incomplete Treatment Follow-up',
    description: 'Follow-up cadence once a patient\'s treatment plan CRM tag becomes INCOMPLETE (initial, ~day 5, ~day 9, day 30).',
    triggerEventType: 'treatment_plan_status_changed',
    triggerCondition: { toValue: 'INCOMPLETE' },
    conflictGroup: PATIENT_TREATMENT_FOLLOWUP_CONFLICT_GROUP,
    touches: [
      { order: 0, delayDays: 0,  messageTemplate: PLACEHOLDER('Hi {firstName}, we noticed your treatment plan at Code Clinic hasn\'t been completed yet. Would you like to book your next appointment?') },
      { order: 1, delayDays: 5,  messageTemplate: PLACEHOLDER('Hi {firstName}, just following up on your treatment plan — happy to help you find a convenient time to continue.') },
      { order: 2, delayDays: 9,  messageTemplate: PLACEHOLDER('Hi {firstName}, your treatment plan is still open. Let us know if you have any questions or would like to schedule.') },
      { order: 3, delayDays: 30, messageTemplate: PLACEHOLDER('Hi {firstName}, we\'d still like to help you finish your treatment plan whenever you\'re ready — just reply here.') },
    ],
  },
]

const DEFAULT_CHANNEL = 'WHATSAPP'

export async function ensureDefaultCrmSequences(): Promise<void> {
  for (const seq of DEFAULT_SEQUENCES) {
    await prisma.sequenceDefinition.upsert({
      where: { key: seq.key },
      update: {}, // never overwrite an admin's edits/activation after first creation
      create: {
        key:              seq.key,
        name:             seq.name,
        description:      seq.description,
        entityType:       'PATIENT',
        triggerEventType: seq.triggerEventType,
        triggerCondition: JSON.stringify(seq.triggerCondition),
        conflictGroup:    seq.conflictGroup,
        channel:          DEFAULT_CHANNEL,
        // Operational health reminders, not promotional marketing — matches
        // the doctor's framing of "recall/treatment follow-up" — but still
        // gated behind explicit activation regardless of this flag.
        isMarketing:      false,
        status:           'DRAFT',
        touches: { create: seq.touches.map(t => ({ ...t, channel: DEFAULT_CHANNEL })) },
      },
    })
  }
}
