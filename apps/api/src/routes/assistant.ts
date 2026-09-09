import { Router } from 'express'
import { AppointmentStatus } from '@prisma/client'
import OpenAI from 'openai'
import { requireAuth } from '../middleware/auth'
import { prisma } from '../lib/prisma'

const router = Router()
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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

// ── Tool definitions (OpenAI function-calling format) ─────────

const TOOLS = [
  {
    type: 'function' as const,
    name: 'get_today_stats',
    description: 'Get today\'s clinic statistics: appointment counts, AI agent status, escalations',
    parameters: { type: 'object' as const, properties: {}, required: [], additionalProperties: false },
    strict: false,
  },
  {
    type: 'function' as const,
    name: 'search_patients',
    description: 'Search for patients by name, phone, or email',
    parameters: {
      type: 'object' as const,
      properties: { query: { type: 'string', description: 'Search term' } },
      required: ['query'],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: 'function' as const,
    name: 'create_appointment',
    description: 'Create a new appointment for a patient',
    parameters: {
      type: 'object' as const,
      properties: {
        patient_id:  { type: 'string', description: 'Patient ID' },
        doctor_id:   { type: 'string', description: 'Doctor ID' },
        service_id:  { type: 'string', description: 'Service ID' },
        datetime:    { type: 'string', description: 'ISO 8601 datetime string' },
      },
      required: ['patient_id', 'doctor_id', 'service_id', 'datetime'],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: 'function' as const,
    name: 'update_appointment_status',
    description: 'Update the status of an appointment (CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED, NO_SHOW)',
    parameters: {
      type: 'object' as const,
      properties: {
        appointment_id: { type: 'string' },
        status:         { type: 'string' },
      },
      required: ['appointment_id', 'status'],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: 'function' as const,
    name: 'pause_agent',
    description: 'Pause an AI agent by type (e.g. BOOKING, REMINDER, FOLLOWUP)',
    parameters: {
      type: 'object' as const,
      properties: { agent_type: { type: 'string' } },
      required: ['agent_type'],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: 'function' as const,
    name: 'send_notification',
    description: 'Send an in-app notification to staff by role (ADMIN, DOCTOR, ACCOUNTS)',
    parameters: {
      type: 'object' as const,
      properties: {
        target_role: { type: 'string' },
        message:     { type: 'string' },
      },
      required: ['target_role', 'message'],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: 'function' as const,
    name: 'open_page',
    description: 'Navigate the user to a different page in the app',
    parameters: {
      type: 'object' as const,
      properties: { route: { type: 'string', description: 'App route e.g. /receptionist/patients' } },
      required: ['route'],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: 'function' as const,
    name: 'highlight_element',
    description: 'Highlight a specific UI element to guide the user',
    parameters: {
      type: 'object' as const,
      properties: { element_id: { type: 'string' }, label: { type: 'string' } },
      required: ['element_id'],
      additionalProperties: false,
    },
    strict: false,
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
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    res.json({
      content: "I'm Sarah, Code Clinic's AI assistant! To enable my full capabilities, please add your OpenAI API key to the .env file as OPENAI_API_KEY. Once configured, I can answer questions, book appointments, and much more!",
      clientActions: [],
    })
    return
  }

  try {
    // Client sends prior turns as simple { role, content } pairs — provider-neutral.
    const { messages, context } = req.body as { messages: Array<{ role: string; content: string }>; context?: { page?: string } }
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

    const clientActions: any[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let input: any[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ]

    for (let iter = 0; iter < 4; iter++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await openai.responses.create({
        model: 'gpt-5.6-sol',
        input,
        tools: TOOLS,
        max_output_tokens: 1024,
      })
      console.log(`[ASSISTANT] call${iter + 1} in=${response.usage?.input_tokens ?? '?'} out=${response.usage?.output_tokens ?? '?'}`)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolCalls: any[] = (response.output ?? []).filter((o: any) => o.type === 'function_call')

      if (toolCalls.length === 0) {
        res.json({ content: response.output_text || '', clientActions })
        return
      }

      input = [...input, ...response.output]
      for (const call of toolCalls) {
        let args: any = {}
        try { args = JSON.parse(call.arguments || '{}') } catch { /* leave empty on parse failure */ }
        const { result, clientAction } = await executeTool(call.name, args, user.id, userName)
        if (clientAction) clientActions.push(clientAction)
        input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) })
      }
    }

    res.json({ content: 'Done!', clientActions })
  } catch (e: any) {
    console.error('[ASSISTANT]', e.message)
    res.status(500).json({ error: 'Assistant unavailable', content: 'Sorry, I ran into an issue. Please try again! 🙏' })
  }
})

export default router
