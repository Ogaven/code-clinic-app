import Anthropic from '@anthropic-ai/sdk'
import {
  getAvailableSlots,
  getServices,
  getDoctors,
  createAppointment,
  rescheduleAppointment as rescheduleAppt,
  cancelAppointment as cancelAppt,
} from '../booking/booking.service'
import { prisma } from '../../lib/prisma'

// ── Tool definitions ───────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_available_slots',
    description: 'Check available appointment slots for a specific date. Use this before suggesting times or confirming a booking.',
    input_schema: {
      type: 'object',
      properties: {
        date:      { type: 'string', description: 'Date in YYYY-MM-DD format' },
        serviceId: { type: 'string', description: 'Optional service ID to filter slots' },
        doctorId:  { type: 'string', description: 'Optional doctor ID to filter slots' },
      },
      required: ['date'],
    },
  },
  {
    name: 'get_services',
    description: 'Get all available dental services with real prices and durations, plus the list of doctors. Use this when a patient asks about services, prices, or doctors.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'book_appointment',
    description: 'Book a new appointment. Only call this after confirming the patient name, phone number, service, date and time.',
    input_schema: {
      type: 'object',
      properties: {
        patientName:  { type: 'string', description: 'Full name of the patient' },
        patientPhone: { type: 'string', description: 'Patient phone number' },
        serviceId:    { type: 'string', description: 'Service ID from get_services' },
        doctorId:     { type: 'string', description: 'Optional doctor ID. First available assigned if omitted.' },
        startAt:      { type: 'string', description: 'ISO datetime string for the appointment start time' },
        notes:        { type: 'string', description: 'Optional notes for the appointment' },
      },
      required: ['patientName', 'patientPhone', 'serviceId', 'startAt'],
    },
  },
  {
    name: 'reschedule_appointment',
    description: 'Move an existing appointment to a new date/time.',
    input_schema: {
      type: 'object',
      properties: {
        appointmentId: { type: 'string', description: 'ID of the appointment to reschedule' },
        newStartAt:    { type: 'string', description: 'New ISO datetime string' },
      },
      required: ['appointmentId', 'newStartAt'],
    },
  },
  {
    name: 'cancel_appointment',
    description: 'Cancel an existing appointment.',
    input_schema: {
      type: 'object',
      properties: {
        appointmentId: { type: 'string', description: 'ID of the appointment to cancel' },
      },
      required: ['appointmentId'],
    },
  },
  {
    name: 'find_patient_appointments',
    description: 'Look up upcoming appointments for a patient by phone number. Use this when a patient wants to check, reschedule or cancel.',
    input_schema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Patient phone number' },
      },
      required: ['phone'],
    },
  },
  {
    name: 'escalate_to_human',
    description: 'Use this when the patient asks to speak to a human or doctor, has a complaint, reports an emergency, or when the issue cannot be resolved through chat. Creates a lead record so staff can follow up.',
    input_schema: {
      type: 'object',
      properties: {
        patientName:    { type: 'string', description: 'Patient name if known, or "Unknown"' },
        patientPhone:   { type: 'string', description: 'Patient phone number if known' },
        conversationSummary: { type: 'string', description: 'Brief summary of what the patient needs and why they are being escalated' },
      },
      required: ['patientName', 'conversationSummary'],
    },
  },
]

// ── Tool execution ─────────────────────────────────────────────────────────────

async function executeTool(name: string, input: Record<string, any>): Promise<string> {
  try {
    switch (name) {

      case 'get_available_slots': {
        const { date, serviceId, doctorId } = input as { date: string; serviceId?: string; doctorId?: string }
        const services = await getServices()
        const sid = serviceId || services[0]?.id
        if (!sid) return JSON.stringify({ error: 'No services configured in the system.' })

        // Calculate how many days ahead to fetch to cover the requested date
        const requestedDate = new Date(date + 'T00:00:00+03:00')
        const daysUntil     = Math.max(0, Math.floor((requestedDate.getTime() - Date.now()) / 86_400_000))
        const slots         = await getAvailableSlots(sid, doctorId, Math.max(daysUntil + 2, 7))

        // Filter to the requested date (in Kampala timezone)
        const targetStr = requestedDate.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
        const daySlots  = slots.filter(
          s => s.startAt.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }) === targetStr
        )
        const service = services.find(s => s.id === sid)

        return JSON.stringify({
          date,
          service: service?.name ?? 'Requested service',
          available: daySlots.length,
          slots: daySlots.map(s => ({
            startAt:   s.startAt.toISOString(),
            time:      s.startAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' }),
            doctor:    s.doctorName,
            doctorId:  s.doctorId,
            serviceId: s.serviceId,
          })),
          message: daySlots.length === 0
            ? `No available slots on ${date} for this service. Try a different date.`
            : `Found ${daySlots.length} slots on ${date}.`,
        })
      }

      case 'get_services': {
        const [services, doctors] = await Promise.all([getServices(), getDoctors()])
        return JSON.stringify({
          services: services.map(s => ({
            id:           s.id,
            name:         s.name,
            priceUGX:     s.priceUGX,
            durationMins: s.durationMins,
          })),
          doctors: doctors.map(d => ({
            id:             d.id,
            name:           `Dr ${d.firstName} ${d.lastName}`,
            specialisation: d.specialisation ?? null,
          })),
        })
      }

      case 'book_appointment': {
        const { patientName, patientPhone, serviceId, doctorId, startAt, notes } = input as {
          patientName: string; patientPhone: string; serviceId: string
          doctorId?: string; startAt: string; notes?: string
        }

        // Find or create patient with the correct name
        let patient = await prisma.patient.findFirst({ where: { phone: patientPhone } })
        if (!patient) {
          const parts = patientName.trim().split(/\s+/)
          patient = await prisma.patient.create({
            data: { firstName: parts[0], lastName: parts.slice(1).join(' ') || parts[0], phone: patientPhone },
          })
        }

        // Resolve doctor — use provided or first active
        let resolvedDoctorId = doctorId
        if (!resolvedDoctorId) {
          const doc = await prisma.doctor.findFirst({ where: { isActive: true } })
          if (!doc) return JSON.stringify({ error: 'No available doctors at this time.' })
          resolvedDoctorId = doc.id
        }

        const appt = await createAppointment(patient.id, resolvedDoctorId, serviceId, new Date(startAt), patientPhone)

        if (notes) {
          await prisma.appointment.update({ where: { id: appt.id }, data: { notes } })
        }

        return JSON.stringify({
          success:       true,
          appointmentId: appt.id,
          patient:       patient.firstName,
          service:       appt.service.name,
          doctor:        `Dr ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`,
          date:          appt.startAt.toLocaleDateString('en-UG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Nairobi' }),
          time:          appt.startAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' }),
        })
      }

      case 'reschedule_appointment': {
        const { appointmentId, newStartAt } = input as { appointmentId: string; newStartAt: string }
        const updated = await rescheduleAppt(appointmentId, new Date(newStartAt))
        return JSON.stringify({
          success: true,
          newDate: updated.startAt.toLocaleDateString('en-UG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Nairobi' }),
          newTime: updated.startAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' }),
          service: updated.service.name,
          doctor:  `Dr ${updated.doctor.user.firstName} ${updated.doctor.user.lastName}`,
        })
      }

      case 'cancel_appointment': {
        const { appointmentId } = input as { appointmentId: string }
        await cancelAppt(appointmentId)
        return JSON.stringify({ success: true })
      }

      case 'find_patient_appointments': {
        const { phone } = input as { phone: string }
        const patient = await prisma.patient.findFirst({ where: { phone } })
        if (!patient) return JSON.stringify({ found: false, message: 'No patient found with this phone number.' })

        const appointments = await prisma.appointment.findMany({
          where: { patientId: patient.id, startAt: { gte: new Date() }, status: { notIn: ['CANCELLED'] } },
          include: {
            service: { select: { name: true } },
            doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
          },
          orderBy: { startAt: 'asc' },
          take: 5,
        })

        return JSON.stringify({
          found:       true,
          patientName: patient.firstName,
          appointments: appointments.map(a => ({
            id:      a.id,
            service: a.service.name,
            doctor:  `Dr ${a.doctor.user.firstName} ${a.doctor.user.lastName}`,
            date:    a.startAt.toLocaleDateString('en-UG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Nairobi' }),
            time:    a.startAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' }),
            status:  a.status,
          })),
        })
      }

      case 'escalate_to_human': {
        const { patientName, patientPhone, conversationSummary } = input as {
          patientName: string; patientPhone?: string; conversationSummary: string
        }
        await prisma.lead.create({
          data: {
            source:      'WEBSITE',
            status:      'NEW',
            name:        patientName !== 'Unknown' ? patientName : undefined,
            phone:       patientPhone ?? undefined,
            notes:       conversationSummary,
            lastMessage: conversationSummary.slice(0, 200),
          },
        })
        return JSON.stringify({ success: true, message: 'Lead created — staff will follow up.' })
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` })
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message || 'Tool execution failed' })
  }
}

// ── System prompt ──────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const now = new Date().toLocaleString('en-UG', {
    timeZone: 'Africa/Nairobi', dateStyle: 'full', timeStyle: 'short',
  })
  return `You are Sarah, a warm and friendly receptionist at Code Clinic dental clinic in Kamwokya, Kampala, Uganda.

=== FORMATTING — ABSOLUTE RULES, NO EXCEPTIONS ===
You are texting in a plain-text chat widget. Markdown does not render — it shows as raw symbols and looks broken and unprofessional.

FORBIDDEN — never output any of these, ever:
  ** (asterisks for bold)
  * or - at the start of a line (bullet points)
  _ (underscores for italic)
  # (headers)
  numbered lists (1. 2. 3.)
  --- or === (dividers)

REQUIRED — always write like this:
  Plain sentences, exactly as you would say them out loud.
  When you need to mention a list of things, weave them into a sentence:
  WRONG:  "Our doctors are:\n- Dr Angella\n- Dr Arnold\n- Dr Joseline"
  RIGHT:  "We have Dr Angella, Dr Arnold, Dr Joseline and others on the team."
  Keep it short — 1 to 3 sentences is almost always enough.

=== GREETING ===
The chat already showed the patient a welcome message. Do NOT greet them again or introduce yourself. Just respond naturally to what they said.

=== PERSONA ===
You are a human receptionist, not a robot. Never say you are AI or automated. If asked, say something like "I'm just one of the girls at the front desk 😄". Be warm, casual and friendly — like a real Ugandan front desk person. Use emojis occasionally 😊 but sparingly. Once you know the patient's name, use it.

=== CLINIC INFO ===
Name: Code Clinic
Location: Old Kira Road, opposite Police Playground, Kamwokya, Kampala
Phone and WhatsApp: +256 709 740457
Email: dentist@codeclinic.ug
Website: codeclinic.ug
Hours: Monday to Friday 8am to 6pm, Saturday 9am to 2pm, Sunday closed

=== TOOLS ===
Call get_services when asked about services, prices or doctors — never guess.
Call get_available_slots before confirming any time — never invent slots.
Call find_patient_appointments when a patient wants to view, reschedule or cancel.
Call book_appointment only after you have the patient's full name, phone, service and preferred date and time.
After booking, confirm in one or two plain sentences — no lists.
If a slot is unavailable, suggest alternatives in a natural sentence.

=== CONFIDENTIALITY ===
Never share staff salaries, internal costs, other patients' data, admin credentials, API keys or backend details. If asked, say: "I'm not able to share that, but I can help with appointments or questions about our services! 😊"

=== ESCALATION ===
Escalate when: the patient asks to speak to a human or doctor, reports an emergency, makes a complaint, or you genuinely cannot resolve their issue after a couple of exchanges.
Steps:
First call the escalate_to_human tool with the patient's details and a short summary.
Then send exactly this — word for word, nothing added: "Please call or WhatsApp us on +256 709 740457 and our team will help you!"

=== CURRENT DATE AND TIME IN KAMPALA ===
${now}`
}

// ── Main entry point ───────────────────────────────────────────────────────────

export async function getWebsiteAgentReply(
  conversationId: string,
  _sessionId: string,
  latestMessage: string,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return `Hi! I've received your message and a team member will be with you shortly. For urgent matters please call us on 0741 087667 😊`
  }

  // Load recent conversation history
  const dbMessages = await prisma.aiMessage.findMany({
    where:   { conversationId },
    orderBy: { createdAt: 'asc' },
    take:    20,
  })

  // Build messages array, alternating user/assistant correctly
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const m of dbMessages) {
    if (m.role === 'USER') {
      history.push({ role: 'user', content: m.content })
    } else if (m.role === 'AGENT') {
      history.push({ role: 'assistant', content: m.content })
    }
  }

  // Append current message if not already last
  const last = history[history.length - 1]
  if (!last || last.role !== 'user' || last.content !== latestMessage) {
    history.push({ role: 'user', content: latestMessage })
  }

  const client = new Anthropic({ apiKey })

  try {
    // Use 'any' for messages to accommodate tool_use content blocks from responses
    const currentMessages: any[] = [...history]

    // Tool-use loop — runs until Claude stops calling tools (max 5 rounds)
    for (let i = 0; i < 5; i++) {
      const response = await client.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system:     buildSystemPrompt(),
        tools:      TOOLS,
        messages:   currentMessages,
      })

      // No tool use — extract and return the text
      if (response.stop_reason !== 'tool_use') {
        const textBlock = response.content.find(b => b.type === 'text') as Anthropic.Messages.TextBlock | undefined
        return textBlock?.text ?? `I'm here — how can I help? 😊`
      }

      // Add the assistant turn with tool_use blocks
      currentMessages.push({ role: 'assistant', content: response.content })

      // Execute every tool call and gather results
      const toolResults: Array<{
        type: 'tool_result'
        tool_use_id: string
        content: string
      }> = []

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        const result = await executeTool(block.name, block.input as Record<string, any>)
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
      }

      // Feed tool results back as a user message
      currentMessages.push({ role: 'user', content: toolResults })
    }

    return `Let me get that sorted for you — if it's urgent please call us on 0741 087667 😊`
  } catch (err: any) {
    console.error('[WebsiteAgent] error:', err)
    return `Sorry, I'm having a small issue right now. Please try again or call the clinic directly on 0741 087667 😊`
  }
}
