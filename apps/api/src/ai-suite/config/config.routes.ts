import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../../middleware/auth'

const router = Router()
const prisma = new PrismaClient()

async function getConfig() {
  let config = await prisma.aiAgentConfig.findFirst()
  if (!config) {
    config = await prisma.aiAgentConfig.create({
      data: { name: 'Sarah', personality: 'warm, friendly, conversational Ugandan English' },
    })
  }
  return config
}

// GET /ai-suite/config
router.get('/config', requireAuth, async (_req, res) => {
  try {
    const config = await getConfig()
    res.json({
      id:                 config.id,
      name:               config.name,
      systemPrompt:       config.systemPrompt ?? null,
      isActive:           config.isActive,
      escalationPhone:    config.escalationPhone ?? null,
      escalationTriggers: config.escalationTriggers ? JSON.parse(config.escalationTriggers) : [],
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /ai-suite/config
router.patch('/config', requireAuth, async (req, res) => {
  try {
    const config = await getConfig()
    const { systemPrompt, escalationPhone, escalationTriggers, name } = req.body

    const updated = await prisma.aiAgentConfig.update({
      where: { id: config.id },
      data: {
        ...(name             !== undefined && { name }),
        ...(systemPrompt     !== undefined && { systemPrompt }),
        ...(escalationPhone  !== undefined && { escalationPhone }),
        ...(escalationTriggers !== undefined && {
          escalationTriggers: JSON.stringify(
            Array.isArray(escalationTriggers) ? escalationTriggers : [escalationTriggers],
          ),
        }),
      },
    })

    res.json({
      id:                 updated.id,
      name:               updated.name,
      systemPrompt:       updated.systemPrompt ?? null,
      isActive:           updated.isActive,
      escalationPhone:    updated.escalationPhone ?? null,
      escalationTriggers: updated.escalationTriggers ? JSON.parse(updated.escalationTriggers) : [],
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
