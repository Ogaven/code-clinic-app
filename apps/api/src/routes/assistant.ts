import { Router } from 'express'
import { AppointmentStatus } from '@prisma/client'
import Anthropic from '@anthropic-ai/sdk'
import { requireAuth } from '../middleware/auth'
import { prisma } from '../lib/prisma'

const router  = Router()
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function kampalaDay(offsetDays = 0) {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }))
  d.setDate(d.getDate() + offsetDays)
  d.setHours(0, 0, 0, 0)
  return d
}

// ── Tool implementations ──────────────────────────────────────

async function get_today_stats() {
  const todayStart = kampalaDay(0)
  const todayEnd   = kampalaDay(1)
  const [total, confirmed, inProgress, escalations, agents] = await Promise.all([
    prisma.appointment.count({ where: { startAt: { gte: todayStart, lt: todayEnd } } }),
    prisma.appointment.count({ where: { startAt: { gte: todayStart, lt: todayEnd }, status: 'CONFIRMED' } }),
    prisma.appointment.count({ where: { startAt: { gte: todayStart, lt: todayEnd }, status: 'IN_PROGRESS' } }),
    prisma.agentLog.count({ where: { escalated: true, createdAt: { gte: todayStart } } }),
    prisma.agentPrompt.count({ where: { isActive: true } }),
  ])
  return { total, confirmed, inProgress, escalationsToday: escalations, activeAgents: agents }
}

async function search_patients(query: string) {
  const patients = await prisma.patient.findMany({
    where: {
      OR: [
        { firstName: { contains: query } },
        { lastName:  { contains: query } },
        { phone:     { contains: query } },
        { email:     { contains: query } },
      ],
      isActive: true,
    },
    select: { id: true, firstName: true, lastName: true, phone: true, email: true, gender: true, dob: true },
    take: 5,
  })
  return patients
}

async function create_appointment(patient_id: string, doctor_id: string, service_id: string, datetime: string) {
  const service = await prisma.service.findUnique({ where: { id: service_id } })
  if (!service) return { error: 'Service not found' }

  const startAt = new Date(datetime)
  const endAt   = new Date(startAt.getTime() + service.durationMins * 60000)

  const appt = await prisma.appointment.create({
    data: { patientId: patient_id, doctorId: doctor_id, serviceId: service_id, startAt, endAt, status: 'CONFIRMED' },
    include: {
      patient: { select: { firstName: true, lastName: true } },
      doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
      service: { select: { name: true } },
    },
  })
  return { id: appt.id, message: `Appointment created: ${appt.patient.firstName} ${appt.patient.lastName} with Dr. ${appt.doctor.user.firstName} for ${appt.service.name} at ${startAt.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' })}` }
}

async function update_appointment_status(appointment_id: string, status: string) {
  const valid = ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']
  if (!valid.includes(status)) return { error: 'Invalid status' }
  const appt = await prisma.appointment.update({
    where: { id: appointment_id },
    data: { status: status as AppointmentStatus },
    include: { patient: { select: { firstName: true, lastName: true } } },
  })
  return { success: true, message: `${appt.patient.firstName} ${appt.patient.lastName}'s appointment marked as ${status}` }
}

async function pause_agent(agent_type: string) {
  const prompt = await prisma.agentPrompt.findFirst({ where: { type: agent_type } })
  if (!prompt) return { error: `Agent type '${agent_type}' not found` }
  await prisma.agentPrompt.update({ where: { id: prompt.id }, data: { isActive: false } })
  return { success: true, message: `${prompt.name} paused successfully` }
}

async function send_notification(target_role: string, message: string, fromUserId: string, fromName: string) {
  const recipients = await prisma.user.findMany({ where: { role: target_role as any, isActive: true } })
  await Promise.all(recipients.map((u) =>
    (prisma as any).notification.create({
      data: {
        userId: u.id,
        type: 'MESSAGE',
        title: `Message from ${fromName}`,
        body: message.slice(0, 200),
        href: '/communications',
      },
    })
  ))
  return { success: true, message: `Notification sent to ${recipients.length} ${target_role} user(s)` }
}

// ── Tool definitions for Claude ───────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_today_stats',
    description: 'Get today\'s clinic statistics: appointment counts, AI agent status, escalations',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'search_patients',
    description: 'Search for patients by name, phone, or email',
    input_schema: {
      type: 'object' as const,
      properties: { query: { type: 'string', description: 'Search term' } },
      required: ['query'],
    },
  },
  {
    name: 'create_appointment',
    description: 'Create a new appointment for a patient',
    input_schema: {
      type: 'object' as const,
      properties: {
        patient_id:  { type: 'string', description: 'Patient ID' },
        doctor_id:   { type: 'string', description: 'Doctor ID' },
        service_id:  { type: 'string', description: 'Service ID' },
        datetime:    { type: 'string', description: 'ISO 8601 datetime string' },
      },
      required: ['patient_id', 'doctor_id', 'service_id', 'datetime'],
    },
  },
  {
    name: 'update_appointment_status',
    description: 'Update the status of an appointment (CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED, NO_SHOW)',
    input_schema: {
      type: 'object' as const,
      properties: {
        appointment_id: { type: 'string' },
        status:         { type: 'string' },
      },
      required: ['appointment_id', 'status'],
    },
  },
  {
    name: 'pause_agent',
    description: 'Pause an AI agent by type (e.g. BOOKING, REMINDER, FOLLOWUP)',
    input_schema: {
      type: 'object' as const,
      properties: { agent_type: { type: 'string' } },
      required: ['agent_type'],
    },
  },
  {
    name: 'send_notification',
    description: 'Send an in-app notification to staff by role (ADMIN, DOCTOR, ACCOUNTS)',
    input_schema: {
      type: 'object' as const,
      properties: {
        target_role: { type: 'string' },
        message:     { type: 'string' },
      },
      required: ['target_role', 'message'],
    },
  },
  {
    name: 'open_page',
    description: 'Navigate the user to a different page in the app',
    input_schema: {
      type: 'object' as const,
      properties: { route: { type: 'string', description: 'App route e.g. /receptionist/patients' } },
      required: ['route'],
    },
  },
  {
    name: 'highlight_element',
    description: 'Highlight a specific UI element to guide the user',
    input_schema: {
      type: 'object' as const,
      properties: { element_id: { type: 'string' }, label: { type: 'string' } },
      required: ['element_id'],
    },
  },
]

async function executeTool(name: string, input: any, userId: string, userName: string): Promise<{ result: any; clientAction?: any }> {
  switch (name) {
    case 'get_today_stats':         return { result: await get_today_stats() }
    case 'search_patients':         return { result: await search_patients(input.query) }
    case 'create_appointment':      return { result: await create_appointment(input.patient_id, input.doctor_id, input.service_id, input.datetime) }
    case 'update_appointment_status': return { result: await update_appointment_status(input.appointment_id, input.status) }
    case 'pause_agent':             return { result: await pause_agent(input.agent_type) }
    case 'send_notification':       return { result: await send_notification(input.target_role, input.message, userId, userName) }
    case 'open_page':               return { result: { success: true }, clientAction: { type: 'open_page', route: input.route } }
    case 'highlight_element':       return { result: { success: true }, clientAction: { type: 'highlight_element', element_id: input.element_id, label: input.label } }
    default:                        return { result: { error: 'Unknown tool' } }
  }
}

// ── POST /assistant/chat ──────────────────────────────────────

router.post('/chat', requireAuth, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey === 'sk-ant-...') {
    res.json({
      content: "I'm Sarah, Code Clinic's AI assistant! To enable my full capabilities, please add your Anthropic API key to the .env file as ANTHROPIC_API_KEY. Once configured, I can answer questions, book appointments, and much more!",
      clientActions: [],
    })
    return
  }

  try {
    const { messages, context } = req.body
    const user = req.user!
    const userName = `${user.firstName} ${user.lastName}`

    // Fetch live context
    const stats = await get_today_stats()
    const kampalaTime = new Date().toLocaleString('en-UG', {
      timeZone: 'Africa/Nairobi',
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

    const systemPrompt = `You are Sarah, Code Clinic's warm, professional AI assistant. You work at a dental clinic in Kampala, Uganda.

Current user: ${userName} (${user.role})
Current time: ${kampalaTime}
Current page: ${context?.page || 'Dashboard'}

LIVE CLINIC DATA:
- Appointments today: ${stats.total} (${stats.confirmed} confirmed, ${stats.inProgress} in progress)
- Active AI agents: ${stats.activeAgents}
- AI escalations today: ${stats.escalationsToday}

YOUR PERSONALITY:
- Warm, professional, Ugandan-friendly
- Greet the user by first name: ${user.firstName}
- Never say "I cannot do that" — always suggest an alternative
- Keep responses SHORT — max 3 sentences unless giving step-by-step instructions
- Use emojis sparingly but naturally

CAPABILITIES:
You can answer questions about the clinic data, perform actions using tools (with the user's confirmation for destructive actions), guide users through the app, and communicate with other staff.

When asked to perform an action that modifies data (book appointment, mark as complete, pause agent), briefly confirm with the user before executing UNLESS they've already confirmed.

When using open_page or highlight_element tools, explain what you're doing in natural language.`

    // First API call
    const firstResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    })

    const clientActions: any[] = []

    if (firstResponse.stop_reason === 'tool_use') {
      // Execute all tool calls
      const toolUseBlocks = firstResponse.content.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[]
      const toolResults: Anthropic.MessageParam = {
        role: 'user',
        content: await Promise.all(toolUseBlocks.map(async (block) => {
          const { result, clientAction } = await executeTool(block.name, block.input, user.id, userName)
          if (clientAction) clientActions.push(clientAction)
          return {
            type: 'tool_result' as const,
            tool_use_id: block.id,
            content: JSON.stringify(result),
          }
        })),
      }

      // Second call with tool results
      const finalResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        tools: TOOLS,
        messages: [...messages, { role: 'assistant', content: firstResponse.content }, toolResults],
      })

      const text = finalResponse.content.find(b => b.type === 'text') as Anthropic.TextBlock | undefined
      res.json({ content: text?.text || 'Done!', clientActions })
    } else {
      const text = firstResponse.content.find(b => b.type === 'text') as Anthropic.TextBlock | undefined
      res.json({ content: text?.text || '', clientActions })
    }
  } catch (e: any) {
    console.error('[ASSISTANT]', e.message)
    res.status(500).json({ error: 'Assistant unavailable', content: 'Sorry, I ran into an issue. Please try again! 🙏' })
  }
})

export default router
