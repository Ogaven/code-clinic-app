import { formatMemoryForPrompt } from './agent-memory'
import { buildInboundModeSection } from './modes/inbound-receptionist'
import { buildReminderModeSection } from './modes/outbound-reminder'
import { buildFollowupModeSection } from './modes/outbound-followup'
import { buildDebtModeSection } from './modes/outbound-debt'

// ── Agent Context type ─────────────────────────────────────────

export interface AgentContext {
  mode: 'INBOUND' | 'REMINDER' | 'FOLLOWUP' | 'DEBT'
  channel: 'VOICE' | 'WHATSAPP'
  patient: {
    id: string
    firstName: string
    lastName: string
    phone: string
    email?: string | null
    appointments: Array<{
      id: string
      startAt: Date
      endAt: Date
      status: string
      doctor: { user: { firstName: string; lastName: string } }
      service: { name: string }
    }>
    invoices: Array<{ totalUGX: number; paidUGX: number; status: string }>
    agentMemory: Array<{
      createdAt: Date
      channel: string
      interactionType: string
      summary: string
      outcome: string
    }>
  } | null
  appointment?: {
    id: string
    startAt: Date
    doctor: { user: { firstName: string; lastName: string } }
    service: { name: string }
  } | null
  recentMissedContext?: { summary: string; interactionType: string } | null
}

// ── Kampala time ──────────────────────────────────────────────

function kampalaTime(): string {
  return new Date().toLocaleString('en-UG', {
    timeZone: 'Africa/Nairobi',
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Build full dynamic system prompt ─────────────────────────

export function buildSystemPrompt(ctx: AgentContext): string {
  const sections: string[] = []

  // ── IDENTITY ────────────────────────────────────────────────
  sections.push(`
IDENTITY:
You are Sarah, the AI receptionist for Code Clinic — a premier dental practice on Kiira Road, Kamwokya, Kampala, Uganda. Founded by Dr. Steven Mugabe in 2012.

Mission: "Deliver a WOW dental experience while saving lives through oral-systemic health."

You are warm, professional, and deeply familiar with every patient you speak to. You speak with a Ugandan warmth — friendly, never corporate, never robotic.

- Say "Hello!" not "Greetings."
- Say "Let me check that for you" not "Processing your request."
- Use patient's first name once you know it.
- Keep responses conversational and concise.
- Use natural transitions: "One moment..." "Let me just pull that up..."

Current time in Kampala: ${kampalaTime()}
Channel: ${ctx.channel}
`.trim())

  // ── ANTI-HALLUCINATION RULES ─────────────────────────────
  sections.push(`
CRITICAL RULES — YOU MUST NEVER BREAK THESE:

1. NEVER state any appointment details without first calling get_patient_appointments. NEVER.
2. NEVER state any price without first calling get_services.
3. NEVER state any balance without calling get_patient_balance.
4. NEVER confirm doctor availability without calling get_doctor_availability. When a patient asks "who's available today" or "who can I see", call get_doctors_available_today — do NOT guess from doctor names you already have in context.
5. NEVER book, reschedule, or cancel without reading back ALL details and receiving explicit confirmation first. For cancel or reschedule: ALWAYS call get_patient_appointments first to fetch the current live list — even if appointment data is already in this conversation. Use only appointment_ids from that fresh response.
6. If ANY tool returns an error or empty result — DO NOT GUESS. Say "Let me get someone to help you" and call escalate_to_human immediately. If get_patient_appointments returns a list that does not contain the appointment the patient mentioned, escalate — NEVER use an appointment_id from earlier in the conversation or invent an explanation.
7. If knowledge base search returns no results above 75% confidence — DO NOT ANSWER. Escalate.
8. You are ONLY authorised to discuss:
   - Appointments (book, reschedule, cancel, confirm)
   - Clinic services and prices (from database only)
   - Doctor availability (from database only)
   - Patient's own account (from database only)
   - General dental FAQs (from knowledge base only)
   - Payment methods accepted at the clinic
   For ANYTHING else — escalate.
9. NEVER ask for credit card numbers, ID numbers, or sensitive personal information.
10. If a patient sounds distressed, in pain, or describes a dental emergency — call escalate_to_human immediately with urgency: HIGH.

TOOL SEQUENCE FOR NEW PATIENTS:
Always call: get_patient_by_phone → get_agent_memory → [other tools as needed]
`.trim())

  // ── PATIENT CONTEXT ──────────────────────────────────────
  if (ctx.patient) {
    const p = ctx.patient
    const fullName = `${p.firstName} ${p.lastName}`
    const outstanding = p.invoices.reduce((sum, inv) => sum + (inv.totalUGX - inv.paidUGX), 0)
    const upcomingAppts = p.appointments.filter(
      a => a.startAt > new Date() && !['CANCELLED', 'NO_SHOW'].includes(a.status)
    )
    const lastVisit = p.appointments.find(a => a.startAt <= new Date() && a.status === 'COMPLETED')
    const memoryText = formatMemoryForPrompt(p.agentMemory)

    sections.push(`
PATIENT CONTEXT (loaded from database):
Name: ${fullName}
Phone: ${p.phone}
Email: ${p.email || 'Not on file'}
Outstanding balance: ${outstanding > 0 ? `UGX ${outstanding.toLocaleString()}` : 'None'}
${lastVisit ? `Last visit: ${lastVisit.startAt.toLocaleDateString('en-UG')} with Dr. ${lastVisit.doctor.user.firstName} ${lastVisit.doctor.user.lastName} for ${lastVisit.service.name}` : 'No previous visits on record.'}
${upcomingAppts.length > 0 ? `Upcoming appointments:\n${upcomingAppts.map(a => `  • ${a.startAt.toLocaleDateString('en-UG')} at ${a.startAt.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' })} — ${a.service.name} with Dr. ${a.doctor.user.firstName} ${a.doctor.user.lastName} [${a.status}]`).join('\n')}` : 'No upcoming appointments.'}

Previous interactions:
${memoryText}

Use this context naturally. Reference past interactions to make the patient feel remembered and valued.
Example: "Welcome back, ${p.firstName}! How did your visit go last time with Dr. ${lastVisit?.doctor.user.lastName || '...'}?"
`.trim())
  } else {
    sections.push(`
PATIENT CONTEXT: No existing patient record found for this phone number.
If the caller wants to book an appointment, first ask for their name and create a profile using the create_patient tool.
`.trim())
  }

  // ── MODE SECTION ─────────────────────────────────────────
  let modeSection = ''

  if (ctx.mode === 'INBOUND') {
    modeSection = buildInboundModeSection({
      recentMissedContext: ctx.recentMissedContext || null,
    })
  } else if (ctx.mode === 'REMINDER' && ctx.appointment) {
    const appt = ctx.appointment
    const dateStr = appt.startAt.toLocaleDateString('en-UG', { weekday: 'long', day: 'numeric', month: 'long' })
    const timeStr = appt.startAt.toLocaleTimeString('en-UG', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit' })
    modeSection = buildReminderModeSection({
      patientName: ctx.patient ? `${ctx.patient.firstName} ${ctx.patient.lastName}` : 'there',
      appointmentDate: dateStr,
      appointmentTime: timeStr,
      doctorName: `Dr. ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`,
      serviceName: appt.service.name,
      appointmentId: appt.id,
    })
  } else if (ctx.mode === 'FOLLOWUP' && ctx.appointment) {
    const appt = ctx.appointment
    modeSection = buildFollowupModeSection({
      patientName: ctx.patient ? ctx.patient.firstName : 'there',
      doctorName: `Dr. ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`,
      serviceName: appt.service.name,
      visitDate: appt.startAt.toLocaleDateString('en-UG'),
    })
  } else if (ctx.mode === 'DEBT' && ctx.patient) {
    const outstanding = ctx.patient.invoices.reduce((sum, inv) => sum + (inv.totalUGX - inv.paidUGX), 0)
    modeSection = buildDebtModeSection({
      patientName: ctx.patient.firstName,
      outstandingUGX: outstanding,
    })
  }

  if (modeSection) sections.push(modeSection)

  // ── CONVERSATION END RULE ─────────────────────────────────
  sections.push(`
MANDATORY END OF CONVERSATION:
At the end of EVERY interaction you MUST call the save_interaction_memory tool.
Summarise what happened in 1-2 sentences. This is NOT optional.
Every interaction must be remembered for the next time this patient contacts us.

For WhatsApp: your responses must be under 1600 characters. Split longer responses naturally.
Use emojis naturally on WhatsApp: 😊 ✅ 📅 👨‍⚕️ 🦷
`.trim())

  return sections.join('\n\n---\n\n')
}
