// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — Meta WhatsApp template mapping for patient sequences.
//
// Every touch in the 3 patient sequences (recall_due_reminder,
// recall_dormant_reactivation, treatment_incomplete_followup) fires days
// after enrollment (day 0/5/7/10/30). Enrollment itself is driven by a
// nightly derived-tag recompute, not an inbound patient message, so by the
// time ANY of these touches is due the patient has almost always gone quiet
// for well over 24h — outside Meta's free-text customer-service window.
//
// sequence-dispatcher.ts uses this map to decide, per touch, which env var
// holds the APPROVED Meta template name to send instead of free text
// outside that window. No env var configured = no template approved yet =
// the touch is BLOCKED, never sent free-form — same fail-closed pattern
// already used by ai-suite/scheduler/followup.service.ts (appointment
// confirmations), reminder.service.ts, and services/agent/guards/
// escalation.ts.
//
// Scoped ONLY to these 3 sequence keys, by (sequenceKey, touch order) — no
// other sequence in the engine is affected by this gate.
// ─────────────────────────────────────────────────────────────────────────

export interface MetaTemplateSlot {
  envVar: string
  // Proposed cc_* name for this touch's Meta template. This is a PROPOSAL
  // only — the actual send never hard-codes this string, it always reads
  // process.env[envVar], which must be set to the exact name Meta approved.
  templateName: string
}

const SEQUENCE_META_TEMPLATE_MAP: Record<string, Record<number, MetaTemplateSlot>> = {
  recall_due_reminder: {
    0: { envVar: 'WA_TEMPLATE_RECALL_DUE_D0', templateName: 'cc_recall_due_d0' },
    1: { envVar: 'WA_TEMPLATE_RECALL_DUE_D5', templateName: 'cc_recall_due_d5' },
  },
  recall_dormant_reactivation: {
    0: { envVar: 'WA_TEMPLATE_RECALL_DORMANT_D0', templateName: 'cc_recall_dormant_d0' },
    1: { envVar: 'WA_TEMPLATE_RECALL_DORMANT_D7', templateName: 'cc_recall_dormant_d7' },
    2: { envVar: 'WA_TEMPLATE_RECALL_DORMANT_D30', templateName: 'cc_recall_dormant_d30' },
  },
  treatment_incomplete_followup: {
    0: { envVar: 'WA_TEMPLATE_TREATMENT_FOLLOWUP_D0', templateName: 'cc_treatment_followup_d0' },
    1: { envVar: 'WA_TEMPLATE_TREATMENT_FOLLOWUP_D5', templateName: 'cc_treatment_followup_d5' },
    2: { envVar: 'WA_TEMPLATE_TREATMENT_FOLLOWUP_D10', templateName: 'cc_treatment_followup_d10' },
  },
}

export function resolveMetaTemplateSlot(sequenceKey: string, order: number): MetaTemplateSlot | undefined {
  return SEQUENCE_META_TEMPLATE_MAP[sequenceKey]?.[order]
}

export function allMetaTemplateSlots(): Array<{ sequenceKey: string; order: number; slot: MetaTemplateSlot }> {
  return Object.entries(SEQUENCE_META_TEMPLATE_MAP).flatMap(([sequenceKey, byOrder]) =>
    Object.entries(byOrder).map(([order, slot]) => ({ sequenceKey, order: Number(order), slot }))
  )
}
