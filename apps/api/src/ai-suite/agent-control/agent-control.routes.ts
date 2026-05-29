import { Router } from 'express'
import { prisma } from '../../lib/prisma'

const router = Router()

// ── Agent catalogue ───────────────────────────────────────────────────────────

const AGENTS = [
  { name: 'booking',         label: 'Booking Agent',               description: 'Handles appointment bookings via WhatsApp and SMS',   group: 'messaging' },
  { name: 'whatsapp',        label: 'WhatsApp Chatbot',            description: 'Responds to inbound WhatsApp messages',               group: 'messaging' },
  { name: 'sms',             label: 'SMS Chatbot',                 description: 'Responds to inbound SMS messages',                    group: 'messaging' },
  { name: 'facebook',        label: 'Facebook Chatbot',            description: 'Engages visitors on your Facebook page',              group: 'messaging' },
  { name: 'instagram',       label: 'Instagram Chatbot',           description: 'Responds to Instagram DMs',                          group: 'messaging' },
  { name: 'website',         label: 'Website Chatbot',             description: 'Chat widget for codeclinic.ug',                       group: 'messaging' },
  { name: 'reminder-caller', label: 'Appointment Reminder Caller', description: 'Calls patients the day before their appointment',    group: 'calling'   },
  { name: 'followup-caller', label: 'Follow-up Caller',            description: 'Checks in with patients after their visit',          group: 'calling'   },
  { name: 'debt-caller',     label: 'Debt Outreach Caller',        description: 'Reaches out to patients with outstanding balances',  group: 'calling'   },
]

// Agents are stored in AppSetting as agent_<name>_enabled = "true"/"false".
// This avoids the AiAgentConfig name-uniqueness limitation.

function agentKey(name: string) { return `agent_${name}_enabled` }

// ── GET /ai-suite/agents ──────────────────────────────────────────────────────

router.get('/agents', async (_req, res) => {
  try {
    const keys    = AGENTS.map(a => agentKey(a.name))
    const settings = await prisma.appSetting.findMany({ where: { key: { in: keys } } })
    const map = Object.fromEntries(settings.map(s => [s.key, s.value]))

    const result = AGENTS.map(a => ({
      name:        a.name,
      label:       a.label,
      description: a.description,
      group:       a.group,
      isActive:    (map[agentKey(a.name)] ?? 'true') === 'true',
    }))

    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /ai-suite/agents/escalation ─────────────────────────────────────────
// Must come before /:agentName/toggle to avoid route shadowing.

router.post('/agents/escalation', async (req, res) => {
  try {
    const { phone, template } = req.body as { phone?: string; template?: string }

    await Promise.all([
      prisma.appSetting.upsert({
        where:  { key: 'escalation_phone' },
        update: { value: phone ?? '' },
        create: { key: 'escalation_phone', value: phone ?? '' },
      }),
      prisma.appSetting.upsert({
        where:  { key: 'escalation_template' },
        update: { value: template ?? '' },
        create: { key: 'escalation_template', value: template ?? '' },
      }),
    ])

    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /ai-suite/agents/escalation ──────────────────────────────────────────

router.get('/agents/escalation', async (_req, res) => {
  try {
    const [phone, template] = await Promise.all([
      prisma.appSetting.findUnique({ where: { key: 'escalation_phone' } }),
      prisma.appSetting.findUnique({ where: { key: 'escalation_template' } }),
    ])
    res.json({
      phone:    phone?.value    ?? '',
      template: template?.value ?? 'Hi, patient [name] on [channel] needs your attention: [last message]',
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /ai-suite/agents/calling-enabled ─────────────────────────────────────
// Must come before /:agentName/toggle to avoid route shadowing.

router.get('/agents/calling-enabled', async (_req, res) => {
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: 'calling_agents_enabled' } })
    res.json({ enabled: (setting?.value ?? 'false') === 'true' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /ai-suite/agents/calling-enabled ────────────────────────────────────

router.post('/agents/calling-enabled', async (req, res) => {
  try {
    const { enabled } = req.body as { enabled: boolean }
    await prisma.appSetting.upsert({
      where:  { key: 'calling_agents_enabled' },
      update: { value: String(!!enabled) },
      create: { key: 'calling_agents_enabled', value: String(!!enabled) },
    })
    res.json({ enabled: !!enabled })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /ai-suite/agents/:agentName/toggle ───────────────────────────────────

router.post('/agents/:agentName/toggle', async (req, res) => {
  try {
    const { agentName } = req.params

    if (!AGENTS.find(a => a.name === agentName)) {
      return res.status(404).json({ error: 'Unknown agent' })
    }

    const key      = agentKey(agentName)
    const existing = await prisma.appSetting.findUnique({ where: { key } })
    const current  = (existing?.value ?? 'true') === 'true'
    const next     = !current

    await prisma.appSetting.upsert({
      where:  { key },
      update: { value: String(next) },
      create: { key, value: String(next) },
    })

    res.json({ name: agentName, isActive: next })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
