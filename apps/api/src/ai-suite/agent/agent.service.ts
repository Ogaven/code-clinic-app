import Anthropic from '@anthropic-ai/sdk'
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
import { prisma } from '../../lib/prisma'

const SARAH_SYSTEM_PROMPT = `You are Sarah, a warm and friendly member of the front desk team at Code Clinic dental clinic in Kampala, Uganda.

CORE RULES — never break these:
- You are a real human team member, NOT a robot or AI. If asked whether you're a bot or AI, deny it naturally: "Ha, I wish — that would make my job so much easier 😂 No, I'm just one of the girls at the front desk!" or "Nope, totally human! Just a regular person at my desk in Kamwokya 😊"
- Never use the words "assistant", "virtual", "automated", "AI", "bot", "system", "language model"
- Never list your capabilities unprompted — that's robot behaviour
- Speak like a warm, real Ugandan receptionist: casual, human, caring
- Use light Ugandan English naturally — "How can I help you?" not "How may I assist you?"
- Short responses — one or two sentences is usually enough. Don't write essays
- Emojis are fine but keep them natural — don't overdo it
- If someone is new, just warmly greet them and ask how you can help — don't list what you do

PERSONALITY:
- Warm, cheerful, professional but relaxed
- Genuinely cares about patients — if someone is in pain, lead with empathy first, then logistics
- Uses contractions and natural flow: "I'll", "we're", "you're", "don't"
- Light humour when it fits the mood
- Never stiff, never formal, never robotic

ESCALATION TO JULIAN:
- If you cannot fully resolve something — complex complaints, sensitive medical questions beyond scheduling, or a patient who explicitly wants to speak with someone — say: "Let me pass you to my colleague Julian who can help you further 😊" and end your response there.
- Julian handles escalations. After hours, tell the patient Julian or the team will follow up when the clinic opens.
- You do NOT need to explain why you're passing to Julian — just do it warmly and briefly.

AFTER-HOURS BEHAVIOUR:
- When the clinic is closed, let the patient know warmly: "We're closed right now but I've noted your message and I'll personally make sure someone follows up with you when we open at 8am 😊"
- Still take booking enquiries — reassure the patient you'll sort them out first thing in the morning
- For urgent dental pain after hours: acknowledge the pain warmly, tell them you've noted it and will follow up personally when the clinic opens at 8am. Do NOT mention or refer to any other hospital or clinic under any circumstances.
- Never direct patients to other hospitals, clinics, or emergency facilities

RESPONSE LENGTH RULES:
- If patient says only "Hi", "Hello", "Hey" — reply in ONE sentence only, match their energy
- If patient says "Good morning/evening/afternoon" — match their greeting, then one follow-up sentence max
- Match the length of the patient's message — short message gets a short reply
- Never more than 3 sentences unless patient asked a detailed question
- Never use bullet points, bold text (**text**), asterisks, dashes, or any markdown — you are texting, not writing a document
- Never send a formatted list — always speak conversationally

SERVICES RULE:
- When asked what services you offer, do NOT list all services with prices
- Say something like: "We do quite a range — consultations, cleaning, fillings, extractions, braces, implants, whitening and more 😊 Anything specific you are looking for?"
- Only share prices if the patient explicitly asks for prices
- Always speak conversationally, never in a formatted list

DIRECTIONS:
- If asked for directions or how to get to the clinic, say: "We're on Kiira Road, opposite the Police Playground in Kamwokya. Here's our Google Maps link: https://maps.google.com/?q=Code+Clinic+Kamwokya+Kampala 📍"
- You can add: "If you're coming from the city center, take Kira Road towards Kamwokya and look for us on the right side opposite the Police Playground."

WEATHER:
- Only mention weather if it is truly notable right now (currently raining, very hot above 32°C, foggy). Do not mention weather if conditions are normal.

WHAT YOU HELP WITH (only mention when directly relevant — never list all at once):
- Booking, rescheduling, cancelling appointments
- Answering questions about services and pricing
- General questions about the clinic

CLINIC INFO:
- Name: Code Clinic
- Location: Kiira Road, opposite Police Playground, Kamwokya, Kampala
- Phone: +256 394 836 298
- WhatsApp: +256 741 087667
- Email: dentist@codeclinic.ug
- Website: codeclinic.ug
- Hours: Monday–Friday 8am–6pm, Saturday 9am–3pm, Closed Sunday

QUICK REPLY GUIDANCE (visitors may send these exact phrases — respond naturally):
- "📅 Book an appointment" → Warmly ask what service they need and a preferred time or date
- "💰 View our services & prices" → Do NOT list everything. Say something like "We do consultations, cleaning, fillings, extractions, braces, whitening and more 😊 Anything specific you are looking for?"
- "📍 Find us / Opening hours" → Give the clinic address, hours, and Google Maps link
- "📞 Talk to someone" → "Of course! Call or WhatsApp us on +256 394 836 298 or +256 741 087667 😊"

OPENING MESSAGE for first contact:
"Hi! 😊 Thanks for reaching out to Code Clinic, this is Sarah — how may I brighten your smile today?"

BUTTON REPLY AWARENESS:
When a patient sends "✅ Confirm", "❌ Cancel", "📅 Reschedule", "😊 Feeling great", or "😐 Could be better" — these are WhatsApp button taps, not typed messages. Treat them as clear, direct intent and respond accordingly without asking for clarification.

POST-APPOINTMENT FOLLOW-UP TONE:
When you are in a post-appointment conversation (the system context will say [POST-APPOINTMENT CONTEXT]):
- Read the doctor notes carefully before responding
- Be warm, personal, and caring — like a friend checking in
- Answer recovery questions using the context from the notes
- Suggest booking a follow-up if the patient reports ongoing issues
- At the right moment in the conversation (after the patient seems okay), ask: "On a scale of 1 to 5, how would you rate your visit with us? 😊 Just reply with a number."
- NEVER rush the rating ask — only when the conversation feels natural to end
- NEVER ask for a rating unprompted — only in post-appointment follow-up conversations

RATING AND FEEDBACK RULES:
- If a patient replies with a number 1 to 5, acknowledge it warmly:
  * Score 4 or 5: "That means so much to us! 🙏 If you have a moment, we'd love it if you shared that on Google — it really helps other patients find us 😊 Here is the link: https://g.page/r/CaA8lzxCme9FEBM/review"
  * Score 1, 2 or 3: "I'm so sorry to hear that 😔 We really want to make this right. Can you tell me what didn't go well? I'll make sure Dr. Steven follows up with you personally." — then end your reply there, do not send the review link
- NEVER send the Google review link to a patient who gave a score of 1, 2 or 3
- NEVER send the Google review link unless the patient has just given a 4 or 5 rating

GOOGLE REVIEW:
- Google review link: https://g.page/r/CaA8lzxCme9FEBM/review
- Only share this link when a patient gives a 4 or 5 star rating during a follow-up
- When sharing, say something like: "If you have a moment, we'd love it if you shared that on Google — it helps other people in Kampala find us! 😊 Here is the link: https://g.page/r/CaA8lzxCme9FEBM/review"`

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContextPackage {
  patientName: string
  conversationHistory: string
  appointments: string
  knowledgeBase: string
  services: string
  doctors: string
}

// ── Services / doctors cache (5-minute TTL — rarely change) ──────────────────

interface CachedMenu { services: string; doctors: string; expiresAt: number }
let menuCache: CachedMenu | null = null

async function getCachedMenu(): Promise<{ services: string; doctors: string }> {
  if (menuCache && Date.now() < menuCache.expiresAt) {
    return { services: menuCache.services, doctors: menuCache.doctors }
  }

  const [allServices, allDoctors] = await Promise.all([
    prisma.service.findMany({
      where: { isActive: true },
      select: { name: true, priceUGX: true, durationMins: true },
      orderBy: { name: 'asc' },
    }),
    prisma.doctor.findMany({
      include: { user: { select: { firstName: true, lastName: true } } },
      where: { user: { isActive: true } },
    }),
  ])

  const services = allServices
    .map(s => `- ${s.name}: UGX ${s.priceUGX.toLocaleString()} (${s.durationMins} mins)`)
    .join('\n')

  const doctors = allDoctors
    .map(d => `- Dr ${d.user.firstName} ${d.user.lastName}${d.specialisation ? ` — ${d.specialisation}` : ''}`)
    .join('\n')

  menuCache = { services, doctors, expiresAt: Date.now() + 5 * 60 * 1000 }
  return { services, doctors }
}

// ── Kampala weather cache (30-minute TTL) ─────────────────────────────────────

interface WeatherCache { temp: number; desc: string; expiresAt: number }
let weatherCache: WeatherCache | null = null

async function getKampalaWeather(): Promise<string> {
  if (weatherCache && Date.now() < weatherCache.expiresAt) {
    return `${weatherCache.temp}°C, ${weatherCache.desc}`
  }
  try {
    const res  = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=0.3163&longitude=32.5822&current_weather=true&hourly=precipitation&timezone=Africa%2FNairobi&forecast_days=1'
    )
    const data = await res.json() as any
    const cw   = data.current_weather
    const temp = Math.round(cw.temperature as number)
    const code = cw.weathercode as number

    // Check actual precipitation for current hour
    let precipNow = 0
    const hourly = data.hourly
    if (hourly?.time && hourly?.precipitation) {
      const currentHourStr = new Date().toLocaleString('sv-SE', {
        timeZone: 'Africa/Nairobi', hour: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit',
      }).slice(0, 13).replace(' ', 'T')
      const idx = (hourly.time as string[]).findIndex(t => t.startsWith(currentHourStr))
      if (idx >= 0) precipNow = (hourly.precipitation as number[])[idx] ?? 0
    }

    let desc: string
    if (code === 95 || code >= 96)                             desc = 'thunderstorm ⛈️'
    else if ([80, 81, 82].includes(code) || precipNow > 1)    desc = 'rain showers 🌧️'
    else if ([61, 63, 65].includes(code) || precipNow > 0.5)  desc = 'raining 🌧️'
    else if ([51, 53, 55].includes(code))                     desc = 'light drizzle'
    else if ([45, 48].includes(code))                         desc = 'foggy'
    else if (code === 3)                                       desc = 'cloudy'
    else if (code === 2)                                       desc = 'mostly cloudy'
    else if (code === 1)                                       desc = 'mostly clear'
    else                                                       desc = 'clear skies ☀️'

    weatherCache = { temp, desc, expiresAt: Date.now() + 30 * 60 * 1000 }
    return `${temp}°C, ${desc}`
  } catch {
    return '26°C, clear skies ☀️'
  }
}

function isClinicOpenNow(): boolean {
  const now    = new Date()
  const eat    = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }))
  const day    = eat.getDay()   // 0=Sun, 6=Sat
  const mins   = eat.getHours() * 60 + eat.getMinutes()
  const mmdd   = `${String(eat.getMonth() + 1).padStart(2, '0')}-${String(eat.getDate()).padStart(2, '0')}`
  const ugandaHolidays = [
    '01-01', '01-26', '02-16', '03-08',
    '04-03', '04-06', // Good Friday & Easter Monday 2026
    '05-01', '06-03', '06-09', '10-09', '12-25', '12-26',
  ]
  if (ugandaHolidays.includes(mmdd)) return false
  if (day === 0) return false
  if (day === 6) return mins >= 9 * 60 && mins < 15 * 60
  return mins >= 8 * 60 && mins < 18 * 60
}

// ── buildContext ──────────────────────────────────────────────────────────────

async function buildContext(
  conversationId: string,
  from: string,
  message: string
): Promise<ContextPackage> {
  // Extract keyword for KB search before firing parallel queries
  const keyword = message.split(/\s+/).find(w => w.length >= 4)

  // Run all independent queries in parallel
  const [patient, dbMessages, menu, kbResults] = await Promise.all([
    prisma.patient.findFirst({
      where: { phone: from },
      select: { id: true, firstName: true, lastName: true, phone: true, email: true, createdAt: true },
    }),
    prisma.aiMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }).then(msgs => msgs.reverse()),
    getCachedMenu(),
    keyword
      ? prisma.aiKnowledgeBase.findMany({
          where: { content: { contains: keyword, mode: 'insensitive' } },
          take: 3,
          select: { content: true },
        })
      : Promise.resolve([]),
  ])

  const patientName = patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown patient'

  const conversationHistory = dbMessages
    .map(m => (m.role === 'USER' ? `Patient: ${m.content}` : `Sarah: ${m.content}`))
    .join('\n')

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

  const knowledgeBase = kbResults.map((k: { content: string }) => k.content).join('\n\n')

  return { patientName, conversationHistory, appointments, knowledgeBase, ...menu }
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
    weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi',
  })
  const time = slot.startAt.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
  }).toLowerCase()
  return `${index + 1}. ${day} at ${time} — ${slot.doctorName}`
}

function formatSlotsMessage(slots: AvailableSlot[], serviceName: string): string {
  if (slots.length === 0) {
    return `I'm sorry, I couldn't find any available slots for *${serviceName}* in the next 7 days. Would you like me to look further ahead, or shall I have someone from the clinic call you to arrange a time? 😊`
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
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Nairobi',
  })
  const time = appt.startAt.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
  }).toLowerCase()
  const doctor = `Dr ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`
  return `Perfect! You're all booked 🎉 *${day}* at *${time}* with *${doctor}* for *${appt.service.name}*. We'll send you a reminder the day before. See you then!`
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
      hour: 'numeric', hour12: false, timeZone: 'Africa/Nairobi',
    })
  )
}

function slotKampalaWeekday(slot: AvailableSlot): number {
  const short = slot.startAt.toLocaleDateString('en-US', {
    weekday: 'short', timeZone: 'Africa/Nairobi',
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
    return `Of course! What dental service are you looking for? For example — cleaning, filling, whitening, extraction, or something else? 😊`
  }

  // RESCHEDULE or CANCEL — need to find their upcoming appointment
  const patient = await prisma.patient.findFirst({ where: { phone: from } })
  if (!patient) {
    return `I don't have any upcoming appointments on record for this number. Would you like to book a new one instead? 😊`
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
    return `I don't see any upcoming appointments for you right now. Would you like to book one? 😊`
  }

  const apptDay = upcoming.startAt.toLocaleDateString('en-UG', {
    weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi',
  })
  const apptTime = upcoming.startAt.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
  }).toLowerCase()
  const apptDoctor = `Dr ${upcoming.doctor.user.firstName} ${upcoming.doctor.user.lastName}`

  if (intent === 'CANCEL') {
    setBookingState(from, { state: 'AWAITING_CANCEL_CONFIRMATION', appointmentId: upcoming.id })
    return `I can see you have an appointment on *${apptDay}* at *${apptTime}* with *${apptDoctor}* for *${upcoming.service.name}*. Are you sure you want to cancel it? Just reply *yes* to confirm or *no* to keep it. 😊`
  }

  // RESCHEDULE
  setBookingState(from, {
    state:         'AWAITING_RESCHEDULE_SLOT',
    appointmentId: upcoming.id,
    serviceId:     upcoming.service.id,
  })
  return `Sure! Your appointment is on *${apptDay}* at *${apptTime}* with *${apptDoctor}* for *${upcoming.service.name}*. What day or time would work better for you? 😊`
}

async function handleAwaitingService(from: string, message: string): Promise<string> {
  const service = await matchService(message)

  if (!service) {
    const services = await getServices()
    const list = services.map(s => `• ${s.name}`).join('\n')
    return `Sorry, I didn't quite catch that 😊 Here are the services we offer:\n\n${list}\n\nWhich one are you interested in?`
  }

  setBookingState(from, { state: 'AWAITING_DOCTOR_PREFERENCE', serviceId: service.id })
  return `Got it! *${service.name}* — great choice 😊 Do you have a preferred doctor, or shall I find whoever is available soonest?`
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
    return `Of course! Here are our doctors:\n\n${nameList}\n\nWhich doctor would you like? 😊`
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
      const patient = await prisma.patient.findFirst({ where: { phone: from } })
      const appt    = await createAppointment(
        patient?.id ?? null,
        slot.doctorId,
        slot.serviceId,
        slot.startAt,
        from
      )
      clearBookingState(from)

      // Send booking confirmation template (best-effort — never block the reply)
      const templateName = process.env.WA_TEMPLATE_BOOKING_CONFIRM_NAME
      if (templateName && process.env.AT_API_KEY && process.env.AT_USERNAME) {
        const waNumber = process.env.AT_WHATSAPP_NUMBER || process.env.WHATSAPP_PHONE_NUMBER
        if (waNumber) {
          const patientName = patient ? patient.firstName : 'there'
          const apptDate = appt.startAt.toLocaleDateString('en-UG', {
            weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Nairobi',
          })
          const apptTime = appt.startAt.toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
          })
          const apptService = appt.service.name
          const apptDoctor  = `Dr ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const AfricasTalking = require('africastalking')
            const at = AfricasTalking({ apiKey: process.env.AT_API_KEY, username: process.env.AT_USERNAME })
            await at.WHATSAPP.sendMessage({
              waNumber,
              phoneNumber: from,
              body: {
                type: 'template',
                template: {
                  name: templateName,
                  language: { code: 'en' },
                  components: [{
                    type: 'body',
                    parameters: [
                      { type: 'text', text: patientName },
                      { type: 'text', text: apptDate },
                      { type: 'text', text: apptTime },
                      { type: 'text', text: apptService },
                      { type: 'text', text: apptDoctor },
                    ],
                  }],
                },
              },
            })
            console.log(`[Booking] Confirmation template sent to ${from}`)
          } catch (tErr: any) {
            console.warn('[Booking] Template send failed (non-critical):', tErr.message)
          }
        }
      }

      return formatConfirmation(appt)
    }
  } catch (err: any) {
    console.error('[Booking] createAppointment failed for', from, '—', err.message || err)
    clearBookingState(from)
    if (err.message?.includes('no longer available') || err.message?.includes('slot')) {
      return `Oh no — that slot was just taken while we were chatting 😅 Let me find you a fresh list! Just send "book appointment" to start again, or I'll get someone to call you.`
    }
    return `Something went a little wrong on my end, so sorry! 😅 Could you try again in a moment? Or I can have someone from our team call you to sort this out!`
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
    return `Done, your appointment has been cancelled. Sorry to see you go — whenever you're ready to book again, I'm here! 😊`
  }

  if (isNo) {
    clearBookingState(from)
    return `No problem at all! Your appointment is still on the books. See you then 😊`
  }

  return `Just to confirm — do you want to *cancel* your appointment? Reply *yes* to cancel or *no* to keep it 😊`
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
    return `Hi! I've received your message and a team member will be with you shortly. For urgent matters please call us directly.`
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
  const [context, weather] = await Promise.all([
    buildContext(conversationId, from, latestMessage),
    getKampalaWeather(),
  ])

  const eatTime = new Date().toLocaleString('en-UG', {
    timeZone: 'Africa/Nairobi',
    weekday: 'long', day: 'numeric', month: 'long',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
  const clinicStatus = isClinicOpenNow() ? 'open' : 'closed'

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

  // Fetch custom system prompt from DB if configured, fall back to hardcoded
  let activeSystemPrompt = SARAH_SYSTEM_PROMPT
  try {
    const agentConfig = await prisma.aiAgentConfig.findFirst({ select: { systemPrompt: true } })
    if (agentConfig?.systemPrompt) activeSystemPrompt = agentConfig.systemPrompt
  } catch { /* non-critical — use hardcoded fallback */ }

  try {
    const client = new Anthropic({ apiKey })

    // Split system prompt into cacheable (static) and dynamic parts.
    // The static part (persona + clinic info + services/doctors) rarely changes —
    // Anthropic will cache it after the first call, reducing cost by ~70%.
    const staticSystem = [
      activeSystemPrompt,
      '',
      'CLINIC CONTACT:',
      'Phone: +256 394 836 298',
      'WhatsApp: +256 741 087667',
      'Email: dentist@codeclinic.ug',
      'Website: codeclinic.ug',
      'Address: Old Kira Road, opposite Police Playground, Kamwokya, Kampala',
      'Hours: Monday–Friday 8am–6pm, Saturday 9am–2pm',
      '',
      'OUR SERVICES:',
      context.services,
      '',
      'OUR DOCTORS:',
      context.doctors,
    ].join('\n')

    const dynamicSystem = [
      '',
      `CURRENT TIME: ${eatTime} (East Africa Time)`,
      `CLINIC STATUS: ${clinicStatus}`,
      `KAMPALA WEATHER: ${weather}`,
      '',
      'PATIENT CONTEXT:',
      `Name: ${context.patientName}`,
      `Phone: ${from}`,
      'Recent appointments:',
      context.appointments,
      ...(context.knowledgeBase ? ['', 'CLINIC KNOWLEDGE BASE:', context.knowledgeBase] : []),
    ].join('\n')

    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 200,
      system: [
        { type: 'text', text: staticSystem },
        { type: 'text', text: dynamicSystem },
      ],
      messages,
    })

    const block = response.content[0]
    if (block && block.type === 'text') return block.text

    return `I'm here to help! Could you please rephrase that for me?`
  } catch (err) {
    console.error('[Agent] Claude API error:', err)
    return `Sorry, I'm having a small issue right now. Please try again or call the clinic directly.`
  }
}
