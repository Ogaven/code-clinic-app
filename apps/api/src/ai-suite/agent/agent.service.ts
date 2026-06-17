import Anthropic from '@anthropic-ai/sdk'
import {
  getAvailableSlots,
  getServices,
  getDoctors,
  createAppointment,
  rescheduleAppointment,
  cancelAppointment,
  getNextAppointment,
  confirmAppointment,
  findSoonestAvailableSlot,
  type AvailableSlot,
} from '../booking/booking.service'
import {
  getBookingState,
  setBookingState,
  clearBookingState,
  type BookingStateEntry,
} from '../booking/booking.state'
import { prisma } from '../../lib/prisma'
import { getGreetingName } from '../../utils/nameHelper'
import { sendWhatsAppMessage } from '../whatsapp/whatsapp.service'

function sanitizeForClaude(content: string): string {
  if (content.startsWith('__MEDIA_IMAGE__:')) {
    const visionIdx = content.indexOf('__VISION__')
    if (visionIdx !== -1) return `[Patient sent an image. Description: ${content.slice(visionIdx + 10)}]`
    return '[Patient sent an image]'
  }
  return content
}

function sanitizeForWhatsApp(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/^\s*[-*+]\s/gm, '• ')
    .replace(/\s—\s/g, ' - ')
    .replace(/—/g, '-')
    .trim()
}

const SARAH_SYSTEM_PROMPT = `You are Sarah, a warm and friendly member of the front desk team at Code Clinic dental clinic in Kampala, Uganda.

CRITICAL GREETING RULES:
- Always greet with Hello not Hi
- Always use the patient first name only, never surname
- Never use em-dashes in any message
- Never use asterisks or bold formatting
- Never sign off as Sarah Code Clinic, just be Sarah
- For doctors always use first name only: Dr Lois not Dr Lois Kisakye
- Be warm human and conversational not formal or robotic
- If this is the first time contacting a patient introduce yourself as Sarah from Code Clinic
- Never show internal context tags like POST-APPOINTMENT CONTEXT to patients
- Never mention SimplyBook or booking reference numbers to patients

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
- IMPORTANT: Never use markdown formatting. No asterisks, no bold, no italics, no em-dashes. Write in plain text only. Service names should be written naturally, not wrapped in asterisks.
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
- Hours: see CLINIC HOURS — FULL WEEK injected below — never guess or use generic hours

QUICK REPLY GUIDANCE (visitors may send these exact phrases — respond naturally):
- "📅 Book an appointment" → Warmly ask what service they need and a preferred time or date
- "💰 View our services & prices" → Do NOT list everything. Say something like "We do consultations, cleaning, fillings, extractions, braces, whitening and more 😊 Anything specific you are looking for?"
- "📍 Find us / Opening hours" → Give the clinic address, hours, and Google Maps link
- "📞 Talk to someone" → "Of course! Call or WhatsApp us on +256 394 836 298 or +256 741 087667 😊"

OPENING MESSAGE for first contact:
"Hello 😊 Thanks for reaching out to Code Clinic, this is Sarah. How may I brighten your smile today?"

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
- When sharing, say something like: "If you have a moment, we'd love it if you shared that on Google — it helps other people in Kampala find us! 😊 Here is the link: https://g.page/r/CaA8lzxCme9FEBM/review"

APPROXIMATE SERVICE PRICES (share only if patient explicitly asks about prices):
- Dental cleaning / scaling: UGX 80,000 - 150,000
- Teeth whitening: UGX 350,000 - 500,000
- Composite filling: UGX 150,000 per tooth
- GI (glass ionomer) filling: UGX 80,000 per tooth
- Exact prices depend on complexity and are confirmed at booking

CONVERSATION MEMORY — critical:
- You have the complete conversation history shown to you. Read it carefully before every response.
- NEVER re-introduce yourself or repeat the opening greeting to someone you have already spoken with in this conversation. If you already said "Hello, this is Sarah from Code Clinic", do NOT say it again.
- NEVER ask for information the patient already gave you earlier in the conversation.
- If the conversation history shows a previous exchange, assume you know each other — respond naturally without re-greeting.

CLINICAL CONCERN RESPONSES:
- When a patient expresses pain, worry, an unusual sensation, or a problem with a previous treatment — lead with genuine empathy first: "I'm so sorry to hear that 😔"
- Do NOT immediately push them into a booking flow — address their concern first
- Always offer the clinic number so they can speak to a dentist directly: +256 394 836 298
- If they want to book, offer an URGENT slot — do not walk them through a standard booking flow
- Examples: "my filling tastes sweet", "my tooth hurts", "something feels wrong", "I'm worried about my extraction" — these all need empathy first, not a booking form

SHORT SERVICE LIST — only show if patient explicitly asks "what services do you offer" or insists on a list:
1. Dental Cleaning / Stain Removal
2. Teeth Whitening
3. Dental Filling
4. Tooth Extraction
5. Root Canal
6. Dental Checkup / Consultation
7. Braces / Aligners
8. Dental Implant
Then add: "Or just tell me what you need in your own words 😊"
NEVER show all 50 services — only these 8 if they really want a list.

SILENT OPERATIONS RULE:
Never tell the patient you are checking, looking up, or fetching anything. All database checks happen in the background.
Do NOT say:
- "Let me check that for you"
- "I'll look that up"
- "One moment while I check"
- "Let me see what's available"
Just respond with the answer directly.

WRONG: "Let me check if Dr Steven has a 2pm slot!"
RIGHT: "Dr Steven has slots at 10am and 1pm on Saturday. Which works better for you? 😊"

EMERGENCY AND CLINICAL CONCERN HANDLING:
When a patient reports pain, an emergency, or any clinical concern — always respond with empathy first, then check CLINIC STATUS RIGHT NOW before making any callback promise:
- If CLINIC STATUS RIGHT NOW is "open": tell them someone will call within the hour and give the emergency number +256 394 836 298.
- If CLINIC STATUS RIGHT NOW is "closed": tell them the clinic is closed, state when it next opens, and give the emergency number +256 394 836 298.
NEVER say "someone will call you today" or "someone will call you shortly" if CLINIC STATUS RIGHT NOW says "closed".

ABSOLUTE RULE — NEVER FAKE A BOOKING CONFIRMATION:

"Slot selection" means BOTH of these happened in this conversation:
(a) You presented a NUMBERED LIST of real time slots in the format "1. [Day] [Date] at [time] - Dr [Name]"
(b) The patient replied with a number from that list

Collecting the patient's name, preferred day, preferred time, or phone number is NOT slot selection — it is just gathering information. Gathering information does NOT make a real booking.

Phrases like "booked", "all done", "confirmed", "you're all set", "I'll get that sorted", "we'll send a reminder", "reminder closer to the day", "I'll get that booked", "confirmed your appointment" may ONLY appear in a message generated immediately after BOTH (a) and (b) above happened AND the system completed the booking in the database.

If you have gathered booking information (service, doctor, patient name, day/time preference) but the numbered slot list has NOT been shown and the patient has NOT replied with a number, you must say something like: "Let me find available slots for [Name] with Dr [X] on [day]" — and then the system will show real slots for the patient to choose from. Never skip this step or pretend it happened.

This applies to bookings for another person (mother, wife, child, friend, etc.) exactly the same way. Never make up an appointment for anyone.`

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
      where: { isActive: true, user: { isActive: true } },
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

  const patientName = patient ? getGreetingName(patient) : 'Unknown patient'

  const conversationHistory = dbMessages
    .filter(m => m.role !== 'SYSTEM')
    .map(m => (m.role === 'USER' ? `Patient: ${sanitizeForClaude(m.content)}` : `Sarah: ${m.content}`))
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

type Intent = 'BOOK' | 'RESCHEDULE' | 'CANCEL' | 'CHECK' | 'CONFIRM' | null

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

  const confirmWords = [
    'confirm my appointment', 'i confirm', 'yes i confirm', 'confirming my',
    '✅ confirm',
  ]
  if (confirmWords.some(w => lower.includes(w))) return 'CONFIRM'

  const checkWords = [
    'my appointment', 'next appointment', 'when is my', 'do i have an appointment',
    'appointment details', 'check my appointment', 'what time is my',
  ]
  if (checkWords.some(w => lower.includes(w))) return 'CHECK'

  const bookWords = [
    'book', 'appointment', 'schedule', 'come in', 'visit',
    'see doctor', 'see a doctor', 'checkup', 'check up',
    'cleaning', 'filling', 'extraction', 'whitening',
    // availability / slot-check phrases that signal booking intent
    'available slot', 'slots available', 'available today', 'available this',
    'check availability', 'check his slot', 'check her slot', 'check the slot',
    'check slot', 'which doctor is', 'who is available', 'see his slot', 'see her slot',
    // "booking for someone else" patterns
    'for my mother', 'for my father', 'for my mum', 'for my dad', 'for my mom',
    'for my wife', 'for my husband', 'for my son', 'for my daughter',
    'for my sister', 'for my brother', 'for my child', 'for my friend',
    'bring my mother', 'bring my wife', 'bring my husband', 'bring my son',
    'bring my daughter', 'bring my mum', 'bring her in', 'bring him in',
  ]
  // Guard against meta-uses of "book" that aren't real booking requests
  const META_BOOK = /\b(before you book|if i book|should i book|do i need to book|need to book first|before booking|before i book)\b/i
  const strongBookWords = bookWords.filter(w => w !== 'book')
  if (META_BOOK.test(lower) && !strongBookWords.some(w => lower.includes(w))) return null
  if (bookWords.some(w => lower.includes(w))) return 'BOOK'

  return null
}

// ── Clinical concern detection ────────────────────────────────────────────────
// Returns true when a patient message is about a symptom, side-effect or worry
// rather than a booking request. Must run BEFORE the booking state machine.

const CLINICAL_CONCERN_PATTERNS = [
  'pain', 'hurts', 'hurting', 'painful',
  'bleeding', 'bleed',
  'swelling', 'swollen', 'swell',
  'tasting', 'tastes', 'taste weird', 'sweet taste', 'bitter taste', 'tasting sweet', 'tasting bitter',
  'feels wrong', 'feeling wrong', 'something wrong', 'went wrong', 'something feels',
  'worried', 'scared', 'anxious',
  'help me', 'i need help',
  'infection', 'infected', 'abscess',
  'sensitive to', 'sensitivity',
  'had a filling', 'got a filling', 'had a root canal', 'had an extraction', 'had a cleaning', 'had treatment',
  'broken tooth', 'chipped tooth', 'cracked tooth', 'fell out', 'knocked out',
  'side effect', 'reaction to',
  'emergency', 'urgent help',
  'not healing', 'still hurting', 'still in pain', 'it hurts',
  'sore', 'sore mouth', 'mouth sore', 'sore gums', 'sore tooth',
]

function isClinicalConcern(message: string): boolean {
  const lower = message.toLowerCase()
  // If the patient explicitly mentions booking/appointment, it's a booking request
  if (/\b(book|schedule|appointment|coming in|can i come)\b/.test(lower)) return false
  return CLINICAL_CONCERN_PATTERNS.some(kw => lower.includes(kw))
}

async function getNextOpeningInfo(): Promise<{ dayName: string; time: string }> {
  const now      = new Date()
  const eatDate  = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }))
  const todayDow = eatDate.getDay()
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  for (let offset = 1; offset <= 7; offset++) {
    const checkDow = (todayDow + offset) % 7
    const hours    = await prisma.workingHours.findUnique({ where: { dayOfWeek: checkDow } }).catch(() => null)
    if (hours && hours.isOpen) {
      const dayLabel = offset === 1 ? 'tomorrow' : dayNames[checkDow]
      const [h, m]   = hours.openTime.split(':').map(Number)
      const period   = h >= 12 ? 'pm' : 'am'
      const h12      = h > 12 ? h - 12 : h === 0 ? 12 : h
      const timeStr  = `${h12}${m === 0 ? '' : ':' + String(m).padStart(2, '0')}${period}`
      return { dayName: dayLabel, time: timeStr }
    }
  }
  return { dayName: 'Monday', time: '8am' }
}

async function buildClinicalConcernResponse(from?: string, followupCtx?: { serviceName: string; doctorName: string }): Promise<string> {
  const clinicOpen = isClinicOpenNow()

  if (clinicOpen) {
    if (followupCtx) {
      return `I'm so sorry to hear that 😔 Since this is related to your ${followupCtx.serviceName} yesterday with Dr ${followupCtx.doctorName}, let me get our team to look into this for you right away. Someone will call you within the hour — or if this is urgent right now, please call us on +256 394 836 298.`
    }
    // Try today first, then next available within a week
    const todaySlot = await findSoonestAvailableSlot(1)
    const slot      = todaySlot ?? await findSoonestAvailableSlot(7)
    if (slot && from) {
      const isToday     = !!todaySlot
      const time        = new Date(slot.startAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' }).toLowerCase()
      const drFirstName = slot.doctorName.replace(/^Dr\s+/, '').split(' ')[0]
      const dayLabel    = isToday ? 'TODAY' : new Date(slot.startAt).toLocaleDateString('en-UG', { weekday: 'long', timeZone: 'Africa/Nairobi' })
      setBookingState(from, {
        state:          'AWAITING_SLOT_CONFIRMATION',
        serviceId:      slot.serviceId,
        availableSlots: [slot],
      })
      return `Ehh, I'm so sorry about that 😔 Let me see what I can do... Good news, I can get you in ${dayLabel} at ${time} with Dr ${drFirstName} for a consultation - would that work, or would you prefer I look for something else?`
    }
    return `Ehh, I'm so sorry about that 😔 I've flagged this as urgent for our team — someone will reach out to you very soon. If this is a dental emergency right now, please call us directly on +256 394 836 298.`
  }

  const next = await getNextOpeningInfo()
  if (followupCtx) {
    return `I'm so sorry to hear that 😔 Since this is related to your ${followupCtx.serviceName} yesterday with Dr ${followupCtx.doctorName}, let me get our team to look into this for you right away. We're currently closed, but as soon as we open ${next.dayName} at ${next.time}, someone will call you first thing. For emergencies, call us on +256 394 836 298.`
  }
  return `Ehh, I'm so sorry about that 😔 We're closed right now, but I'll make sure our team sees this first thing when we open ${next.dayName} at ${next.time} and gets you in as a priority. In the meantime, is there anything I can help with - like general advice?`
}

// ── Tangent question helpers ──────────────────────────────────────────────────

function looksLikeTangent(message: string): boolean {
  if (message.includes('?')) return true
  const lower = message.toLowerCase().trim()
  if (/^(what|why|how|does|can|do|is|are|will|where)\b/.test(lower)) return true
  if (/^(hello|hi|hey)\b/.test(lower) && lower.split(/\s+/).length <= 3) return true
  return false
}

async function respondToTangentThenRedirect(
  message: string,
  pendingPromptText: string
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return pendingPromptText
  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 80,
      system:     `You are Sarah, a warm dental assistant at Code Clinic. Give a brief (1-2 sentence), friendly, informative answer using general dental knowledge. Do NOT state clinic-specific prices, doctor names, or availability unless certain. No em dashes. No markdown.`,
      messages:   [{ role: 'user', content: `The patient asked: "${message}". Answer briefly and warmly.` }],
    })
    const block = response.content[0]
    const answer = block?.type === 'text' ? sanitizeForWhatsApp(block.text) : ''
    return answer ? `${answer}\n\n${pendingPromptText}` : pendingPromptText
  } catch {
    return pendingPromptText
  }
}

async function respondToClinicalFollowUp(message: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return `Our team's on it and will be in touch soon 🙏`
  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 120,
      system:     `You are Sarah, a warm dental assistant at Code Clinic. The patient previously reported a clinical concern and our team has already been notified. Answer their follow-up question with 1-2 friendly sentences using general dental knowledge. If it fits naturally at the end, add: "Our team's on it and will be in touch soon 🙏" - only if it flows well. Do NOT say you've alerted the team again. No em dashes. No markdown.`,
      messages:   [{ role: 'user', content: message }],
    })
    const block = response.content[0]
    if (block?.type === 'text') return sanitizeForWhatsApp(block.text)
  } catch { /* fall through */ }
  return `Our team's on it and will be in touch soon 🙏`
}

// ── Slot formatting helpers ───────────────────────────────────────────────────

function formatSlotLine(slot: AvailableSlot, index: number): string {
  const day = slot.startAt.toLocaleDateString('en-UG', {
    weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi',
  })
  const time = slot.startAt.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
  }).toLowerCase()
  return `${index + 1}. ${day} at ${time} - ${slot.doctorName}`
}

function formatSlotsMessage(slots: AvailableSlot[], serviceName: string, specificDoctorName?: string): string {
  if (slots.length === 0) {
    if (specificDoctorName) {
      return `${specificDoctorName} doesn't seem to have any free slots for ${serviceName} in the next 7 days. Would you like me to check other doctors instead? 😊`
    }
    return `I'm sorry, I couldn't find any available slots for ${serviceName} in the next 7 days. Would you like me to look further ahead, or shall I have someone from the clinic call you to arrange a time? 😊`
  }
  const lines = slots.slice(0, 5).map((s, i) => {
    const day = s.startAt.toLocaleDateString('en-UG', {
      weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi',
    })
    const time = s.startAt.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
    }).toLowerCase()
    if (specificDoctorName) {
      return `${i + 1}. ${day} at ${time}`
    }
    const docFirst = s.doctorName.replace(/^Dr\s+/, '').split(' ')[0]
    return `${i + 1}. ${day} at ${time} - Dr ${docFirst}`
  }).join('\n')
  if (specificDoctorName) {
    return `${specificDoctorName} has these slots available 😊\n\n${lines}\n\nJust reply with the number that works for you!`
  }
  return `Here are the earliest available slots 😊\n\n${lines}\n\nJust reply with the number that works for you!`
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
  const doctor = `Dr ${appt.doctor.user.firstName}`
  return `Perfect! You're booked ✅\n📅 ${day} at ${time}\n🦷 ${appt.service.name}\n👨‍⚕️ ${doctor}\n📍 Code Clinic, Kamwokya\nSee you then! 😊`
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
  const wordSet = new Set(lower.split(/\W+/))
  for (const [word, num] of Object.entries(ordinals)) {
    if (wordSet.has(word)) return num
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

// ── Service aliases — natural language → exact DB service name ────────────────

const SERVICE_ALIASES: Record<string, string> = {
  'checkup':       'Review Check up',
  'check up':      'Review Check up',
  'check-up':      'Review Check up',
  'cleaning':      'Stain Removal',
  'scale':         'Stain Removal',
  'scaling':       'Stain Removal',
  'polish':        'Stain Removal',
  'stain':         'Stain Removal',
  'whitening':     'Teeth Whitening (Inoffice)',
  'whiten':        'Teeth Whitening (Inoffice)',
  'brighten':      'Teeth Whitening (Inoffice)',
  'filling':       'Composite Filling',
  'composite':     'Composite Filling',
  'cavity':        'Composite Filling',
  'cavities':      'Composite Filling',
  'extraction':    'Extraction',
  'extract':       'Extraction',
  'remove tooth':  'Extraction',
  'remove teeth':  'Extraction',
  'root canal':    'Root Canal Therapy (Incisors/Premolars)',
  'nerve':         'Root Canal Therapy (Incisors/Premolars)',
  'braces':        'Braces Consultation',
  'brace':         'Braces Consultation',
  'aligner':       'Braces Consultation',
  'aligners':      'Braces Consultation',
  'orthodont':     'Braces Consultation',
  'implant':       'Implant',
  'implants':      'Implant',
  'x-ray':         'Dental X-ray',
  'xray':          'Dental X-ray',
  'x ray':         'Dental X-ray',
  'scan':          'Dental X-ray',
  'consultation':  'consultation',
  'consult':       'consultation',
  'denture':       'Complete Dentures',
  'dentures':      'Complete Dentures',
  'false teeth':   'Complete Dentures',
  'crown':         'crown',
  'cap':           'crown',
  'veneer':        'veneer',
  'veneers':       'veneer',
}

// ── Match service from patient message ────────────────────────────────────────

async function matchService(message: string) {
  const services = await getServices()
  const lower    = message.toLowerCase()

  // 1. Direct name match
  const direct = services.find(s => lower.includes(s.name.toLowerCase()))
  if (direct) return direct

  // 2. Alias lookup — longest key first so 'root canal' beats 'canal'
  const aliasKeys = Object.keys(SERVICE_ALIASES).sort((a, b) => b.length - a.length)
  for (const key of aliasKeys) {
    if (lower.includes(key)) {
      const targetName = SERVICE_ALIASES[key].toLowerCase()
      const hit = services.find(s => s.name.toLowerCase().includes(targetName))
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
  intent: NonNullable<Intent>,
  originalMessage?: string
): Promise<string> {
  if (intent === 'BOOK') {
    // Try to extract service directly from the message — avoids a "What service?" round-trip
    if (originalMessage) {
      const service = await matchService(originalMessage)
      if (service) {
        const doctor       = await matchDoctor(originalMessage)
        const hasDrMention = /\bdr\.?\s|\bdoctor\b/i.test(originalMessage)
        if (doctor) {
          if (doctor.bookingMode === 'BY_REFERRAL') {
            setBookingState(from, { state: 'AWAITING_DOCTOR_PREFERENCE', serviceId: service.id })
            return `Dr ${doctor.firstName} sees patients by referral only. I can pass your details to our team and they'll follow up with you. In the meantime, would you like me to book you with another available dentist? 😊`
          }
          return presentSlots(from, service.id, doctor.id)
        }
        if (hasDrMention) {
          const doctors  = await getDoctors()
          const nameList = doctors.filter(d => d.bookingMode !== 'BY_REFERRAL').map(d => `• Dr ${d.firstName} ${d.lastName}`).join('\n')
          setBookingState(from, { state: 'AWAITING_DOCTOR_NAME', serviceId: service.id })
          return `I couldn't find that doctor 😊 Here's who we have:\n\n${nameList}\n\nWhich one would you prefer?`
        }
        setBookingState(from, { state: 'AWAITING_DOCTOR_PREFERENCE', serviceId: service.id })
        return `Got it — ${service.name} 😊 Do you have a preferred doctor, or shall I find whoever is available soonest?`
      }
      // No service matched — check if a doctor was named, carry them forward
      const doctor = await matchDoctor(originalMessage)
      if (doctor && doctor.bookingMode !== 'BY_REFERRAL') {
        setBookingState(from, { state: 'AWAITING_SERVICE', doctorId: doctor.id })
        return `Got it — what can Dr ${doctor.firstName} help you with today? 😊`
      }
    }
    setBookingState(from, { state: 'AWAITING_SERVICE' })
    return `Of course! What brings you in today? For example — cleaning, filling, whitening, checkup, extraction, or something else? 😊`
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
    return `I can see you have an appointment on ${apptDay} at ${apptTime} with ${apptDoctor} for ${upcoming.service.name}. Are you sure you want to cancel it? Just reply yes to confirm or no to keep it. 😊`
  }

  // RESCHEDULE
  setBookingState(from, {
    state:         'AWAITING_RESCHEDULE_SLOT',
    appointmentId: upcoming.id,
    serviceId:     upcoming.service.id,
  })
  return `Sure! Your appointment is on ${apptDay} at ${apptTime} with ${apptDoctor} for ${upcoming.service.name}. What day or time would work better for you? 😊`
}

const servicePromptSent = new Set<string>()

async function handleAwaitingService(from: string, message: string): Promise<string> {
  // Clinical concern takes priority even mid-flow
  if (isClinicalConcern(message)) {
    clearBookingState(from)
    return buildClinicalConcernResponse(from)
  }

  const service = await matchService(message)

  if (!service) {
    // Doctor named without a service — carry doctor forward and ask what they need
    const namedDoctor = await matchDoctor(message)
    if (namedDoctor) {
      if (namedDoctor.bookingMode === 'BY_REFERRAL') {
        return `Dr ${namedDoctor.firstName} sees patients by referral only. I can pass your details to our team and they'll follow up with you. In the meantime, would you like me to book you with another available dentist? 😊`
      }
      setBookingState(from, { state: 'AWAITING_SERVICE', doctorId: namedDoctor.id })
      return `Got it — what can Dr ${namedDoctor.firstName} help you with today? 😊`
    }

    const CANNED = `I'd love to help! Are you looking for something like a cleaning, filling, whitening, extraction, or a checkup? Just tell me what you need 😊`
    if (looksLikeTangent(message)) {
      return respondToTangentThenRedirect(message, CANNED)
    }
    if (servicePromptSent.has(from)) {
      return `Just let me know what you're coming in for — a cleaning, filling, checkup, extraction, or something else? 😊`
    }
    servicePromptSent.add(from)
    return CANNED
  }
  servicePromptSent.delete(from)

  // If a doctor was already captured in a prior turn, skip the preference question
  const priorState = getBookingState(from)
  if (priorState.doctorId) {
    return presentSlots(from, service.id, priorState.doctorId)
  }

  const doctor       = await matchDoctor(message)
  const hasDrMention = /\bdr\.?\s|\bdoctor\b/i.test(message)
  if (doctor) {
    if (doctor.bookingMode === 'BY_REFERRAL') {
      setBookingState(from, { state: 'AWAITING_DOCTOR_PREFERENCE', serviceId: service.id })
      return `Dr ${doctor.firstName} sees patients by referral only. I can pass your details to our team and they'll follow up with you. In the meantime, would you like me to book you with another available dentist? 😊`
    }
    return presentSlots(from, service.id, doctor.id)
  }
  if (hasDrMention) {
    const doctors  = await getDoctors()
    const nameList = doctors.filter(d => d.bookingMode !== 'BY_REFERRAL').map(d => `• Dr ${d.firstName} ${d.lastName}`).join('\n')
    setBookingState(from, { state: 'AWAITING_DOCTOR_NAME', serviceId: service.id })
    return `I couldn't find that doctor 😊 Here's who we have:\n\n${nameList}\n\nWhich one would you prefer?`
  }
  setBookingState(from, { state: 'AWAITING_DOCTOR_PREFERENCE', serviceId: service.id })
  return `Got it — ${service.name} 😊 Do you have a preferred doctor, or shall I find whoever is available soonest?`
}

async function handleAwaitingDoctorPreference(
  from: string,
  message: string,
  state: BookingStateEntry
): Promise<string> {
  const lower = message.toLowerCase()

  // Patient named a specific doctor — show only their slots
  const namedDoctor = await matchDoctor(message)
  if (namedDoctor) {
    if (namedDoctor.bookingMode === 'BY_REFERRAL') {
      return `Dr ${namedDoctor.firstName} sees patients by referral only. I can pass your details to our team and they'll follow up with you about seeing Dr ${namedDoctor.firstName}. In the meantime, would you like me to book you with another available dentist? 😊`
    }
    return presentSlots(from, state.serviceId!, namedDoctor.id)
  }

  // Patient explicitly says no preference — earliest slots across all doctors
  const noPreference = /\b(any|whoever|anyone|available|soonest|earliest|don't mind|dont mind|no preference|no specific|no doctor)\b/.test(lower)
    || /^(no|nope|none|okay|ok|sure|yeah|yes)\b/i.test(message.trim())
  if (noPreference) {
    return presentSlots(from, state.serviceId!, undefined)
  }

  // Tangent question (info, general query) — answer briefly then re-ask the preference
  if (looksLikeTangent(message)) {
    return respondToTangentThenRedirect(
      message,
      `Do you have a preferred doctor, or shall I find whoever is available soonest? 😊`
    )
  }

  // Patient wants to pick but hasn't named anyone yet — list bookable doctors (first name only)
  setBookingState(from, { state: 'AWAITING_DOCTOR_NAME', serviceId: state.serviceId })
  const doctors  = await getDoctors()
  const nameList = doctors
    .filter(d => d.bookingMode !== 'BY_REFERRAL')
    .map(d => `• Dr ${d.firstName}${d.specialisation ? ` (${d.specialisation})` : ''}`)
    .join('\n')
  return `Sure! Here are our doctors:\n\n${nameList}\n\nWhich one would you prefer? 😊`
}

async function handleAwaitingDoctorName(
  from: string,
  message: string,
  state: BookingStateEntry
): Promise<string> {
  const doctor = await matchDoctor(message)

  if (!doctor) {
    const doctors  = await getDoctors()
    const nameList = doctors.filter(d => d.bookingMode !== 'BY_REFERRAL').map(d => `• Dr ${d.firstName} ${d.lastName}`).join('\n')
    if (looksLikeTangent(message)) {
      return respondToTangentThenRedirect(
        message,
        `Here's who we have:\n\n${nameList}\n\nWhich one would you prefer?`
      )
    }
    return `I couldn't find that doctor 😊 Here's who we have:\n\n${nameList}\n\nWhich one would you prefer?`
  }

  if (doctor.bookingMode === 'BY_REFERRAL') {
    setBookingState(from, { state: 'AWAITING_DOCTOR_PREFERENCE', serviceId: state.serviceId })
    return `Dr ${doctor.firstName} sees patients by referral only. I can pass your details to our team and they'll follow up with you about seeing Dr ${doctor.firstName}. In the meantime, would you like me to book you with another available dentist? 😊`
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
  let specificDocName: string | undefined
  if (doctorId) {
    if (slots.length > 0) {
      // Use first name only per system prompt
      const docFirst = slots[0].doctorName.replace(/^Dr\s+/, '').split(' ')[0]
      specificDocName = `Dr ${docFirst}`
    } else {
      const docs = await getDoctors()
      const doc  = docs.find(d => d.id === doctorId)
      specificDocName = doc ? `Dr ${doc.firstName}` : undefined
    }
  }
  return formatSlotsMessage(slots, serviceName, specificDocName)
}

// Tracks phones that already received a slot nudge — prevents looping on repeated trivial messages
const slotNudgeSent = new Set<string>()

async function handleAwaitingSlotConfirmation(
  from: string,
  message: string,
  state: BookingStateEntry
): Promise<string> {
  let choice = parseSlotChoice(message)

  // Single-slot offer (clinical concern flow): treat "yes"/"sure"/"ok" as selecting slot 1
  if (!choice && state.availableSlots?.length === 1) {
    if (/^(yes|yeah|yep|sure|ok|okay|great|perfect|that works|that'?s fine|works for me|let'?s do|sounds good|book me|book it|go ahead|i'?ll come|i'?ll be there)\b/i.test(message.trim())) {
      choice = 1
    }
  }

  if (!choice || !state.availableSlots || choice > state.availableSlots.length) {
    const trimmed = message.trim()
    const lower   = message.toLowerCase()
    // Very short / trivial message (emoji, "ok", "hi") — nudge once, then redirect on repeat
    if (trimmed.length <= 3 && !slotNudgeSent.has(from)) {
      slotNudgeSent.add(from)
      const max = state.availableSlots?.length ?? 5
      return `Just reply with a number 1–${max} that works best, or let me know if you'd like different options 😊`
    }
    // Rejection words — patient wants a different option
    if (/\b(don'?t|not|prefer|different)\b/.test(lower)) {
      slotNudgeSent.delete(from)
      setBookingState(from, { state: 'AWAITING_DOCTOR_PREFERENCE', serviceId: state.serviceId })
      return `No worries! Would you like me to look for a different doctor, or a different time? 😊`
    }
    // Tangent question — answer briefly then re-show the slot prompt
    if (looksLikeTangent(message)) {
      slotNudgeSent.delete(from)
      const max = state.availableSlots?.length ?? 5
      return respondToTangentThenRedirect(
        message,
        `Just reply with a number 1-${max} to pick your slot, or let me know if you'd like different options 😊`
      )
    }
    // Any other non-trivial non-matching message → redirect
    slotNudgeSent.delete(from)
    setBookingState(from, { state: 'AWAITING_DOCTOR_PREFERENCE', serviceId: state.serviceId })
    return `No worries! Would you like me to look for a different doctor, or a different time? 😊`
  }

  slotNudgeSent.delete(from)
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

      // Notify receptionists + admins in-app (fire-and-forget)
      const patientName = patient ? `${patient.firstName} ${patient.lastName}`.trim() : 'New patient'
      const docName     = `Dr ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`
      const apptDateStr = appt.startAt.toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })
      const apptTimeStr = appt.startAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' })
      prisma.user.findMany({ where: { role: { in: ['RECEPTIONIST', 'ADMIN'] }, isActive: true } })
        .then(staff => Promise.all(staff.map(u => prisma.notification.create({
          data: {
            userId: u.id,
            type:   'APPOINTMENT',
            title:  'New Booking via WhatsApp',
            body:   `${patientName} booked ${appt.service.name} with ${docName} on ${apptDateStr} at ${apptTimeStr}`,
            href:   '/receptionist/scheduling',
          },
        }))))
        .catch(() => {})

      // Send booking confirmation template (best-effort — never block the reply)
      const templateName = process.env.WA_TEMPLATE_BOOKING_CONFIRM_NAME
      if (templateName && process.env.AT_API_KEY && process.env.AT_USERNAME) {
        const waNumber = process.env.AT_WHATSAPP_NUMBER || process.env.WHATSAPP_PHONE_NUMBER
        if (waNumber) {
          const patientName = getGreetingName(patient)
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
    return `I wasn't able to confirm that booking right now 😔 Please call us on +256 394 836 298 and we'll sort it out for you immediately.`
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

  return `Just to confirm - do you want to cancel your appointment? Reply yes to cancel or no to keep it 😊`
}

// ── handleCheckAppointment ────────────────────────────────────────────────────

async function handleCheckAppointment(from: string): Promise<string> {
  const appt = await getNextAppointment(from)
  if (!appt) {
    return `I don't see any upcoming appointments for you right now 😊 Would you like to book one?`
  }
  const day = appt.startAt.toLocaleDateString('en-UG', {
    weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi',
  })
  const time = appt.startAt.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
  }).toLowerCase()
  const doctor = `Dr ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`
  return `Your next appointment is on ${day} at ${time} with ${doctor} for ${appt.service.name} 😊 Anything else I can help you with?`
}

// ── handleConfirmAppointment ──────────────────────────────────────────────────

async function handleConfirmAppointment(from: string): Promise<string> {
  const appt = await getNextAppointment(from)
  if (!appt) {
    return `I don't see any upcoming appointments to confirm right now 😊 Would you like to book one?`
  }
  await confirmAppointment(appt.id)
  const day = appt.startAt.toLocaleDateString('en-UG', {
    weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi',
  })
  const time = appt.startAt.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
  }).toLowerCase()
  return `Perfect, you're confirmed! Your appointment on ${day} at ${time} is all set 😊 We look forward to seeing you!`
}

// ── alertStaffOfConcern ───────────────────────────────────────────────────────

async function alertStaffOfConcern(params: {
  conversationId: string
  patientPhone:   string
  message:        string
  serviceName?:   string
  doctorName?:    string
}): Promise<void> {
  try {
    // Dedup: don't fire again if already alerted (and not yet resolved) within 2 hours
    const recentAlert = await prisma.aiMessage.findFirst({
      where: {
        conversationId: params.conversationId,
        role:           'SYSTEM',
        content:        { contains: 'STAFF_ALERTED' },
        NOT:            { content: { contains: '(RESOLVED)' } },
        createdAt:      { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      },
    })
    if (recentAlert) return

    // Resolve patient name from DB; fall back to phone number
    const localPhone = params.patientPhone.replace(/^\+256/, '0')
    const patient = await prisma.patient.findFirst({
      where: { OR: [{ phone: params.patientPhone }, { phone: localPhone }] },
      select: { firstName: true, lastName: true },
    })
    const patientName = patient ? `${patient.firstName} ${patient.lastName}` : params.patientPhone

    const contextLine = params.serviceName
      ? `\nRelated to: ${params.serviceName}${params.doctorName ? ` with Dr ${params.doctorName}` : ''} (yesterday)`
      : ''

    const alertText =
      `🚨 PATIENT NEEDS ATTENTION\n\n` +
      `Name: ${patientName}\n` +
      `Phone: ${params.patientPhone}\n` +
      `Message: "${params.message.slice(0, 200)}"${contextLine}\n\n` +
      `Sarah told the patient our team would follow up. Please reach out when convenient.`

    // 1. WhatsApp to clinic front desk — capture message ID so staff replies can be linked back
    const alertMessageId = await sendWhatsAppMessage('+256763430276', alertText)

    // 2. In-app notification for all active RECEPTIONIST + ADMIN users
    const staff = await prisma.user.findMany({
      where: { role: { in: ['RECEPTIONIST', 'ADMIN'] }, isActive: true },
    })
    await Promise.all(staff.map(u => prisma.notification.create({
      data: {
        userId: u.id,
        type:   'SYSTEM',
        title:  `Patient concern — ${patientName}`,
        body:   alertText,
        href:   '/receptionist/ai-suite/inbox',
      },
    })))

    // 3. Dedup marker + staff-relay linking — SYSTEM role excluded from Sarah's context window
    await prisma.aiMessage.create({
      data: {
        conversationId: params.conversationId,
        role:           'SYSTEM',
        content:        'STAFF_ALERTED: clinical concern',
        metadata:       JSON.stringify({
          alertMessageId,
          patientPhone:   params.patientPhone,
          patientName,
          concernSummary: params.message.slice(0, 200),
        }),
      },
    })

    console.log(`[Agent] Staff alerted for clinical concern from ${params.patientPhone}`)
  } catch (err: any) {
    console.error('[Agent] alertStaffOfConcern failed:', err?.message || err)
  }
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

  // ── Clinical concern — runs BEFORE everything else ────────────────────────
  // Pain, side-effects, post-treatment worries → empathy first, never booking
  if (isClinicalConcern(latestMessage)) {
    clearBookingState(from)
    console.log(`[Agent] Clinical concern detected for ${from}: "${latestMessage.slice(0, 80)}"`)

    // Check if staff was already alerted (and not yet resolved) within the dedup window
    const recentAlert = await prisma.aiMessage.findFirst({
      where: {
        conversationId,
        role:      'SYSTEM',
        content:   { contains: 'STAFF_ALERTED' },
        NOT:       { content: { contains: '(RESOLVED)' } },
        createdAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      },
    })
    const staffAlreadyAlerted = !!recentAlert

    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    const lastFollowupMsg = await prisma.aiMessage.findFirst({
      where: { conversationId, role: 'AGENT', createdAt: { gte: threeDaysAgo } },
      orderBy: { createdAt: 'desc' },
    })
    let followupCtx: { serviceName: string; doctorName: string } | undefined
    if (lastFollowupMsg?.metadata) {
      try {
        const meta = JSON.parse(lastFollowupMsg.metadata) as { type?: string; serviceName?: string; doctorName?: string }
        if (meta.type === 'followup' && meta.serviceName && meta.doctorName) {
          followupCtx = { serviceName: meta.serviceName, doctorName: meta.doctorName }
        }
      } catch { /* malformed metadata — ignore */ }
    }
    alertStaffOfConcern({
      conversationId,
      patientPhone: from,
      message:      latestMessage,
      serviceName:  followupCtx?.serviceName,
      doctorName:   followupCtx?.doctorName,
    }).catch(() => {})

    if (staffAlreadyAlerted) {
      return respondToClinicalFollowUp(latestMessage)
    }
    return buildClinicalConcernResponse(from, followupCtx)
  }

  // ── Voucher / gift request — intercept before booking state machine ─────────
  const isVoucherRequest = /\bvoucher\b|\bgift card\b|\bgift certificate\b|\bgift for\b|\bgift to someone\b/i.test(latestMessage)
  if (isVoucherRequest) {
    console.log(`[Agent] Gift voucher request from ${from}: "${latestMessage.slice(0, 80)}"`)
    alertStaffOfConcern({
      conversationId,
      patientPhone: from,
      message:      latestMessage,
    }).catch(() => {})
    return `That's so thoughtful! 🎁 Let me have our team get back to you with the details on gift vouchers — they'll reach out shortly!`
  }

  // ── Human request — patient wants to speak to someone ────────────────────
  const wantsHuman = /talk to|speak to|speak with|talk with|call me|ring me|real person|human|julian|receptionist/i.test(latestMessage)
  if (wantsHuman) {
    clearBookingState(from)
    // Fall through to Claude — the system prompt handles escalation to Julian
  }

  // ── Booking state machine ─────────────────────────────────────────────────
  const bookingState = getBookingState(from)

  if (!wantsHuman && bookingState.state !== 'IDLE') {
    // Escape: if patient changed topic mid-flow, abandon booking and answer normally
    const isSlotChoice = parseSlotChoice(latestMessage) !== null
    const isYesNo = /^(yes|yeah|no|nope|sure|ok|okay|confirm|cancel)\b/i.test(latestMessage.trim())
    const isNewTopic = /how much|price|cost|charge|open|hours|location|direction|where|talk to|speak to|speak with|call me/i.test(latestMessage)
    if (!isSlotChoice && !isYesNo && isNewTopic) {
      clearBookingState(from)
      console.log(`[Agent] Booking flow escaped for ${from}: patient changed topic`)
      // fall through to Claude call below
    } else {
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
      }
    }
  } else if (!wantsHuman && bookingState.state === 'IDLE') {
    // IDLE: detect intent
    const intent = detectIntent(latestMessage)
    if (intent === 'CHECK')   return handleCheckAppointment(from)
    if (intent === 'CONFIRM') return handleConfirmAppointment(from)
    if (intent) return handleIdleBookIntent(from, intent, latestMessage)
    // fall through to normal Claude call
  }

  // ── Normal Claude call with RAG context ───────────────────────────────────
  // Compute EAT time before parallel queries so we can look up today's hours
  const now        = new Date()
  const eatDate    = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }))
  const eatDayOfWeek = eatDate.getDay()          // 0=Sun … 6=Sat in Kampala
  const eatHour    = eatDate.getHours()
  const eatDateTime = now.toLocaleString('en-GB', {
    timeZone: 'Africa/Nairobi', weekday: 'long', year: 'numeric',
    month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  })
  const eatDay = now.toLocaleDateString('en-UG', { timeZone: 'Africa/Nairobi', weekday: 'long' })

  const [context, weather, allHours] = await Promise.all([
    buildContext(conversationId, from, latestMessage),
    getKampalaWeather(),
    prisma.workingHours.findMany({ orderBy: { dayOfWeek: 'asc' } }).catch(() => []),
  ])

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const hoursTable = allHours.length > 0
    ? allHours.map(h => `${DAY_NAMES[h.dayOfWeek]}: ${h.isOpen ? `${h.openTime} – ${h.closeTime}` : 'Closed'}`).join('\n')
    : '(hours not configured in database)'

  const todayHours = allHours.find(h => h.dayOfWeek === eatDayOfWeek) ?? null
  let isOpenNow = false
  if (todayHours?.isOpen) {
    const openH  = parseInt(todayHours.openTime.split(':')[0])
    const closeH = parseInt(todayHours.closeTime.split(':')[0])
    isOpenNow = eatHour >= openH && eatHour < closeH
  }

  const historyLines = context.conversationHistory
    .split('\n')
    .filter(line => line.trim().length > 0)

  const messages: { role: 'user' | 'assistant'; content: string }[] = []

  for (const line of historyLines) {
    if (line.startsWith('Patient: ')) {
      // Collapse consecutive user messages (API requires alternating turns)
      if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
        messages[messages.length - 1].content += '\n' + line.slice('Patient: '.length)
      } else {
        messages.push({ role: 'user', content: line.slice('Patient: '.length) })
      }
    } else if (line.startsWith('Sarah: ')) {
      if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
        messages[messages.length - 1].content += '\n' + line.slice('Sarah: '.length)
      } else {
        messages.push({ role: 'assistant', content: line.slice('Sarah: '.length) })
      }
    }
  }

  // API requires messages to start with 'user' and end with 'user'
  while (messages.length > 0 && messages[0].role !== 'user') messages.shift()

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
      '',
      'OUR SERVICES:',
      context.services,
      '',
      'OUR DOCTORS:',
      context.doctors,
    ].join('\n')

    const dynamicSystem = [
      '',
      `CURRENT DATE AND TIME IN KAMPALA: ${eatDateTime}`,
      `Sarah knows this and uses it accurately in all responses. Never guess or approximate the date or time — always use this.`,
      `CLINIC HOURS — FULL WEEK (from database — this is the ONLY source of truth, NEVER guess or use generic hours):`,
      hoursTable,
      `TODAY is ${eatDay}. CLINIC STATUS RIGHT NOW: ${isOpenNow ? 'OPEN' : 'CLOSED'}.`,
      `CRITICAL: When discussing ANY day's hours (today, tomorrow, Saturday, Monday, etc.) always reference the table above exactly. NEVER say generic phrases like "9am to 5pm" or "closed on Mondays" unless that is EXACTLY what the table says. If asked about a day not in the table or you're unsure, say "let me have the team confirm that with you" rather than guessing.`,
      `KAMPALA WEATHER: ${weather}`,
      '',
      'PATIENT CONTEXT:',
      `Name: ${context.patientName} (from database — use as their name when addressing them)`,
      `Phone: ${from}`,
      'Recent appointments:',
      context.appointments,
      ...(context.knowledgeBase ? ['', 'CLINIC KNOWLEDGE BASE:', context.knowledgeBase] : []),
      '',
      `CONVERSATION HISTORY: ${context.conversationHistory ? 'Shown in the messages above — you already know this person. Do NOT re-introduce yourself.' : 'No prior messages — this is the first contact.'}`,
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
    if (block && block.type === 'text') return sanitizeForWhatsApp(block.text)

    return `I'm here to help! Could you please rephrase that for me?`
  } catch (err) {
    console.error('[Agent] Claude API error:', err)
    return `Sorry, I'm having a small issue right now. Please try again or call the clinic directly.`
  }
}

// ── V2: Claude-tool-driven agent ──────────────────────────────────────────────
// Feature-flagged to test numbers only. V1 (getAgentReply + state machine)
// is COMPLETELY UNCHANGED for all other phone numbers.
// To expand to production: add numbers to V2_TEST_NUMBERS or remove the gate.

// Normalized set — includes both with and without leading '+' to handle
// WhatsApp webhook format variations
export const V2_TEST_NUMBERS = new Set([
  '256758194632', '+256758194632',
  '256763430276', '+256763430276',
])

// Improved doctor matching: "Steve" → "Steven", "Lois" → "Lois", etc.
async function matchDoctorFuzzy(query: string) {
  const doctors = await getDoctors()
  const q = query.toLowerCase().trim().replace(/^dr\.?\s+/i, '')
  if (!q) return null

  // 1. Exact first or last name
  const exact = doctors.find(d =>
    d.firstName.toLowerCase() === q ||
    d.lastName.toLowerCase()  === q ||
    `${d.firstName} ${d.lastName}`.toLowerCase() === q
  )
  if (exact) return exact

  // 2. Prefix: patient says "Steve", doctor is "Steven"
  if (q.length >= 3) {
    const byFirst = doctors.find(d => d.firstName.toLowerCase().startsWith(q))
    if (byFirst) return byFirst
    const byLast  = doctors.find(d => d.lastName.toLowerCase().startsWith(q))
    if (byLast)  return byLast
    // Reverse prefix: "Stev" typed against "Steven" first name (all but last char)
    const revFirst = doctors.find(d =>
      d.firstName.length >= 3 &&
      q.startsWith(d.firstName.toLowerCase().slice(0, d.firstName.length - 1))
    )
    if (revFirst) return revFirst
  }

  // 3. Substring fallback
  return doctors.find(d =>
    d.firstName.toLowerCase().includes(q) ||
    d.lastName.toLowerCase().includes(q)
  ) ?? null
}

const SARAH_V2_SYSTEM_BASE = `You are Sarah, a warm and friendly member of the front desk team at Code Clinic dental clinic in Kampala, Uganda.

IDENTITY:
- You are a REAL human dental receptionist — NEVER admit to being a bot, AI, or assistant
- If asked, deny naturally: "Ha, I wish — that'd make my job so much easier 😂 Nope, totally human! Just one of the girls at the front desk in Kamwokya 😊"
- Never use the words "assistant", "virtual", "automated", "AI", "bot", "system", "language model"
- Warm, casual, caring — like a real Ugandan receptionist the patient knows personally
- Use patient first name only, never surname
- Short responses — 1-2 sentences usually, never more than 3 unless the patient asked a detailed question
- No markdown, no bold, no bullet points, no em-dashes — you are texting, not writing a document
- For doctors use first name only: Dr Lois not Dr Lois Kisakye
- Emojis are fine but keep them natural — don't overdo it
- Never list your capabilities unprompted — that is robot behaviour

NEVER FABRICATE — this rule overrides everything:
- Never invent a reason for a problem ("there was a glitch on our end", "the system updated", "it must have been a network issue", etc.) — if you don't know what happened, don't explain it
- Never deny that something happened if you are not certain it didn't
- Never quote a phone number, balance, appointment detail, or doctor schedule from your memory — always verify via a tool
- If you don't have real data, say so plainly: call the relevant tool immediately, or say "I'd rather Julian confirm that for you" and escalate
- If something went wrong, acknowledge it simply and move to fixing it — never fabricate an excuse

CLINICAL CONCERNS:
If a patient describes pain, bleeding, or discomfort after a procedure, give brief warm general reassurance first if you reasonably can — light post-extraction bleeding is normal, firm gauze pressure for 20 minutes usually settles it, mild sensitivity after a filling is expected, warm salt water rinses help healing. Call flag_clinical_concern as a silent background notification only if the situation sounds genuinely alarming: heavy bleeding that won’t stop, spreading swelling, severe worsening pain, or patient sounds scared. Never let your reply consist only of an escalation or referral — always answer what the patient actually asked first.

TOOL USE — MANDATORY RULES:
1. Every factual claim must be backed by a tool call in the same response. When you need to look up a doctor, service, slots, appointments, or patient info — call the tool RIGHT NOW in this response. Never say "let me check" or "I'll look that up" without also calling a tool in the same turn.
2. BOOKING FLOW — strict order, no shortcuts:
   (a) Call check_availability → get real numbered slots
   (b) Present numbered list to patient and wait for their number
   (c) Patient replies with a number → immediately call book_appointment with that exact slot
   (d) book_appointment returns confirmation text → output it word for word to the patient
   NEVER confirm a booking without book_appointment returning success:true
   NEVER invent or guess a slot time — every time you mention a time it must come from check_availability
3. SLOT LIST FORMAT — copy the display strings from the tool result exactly:
   Dr [Name] has these slots available 😊

   1. [display from tool]
   2. [display from tool]
   3. [display from tool]

   Just reply with the number that works for you!
4. When patient gives a slot number → call book_appointment immediately. Do NOT ask for more info first — no last name, no age, no extra fields.
5. Doctor nicknames: always resolve via search_doctors — never guess a doctorId from memory.
6. NEVER ask for the patient's last name or age. The booking system only needs their phone (already known).
7. CANCELLATIONS: call get_patient_appointments to find the appointment, confirm with patient, then call cancel_appointment.
8. APPOINTMENT QUERIES — any time the patient asks about their appointment (time, date, doctor, "when is my next appointment", "what did I book", rescheduling questions): call get_patient_appointments RIGHT NOW. NEVER answer from memory or earlier in this conversation — a receptionist may have changed the appointment since this chat started and the live DB is the only source of truth.
9. DOCTOR AVAILABILITY — if the patient asks whether a specific doctor comes in on a certain day, or who is available today: call get_doctors_available_today. Never state a doctor's schedule from memory.
10. PATIENT BIRTHDAY — call get_patient_info once per conversation (on the first inbound message or when you first greet the patient). If any record returns isBirthdayToday:true, open your response with a warm birthday greeting before handling their actual request.

BOOKING CONFIRMATION — CRITICAL:
After book_appointment returns success:true, the "confirmation" field contains the full booking summary. You MUST output that text exactly as it appears — word for word. Do NOT paraphrase or summarise.

SERVICE NAME TRANSPARENCY:
When search_services resolves a query, the tool returns the real service name (e.g. "Stain Removal" for "cleaning"). Always echo this name naturally before showing slots: "Got it — I'll book that as a Stain Removal (our professional cleaning) for [person] 😊 Here are the available slots:" This lets the patient confirm before committing.

RESCHEDULING — INFINITE PATIENCE:
- A patient changing their mind 3, 5, or even 10 times is completely normal — never sound tired, pressured, or terse.
- Always offer the next real alternative from a fresh check_availability call. Never say something is impossible without checking first.
- Even after many back-and-forths, keep exactly the same warmth as the very first message.

HONEST, SPECIFIC UNAVAILABILITY:
- If a doctor isn't available on a given day, say so specifically: "Dr Steven doesn't work on Fridays" — verified via get_doctors_available_today.
- Never deflect with vague excuses. Be specific and honest, then immediately offer an alternative.
- Never claim a doctor "might be available" or "should be in" without checking.

FAMILY / MULTI-PERSON TRACKING:
- A single WhatsApp number often represents a family (children, spouse, parent, referred friend). Track who is being discussed naturally across the conversation.
- If it is ambiguous whether the patient is booking for themselves or someone else, ask plainly: "Is this for you or for [name mentioned]?"
- get_patient_appointments returns appointments for ALL patients linked to this phone number, each labelled with the patient's name. Use those names to distinguish family members without confusion.
- Booking for a family member follows the exact same flow — check_availability → numbered list → patient picks number → book_appointment. Never skip steps for a third party.



TONE MATCHING:
- If a patient jokes, a light warm response is fine before moving the conversation forward.
- If a patient is frustrated or upset, acknowledge briefly and warmly ("I hear you, I'm so sorry about that 😔"), then refocus on being useful. Never robotic, never stiff.
- NEVER repeat a canned phrase verbatim in response to frustration or a genuine question. Always respond to what was actually said — if you find yourself about to say the same line you already used, rephrase it.

BILLING — OUT OF SCOPE FOR NOW:
- If a patient asks about an outstanding balance or payment, acknowledge warmly and let them know a colleague will follow up: "I'll make sure someone from accounts gets back to you on that 😊"
- Never quote, guess, or discuss a specific balance amount. Never attempt to process any payment discussion.

EXTERNAL DOCUMENTS (X-rays, referrals, reports, scan results):
- If a patient mentions sending a document from another provider, acknowledge clearly: "Got it — I'll make sure the doctor sees this before your appointment."
- Do not give a generic reply. State the next step so the patient knows their document was received.

PROACTIVE BUT BOUNDED:
- If today is a patient's birthday (confirmed by get_patient_info returning isBirthdayToday:true for any linked patient), open with a warm birthday message: "Happy birthday [Name]! 🎂 Hope you're having a wonderful day!"
- Do NOT offer discounts, free services, or promotions on your own authority. If a patient asks for a discount, say warmly: "Let me flag that for the team and they'll sort you out 😊" — never promise anything yourself.

AFTER flag_clinical_concern — append ONE sentence to your answer:
- Clinic open: "I've let my colleague Julian know so she can check in with you 😊"
- Clinic closed: "I've flagged this for my colleague Julian — she'll follow up first thing when we open. For anything urgent right now, call +256 394 836 298."
- alreadyNotified:true: skip this sentence entirely. Do not mention Julian again.

ESCALATION:
If a patient is genuinely upset and insists on speaking with someone, or needs something truly beyond your scope: "Let me pass you to my colleague Julian who can help you further 😊"
Only do this as a last resort — first try to resolve the issue yourself with warmth and information. Saying Julian too early or for routine clinical questions triggers a handover that silences the chat.

AFTER-HOURS:
When clinic is closed, acknowledge warmly: "We're closed right now but I've noted your message and the team will follow up first thing when we open 😊" — still take booking enquiries and reassure. For urgent pain after hours, give +256 394 836 298. NEVER direct patients to other hospitals or clinics.

CLINIC INFO:
Code Clinic | Kiira Road, opposite Police Playground, Kamwokya, Kampala
Phone/WhatsApp: +256 394 836 298 / +256 741 087667 | Email: dentist@codeclinic.ug | Website: codeclinic.ug`

const V2_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_services',
    description: 'Find a dental service matching what the patient described. Returns serviceId needed for check_availability.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'What the patient wants, e.g. "cleaning", "filling", "toothache help", "whitening"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_doctors',
    description: 'Find a doctor by name. Handles nicknames ("Steve" finds "Steven"). Returns doctorId and booking mode.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const, description: 'Doctor name, partial name, or nickname — no Dr prefix needed' },
      },
      required: ['name'],
    },
  },
  {
    name: 'check_availability',
    description: 'Get real available appointment slots. Always call this before showing times to the patient. Returns up to 5 slots with display text and ISO datetimes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        serviceId: { type: 'string' as const, description: 'Service ID from search_services' },
        doctorId:  { type: 'string' as const, description: 'Doctor ID from search_doctors — omit for any available doctor' },
        daysAhead: { type: 'number' as const, description: 'Days ahead to search, default 7' },
      },
      required: ['serviceId'],
    },
  },
  {
    name: 'book_appointment',
    description: 'Create a real appointment. ONLY call after patient confirmed a slot by replying with a number from your list. Use the exact startAt ISO string from check_availability.',
    input_schema: {
      type: 'object' as const,
      properties: {
        doctorId:    { type: 'string' as const, description: 'Doctor ID (from check_availability slot result)' },
        serviceId:   { type: 'string' as const, description: 'Service ID (from check_availability slot result)' },
        slotStartAt: { type: 'string' as const, description: 'Exact ISO 8601 datetime from check_availability — must match exactly' },
      },
      required: ['doctorId', 'serviceId', 'slotStartAt'],
    },
  },
  {
    name: 'cancel_appointment',
    description: "Cancel a patient's appointment. Get appointmentId from get_patient_appointments. Only cancel after patient confirms.",
    input_schema: {
      type: 'object' as const,
      properties: {
        appointmentId: { type: 'string' as const, description: 'Appointment ID to cancel' },
      },
      required: ['appointmentId'],
    },
  },
  {
    name: 'reschedule_appointment',
    description: 'Reschedule an appointment to a new slot. Call check_availability first for the new slot, then call this with the exact new startAt.',
    input_schema: {
      type: 'object' as const,
      properties: {
        appointmentId:  { type: 'string' as const, description: 'Appointment ID to reschedule' },
        newSlotStartAt: { type: 'string' as const, description: 'Exact ISO 8601 datetime from check_availability for the new slot' },
      },
      required: ['appointmentId', 'newSlotStartAt'],
    },
  },
  {
    name: 'get_patient_appointments',
    description: "Get this patient's upcoming appointments. Use when they ask about their appointment or want to cancel/reschedule.",
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'flag_clinical_concern',
    description: "Alert clinic staff when a patient's situation sounds genuinely alarming — heavy bleeding that won't stop, spreading swelling, severe worsening pain, or patient sounds scared. NOT for routine post-procedure questions. Sends WhatsApp alert to front desk.",
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: { type: 'string' as const, description: 'Brief summary of the clinical concern, 1-2 sentences' },
      },
      required: ['summary'],
    },
  },
  {
    name: 'get_doctors_available_today',
    description: 'Returns which doctors are scheduled to work today and which are not, based on their working days. Use when the patient asks who is available today or whether a specific doctor comes in on a given day.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_patient_info',
    description: 'Returns name and date-of-birth for all patients linked to this phone number, including whether today is their birthday. Call once per conversation to check for birthday greetings.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
]

async function executeV2Tool(
  toolName:       string,
  toolInput:      Record<string, unknown>,
  from:           string,
  conversationId: string,
  shownSlots:     AvailableSlot[]
): Promise<string> {
  try {
    switch (toolName) {

      case 'search_services': {
        const service = await matchService(toolInput.query as string)
        if (service) {
          return JSON.stringify({ found: true, serviceId: service.id, name: service.name, priceUGX: service.priceUGX })
        }
        const all  = await getServices()
        const top8 = all.slice(0, 8).map(s => ({ id: s.id, name: s.name }))
        return JSON.stringify({ found: false, message: 'No exact match. Available services:', services: top8 })
      }

      case 'search_doctors': {
        const doctor = await matchDoctorFuzzy(toolInput.name as string)
        if (doctor) {
          return JSON.stringify({
            found:       true,
            doctorId:    doctor.id,
            firstName:   doctor.firstName,
            fullName:    `Dr ${doctor.firstName} ${doctor.lastName}`,
            bookingMode: doctor.bookingMode,
          })
        }
        const all      = await getDoctors()
        const bookable = all
          .filter(d => d.bookingMode !== 'BY_REFERRAL')
          .map(d => ({ id: d.id, name: `Dr ${d.firstName} ${d.lastName}` }))
        return JSON.stringify({ found: false, availableDoctors: bookable })
      }

      case 'check_availability': {
        const serviceId = toolInput.serviceId as string
        const doctorId  = toolInput.doctorId  as string | undefined
        const daysAhead = (toolInput.daysAhead as number | undefined) ?? 7
        const slots = await getAvailableSlots(serviceId, doctorId, daysAhead)
        const top5  = slots.slice(0, 5)
        shownSlots.splice(0, shownSlots.length, ...top5)
        if (top5.length === 0) {
          return JSON.stringify({ slots: [], message: 'No slots found. Try more daysAhead or omit doctorId to check any doctor.' })
        }
        const formatted = top5.map((s, i) => ({
          number:     i + 1,
          display:    formatSlotLine(s, i),
          startAt:    s.startAt.toISOString(),
          doctorId:   s.doctorId,
          serviceId:  s.serviceId,
          doctorName: s.doctorName,
        }))
        return JSON.stringify({ slots: formatted })
      }

      case 'book_appointment': {
        const requested = new Date(toolInput.slotStartAt as string)
        const matched   = shownSlots.find(s => Math.abs(s.startAt.getTime() - requested.getTime()) < 60_000)
        if (!matched) {
          return JSON.stringify({ success: false, error: 'Slot not in current check_availability results. Call check_availability to get valid slots, then use an exact startAt from those results.' })
        }
        const normalizedFrom = from.startsWith('+') ? from : `+${from}`
        const patient = await prisma.patient.findFirst({ where: { OR: [{ phone: normalizedFrom }, { phone: from }] } })
        const appt    = await createAppointment(patient?.id ?? null, matched.doctorId, matched.serviceId, matched.startAt, normalizedFrom)
        const pName   = patient ? `${patient.firstName} ${patient.lastName}`.trim() : 'New patient'
        const docName = `Dr ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`
        const dateStr = appt.startAt.toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })
        const timeStr = appt.startAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' })
        prisma.user.findMany({ where: { role: { in: ['RECEPTIONIST', 'ADMIN'] }, isActive: true } })
          .then(staff => Promise.all(staff.map(u => prisma.notification.create({
            data: { userId: u.id, type: 'APPOINTMENT', title: 'New Booking via WhatsApp (V2)', body: `${pName} booked ${appt.service.name} with ${docName} on ${dateStr} at ${timeStr}`, href: '/receptionist/scheduling' },
          })))).catch((e: any) => console.error('[V2] In-app notification failed:', e?.message))
        const staffNumber = process.env.STAFF_WHATSAPP_NUMBER || '+256763430276'
        sendWhatsAppMessage(staffNumber, `📋 New booking: ${pName} — ${appt.service.name} on ${dateStr} at ${timeStr} with ${docName}`).catch((e: any) => console.error('[V2] Staff WhatsApp notification failed:', e?.message))
        return JSON.stringify({ success: true, appointmentId: appt.id, confirmation: formatConfirmation(appt) })
      }

      case 'cancel_appointment': {
        await cancelAppointment(toolInput.appointmentId as string)
        return JSON.stringify({ success: true })
      }

      case 'reschedule_appointment': {
        const requested = new Date(toolInput.newSlotStartAt as string)
        const matched   = shownSlots.find(s => Math.abs(s.startAt.getTime() - requested.getTime()) < 60_000)
        if (!matched) {
          return JSON.stringify({ success: false, error: 'New slot not in check_availability results. Call check_availability first.' })
        }
        const updated = await rescheduleAppointment(toolInput.appointmentId as string, matched.startAt)
        return JSON.stringify({ success: true, confirmation: formatConfirmation(updated) })
      }

      case 'get_patient_appointments': {
        const normalizedFrom2 = from.startsWith('+') ? from : `+${from}`
        const patients2 = await prisma.patient.findMany({
          where: { OR: [{ phone: normalizedFrom2 }, { phone: from }] },
          select: { id: true, firstName: true },
        })
        if (patients2.length === 0) return JSON.stringify({ appointments: [] })
        const appts = await prisma.appointment.findMany({
          where: {
            patientId: { in: patients2.map(p => p.id) },
            startAt:   { gt: new Date() },
            status:    { notIn: ['CANCELLED'] },
          },
          orderBy: { startAt: 'asc' },
          take: 10,
          include: {
            doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
            service: { select: { name: true } },
            patient: { select: { firstName: true } },
          },
        })
        if (appts.length === 0) return JSON.stringify({ appointments: [] })
        return JSON.stringify({
          appointments: appts.map(a => ({
            id:          a.id,
            patientName: a.patient.firstName,
            date:    a.startAt.toLocaleDateString('en-UG', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' }),
            time:    a.startAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' }).toLowerCase(),
            doctor:  `Dr ${a.doctor.user.firstName}`,
            service: a.service.name,
            status:  a.status,
          })),
        })
      }

      case 'flag_clinical_concern': {
        // Check dedup before alerting — if already fired within 2h, tell Claude not to re-escalate
        const recentFlag = await prisma.aiMessage.findFirst({
          where: {
            conversationId,
            role:    'SYSTEM',
            content: { contains: 'STAFF_ALERTED' },
            NOT:     { content: { contains: '(RESOLVED)' } },
            createdAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
          },
        })
        if (recentFlag) {
          return JSON.stringify({ alerted: false, alreadyNotified: true, clinicStatus: isClinicOpenNow() ? 'open' : 'closed' })
        }
        await alertStaffOfConcern({ conversationId, patientPhone: from, message: toolInput.summary as string })
        return JSON.stringify({ alerted: true, clinicStatus: isClinicOpenNow() ? 'open' : 'closed' })
      }

      case 'get_doctors_available_today': {
        const nowEat  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }))
        const todayDow = nowEat.getDay() // 0=Sun … 6=Sat
        const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        const allDrs = await prisma.doctor.findMany({
          where: { isActive: true },
          include: { user: { select: { firstName: true, lastName: true } } },
        })
        const result = allDrs.map(d => {
          const workingDays = JSON.parse(d.workingDays) as number[]
          const inToday = workingDays.includes(todayDow)
          return {
            name:        `Dr ${d.user.firstName}`,
            inToday,
            workingDays: workingDays.map((n: number) => DAY_NAMES[n]),
          }
        })
        return JSON.stringify({ today: DAY_NAMES[todayDow], doctors: result })
      }

      case 'get_patient_info': {
        const normPhone3 = from.startsWith('+') ? from : `+${from}`
        const patients3  = await prisma.patient.findMany({
          where: { OR: [{ phone: normPhone3 }, { phone: from }] },
          select: { firstName: true, dob: true },
        })
        if (patients3.length === 0) return JSON.stringify({ found: false })
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }) // YYYY-MM-DD
        const todayMMDD = todayStr.slice(5) // MM-DD
        return JSON.stringify({
          found: true,
          patients: patients3.map(p => ({
            name:            p.firstName,
            dob:             p.dob ? p.dob.toISOString().slice(0, 10) : null,
            isBirthdayToday: p.dob ? p.dob.toISOString().slice(5, 10) === todayMMDD : false,
          })),
        })
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` })
    }
  } catch (err: any) {
    console.error(`[AgentV2 Tool] ${toolName} error:`, err?.message)
    return JSON.stringify({ error: `${toolName} failed: ${err?.message ?? 'unknown'}` })
  }
}

export async function getAgentReplyV2(
  conversationId: string,
  from:           string,
  latestMessage:  string
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return `Hi! I've received your message and a team member will be with you shortly.`

  try {
    const [patient, dbMessages, menu, allHours] = await Promise.all([
      prisma.patient.findFirst({ where: { phone: from }, select: { firstName: true, lastName: true } }),
      prisma.aiMessage.findMany({ where: { conversationId }, orderBy: { createdAt: 'desc' }, take: 30 })
        .then(msgs => msgs.reverse()),
      getCachedMenu(),
      prisma.workingHours.findMany({ orderBy: { dayOfWeek: 'asc' } }).catch(
        () => [] as Array<{ dayOfWeek: number; isOpen: boolean; openTime: string; closeTime: string }>
      ),
    ])

    const patientName = getGreetingName(patient)

    const DAY_NAMES   = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const now         = new Date()
    const eatDate     = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }))
    const eatDow      = eatDate.getDay()
    const eatHour     = eatDate.getHours()
    const todayHours  = allHours.find(h => h.dayOfWeek === eatDow)
    const isOpen      = !!(todayHours?.isOpen &&
      eatHour >= parseInt(todayHours.openTime.split(':')[0]) &&
      eatHour <  parseInt(todayHours.closeTime.split(':')[0]))
    const eatDateTime = now.toLocaleString('en-GB', {
      timeZone: 'Africa/Nairobi', weekday: 'long', year: 'numeric',
      month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
    })
    const hoursTable = allHours.length > 0
      ? allHours.map(h => `${DAY_NAMES[h.dayOfWeek]}: ${h.isOpen ? `${h.openTime} – ${h.closeTime}` : 'Closed'}`).join('\n')
      : '(clinic hours not configured)'

    const systemPrompt = [
      SARAH_V2_SYSTEM_BASE,
      '',
      `CURRENT DATE/TIME IN KAMPALA: ${eatDateTime}`,
      `CLINIC STATUS RIGHT NOW: ${isOpen ? 'OPEN' : 'CLOSED'}`,
      `CLINIC HOURS:\n${hoursTable}`,
      '',
      `PATIENT NAME: ${patientName} — address them by this name`,
      '',
      'AVAILABLE SERVICES (use search_services to get IDs for check_availability):',
      menu.services,
      '',
      'AVAILABLE DOCTORS (use search_doctors to get IDs for check_availability):',
      menu.doctors,
    ].join('\n')

    // Build alternating user/assistant message history from DB
    const history = dbMessages.filter(m => m.role !== 'SYSTEM')
    const apiMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
    for (const m of history) {
      const role    = m.role === 'USER' ? 'user' : 'assistant'
      const content = sanitizeForClaude(m.content)
      const last    = apiMessages[apiMessages.length - 1]
      if (last && last.role === role) {
        last.content += '\n' + content
      } else {
        apiMessages.push({ role, content })
      }
    }
    // Must start with user
    while (apiMessages.length > 0 && apiMessages[0].role !== 'user') apiMessages.shift()
    // Ensure latest user message is present at end
    if (apiMessages.length === 0 || apiMessages[apiMessages.length - 1].role !== 'user') {
      apiMessages.push({ role: 'user', content: latestMessage })
    }

    const client     = new Anthropic({ apiKey })
    const shownSlots: AvailableSlot[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let messages: any[] = apiMessages

    for (let iter = 0; iter < 8; iter++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await client.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 1024,
        system:     systemPrompt,
        tools:      V2_TOOLS,
        messages,
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolBlocks: any[] = (response.content ?? []).filter((b: any) => b.type === 'tool_use')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const textBlock: any    = (response.content ?? []).find((b: any) => b.type === 'text')

      if (toolBlocks.length === 0) {
        const reply = textBlock ? sanitizeForWhatsApp(textBlock.text as string) : `I'm here to help! Could you rephrase that for me? 😊`
        console.log(`[AgentV2] Reply after ${iter} tool round(s) for ${from}: "${reply.slice(0, 80)}"`)
        return reply
      }

      // Append assistant turn and execute all tool calls
      messages = [...messages, { role: 'assistant', content: response.content }]

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []
      for (const block of toolBlocks) {
        console.log(`[AgentV2] Tool: ${block.name}(${JSON.stringify(block.input ?? {}).slice(0, 100)})`)
        const result = await executeV2Tool(
          block.name as string,
          (block.input ?? {}) as Record<string, unknown>,
          from,
          conversationId,
          shownSlots
        )
        console.log(`[AgentV2] Result: ${result.slice(0, 150)}`)
        results.push({ type: 'tool_result', tool_use_id: block.id as string, content: result })
      }
      messages = [...messages, { role: 'user', content: results }]
    }

    return `I ran into a small issue — please try again or call us on +256 394 836 298 😊`
  } catch (err: any) {
    console.error('[AgentV2] Error:', err?.message)
    return `Sorry, I'm having a small issue right now. Please try again or call us on +256 394 836 298.`
  }
}
