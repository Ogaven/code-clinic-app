import Anthropic from '@anthropic-ai/sdk'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const SARAH_SYSTEM_PROMPT = `You are Sarah, the patient care assistant for Code Clinic, a dental clinic in Kampala, Uganda. You are warm, friendly, and speak in natural conversational Ugandan English — not stiff, not formal, not robotic. You genuinely care about every patient. You remember everything about them from previous conversations and refer to their history naturally without making it feel strange. You help patients book, reschedule, and cancel appointments conversationally. You send reminders and follow up after treatment warmly. When discussing outstanding balances you are empathetic and non-judgmental — like a trusted friend helping them sort things out, never making them feel embarrassed. You know everything about Code Clinic's services, prices, hours, and doctors from the knowledge provided to you. When you truly cannot help, you escalate gracefully to a human staff member by saying you will get someone to follow up. You sign off messages as 'Sarah — Code Clinic 😊'. You keep responses short and conversational — 1 to 3 sentences maximum unless the patient asks for detail. Never say you are an AI unless directly and explicitly asked. If asked directly, say you are Sarah, Code Clinic's care assistant. Never mention Claude or Anthropic.`

interface ContextPackage {
  patientName: string
  conversationHistory: string
  appointments: string
  knowledgeBase: string
}

async function buildContext(
  conversationId: string,
  from: string,
  message: string
): Promise<ContextPackage> {
  // Step 1 — Look up patient by phone number
  const patient = await prisma.patient.findUnique({
    where: { phone: from },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      createdAt: true,
    },
  })

  const patientName = patient
    ? `${patient.firstName} ${patient.lastName}`
    : 'Unknown patient'

  // Step 2 — Last 15 messages from this conversation, oldest first
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

  // Step 3 — Last 3 appointments with doctor and service names
  let appointments = 'none on record'
  if (patient) {
    const appts = await prisma.appointment.findMany({
      where: { patientId: patient.id },
      orderBy: { startAt: 'desc' },
      take: 3,
      include: {
        doctor: {
          include: {
            user: { select: { firstName: true, lastName: true } },
          },
        },
        service: { select: { name: true } },
      },
    })

    if (appts.length > 0) {
      appointments = appts
        .map(a => {
          const date = a.startAt.toLocaleDateString('en-UG', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
          const doctor = `Dr ${a.doctor.user.firstName} ${a.doctor.user.lastName}`
          return `- ${date}: ${a.service.name} with ${doctor} (status: ${a.status})`
        })
        .join('\n')
    }
  }

  // Step 4 — RAG: ILIKE search on AiKnowledgeBase using first meaningful word (≥4 chars)
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

export async function getAgentReply(
  conversationId: string,
  from: string,
  latestMessage: string
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    console.warn('[Agent] ANTHROPIC_API_KEY not set — returning fallback')
    return "Hi! I've received your message and a team member will be with you shortly. For urgent matters please call us directly.\n\nSarah — Code Clinic 😊"
  }

  const context = await buildContext(conversationId, from, latestMessage)

  // Build Claude messages array from conversation history lines
  const historyLines = context.conversationHistory
    .split('\n')
    .filter(line => line.trim().length > 0)

  const messages: { role: 'user' | 'assistant'; content: string }[] = []

  for (const line of historyLines) {
    if (line.startsWith('Patient: ')) {
      messages.push({ role: 'user', content: line.slice('Patient: '.length) })
    } else if (line.startsWith('Sarah: ')) {
      messages.push({ role: 'assistant', content: line.slice('Sarah: '.length) })
    }
  }

  // Append current incoming message as final user turn.
  // If history was empty (first message from this patient) add it directly.
  // If history already ends with a user turn containing this message, Claude already
  // has it — but we still ensure the conversation ends on a user turn.
  if (messages.length === 0) {
    messages.push({ role: 'user', content: latestMessage })
  } else if (messages[messages.length - 1].role !== 'user') {
    messages.push({ role: 'user', content: latestMessage })
  }

  // Compose system prompt with patient context + optional knowledge base
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

  const system = systemParts.join('\n')

  try {
    const client = new Anthropic({ apiKey })

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system,
      messages,
    })

    const block = response.content[0]
    if (block.type === 'text') return block.text

    return "I'm here to help! Could you please rephrase that for me?\n\nSarah — Code Clinic 😊"
  } catch (err) {
    console.error('[Agent] Claude API error:', err)
    return "Sorry, I'm having a small issue right now. Please try again or call the clinic directly.\n\nSarah — Code Clinic 😊"
  }
}
