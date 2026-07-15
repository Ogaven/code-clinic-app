import Anthropic from '@anthropic-ai/sdk'
import {
  getAvailableSlots,
  getServices,
  getDoctors,
  createAppointment,
} from '../booking/booking.service'
import { prisma } from '../../lib/prisma'
import { sendWhatsAppMessage } from '../whatsapp/whatsapp.service'

// Phrase that marks an escalation has already been sent in this conversation
const ESCALATION_PHRASE = 'Please call or WhatsApp us on +256741087667 and our team will help you'

// ── Tool definitions ───────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_services',
    description: 'Get all available dental services with real prices and durations, plus the list of doctors. Call this when a visitor asks about services, prices, treatments or doctors.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_available_slots',
    description: 'Check available appointment slots for a specific date. Use this to show a visitor real available times. Do NOT use this to actually book — use book_appointment after the visitor picks a slot.',
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
    name: 'save_booking_request',
    description: 'FALLBACK ONLY: Save a booking request as a Lead when the visitor cannot pick a specific time slot (e.g. "call me anytime"). Use book_appointment instead whenever the visitor has confirmed a real slot.',
    input_schema: {
      type: 'object',
      properties: {
        visitorName:      { type: 'string', description: 'Full name of the visitor' },
        visitorPhone:     { type: 'string', description: 'Phone number of the visitor' },
        serviceRequested: { type: 'string', description: 'Service or treatment they want, e.g. "Tooth extraction", "Cleaning", "General checkup"' },
        doctorPreference: { type: 'string', description: 'Preferred doctor name if mentioned, otherwise omit' },
        preferredDate:    { type: 'string', description: 'Preferred date or time if mentioned, e.g. "Tuesday afternoon" or "2026-06-03"' },
      },
      required: ['visitorName', 'visitorPhone'],
    },
  },
  {
    name: 'book_appointment',
    description: 'Book a real confirmed appointment for a website visitor. Call this ONLY after the visitor has confirmed a specific slot from the list you showed them. Use the exact serviceId, doctorId, and slotStartAt values returned by get_available_slots.',
    input_schema: {
      type: 'object',
      properties: {
        visitorName:  { type: 'string', description: 'Full name of the visitor' },
        visitorPhone: { type: 'string', description: 'Phone number of the visitor' },
        serviceId:    { type: 'string', description: 'Service ID from get_available_slots result' },
        doctorId:     { type: 'string', description: 'Doctor ID from the chosen slot in get_available_slots result' },
        slotStartAt:  { type: 'string', description: 'Exact slot start time as ISO string from get_available_slots result' },
      },
      required: ['visitorName', 'visitorPhone', 'serviceId', 'doctorId', 'slotStartAt'],
    },
  },
  {
    name: 'escalate_to_human',
    description: 'Use this when the visitor explicitly asks to speak to a human or doctor, reports an emergency, makes a complaint, or when you genuinely cannot help after a couple of exchanges. Creates a lead record so staff can follow up. Only call this ONCE per conversation.',
    input_schema: {
      type: 'object',
      properties: {
        patientName:         { type: 'string', description: 'Visitor name if known, or "Unknown"' },
        patientPhone:        { type: 'string', description: 'Visitor phone number if known' },
        conversationSummary: { type: 'string', description: 'Brief summary of what the visitor needs and why they are being escalated' },
      },
      required: ['patientName', 'conversationSummary'],
    },
  },
]

// ── Tool execution ─────────────────────────────────────────────────────────────

async function executeTool(name: string, input: Record<string, any>): Promise<string> {
  try {
    switch (name) {

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

      case 'get_available_slots': {
        const { date, serviceId, doctorId } = input as { date: string; serviceId?: string; doctorId?: string }
        const services = await getServices()
        const sid = serviceId || services[0]?.id
        if (!sid) return JSON.stringify({ error: 'No services configured in the system.' })

        const requestedDate = new Date(date + 'T00:00:00+03:00')
        const daysUntil     = Math.max(0, Math.floor((requestedDate.getTime() - Date.now()) / 86_400_000))
        const slots         = await getAvailableSlots(sid, doctorId, Math.max(daysUntil + 2, 7))

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

      case 'book_appointment': {
        const { visitorName, visitorPhone, serviceId, doctorId, slotStartAt } = input as {
          visitorName: string; visitorPhone: string; serviceId: string; doctorId: string; slotStartAt: string
        }
        const digits     = visitorPhone.replace(/\D/g, '')
        const normalized = digits.startsWith('256') ? '+' + digits
          : digits.startsWith('0') && digits.length === 10 ? '+256' + digits.slice(1)
          : digits.length === 9 ? '+256' + digits
          : '+' + digits

        const startAt = new Date(slotStartAt)
        if (isNaN(startAt.getTime())) {
          return JSON.stringify({ error: 'Invalid slot time — please use the exact ISO string from get_available_slots.' })
        }

        const firstName = visitorName.trim().split(' ')[0]
        const appt = await createAppointment(null, doctorId, serviceId, startAt, normalized, firstName)

        const dateStr = appt.startAt.toLocaleDateString('en-UG', {
          weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi',
        })
        const timeStr = appt.startAt.toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
        })
        const docName = `Dr ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`
        const confirmation = `Your appointment is confirmed for ${dateStr} at ${timeStr} with ${docName} at Code Clinic. See you then! 😊`

        const staffNum = process.env.STAFF_WHATSAPP_NUMBER || '+256763430276'
        sendWhatsAppMessage(
          staffNum,
          `📅 Website Booking\nName: ${visitorName}\nPhone: ${normalized}\nService: ${appt.service.name}\nTime: ${dateStr} at ${timeStr}\nDoctor: ${docName}`,
          '',
        ).catch(() => {})

        return JSON.stringify({ success: true, confirmation, appointmentId: appt.id })
      }

      case 'save_booking_request': {
        const { visitorName, visitorPhone, serviceRequested, doctorPreference, preferredDate } = input as {
          visitorName: string; visitorPhone: string; serviceRequested?: string
          doctorPreference?: string; preferredDate?: string
        }

        const noteParts: string[] = ['Booking request from website chatbot.']
        if (serviceRequested) noteParts.push(`Service: ${serviceRequested}.`)
        if (doctorPreference) noteParts.push(`Doctor preference: ${doctorPreference}.`)
        if (preferredDate)    noteParts.push(`Preferred date/time: ${preferredDate}.`)

        const notes = noteParts.join(' ')

        await prisma.lead.create({
          data: {
            source:      'WEBSITE',
            status:      'NEW',
            name:        visitorName,
            phone:       visitorPhone,
            notes,
            lastMessage: notes.slice(0, 200),
          },
        })

        const staffNum = process.env.STAFF_WHATSAPP_NUMBER || '+256763430276'
        sendWhatsAppMessage(
          staffNum,
          `🔔 Website Lead (needs callback)\nName: ${visitorName}\nPhone: ${visitorPhone}\n${notes}`,
          '',
        ).catch(() => {})

        return JSON.stringify({ success: true, message: 'Booking request saved — team will call back to confirm.' })
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

        const staffNum = process.env.STAFF_WHATSAPP_NUMBER || '+256763430276'
        const staffMsg = `🚨 Website Escalation\nName: ${patientName}${patientPhone ? '\nPhone: ' + patientPhone : ''}\nSummary: ${conversationSummary.slice(0, 200)}`
        sendWhatsAppMessage(staffNum, staffMsg, '').catch(() => {})

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

function buildSystemPrompt(alreadyEscalated: boolean): string {
  const now = new Date().toLocaleString('en-UG', {
    timeZone: 'Africa/Nairobi', dateStyle: 'full', timeStyle: 'short',
  })

  const escalationSection = alreadyEscalated
    ? `=== ESCALATION ===
You have ALREADY escalated this conversation and given the visitor the phone number. DO NOT say the escalation phrase again. Just continue helping them normally and answer any further questions they have.`
    : `=== ESCALATION ===
Escalate when: the visitor explicitly asks to speak to a human or doctor, reports an emergency, makes a complaint, or you genuinely cannot help after a couple of exchanges.
Steps (do these ONCE per conversation — never repeat):
1. Call the escalate_to_human tool with the visitor's details and a short summary.
2. Then send exactly this — word for word, nothing added: "Please call or WhatsApp us on +256741087667 and our team will help you!"`

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
The chat already showed the visitor a welcome message. Do NOT greet them again or introduce yourself. Just respond naturally to what they said.

=== PERSONA ===
You are a human receptionist, not a robot. Never say you are AI or automated. If asked, say something like "I'm just one of the girls at the front desk 😄". Be warm, casual and friendly — like a real Ugandan front desk person. Use emojis occasionally 😊 but sparingly. Once you know the visitor's name, use it.

=== CLINIC INFO ===
Name: Code Clinic
Location: Old Kira Road, opposite Police Playground, Kamwokya, Kampala
Phone and WhatsApp: +256741087667
Email: dentist@codeclinic.ug
Website: codeclinic.ug
Hours: Monday to Friday 8am to 6pm, Saturday 9am to 2pm, Sunday closed

=== WHO YOU ARE TALKING TO ===
Visitors on this chat are members of the public who found us online. They are NOT registered patients in our system yet. NEVER say you "cannot find them in the database" or that they "don't exist in our records" — that would be confusing and rude. Treat them like a new walk-in calling for the first time.

=== WHAT YOU CAN DO ===
Answer questions about our services, prices, and doctors — use get_services for accurate info.
Check real availability — use get_available_slots to show a visitor actual open slots.
Book a real confirmed appointment — use book_appointment once the visitor picks a specific slot.
As a fallback when a visitor cannot pick a specific time, use save_booking_request so our team calls them back.
Give our location, hours, contact details.
Escalate complex or urgent issues.

=== WHAT YOU CANNOT DO ===
You CANNOT look up whether someone is already a patient — do not try, do not mention it.
You CANNOT access or modify existing appointment records for website visitors.

=== BOOKING FLOW ===
When a visitor wants an appointment:
1. Ask for their name and phone number if you don't have them yet.
2. Find out what service they want — call get_services to confirm details and get the serviceId.
3. Ask for their preferred date, then call get_available_slots with that date and the serviceId to get real slots.
4. Present 2-3 options conversationally: "I have Tuesday at 10am with Dr Angella or Wednesday at 2pm with Dr Arnold — which suits you?"
5. Once they confirm a slot, call book_appointment with their name, phone, and the exact serviceId, doctorId, and slotStartAt from the get_available_slots result.
6. After book_appointment succeeds, output the "confirmation" field from the tool result exactly as written.
FALLBACK: If the visitor genuinely cannot pick a specific time (e.g. "call me anytime"), use save_booking_request instead — our team will call them to arrange a time.
Do NOT ask them to log in, do NOT say you cannot find them, do NOT mention databases.

=== CONFIDENTIALITY ===
Never share staff salaries, internal costs, other patients' data, admin credentials, API keys or backend details. If asked, say: "I'm not able to share that, but I can help with appointments or questions about our services! 😊"

${escalationSection}

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
    return `Hi! I've received your message and a team member will be with you shortly. For urgent matters please call us on +256741087667 😊`
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

  // BUG 1 FIX: detect whether we already sent the escalation phrase in this conversation
  const alreadyEscalated = dbMessages.some(
    m => m.role === 'AGENT' && m.content.includes(ESCALATION_PHRASE)
  )

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
        system:     buildSystemPrompt(alreadyEscalated),
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

    return `Let me get that sorted for you — if it's urgent please call or WhatsApp us on +256741087667 😊`
  } catch (err: any) {
    console.error('[WebsiteAgent] error:', err)
    return `Sorry, I'm having a small issue right now. Please try again or call the clinic directly on +256741087667 😊`
  }
}
