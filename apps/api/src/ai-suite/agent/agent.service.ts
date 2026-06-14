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
    // "booking for someone else" patterns
    'for my mother', 'for my father', 'for my mum', 'for my dad', 'for my mom',
    'for my wife', 'for my husband', 'for my son', 'for my daughter',
    'for my sister', 'for my brother', 'for my child', 'for my friend',
    'bring my mother', 'bring my wife', 'bring my husband', 'bring my son',
    'bring my daughter', 'bring my mum', 'bring her in', 'bring him in',
  ]
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

async function buildClinicalConcernResponse(followupCtx?: { serviceName: string; doctorName: string }): Promise<string> {
  const now          = new Date()
  const eatDate      = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }))
  const eatDayOfWeek = eatDate.getDay()
  const eatHourNow   = eatDate.getHours()
  const todayHours   = await prisma.workingHours.findUnique({ where: { dayOfWeek: eatDayOfWeek } }).catch(() => null)

  let clinicOpen = false
  if (todayHours && todayHours.isOpen) {
    const openH  = parseInt(todayHours.openTime.split(':')[0])
    const closeH = parseInt(todayHours.closeTime.split(':')[0])
    clinicOpen   = eatHourNow >= openH && eatHourNow < closeH
  }

  if (clinicOpen) {
    if (followupCtx) {
      return `I'm so sorry to hear that 😔 Since this is related to your ${followupCtx.serviceName} yesterday with Dr ${followupCtx.doctorName}, let me get our team to look into this for you right away. Someone will call you within the hour — or if this is urgent right now, please call us on +256 394 836 298.`
    }
    return `I'm so sorry to hear that 😔 I've flagged this as urgent for our team — someone will call you within the hour. If this is a dental emergency right now, please call us directly on +256 394 836 298.`
  }
  const next = await getNextOpeningInfo()
  if (followupCtx) {
    return `I'm so sorry to hear that 😔 Since this is related to your ${followupCtx.serviceName} yesterday with Dr ${followupCtx.doctorName}, let me get our team to look into this for you right away. We're currently closed, but as soon as we open ${next.dayName} at ${next.time}, someone will call you first thing. For emergencies, call us on +256 394 836 298.`
  }
  return `I'm so sorry to hear that 😔 I've flagged this as urgent for our team. We're currently closed, but as soon as we open ${next.dayName} at ${next.time}, someone will call you first thing. If this is a dental emergency right now, call us on +256 394 836 298 — they may be able to assist even outside normal hours.`
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
        setBookingState(from, { state: 'AWAITING_DOCTOR_PREFERENCE', serviceId: service.id })
        return `Got it — ${service.name} 😊 Do you have a preferred doctor, or shall I find whoever is available soonest?`
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

async function handleAwaitingService(from: string, message: string): Promise<string> {
  // Clinical concern takes priority even mid-flow
  if (isClinicalConcern(message)) {
    clearBookingState(from)
    return buildClinicalConcernResponse()
  }

  const service = await matchService(message)

  if (!service) {
    // Never dump the full service list — ask a clarifying question instead
    return `I'd love to help! Are you looking for something like a cleaning, filling, whitening, extraction, or a checkup? Just tell me what you need 😊`
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

async function handleAwaitingSlotConfirmation(
  from: string,
  message: string,
  state: BookingStateEntry
): Promise<string> {
  const choice = parseSlotChoice(message)

  if (!choice || !state.availableSlots || choice > state.availableSlots.length) {
    const lower   = message.toLowerCase()
    const trimmed = message.trim()
    const isRejection = trimmed.length > 8 &&
      /\bnot\b|\bdon'?t\b|\bno\b|prefer|different|another|change|switch|rather|instead|wrong/i.test(lower)
    if (isRejection) {
      setBookingState(from, { state: 'AWAITING_DOCTOR_PREFERENCE', serviceId: state.serviceId })
      return `No problem! Would you like me to find slots with a different doctor, or a different time? 😊`
    }
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
    // Dedup: don't fire again if already alerted for this conversation within 2 hours
    const recentAlert = await prisma.aiMessage.findFirst({
      where: {
        conversationId: params.conversationId,
        role:           'SYSTEM',
        content:        { contains: 'STAFF_ALERTED' },
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

    // 1. WhatsApp to clinic front desk
    await sendWhatsAppMessage('+256394836298', alertText)

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

    // 3. Dedup marker — SYSTEM role is excluded from Sarah's context window
    await prisma.aiMessage.create({
      data: {
        conversationId: params.conversationId,
        role:           'SYSTEM',
        content:        'STAFF_ALERTED: clinical concern',
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

    return buildClinicalConcernResponse(followupCtx)
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
