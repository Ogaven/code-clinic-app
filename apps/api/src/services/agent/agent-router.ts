import { PrismaClient } from '@prisma/client'
import { loadPatientContext, findRecentMissedOutbound } from './agent-memory'
import { AgentContext } from './agent-prompt'

const prisma = new PrismaClient()

// ── Route inbound/outbound context ─────────────────────────────

export async function routeAgentContext(
  phoneNumber: string,
  channel: 'VOICE' | 'WHATSAPP',
  direction: 'INBOUND' | 'OUTBOUND',
  outboundQueueId?: string
): Promise<AgentContext> {
  // Step 1: Load patient and their memory
  const patient = await loadPatientContext(phoneNumber)

  // Step 2: OUTBOUND — load queue item for mode/appointment context
  if (direction === 'OUTBOUND' && outboundQueueId) {
    const queueItem = await prisma.outboundQueue.findUnique({
      where: { id: outboundQueueId },
    })
    if (!queueItem) throw new Error(`OutboundQueue item not found: ${outboundQueueId}`)

    let appointment = null
    if (queueItem.appointmentId) {
      appointment = await prisma.appointment.findUnique({
        where: { id: queueItem.appointmentId },
        include: {
          doctor: { include: { user: { select: { firstName: true, lastName: true } } } },
          service: { select: { name: true } },
        },
      })
    }

    const mode = queueItem.agentMode as 'REMINDER' | 'FOLLOWUP' | 'DEBT'

    return {
      mode,
      channel,
      patient: patient as AgentContext['patient'],
      appointment,
    }
  }

  // Step 3: INBOUND — check for recent missed outbound context
  const recentMissed = patient?.agentMemory
    ? findRecentMissedOutbound(patient.agentMemory)
    : null

  return {
    mode: 'INBOUND',
    channel,
    patient: patient as AgentContext['patient'],
    recentMissedContext: recentMissed
      ? { summary: recentMissed.summary, interactionType: recentMissed.interactionType }
      : null,
  }
}
