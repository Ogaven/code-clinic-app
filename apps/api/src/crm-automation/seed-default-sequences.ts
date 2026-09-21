// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — default PATIENT sequence templates (Parts B/C).
//
// Creates the two recall sequences and the treatment-follow-up sequence the
// doctor's spec calls for, using the EXISTING sequence engine (nothing new
// added to the schema or the enrollment/dispatch code for this). Every
// sequence is created — and, on every subsequent boot, kept — in `DRAFT`
// status.
//
// This is deliberate, not an oversight: the engine will not evaluate a DRAFT
// sequence for enrollment at all (evaluateRulesForEvent only matches
// status:'ACTIVE' — see automation-events.service.ts), so deploying this
// file sends nothing to any patient, existing or future, no matter how many
// patients are already overdue/incomplete today. An admin explicitly
// activates each sequence only once the clinic has approved real wording —
// this mirrors how every other sequence in this system is already created
// (POST /crm-automation/sequences hardcodes status:'DRAFT' too).
//
// Content below is the clinic-approved copy (Dr Steven sign-off, 2026-09-21)
// — no longer placeholder text. Idempotent by design: upserted by the
// unique `key`, safe to call on every server boot.
//
// Two-phase content lifecycle:
//   1. Sequence doesn't exist yet -> created DRAFT with this approved copy.
//   2. Sequence exists and is STILL 'DRAFT' -> its touches are replaced with
//      this approved copy (same delete+recreate transaction PUT
//      /sequences/:id/touches already uses for an admin edit — safe because
//      a DRAFT sequence has never been evaluated for enrollment, so no
//      ScheduledTouch/SequenceEnrollment row can reference its old touch
//      templates).
//   3. Sequence exists and has moved to ACTIVE/PAUSED/ARCHIVED (an admin
//      acted on it) -> NEVER touched again, exactly as before. This is the
//      one case content is frozen for good.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import { PATIENT_RECALL_CONFLICT_GROUP, PATIENT_TREATMENT_FOLLOWUP_CONFLICT_GROUP } from './sequence-groups'

interface SeedSequence {
  key: string
  name: string
  description: string
  triggerEventType: string
  triggerCondition: Record<string, string>
  conflictGroup: string
  touches: Array<{ order: number; delayDays: number; messageTemplate: string }>
}

// {firstName} is the existing interpolation token used by every other
// sequence/scheduler message in this codebase (see sequence-dispatcher.ts's
// renderTemplate, reminder.service.ts, followup.service.ts) — reused here
// rather than inventing a new {{patient_name}} token syntax.
const DEFAULT_SEQUENCES: SeedSequence[] = [
  {
    key: 'recall_due_reminder',
    name: 'Recall Due Reminder',
    description: 'Initial recall reminder cadence once a patient\'s recall status becomes DUE (day 0, day 5).',
    triggerEventType: 'recall_status_changed',
    triggerCondition: { toValue: 'DUE' },
    conflictGroup: PATIENT_RECALL_CONFLICT_GROUP,
    touches: [
      {
        order: 0, delayDays: 0,
        messageTemplate:
          'Good morning {firstName} 😊\n\n' +
          'This is Sarah from Code Clinic. I hope you’re doing well.\n\n' +
          'We’re kindly reminding you that you are due for your dental review.\n\n' +
          'Would you like us to help you schedule an appointment?',
      },
      {
        order: 1, delayDays: 5,
        messageTemplate:
          'Hello {firstName} 😊\n\n' +
          'Sarah from Code Clinic here. I’m kindly following up on your dental review reminder.\n\n' +
          'If you would like to come in, please let me know and I’ll be happy to help you arrange a suitable appointment.',
      },
    ],
  },
  {
    key: 'recall_dormant_reactivation',
    name: 'Dormant Patient Reactivation',
    description: 'Longer-horizon win-back cadence once a patient\'s recall status reaches OVERDUE_180_PLUS (day 0, day 7, day 30).',
    triggerEventType: 'recall_status_changed',
    triggerCondition: { toValue: 'OVERDUE_180_PLUS' },
    conflictGroup: PATIENT_RECALL_CONFLICT_GROUP,
    touches: [
      {
        order: 0, delayDays: 0,
        messageTemplate:
          'Good morning {firstName} 😊\n\n' +
          'This is Sarah from Code Clinic. It has been a while since your last dental review, and we wanted to check in and see how you’re doing.\n\n' +
          'You are currently due for a review with us. Would you like me to help you arrange an appointment?',
      },
      {
        order: 1, delayDays: 7,
        messageTemplate:
          'Hello {firstName} 😊\n\n' +
          'I’m kindly following up from Code Clinic regarding your dental review.\n\n' +
          'If you haven’t had the opportunity to come in yet, we’ll be happy to help you find a convenient appointment. Kindly let me know if you would like us to arrange one for you.',
      },
      {
        // Long-overdue/dormant cohort only — this sequence is itself already
        // scoped to OVERDUE_180_PLUS (the dormant cohort), so every enrolled
        // patient qualifies for this final touch. No further touch is
        // scheduled after this one (fixed touch list — see the dispatcher,
        // which never creates a ScheduledTouch row itself).
        order: 2, delayDays: 30,
        messageTemplate:
          'Hello {firstName} 😊\n\n' +
          'This is Sarah from Code Clinic. We haven’t seen you in a while and just wanted to check that you’re doing well.\n\n' +
          'Whenever you’re ready for your next dental review, we’ll be happy to assist you with an appointment.',
      },
    ],
  },
  {
    key: 'treatment_incomplete_followup',
    name: 'Incomplete Treatment Follow-up',
    description: 'Follow-up cadence once a patient\'s treatment plan CRM tag becomes INCOMPLETE (day 0, day 5, day 10). Never names the treatment itself — see privacy note below.',
    triggerEventType: 'treatment_plan_status_changed',
    triggerCondition: { toValue: 'INCOMPLETE' },
    conflictGroup: PATIENT_TREATMENT_FOLLOWUP_CONFLICT_GROUP,
    touches: [
      {
        order: 0, delayDays: 0,
        messageTemplate:
          'Good morning {firstName} 😊\n\n' +
          'This is Sarah from Code Clinic. I hope you’re doing well.\n\n' +
          'I’m kindly following up regarding the treatment discussed during your visit with us. We noticed that there is still treatment that has not yet been completed.\n\n' +
          'Would you like me to help you arrange your next appointment?',
      },
      {
        order: 1, delayDays: 5,
        messageTemplate:
          'Hello {firstName} 😊\n\n' +
          'Sarah from Code Clinic here. I’m kindly following up regarding your pending treatment.\n\n' +
          'If you would like to continue with your treatment, please let me know and I’ll be happy to help you arrange a suitable appointment.',
      },
      {
        // After this touch, automation stops for good (no further touch is
        // scheduled) — the still-unresolved case stays visible to staff via
        // patient-engagement.service.ts's Treatment Follow-up view, which
        // already exists independent of this sequence.
        order: 2, delayDays: 10,
        messageTemplate:
          'Hello {firstName} 😊\n\n' +
          'Just checking in once more regarding your pending treatment at Code Clinic. Whenever you’re ready to continue, please reply here and we’ll assist you with the next step.',
      },
    ],
  },
]

const DEFAULT_CHANNEL = 'WHATSAPP'

export async function ensureDefaultCrmSequences(): Promise<void> {
  for (const seq of DEFAULT_SEQUENCES) {
    const existing = await prisma.sequenceDefinition.findUnique({ where: { key: seq.key } })

    if (!existing) {
      await prisma.sequenceDefinition.create({
        data: {
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
      continue
    }

    // Never touch a sequence again once an admin has moved it out of DRAFT
    // (activated, paused, or archived) — same guarantee as before.
    if (existing.status !== 'DRAFT') continue

    // Still DRAFT: refresh its touch content to the latest approved copy.
    // Safe because a DRAFT sequence is never evaluated for enrollment, so no
    // ScheduledTouch/SequenceEnrollment can reference its current touch
    // templates yet — identical safety argument to the admin-facing
    // PUT /sequences/:id/touches route, which uses this same
    // deleteMany+createMany transaction shape for a non-ACTIVE sequence.
    await prisma.$transaction([
      prisma.sequenceTouchTemplate.deleteMany({ where: { sequenceId: existing.id } }),
      prisma.sequenceTouchTemplate.createMany({
        data: seq.touches.map(t => ({ sequenceId: existing.id, ...t, channel: DEFAULT_CHANNEL })),
      }),
      prisma.sequenceDefinition.update({
        where: { id: existing.id },
        data:  {
          name: seq.name, description: seq.description,
          triggerCondition: JSON.stringify(seq.triggerCondition),
          conflictGroup: seq.conflictGroup,
          version: { increment: 1 },
        },
      }),
    ])
  }
}
