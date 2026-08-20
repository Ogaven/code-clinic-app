/**
 * Part B — Find patients who received fake booking confirmations
 *
 * Queries ai_messages for AGENT messages containing booking-confirmation language,
 * then cross-references with the appointments table to find cases where no real
 * appointment exists for that patient around the time the confirmation was sent.
 *
 * READ-ONLY — does not create, modify, or delete any data.
 *
 * Run on server after deploy:
 *   node dist/find-hallucinated-bookings.js
 */

import { prisma } from './lib/prisma'
import { phoneVariants } from './utils/phone'

const CONFIRMATION_PHRASES = [
  'booked',
  "you're all set",
  'confirmed for',
  'appointment is confirmed',
  'see you at',
  'see you on',
  'successfully booked',
  'i have booked',
  "i've booked",
  'appointment has been',
]

function hasConfirmationLanguage(text: string): boolean {
  const lower = text.toLowerCase()
  return CONFIRMATION_PHRASES.some(p => lower.includes(p))
}

async function run() {
  console.log('\n=== Part B: Hallucinated Booking Detection ===\n')
  console.log('Scanning ai_messages for booking confirmations with no matching appointment...\n')

  // Load all AGENT messages with confirmation language
  const agentMessages = await prisma.aiMessage.findMany({
    where: { role: 'AGENT' },
    select: { id: true, conversationId: true, content: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`Total AGENT messages in DB: ${agentMessages.length}`)

  const confirmed = agentMessages.filter(m => hasConfirmationLanguage(m.content))
  console.log(`Messages with confirmation language: ${confirmed.length}\n`)

  const conversationIds = [...new Set(confirmed.map(m => m.conversationId))]
  console.log(`Distinct conversations with confirmation language: ${conversationIds.length}\n`)

  const affected: Array<{
    phone: string
    patientName: string
    conversationId: string
    fakeConfirmationAt: Date
    messageSnippet: string
  }> = []

  for (const convId of conversationIds) {
    const conv = await prisma.aiConversation.findUnique({
      where: { id: convId },
      select: { id: true, phoneNumber: true },
    })
    if (!conv?.phoneNumber) continue

    const phone = conv.phoneNumber

    // Find patient record by phone (handles every historical stored format)
    const patient = await prisma.patient.findFirst({
      where: { phone: { in: phoneVariants(phone) } },
      select: { id: true, firstName: true, lastName: true },
    })
    const patientName = patient
      ? `${patient.firstName} ${patient.lastName}`.trim()
      : '(no patient record)'

    const convConfirmed = confirmed.filter(m => m.conversationId === convId)

    for (const msg of convConfirmed) {
      // Look for appointments for this patient created within ±48h of the confirmation
      const windowStart = new Date(msg.createdAt.getTime() - 48 * 60 * 60 * 1000)
      const windowEnd   = new Date(msg.createdAt.getTime() + 48 * 60 * 60 * 1000)

      let realApptCount = 0
      if (patient) {
        realApptCount = await prisma.appointment.count({
          where: {
            patientId: patient.id,
            createdAt: { gte: windowStart, lte: windowEnd },
          },
        })
      }

      if (realApptCount === 0) {
        // Avoid duplicate rows for the same conversation
        if (!affected.find(a => a.conversationId === convId)) {
          affected.push({
            phone,
            patientName,
            conversationId: convId,
            fakeConfirmationAt: msg.createdAt,
            messageSnippet: msg.content.slice(0, 150).replace(/\n/g, ' '),
          })
        }
      }
    }
  }

  // ── Print results ──────────────────────────────────────────────
  if (affected.length === 0) {
    console.log('✅ No hallucinated bookings detected.')
    console.log('   All confirmation messages correspond to real appointments, or no patient')
    console.log('   records were found to cross-reference.\n')
    return
  }

  console.log(`⚠️  Found ${affected.length} conversation(s) with likely hallucinated booking confirmations:\n`)
  console.log('─'.repeat(80))

  for (const row of affected) {
    console.log(`Phone        : ${row.phone}`)
    console.log(`Patient      : ${row.patientName}`)
    console.log(`Conversation : ${row.conversationId}`)
    console.log(`Fake confirm : ${row.fakeConfirmationAt.toLocaleString('en-UG', { timeZone: 'Africa/Nairobi' })} EAT`)
    console.log(`Message      : "${row.messageSnippet}..."`)
    console.log('─'.repeat(80))
  }

  console.log(`\nTotal affected patients: ${affected.length}`)
  console.log('ACTION NEEDED: These patients believe they have appointments that do not exist.')
  console.log('Please contact each patient directly to reschedule their appointment.\n')
}

run()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ Query failed:', err.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
