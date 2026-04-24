import Anthropic from '@anthropic-ai/sdk'
import { PrismaClient } from '@prisma/client'
import {
  getAvailableSlots,
  getServices,
  getDoctors,
  createAppointment,
  rescheduleAppointment,
  cancelAppointment,
  type AvailableSlot,
} from '../booking/booking.service'
import {
  getBookingState,
  setBookingState,
  clearBookingState,
  type BookingStateEntry,
} from '../booking/booking.state'

const prisma = new PrismaClient()

const SARAH_SYSTEM_PROMPT = `You are Sarah, the patient care assistant for Code Clinic, a dental clinic in Kampala, Uganda. You are warm, friendly, and speak in natural conversational Ugandan English — not stiff, not formal, not robotic. You genuinely care about every patient. You remember everything about them from previous conversations and refer to their history naturally without making it feel strange. You help patients book, reschedule, and cancel appointments conversationally. You send reminders and follow up after treatment warmly. When discussing outstanding balances you are empathetic and non-judgmental — like a trusted friend helping them sort things out, never making them feel embarrassed. You know everything about Code Clinic's services, prices, hours, and doctors from the knowledge provided to you. When you truly cannot help, you escalate gracefully to a human staff member by saying you will get someone to follow up. You sign off messages as 'Sarah — Code Clinic 😊'. You keep responses short and conversational — 1 to 3 sentences maximum unless the patient asks for detail. Never say you are an AI unless directly and explicitly asked. If asked directly, say you are Sarah, Code Clinic's care assistant. Never mention Claude or Anthropic.`

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContextPackage {
  patientName: string
  conversationHistory: string
  appointments: string
  knowledgeBase: string
}

// ── buildContext ──────────────────────────────────────────────────────────────

async function buildContext(
  conversationId: string,
  from: string,
  message: string
): Promise<ContextPackage> {
  const patient = await prisma.patient.findUnique({
    where: { phone: from },
    select: { id: true, firstName: true, lastName: true, phone: true, email: true, createdAt: true },
  })

  const patientName = patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown patient'

  let conversationHistory = ''
  if (patient) {
    const dbMessages = await prisma.aiMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 15,
    })
    conversationHistory = dbMessages
      .map(m => (m.role === 'USER' ? `Patient: ${m.content}` : `Sarah: ${m.content}`))
      .join('\n')
  }

  let appointments = 'none on record'
  if (patient) {
    const appts = await prisma.appointment.findMany({
      where: { patientId: patient.id },
      orderBy: { startAt: 'desc' },
      take: 3,
      include: {
        doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
        service: { select: { name: true } },
      },
    })
    if (appts.length > 0) {
      appointments = appts
        .map(a => {
          const date = a.startAt.toLocaleDateString('en-UG', {
            day: '2-digit', month: 'short', year: 'numeric',
          })
          const doctor = `Dr ${a.doctor.user.firstName} ${a.doctor.user.lastName}`
          return `- ${date}: ${a.service.name} with ${doctor} (status: ${a.status})`
        })
        .join('\n')
    }
  }

  let knowledgeBase = ''
  const keyword = message.split(/\s+/).find(w => w.length >= 4)
  if (keyword) {
    const kbResults = await prisma.aiKnowledgeBase.findMany({
      where: { content: { contains: keyword, mode: 'insensitive' } },
      take: 3,
      select: { content: true },
    })
    knowledgeBase = kbResults.map(k => k.content).join('\n\n')
  }

  return { patientName, conversationHistory, appointments, knowledgeBase }
}

// ── Intent detection ──────────────────────────────────────────────────────────

type Intent = 'BOOK' | 'RESCHEDULE' | 'CANCEL' | null

export function detectIntent(message: string): Intent {
  const lower = message.toLowerCase()

  const cancelWords = [
    'cancel', "won't make it", "wont make it", "can't come", "cant come",
    "cannot come", 'remove my appointment', 'delete my appointment',
  ]
  if (cancelWords.some(w => lower.includes(w))) return 'CANCEL'

  const rescheduleWords = [
    'reschedule', 'change my appointment', 'move my appointment',
    'different time', 'change the time', 'postpone',
  ]
  if (rescheduleWords.some(w => lower.includes(w))) return 'RESCHEDULE'

  const bookWords = [
    'book', 'appointment', 'schedule', 'come in', 'visit',
    'see doctor', 'see a doctor', 'checkup', 'check up',
    'cleaning', 'filling', 'extraction', 'whitening',
  ]
  if (bookWords.some(w => lower.includes(w))) return 'BOOK'

  return null
}

// ── Slot formatting helpers ───────────────────────────────────────────────────

function formatSlotLine(slot: AvailableSlot, index: number): string {
  const day = slot.startAt.toLocaleDateString('en-UG', {
    weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Africa/Kampala',
  })
  const time = slot.startAt.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala',
  }).toLowerCase()
  return `${index + 1}. ${day} at ${time} — ${slot.doctorName}`
}

function formatSlotsMessage(slots: AvailableSlot[], serviceName: string): string {
  if (slots.length === 0) {
    return `I'm sorry, I couldn't find any available slots for *${serviceName}* in the next 7 days. Would you like me to look further ahead, or shall I have someone from the clinic call you to arrange a time? 😊\n\nSarah — Code Clinic 😊`
  }
  const lines = slots.slice(0, 5).map((s, i) => formatSlotLine(s, i)).join('\n')
  return `I found these available slots for *${serviceName}* 😊\n\n${lines}\n\nJust reply with the number that works best for you!`
}

function formatConfirmation(appt: {
  startAt: Date
  doctor:  { user: { firstName: string; lastName: string } }
  service: { name: string }
}): string {
  const day = appt.startAt.toLocaleDateString('en-UG', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Kampala',
  })
  const time = appt.startAt.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala',
  }).toLowerCase()
  const doctor = `Dr ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`
  return `Perfect! You're all booked 🎉 *${day}* at *${time}* with *${doctor}* for *${appt.service.name}*. We'll send you a reminder the day before. See you then!\n\nSarah — Code Clinic 😊`
}

// ── Parse patient's slot choice (1/2/3 or "first"/"second" etc.) ──────────────

function parseSlotChoice(message: string): number | null {
  const lower = message.toLowerCase().trim()
  const ordinals: Record<string, number> = {
    'first': 1, '1st': 1, 'one': 1,
    'second': 2, '2nd': 2, 'two': 2,
    'third': 3, '3rd': 3, 'three': 3,
    'fourth': 4, '4th': 4, 'four': 4,
    'fifth': 5, '5th': 5, 'five': 5,
  }
  for (const [word, num] of Object.entries(ordinals)) {
    if (lower.includes(word)) return num
  }
  const m = lower.match(/\b([1-5])\b/)
  return m ? parseInt(m[1]) : null
}

// ── Parse preferred day for reschedule ────────────────────────────────────────

function parsePreferredDay(message: string): number | null {
  const lower = message.toLowerCase()
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  for (let i = 0; i < days.length; i++) {
    if (lower.includes(days[i])) return i
  }
  if (lower.includes('tomorrow')) {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.getDay()
  }
  if (lower.includes('today')) return new Date().getDay()
  return null
}

function parseTimeOfDay(message: string): { startH: number; endH: number } | null {
  const lower = message.toLowerCase()
  if (lower.includes('morning'))   return { startH: 8,  endH: 12 }
  if (lower.includes('afternoon')) return { startH: 12, endH: 17 }
  if (lower.includes('evening'))   return { startH: 17, endH: 19 }
  return null
}

function slotKampalaHour(slot: AvailableSlot): number {
  return parseInt(
    slot.startAt.toLocaleTimeString('en-US', {
      hour: 'numeric', hour12: false, timeZone: 'Africa/Kampala',
    })
  )
}

function slotKampalaWeekday(slot: AvailableSlot): number {
  const short = slot.startAt.toLocaleDateString('en-US', {
    weekday: 'short', timeZone: 'Africa/Kampala',
  })
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(short)
}

// ── Match service from patient message ────────────────────────────────────────

async function matchService(message: string) {
  const services = await getServices()
  const lower    = message.toLowerCase()

  const direct = services.find(s => lower.includes(s.name.toLowerCase()))
  if (direct) return direct

  const synonyms: Array<[string[], string]> = [
    [['clean', 'scal', 'polish'],                        'cleaning'],
    [['fill', 'cavity', 'cavit'],                        'filling'],
    [['whiten', 'bright'],                               'whitening'],
    [['extract', 'pull', 'remove tooth', 'remove teeth'],'extraction'],
    [['root canal', 'nerve'],                            'root canal'],
    [['check', 'exam', 'consult'],                       'checkup'],
    [['crown', 'cap'],                                   'crown'],
    [['brace', 'align', 'orthodont'],                    'braces'],
    [['implant'],                                        'implant'],
    [['veneer'],                                         'veneer'],
    [['x-ray', 'xray', 'scan'],                         'x-ray'],
  ]

  for (const [keywords, canonical] of synonyms) {
    if (keywords.some(k => lower.includes(k))) {
      const hit = services.find(s => s.name.toLowerCase().includes(canonical))
      if (hit) return hit
    }
  }

  return null
}

// ── Match doctor from patient message ─────────────────────────────────────────

async function matchDoctor(message: string) {
  const doctors = await getDoctors()
  const lower   = message.toLowerCase()
  return doctors.find(
    d => lower.includes(d.firstName.toLowerCase()) || lower.includes(d.lastName.toLowerCase())
  ) ?? null
}

// ── Booking state handlers ────────────────────────────────────────────────────

async function handleIdleBookIntent(
  from: string,
  intent: NonNullable<Intent>
): Promise<string> {
  if (intent === 'BOOK') {
    setBookingState(from, { state: 'AWAITING_SERVICE' })
    return `Of course! What dental service are you looking for? For example — cleaning, filling, whitening, extraction, or something else? 😊\n\nSarah — Code Clinic 😊`
  }

  // RESCHEDULE or CANCEL — need to find their upcoming appointment
  const patient = await prisma.patient.findUnique({ where: { phone: from } })
  if (!patient) {
    return `I don't have any upcoming appointments on record for this number. Would you like to book a new one instead? 😊\n\nSarah — Code Clinic 😊`
  }

  const upcoming = await prisma.appointment.findFirst({
    where: {
      patientId: patient.id,
      startAt:   { gt: new Date() },
      status:    { notIn: ['CANCELLED'] },
    },
    orderBy: { startAt: 'asc' },
    include: {
      doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
      service: { select: { id: true, name: true } },
    },
  })

  if (!upcoming) {
    return `I don't see any upcoming appointments for you right now. Would you like to book one? 😊\n\nSarah — Code Clinic 😊`
  }

  const apptDay = upcoming.startAt.toLocaleDateString('en-UG', {
    weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Africa/Kampala',
  })
  const apptTime = upcoming.startAt.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala',
  }).toLowerCase()
  const apptDoctor = `Dr ${upcoming.doctor.user.firstName} ${upcoming.doctor.user.lastName}`

  if (intent === 'CANCEL') {
    setBookingState(from, { state: 'AWAITING_CANCEL_CONFIRMATION', appointmentId: upcoming.id })
    return `I can see you have an appointment on *${apptDay}* at *${apptTime}* with *${apptDoctor}* for *${upcoming.service.name}*. Are you sure you want to cancel it? Just reply *yes* to confirm or *no* to keep it. 😊\n\nSarah — Code Clinic 😊`
  }

  // RESCHEDULE
  setBookingState(from, {
    state:         'AWAITING_RESCHEDULE_SLOT',
    appointmentId: upcoming.id,
    serviceId:     upcoming.service.id,
  })
  return `Sure! Your appointment is on *${apptDay}* at *${apptTime}* with *${apptDoctor}* for *${upcoming.service.name}*. What day or time would work better for you? 😊\n\nSarah — Code Clinic 😊`
}

async function handleAwaitingService(from: string, message: string): Promise<string> {
  const service = await matchService(message)

  if (!service) {
    const services = await getServices()
    const list = services.map(s => `• ${s.name}`).join('\n')
    return `Sorry, I didn't quite catch that 😊 Here are the services we offer:\n\n${list}\n\nWhich one are you interested in?`
  }

  setBookingState(from, { state: 'AWAITING_DOCTOR_PREFERENCE', serviceId: service.id })
  return `Got it! *${service.name}* — great choice 😊 Do you have a preferred doctor, or shall I find whoever is available soonest?\n\nSarah — Code Clinic 😊`
}

async function handleAwaitingDoctorPreference(
  from: string,
  message: string,
  state: BookingStateEntry
): Promise<string> {
  const lower = message.toLowerCase()

  // Patient said "yes" but hasn't named a doctor yet
  if (
    (lower.includes('yes') || lower.includes('prefer') || lower.includes('specific')) &&
    !lower.includes('no') &&
    !(await matchDoctor(message))
  ) {
    setBookingState(from, { state: 'AWAITING_DOCTOR_NAME', serviceId: state.serviceId })
    const doctors  = await getDoctors()
    const nameList = doctors.map(d => `• Dr ${d.firstName} ${d.lastName}${d.specialisation ? ` (${d.specialisation})` : ''}`).join('\n')
    return `Of course! Here are our doctors:\n\n${nameList}\n\nWhich doctor would you like? 😊\n\nSarah — Code Clinic 😊`
  }

  // Patient named a doctor directly
  const namedDoctor = await matchDoctor(message)
  if (namedDoctor) {
    return presentSlots(from, state.serviceId!, namedDoctor.id)
  }

  // Patient said no preference / any / whoever
  return presentSlots(from, state.serviceId!, undefined)
}

async function handleAwaitingDoctorName(
  from: string,
  message: string,
  state: BookingStateEntry
): Promise<string> {
  const doctor = await matchDoctor(message)

  if (!doctor) {
    const doctors  = await getDoctors()
    const nameList = doctors.map(d => `• Dr ${d.firstName} ${d.lastName}`).join('\n')
    return `I couldn't find that doctor 😊 Here's who we have:\n\n${nameList}\n\nWhich one would you prefer?`
  }

  return presentSlots(from, state.serviceId!, doctor.id)
}

// Shared helper: fetch slots, store in state, return formatted message
async function presentSlots(
  from: string,
  serviceId: string,
  doctorId: string | undefined,
  existingAppointmentId?: string
): Promise<string> {
  const slots = await getAvailableSlots(serviceId, doctorId)

  setBookingState(from, {
    state:          'AWAITING_SLOT_CONFIRMATION',
    serviceId,
    doctorId,
    availableSlots: slots.slice(0, 5),
    appointmentId:  existingAppointmentId,
  })

  const serviceName = slots[0]?.serviceName ?? 'your appointment'
  return formatSlotsMessage(slots, serviceName)
}

async function handleAwaitingSlotConfirmation(
  from: string,
  message: string,
  state: BookingStateEntry
): Promise<string> {
  const choice = parseSlotChoice(message)

  if (!choice || !state.availableSlots || choice > state.availableSlots.length) {
    const max = state.availableSlots?.length ?? 5
    return `Sorry, I didn't catch that 😊 Please reply with a number between 1 and ${max} to choose your slot.`
  }

  const slot = state.availableSlots[choice - 1]

  try {
    if (state.appointmentId) {
      // Reschedule
      const updated = await rescheduleAppointment(state.appointmentId, slot.startAt)
      clearBookingState(from)
      return formatConfirmation(updated)
    } else {
      // New booking — look up patient by phone
      const patient = await prisma.patient.findUnique({ where: { phone: from } })
      const appt    = await createAppointment(
        patient?.id ?? null,
        slot.doctorId,
        slot.serviceId,
        slot.startAt,
        from
      )
      clearBookingState(from)
      return formatConfirmation(appt)
    }
  } catch (err: any) {
    // Slot may have been taken between presentation and confirmation
    clearBookingState(from)
    return `Oh no — that slot was just taken while we were chatting 😅 Let me find you a fresh list! Just send "book appointment" to start again, or I'll get someone to call you.\n\nSarah — Code Clinic 😊`
  }
}

async function handleAwaitingRescheduleSlot(
  from: string,
  message: string,
  state: BookingStateEntry
): Promise<string> {
  let allSlots = await getAvailableSlots(state.serviceId!, state.doctorId, 14)

  // Filter by preferred day if detectable
  const preferredDay = parsePreferredDay(message)
  if (preferredDay !== null) {
    const filtered = allSlots.filter(s => slotKampalaWeekday(s) === preferredDay)
    if (filtered.length > 0) allSlots = filtered
  }

  // Filter by time of day if detectable
  const tod = parseTimeOfDay(message)
  if (tod) {
    const filtered = allSlots.filter(s => {
      const h = slotKampalaHour(s)
      return h >= tod.startH && h < tod.endH
    })
    if (filtered.length > 0) allSlots = filtered
  }

  const top5 = allSlots.slice(0, 5)

  setBookingState(from, {
    state:          'AWAITING_SLOT_CONFIRMATION',
    serviceId:      state.serviceId,
    doctorId:       state.doctorId,
    availableSlots: top5,
    appointmentId:  state.appointmentId,  // preserve for reschedule
  })

  const serviceName = top5[0]?.serviceName ?? 'your appointment'
  return formatSlotsMessage(top5, serviceName)
}

async function handleAwaitingCancelConfirmation(
  from: string,
  message: string,
  state: BookingStateEntry
): Promise<string> {
  const lower = message.toLowerCase()
  const isYes = ['yes', 'yeah', 'yep', 'confirm', 'sure', 'okay', 'ok', 'proceed'].some(w => lower.includes(w))
  const isNo  = ['no', "don't", 'dont', 'keep', 'never mind', 'nevermind', 'stop'].some(w => lower.includes(w))

  if (isYes && state.appointmentId) {
    try {
      await cancelAppointment(state.appointmentId)
    } catch { /* appointment may already be cancelled */ }
    clearBookingState(from)
    return `Done, your appointment has been cancelled. Sorry to see you go — whenever you're ready to book again, I'm here! 😊\n\nSarah — Code Clinic 😊`
  }

  if (isNo) {
    clearBookingState(from)
    return `No problem at all! Your appointment is still on the books. See you then 😊\n\nSarah — Code Clinic 😊`
  }

  return `Just to confirm — do you want to *cancel* your appointment? Reply *yes* to cancel or *no* to keep it 😊\n\nSarah — Code Clinic 😊`
}

// ── getAgentReply — main entry point ─────────────────────────────────────────

export async function getAgentReply(
  conversationId: string,
  from: string,
  latestMessage: string
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    console.warn('[Agent] ANTHROPIC_API_KEY not set — returning fallback')
    return `Hi! I've received your message and a team member will be with you shortly. For urgent matters please call us directly.\n\nSarah — Code Clinic 😊`
  }

  // ── Booking state machine ─────────────────────────────────────────────────
  const bookingState = getBookingState(from)

  switch (bookingState.state) {
    case 'AWAITING_SERVICE':
      return handleAwaitingService(from, latestMessage)

    case 'AWAITING_DOCTOR_PREFERENCE':
      return handleAwaitingDoctorPreference(from, latestMessage, bookingState)

    case 'AWAITING_DOCTOR_NAME':
      return handleAwaitingDoctorName(from, latestMessage, bookingState)

    case 'AWAITING_SLOT_CONFIRMATION':
      return handleAwaitingSlotConfirmation(from, latestMessage, bookingState)

    case 'AWAITING_RESCHEDULE_SLOT':
      return handleAwaitingRescheduleSlot(from, latestMessage, bookingState)

    case 'AWAITING_CANCEL_CONFIRMATION':
      return handleAwaitingCancelConfirmation(from, latestMessage, bookingState)

    case 'IDLE':
    default: {
      const intent = detectIntent(latestMessage)
      if (intent) return handleIdleBookIntent(from, intent)
      // fall through to normal Claude call
    }
  }

  // ── Normal Claude call with RAG context ───────────────────────────────────
  const context = await buildContext(conversationId, from, latestMessage)

  const historyLines = context.conversationHistory
    .split('\n')
    .filter(line => line.trim().length > 0)

  const messages: { role: 'user' | 'assistant'; content: string }[] = []

  for (const line of historyLines) {
    if (line.startsWith('Patient: ')) {
      messages.push({ role: 'user',      content: line.slice('Patient: '.length) })
    } else if (line.startsWith('Sarah: ')) {
      messages.push({ role: 'assistant', content: line.slice('Sarah: '.length) })
    }
  }

  if (messages.length === 0) {
    messages.push({ role: 'user', content: latestMessage })
  } else if (messages[messages.length - 1].role !== 'user') {
    messages.push({ role: 'user', content: latestMessage })
  }

  const systemParts = [
    SARAH_SYSTEM_PROMPT,
    '',
    'PATIENT CONTEXT:',
    `Name: ${context.patientName}`,
    `Phone: ${from}`,
    'Recent appointments:',
    context.appointments,
  ]
  if (context.knowledgeBase) {
    systemParts.push('', 'CLINIC KNOWLEDGE BASE:', context.knowledgeBase)
  }

  try {
    const client   = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 300,
      system:     systemParts.join('\n'),
      messages,
    })

    const block = response.content[0]
    if (block.type === 'text') return block.text

    return `I'm here to help! Could you please rephrase that for me?\n\nSarah — Code Clinic 😊`
  } catch (err) {
    console.error('[Agent] Claude API error:', err)
    return `Sorry, I'm having a small issue right now. Please try again or call the clinic directly.\n\nSarah — Code Clinic 😊`
  }
}
